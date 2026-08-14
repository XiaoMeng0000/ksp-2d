'use strict';

// 资源系统 - 扫描机制（0.2.0 阶段6：主动扫描模型）
// 职责：
//   1. 主动扫描：扫描菜单"开始扫描"启动任务 → 随游戏时间累积进度 → 完成写入 scannedBodies
//      扫描时长 = 基准天数 × 星球规模系数 / 扫描仪等级系数（越高级扫描仪越快，越大星球越慢）
//   2. 扫描进度：scannedBodies[bodyId].progress（秒）/ scanDuration（秒）/ scanning（bool）
//   3. 资源可见性过滤：sandbox 全部可见；career 仅显示 tier ≤ 已扫描等级的资源
//   4. SOI 首访奖励：首次进入天体 SOI 记录 visitedBodies 并发放科技点
// 规则约定：自由模式（sandbox）丰度直接可见；生涯模式（career）需主动扫描后可见

import { gameState } from '../gameState.js';
import { eventBus, Events } from '../eventBus.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { shipSystem } from '../ship/shipSystem.js';
import { getBodyResources } from '../config/bodyResources.js';
import { celestialBodies } from '../physics/physics.js';
import { getResourceType } from './resourceTypes.js';
import { isScansEnabled } from './modeRules.js';
import { t } from '../config/strings.js';

// SOI 首访奖励（科技点），数值后置调整
const FIRST_VISIT_SCIENCE = 5;

// KSP 一天 = 6 小时 = 21600 秒（Kerbin 自转周期）
export const GAME_DAY_SECONDS = 21600;

// 扫描时长参数（秒）：
//   基准：tier1 扫描仪扫中等星球（radius 200 km，如 Mun）约 10 游戏天
//   规模系数：radius / 200000（线性；Kerbin 600 km → ×3，Minmus 60 km → ×0.3）
//   等级系数：tier1 ×1 / tier2 ×0.5 / tier3 ×0.25
const SCAN_BASE_SECONDS = GAME_DAY_SECONDS * 10;
const SCAN_REFERENCE_RADIUS = 200000;
const SCAN_TIER_SPEED = { 1: 1, 2: 0.5, 3: 0.25 };

// 获取飞船最高扫描等级（无扫描仪返回 0）
export function getShipScanTier(ship) {
    if (!ship || !Array.isArray(ship.modules)) return 0;
    let maxTier = 0;
    for (const mod of ship.modules) {
        const def = getModuleDef(mod.type);
        if (def && def.capability === 'scan_resources' && typeof def.scanTier === 'number') {
            maxTier = Math.max(maxTier, def.scanTier);
        }
    }
    return maxTier;
}

// 计算扫描时长（秒）：基准 × 星球规模 / 扫描仪等级倍率
// 未知天体或无扫描仪返回 0
export function getScanDuration(bodyId, scanTier) {
    if (!bodyId || scanTier <= 0) return 0;
    const body = celestialBodies.find(b => b.name === bodyId);
    if (!body) return 0;
    const sizeFactor = (body.radius || SCAN_REFERENCE_RADIUS) / SCAN_REFERENCE_RADIUS;
    const tierFactor = SCAN_TIER_SPEED[scanTier] || 1;
    return Math.max(GAME_DAY_SECONDS * 0.1, SCAN_BASE_SECONDS * sizeFactor * tierFactor);
}

// 获取天体扫描进度条目（无则返回 null）
// 结构：{ scanning, progress, scanDuration, scanTier }
export function getScanProgress(bodyId) {
    const player = gameState.getPlayerRef();
    const entry = player.scannedBodies && player.scannedBodies[bodyId];
    if (!entry || typeof entry.progress !== 'number') return null;
    return {
        scanning: !!entry.scanning,
        progress: entry.progress,
        scanDuration: entry.scanDuration || 0,
        scanTier: entry.scanTier || 0
    };
}

// 开始扫描（活动飞船带扫描仪、在目标天体 SOI 内、当前无进行中的全局扫描任务）
// 返回 { ok, reason } 供 UI 分支提示
export function startScan(ship, bodyId) {
    if (!ship || !bodyId) return { ok: false, reason: 'invalid' };
    const tier = getShipScanTier(ship);
    if (tier <= 0) return { ok: false, reason: 'noScanner' };
    if (ship.currentSOI !== bodyId) return { ok: false, reason: 'notInSOI' };

    // 全局仅允许一个进行中的扫描任务（扫描仪单通道）
    const player = gameState.getState().player;
    for (const [id, entry] of Object.entries(player.scannedBodies || {})) {
        if (entry && entry.scanning) return { ok: false, reason: 'busy', body: id };
    }

    // 该天体此等级已扫完 → 提示已知
    const existing = player.scannedBodies[bodyId] || { tiersScanned: 0 };
    if (existing.tiersScanned >= tier) return { ok: false, reason: 'alreadyKnown' };

    const duration = getScanDuration(bodyId, tier);
    if (duration <= 0) return { ok: false, reason: 'noDuration' };

    if (!player.scannedBodies[bodyId]) player.scannedBodies[bodyId] = { tiersScanned: 0 };
    player.scannedBodies[bodyId].scanning = true;
    player.scannedBodies[bodyId].progress = 0;
    player.scannedBodies[bodyId].scanDuration = duration;
    player.scannedBodies[bodyId].scanTier = tier;
    player.scannedBodies[bodyId].scanShipId = ship.id;
    gameState.setState({ player });
    return { ok: true };
}

