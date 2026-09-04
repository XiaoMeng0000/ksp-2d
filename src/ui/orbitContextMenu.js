'use strict';

// 轨道线右键菜单（0.3.0 提交5 占位版 + 锚点化）
// 入口：flightScene 命中轨道线时调用；菜单锚定"点击那一刻的轨道时空点"（KSP2 式）：
//   - 面板通过"菱形选择点 + 竖线（连面板底边中点）"连接轨道点，与标签的折线（连右上）不同；
//   - **定点冻结**：锚点 = 点击瞬间解析的世界坐标（不随轨道重锚/宿主移动漂移），
//     每帧仅做相机变换（worldToScreen）；倒计时归零（到达目标时刻）→ 点与菜单自动消失；
//   数据为右键点快照（冻结：absTime = anchorTime + 段内偏移，不受时间推进影响）。
// 本版功能占位：点击项弹"未完成"通知。后续：机动计划 / 时间加速至目标点 / 快进。
// 显示优先级：#orbitLabels(500) < 锚点层(945) < 面板(950)——菜单显示在标签之上。

import { t } from '../config/strings.js';
import { eventBus, Events } from '../eventBus.js';
import { getCachedTime, bodyFuturePos } from '../physics/orbitalPrediction.js';
import { celestialBodies } from '../physics/physics.js';
import { formatGameDurationLong } from '../utils/format.js';
import { worldToScreen } from '../camera.js';
import { timeWarp } from '../timeWarp.js';
import { shipSystem } from '../ship/shipSystem.js';
import { timeToNextSOISwitch } from '../physics/orbitalPrediction.js';
import { getLastOrbitMarkers } from '../renderer.js';

// 菜单项定义（数据驱动：action 行为标识 + 图标字符 + strings key）
const MENU_ITEMS = [
    { action: 'createNode', icon: '+', nameKey: 'orbitMenu.createNode' },
    { action: 'warpToPoint', icon: '\u27A4', nameKey: 'orbitMenu.warpToPoint' },   // ➤
    { action: 'toApo', icon: '\u27A4', nameKey: 'orbitMenu.toApo' },
    { action: 'toPe', icon: '\u27A4', nameKey: 'orbitMenu.toPe' },
    { action: 'toSoi', icon: '\u27A4', nameKey: 'orbitMenu.toSoi' }
];

// 面板底边中点与锚点（轨道点）之间的连接间隙：菱形半径(约10) + 竖线段
const ANCHOR_GAP = 26;

// 快进至 Ap/Pe 的提前停表余量（秒）：在"距离到达拱点该值时"停止加速，1x 滑行至拱点
const APE_ARRIVE_MARGIN = 15;

let _menuEl = null;      // 菜单面板
let _anchorEl = null;    // 锚点层（菱形选择点 + 竖线）
let _titleEl = null;     // 标题元素（倒计时实时刷新）
let _menuData = null;    // 右键点快照（冻结）

function closeMenu(silent) {
    for (const el of [_menuEl, _anchorEl]) {
        if (el && el.parentNode) {
            el.remove();
        }
    }
    _menuEl = null;
    _anchorEl = null;
    _menuData = null;
    document.removeEventListener('click', closeOnOutside);
    document.removeEventListener('keydown', closeOnEsc);
    // 用户关闭才发关闭事件（音频对称）；幂等清理（打开新菜单前的内部清理）静默
    if (!silent) {
        eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: 'orbitContextMenu' });
    }
}

function closeOnOutside() {
    closeMenu(false);
}

function closeOnEsc(e) {
    if (e.key === 'Escape') {
        closeMenu(false);
    }
}

/**
 * 显示轨道线右键菜单（锚定轨道时空点）
 * @param {number} clientX - 触发点 clientX（首次定位近似用；之后由 updateOrbitContextMenu 锚定）
 * @param {number} clientY - 触发点 clientY
 * @param {Object} data - 点击点快照（冻结）：
 *   { worldX, worldY, soiName, absTime, tToNext, anchorBody, relX, relY }
 *   anchorBody + relX/relY = 轨道坐标锚定（点随宿主/轨道线移动，始终在线上）；
 *   absTime = 目标绝对时刻，倒计时归零时菜单自动消失
 * @param {HTMLCanvasElement} [canvas] - 画布（相机变换用；flightScene 传入）
 */
export function showOrbitContextMenu(clientX, clientY, data, canvas) {
    // 幂等：静默清理（菜单未开时不应发关闭事件，防干扰音频时序）
    closeMenu(true);

    _menuData = data || null;

    const menu = document.createElement('div');
    menu.className = 'orbit-context-menu';

    // 标题：T-{剩余时间}到目标点（每帧随倒计时刷新；无目标时刻显示 --）
    const remain = (data && data.absTime !== null && data.absTime !== undefined)
        ? Math.max(0, data.absTime - getCachedTime())
        : null;
    const title = document.createElement('div');
    title.className = 'ocm-title';
    title.textContent = 'T-'
        + (remain !== null ? formatGameDurationLong(remain) : '--')
        + t('orbitMenu.targetSuffix');
    menu.appendChild(title);
    _titleEl = title;

    // 菜单项：占位版——点击弹"未完成"通知并关闭
    for (const item of MENU_ITEMS) {
        const row = document.createElement('div');
        row.className = 'ocm-item';
        row.textContent = item.icon + ' ' + t(item.nameKey);
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            // 0.3.0 提交5：定点加速三项（目标点/远点/近点）——统一走 timeWarp.warpToTime
            let targetTime = null;
            let targetLabel = null;
            if (item.action === 'warpToPoint') {
                // 目标点：点击点快照（菜单打开瞬间冻结的绝对时刻）
                if (_menuData && _menuData.absTime !== null && _menuData.absTime !== undefined) {
                    targetTime = _menuData.absTime;
                    targetLabel = t(item.nameKey);
                }
            } else if (item.action === 'toApo' || item.action === 'toPe') {
                // 快进至远点/近点：取渲染层本帧实时广播的拱点标记 tToNext（标记显示规则不变，
                // 始终按现有逻辑显示；此处仅判定"功能可用性"）
                const markerType = item.action === 'toApo' ? 'apoapsis' : 'periapsis';
                const markers = getLastOrbitMarkers() || [];
                const mk = markers.find(x => x.type === markerType
                    && x.tToNext !== null && x.tToNext !== undefined);
                if (mk) {
                    // SOI 切换前不可达（切换发生在到达拱点之前）→ 功能不可用（标记照常显示）
                    const ship = shipSystem.getActiveShip();
                    const host = ship && ship.currentSOI
                        ? celestialBodies.find(b => b.name === ship.currentSOI)
                        : null;
                    const tSwitch = ship ? timeToNextSOISwitch(ship, host) : null;
                    if (tSwitch !== null && mk.tToNext > tSwitch) {
                        if (typeof window.showNotification === 'function') {
                            window.showNotification(t('orbitMenu.apeUnavailable'), 'warning');
                        }
                        closeMenu(false);
                        return;
                    }
                    // 优化：目标 = "距离到达拱点 APE_ARRIVE_MARGIN 秒处"——提前停表，1x 滑行至拱点
                    //（避免到点即停的突兀；不足余量时无需加速）
                    if (mk.tToNext > APE_ARRIVE_MARGIN) {
                        targetTime = getCachedTime() + mk.tToNext - APE_ARRIVE_MARGIN;
                        targetLabel = t(item.nameKey);
                    } else if (typeof window.showNotification === 'function') {
                        window.showNotification(t('orbitMenu.apeClose'), 'info');
                        closeMenu(false);
                        return;
                    }
                }
            } else if (item.action === 'toSoi') {
                // 快进至引力范围变化：只加速到最近一次 SOI 切换
                // （timeToNextSOISwitch 与飞行场景保护/预测线同口径：出界 + 嵌套进入统一；
                //   返回 null = 稳定轨道/深空/无解析轨道 → 无近期切换）
                const ship = shipSystem.getActiveShip();
                const host = ship && ship.currentSOI
                    ? celestialBodies.find(b => b.name === ship.currentSOI)
                    : null;
                const tSwitch = ship ? timeToNextSOISwitch(ship, host) : null;
                if (tSwitch !== null) {
                    targetTime = getCachedTime() + tSwitch;
                    targetLabel = t(item.nameKey);
                }
            }

            if (targetTime !== null) {
                timeWarp.warpToTime(targetTime);
                if (typeof window.showNotification === 'function') {
                    window.showNotification(t('orbitMenu.warpStarted', { name: targetLabel }), 'info');
                }
                closeMenu(false);
                return;
            }
            if (item.action === 'toSoi') {
                // 无近期切换：稳定轨道/深空（与"无拱点数据"区分提示）
                if (typeof window.showNotification === 'function') {
                    window.showNotification(t('orbitMenu.noSoi'), 'warning');
                }
                closeMenu(false);
                return;
            }
            if (item.action === 'warpToPoint' || item.action === 'toApo' || item.action === 'toPe') {
                // 数据不可用：目标点无时间数据 / 当前轨道无该拱点（逃逸、已过近点等）
                if (typeof window.showNotification === 'function') {
                    window.showNotification(t('orbitMenu.noTime'), 'warning');
                }
                closeMenu(false);
                return;
            }
            // TODO: 占位——其余功能（机动计划/快进至引力范围变化）后续提交实现
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('orbitMenu.todo', { name: t(item.nameKey) }), 'info');
            }
            closeMenu(false);
        });
        menu.appendChild(row);
    }

    // 首次近似定位（之后由 updateOrbitContextMenu 锚定）
    menu.style.left = Math.max(4, Math.min(clientX, window.innerWidth - 210)) + 'px';
    menu.style.top = Math.max(4, Math.min(clientY, window.innerHeight - 250)) + 'px';

    document.body.appendChild(menu);
    _menuEl = menu;

    // 锚点层（菱形选择点 + 竖线）——始终启用（冻结世界坐标）
    _anchorEl = document.createElement('div');
    _anchorEl.id = 'orbitContextMenuAnchor';
    document.body.appendChild(_anchorEl);

    eventBus.emit(Events.UI_PANEL_OPENED, { panelId: 'orbitContextMenu' });
    // 延迟绑定：避免打开本菜单的点击事件立即触发关闭
    setTimeout(() => {
        document.addEventListener('click', closeOnOutside);
        document.addEventListener('keydown', closeOnEsc);
    }, 0);

    // 立即做一次锚定（测量/定位/连线）
    if (canvas) {
        updateOrbitContextMenu(canvas);
    }
}