// 扫描推进（由飞行场景每帧调用，simDt 已含时间加速倍率）
// 0.2.0 阶段6 修复：直接在 player 真身上累加（getState() 深拷贝会丢失进度），
// 完成时写入 tiersScanned、清理任务态并通知；返回完成的天体名（无完成返回 null）
export function updateScanProgress(simDt) {
    const player = gameState.getPlayerRef();
    if (!player.scannedBodies) return null;

    let completed = null;
    for (const [bodyId, entry] of Object.entries(player.scannedBodies)) {
        if (!entry || !entry.scanning) continue;
        // 防御：扫描飞船失效（被删除/读档残留/离开 SOI）→ 中断任务，防止孤儿任务永久卡死单通道
        if (entry.scanShipId) {
            const scanShip = shipSystem.getShip(entry.scanShipId);
            if (!scanShip || scanShip.currentSOI !== bodyId) {
                entry.scanning = false;
                entry.progress = 0;
                continue;
            }
        }
        entry.progress = (entry.progress || 0) + simDt;
        if (entry.progress >= entry.scanDuration) {
            // 取 max 不降级（换低级扫描仪重扫不降已有等级）
            entry.tiersScanned = Math.max(entry.tiersScanned || 0, entry.scanTier || 1);
            entry.scanning = false;
            entry.progress = entry.scanDuration;
            completed = bodyId;
            break;   // 全局单任务，完成即退出
        }
    }
    if (completed !== null) {
        if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
            window.showNotification(
                t('scan.completed', { name: completed, tier: gameState.getPlayerRef().scannedBodies[completed].tiersScanned }),
                'success'
            );
        }
    }
    return completed;
}

// 取消当前进行中的扫描（切换 SOI 离开 / 手动取消时调用；进度清零）
export function cancelScan() {
    const player = gameState.getState().player;
    if (!player.scannedBodies) return;
    let changed = false;
    for (const entry of Object.values(player.scannedBodies)) {
        if (entry && entry.scanning) {
            entry.scanning = false;
            entry.progress = 0;
            changed = true;
        }
    }
    if (changed) gameState.setState({ player });
}

// 获取指定天体对当前玩家可见的地表资源
// sandbox：全部直接可见；career：仅展示 tier ≤ 已扫描等级的资源
export function getVisibleBodyResources(bodyId) {
    const config = getBodyResources(bodyId);
    if (isScansEnabled()) {
        return { ...config.surface };
    }

    const player = gameState.getPlayerRef();
    const scanned = (player.scannedBodies && player.scannedBodies[bodyId])
        ? player.scannedBodies[bodyId].tiersScanned
        : 0;
    const visible = {};
    for (const [resId, info] of Object.entries(config.surface)) {
        const def = getResourceType(resId);
        const needTier = (def && typeof def.tier === 'number') ? def.tier : 1;
        if (needTier <= scanned) {
            visible[resId] = info;
        }
    }
    return visible;
}

// SOI 首访奖励：玩家首次进入某天体 SOI 时记录并发放科技点
export function awardFirstVisit(bodyId) {
    if (!bodyId) return 0;
    const state = gameState.getState();
    const player = state.player;
    if (!player.visitedBodies) player.visitedBodies = {};
    if (player.visitedBodies[bodyId]) return 0;

    player.visitedBodies[bodyId] = true;
    if (!player.resources) player.resources = {};
    // 0.2.0 阶段4：全模式发放（原仅 career；测试期保证 science 数字可观测）
    if (!player.resources.science) player.resources.science = { amount: 0 };
    player.resources.science.amount += FIRST_VISIT_SCIENCE;
    gameState.setState({ player });
    return FIRST_VISIT_SCIENCE;
}

// 订阅 SOI 切换事件：首访奖励 + 扫描任务随飞船离开而中断（进度清零）
eventBus.on(Events.SOI_CHANGED, ({ shipId, to }) => {
    if (!to) return;
    const sci = awardFirstVisit(to);
    if (sci > 0 && typeof window !== 'undefined' && typeof window.showNotification === 'function') {
        window.showNotification(t('scan.firstVisit', { name: to, n: sci }), 'success');
    }
    // 扫描飞船离开目标天体 → 任务中断（简单可靠；扫描仪必须留在轨道上工作）
    const player = gameState.getState().player;
    if (player.scannedBodies) {
        for (const [bodyId, entry] of Object.entries(player.scannedBodies)) {
            if (entry && entry.scanning && entry.scanShipId === shipId) {
                const ship = shipSystem.getShip(shipId);
                if (!ship || ship.currentSOI !== bodyId) {
                    cancelScan();
                    if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
                        window.showNotification(t('scan.aborted', { name: bodyId }), 'warning');
                    }
                }
                break;
            }
        }
    }
});