/**
 * 每帧更新锚定位置（flightScene render 循环调用；菜单未开时无操作）：
 * - **轨道坐标锚定**：世界坐标 = 宿主"当前时刻"位置 + 冻结的轨道相对坐标（relX/relY），
 *   与轨道线渲染同源——宿主（星球）移动 → 轨道线移动 → 菜单点**跟着轨道线走**，
 *   始终在线上、不沿轨道滑动；宿主缺失（深空段）时回退冻结世界坐标；
 * - 倒计时归零：absTime 到达（或已过）→ 点与菜单一起关闭；
 * - 面板保持"底边中点 经竖线 + 菱形 连到轨道点"，竖直连接（KSP2 式）；防出屏翻转/钳制。
 * @param {HTMLCanvasElement} canvas
 */
export function updateOrbitContextMenu(canvas) {
    if (!_menuEl || !_menuData || !canvas) return;

    // 倒计时归零 → 菜单与锚点一起消失（目标时空点已到达/走过）
    if (_menuData.absTime !== null && _menuData.absTime !== undefined
        && getCachedTime() >= _menuData.absTime) {
        closeMenu(false);
        return;
    }

    // 标题倒计时实时刷新
    if (_titleEl && _menuData.absTime !== null && _menuData.absTime !== undefined) {
        const remain = Math.max(0, _menuData.absTime - getCachedTime());
        _titleEl.textContent = 'T-' + formatGameDurationLong(remain) + t('orbitMenu.targetSuffix');
    }

    // 轨道坐标锚定：宿主当前时刻位置 + 冻结轨道相对坐标（随轨道线移动）
    let wx = _menuData.worldX;
    let wy = _menuData.worldY;
    if (_menuData.anchorBody && _menuData.relX !== null && _menuData.relX !== undefined
        && _menuData.relY !== null && _menuData.relY !== undefined) {
        const hostBody = celestialBodies.find(b => b.name === _menuData.anchorBody);
        const anchor = hostBody ? bodyFuturePos(hostBody, getCachedTime()) : { x: 0, y: 0 };
        wx = anchor.x + _menuData.relX;
        wy = anchor.y + _menuData.relY;
    }
    const s = worldToScreen(wx, wy, canvas);
    const ax = s.x;
    const ay = s.y;
    const w = _menuEl.offsetWidth || 200;
    const h = _menuEl.offsetHeight || 230;

    // 面板：水平居中对齐锚点；默认在锚点上方（底边中点 = 锚点 - ANCHOR_GAP）
    let left = ax - w / 2;
    let top = ay - ANCHOR_GAP - h;
    const flip = top < 4;                 // 上方放不下 → 翻转到锚点下方
    if (flip) {
        top = ay + ANCHOR_GAP;
    }
    const viewW = (canvas && canvas.width) || window.innerWidth;
    const viewH = (canvas && canvas.height) || window.innerHeight;
    left = Math.max(4, Math.min(left, viewW - w - 4));
    top = Math.max(4, Math.min(top, viewH - h - 4));
    _menuEl.style.left = left + 'px';
    _menuEl.style.top = top + 'px';

    // 锚点层：菱形（锚点位置）+ 竖线（锚点 → 面板近边的中点）
    // 锚点移出屏幕 → 隐藏锚点层（菜单贴边保留；KSP 菜单不跟出屏）
    const onScreen = ax > 4 && ax < viewW - 4 && ay > 4 && ay < viewH - 4;
    if (_anchorEl) {
        _anchorEl.textContent = '';   // 轻量重建（元素极少）
        if (onScreen) {
            const diamond = document.createElement('div');
            diamond.className = 'ocm-diamond';
            diamond.style.left = (ax - 7) + 'px';
            diamond.style.top = (ay - 7) + 'px';
            const panelEdgeY = flip ? top : (top + h);   // 翻转时连面板顶边中点（默认连底边）
            const line = document.createElement('div');
            line.className = 'ocm-line';
            line.style.left = (ax - 1) + 'px';
            line.style.top = Math.min(ay, panelEdgeY) + 'px';
            line.style.height = Math.max(1, Math.abs(panelEdgeY - ay)) + 'px';
            _anchorEl.appendChild(diamond);
            _anchorEl.appendChild(line);
        }
    }
}
