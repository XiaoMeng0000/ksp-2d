// 存档管理器模块

import { gameState } from './gameState.js';
// 导入轨道力学和物理计算函数
import { sceneManager } from './sceneManager.js';
// 导入 shipSystem 用于存档操作
import { shipSystem } from './ship/shipSystem.js';
import { facilitySystem } from './facility/facilitySystem.js';
import { stateToKepler } from './physics/orbitalMechanics.js';
import { celestialBodies, setActiveSystems, getActiveSystemIds } from './physics/physics.js';
import { eventBus, Events } from './eventBus.js';
import { t } from './config/strings.js';
import { VERSION_TEXT } from './config/version.js';
import { validateSystemSelection } from './config/starSystemIndex.js';
import { createInfoDialog } from './ui/uiComponents.js';
import { initFacilityStorage, addStorage } from './resources/cargoSystem.js';

class SaveManager {
    constructor() {
        if (SaveManager._instance) {
            return SaveManager._instance;
        }
        SaveManager._instance = this;
        this._worlds = {};
        this._worldList = [];
        this._cachedTime = 0;
        this._playerProfile = this._loadPlayerProfile();
        this._loadFromStorage();
        eventBus.on(Events.CELESTIAL_TIME_UPDATED, ({ time }) => {
            this._cachedTime = time;
        });
    }

    _generateId() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        const rand = Math.random().toString(36).slice(2, 6);
        return `${year}_${month}_${day}_${hours}${minutes}${seconds}_${ms}_${rand}`;
    }

    _loadPlayerProfile() {
        try {
            const saved = localStorage.getItem('ksp2d_profile');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error('[SaveManager] 加载玩家档案失败:', e);
        }
        return {
            // 0.2.0：points 废弃，迁移到 resources
            gameMode: 'sandbox',            // 游戏模式：'sandbox' 自由 | 'career' 生涯
            unlockedBlueprints: [],
            scannedBodies: {},              // 天体扫描进度：{ bodyId: { tiersScanned: n } }
            visitedBodies: {},              // 天体访问记录（已废弃：首访奖励已移除，字段保留兼容存档）
            resources: {
                science: { amount: 50 }         // 科技点（唯一全局资源）
            },
            totalPlayTime: 0,
            stats: { orbits: 0, soiChanges: 0 }
        };
    }

    _savePlayerProfile() {
        try {
            localStorage.setItem('ksp2d_profile', JSON.stringify(this._playerProfile));
        } catch (e) {
            console.error('[SaveManager] 保存玩家档案失败:', e);
        }
    }

    getPlayerProfile() {
        return this._playerProfile;
    }

    updatePlayerProfile(updates) {
        Object.assign(this._playerProfile, updates);
        this._savePlayerProfile();
    }

    _loadFromStorage() {
        try {
            const saved = localStorage.getItem('ksp2d_worlds');
            if (saved) {
                const data = JSON.parse(saved);
                this._worlds = data._worlds || {};
                this._worldList = data._worldList || [];
            }
        } catch (e) {
            console.error('[SaveManager] 从 localStorage 加载世界数据失败:', e);
            this._worlds = {};
            this._worldList = [];
        }
    }

    _saveToStorage() {
        try {
            localStorage.setItem('ksp2d_worlds', JSON.stringify({
                _worlds: this._worlds,
                _worldList: this._worldList
            }));
        } catch (e) {
            console.error('[SaveManager] 保存到 localStorage 失败:', e);
        }
    }

    // 玩家状态进存档/跨世界前清洗：剥离"进行中"的扫描任务（scanning → false, progress → 0）。
    // 扫描是实时进行的行为，不随存档持久化；否则 scanning 状态会经 _playerProfile / world.player
    // 跨世界泄漏，卡死全局"扫描单通道"（startScan 遇任何 scanning=true 即返回 busy）
    _sanitizePlayerForSave(player) {
        if (!player) return { scannedBodies: {}, visitedBodies: {}, resources: {} };
        const clean = JSON.parse(JSON.stringify(player));
        if (clean.scannedBodies) {
            for (const [bodyId, entry] of Object.entries(clean.scannedBodies)) {
                if (entry && entry.scanning) {
                    entry.scanning = false;
                    entry.progress = 0;
                }
            }
        }
        return clean;
    }

    // 序列化前清洗飞船对象：剔除下划线开头的运行时对象引用（如 _sasController，
    // 其内部持有 ship 回引形成循环引用，直接 JSON.stringify 会抛错），
    // 其余数据字段全部保留；控制器读档后由飞行场景自动懒重建
    _sanitizeShipForSave(ship) {
        const clean = {};
        for (const key of Object.keys(ship)) {
            if (key.startsWith('_')) continue;
            clean[key] = ship[key];
        }
        return clean;
    }

    // 创建新世界
    // starSystems: 星系组合 id 数组(创建时绑定,不可更改;缺省时按当前激活组合)
    createWorld(name, starSystems) {
        // 名称冲突检测
        const nameExists = this._worldList.some(id => this._worlds[id].metadata.name === name);
        if (nameExists) {
            console.warn(`[SaveManager] 世界名称 "${name}" 已存在`);
            return null;
        }

        // 星系组合:显式传入优先,否则沿用当前激活组合(保证不丢默认 kerbolar)
        const systemIds = Array.isArray(starSystems) && starSystems.length > 0
            ? [...starSystems]
            : getActiveSystemIds();
        const validation = validateSystemSelection(systemIds);
        if (!validation.ok) {
            console.warn(`[SaveManager] 星系组合校验失败,拒绝创建: ${validation.reason}`);
            return null;
        }

        const worldId = `world_${this._generateId()}`;
        const now = Date.now();
        const gameTime = this._cachedTime;
        const state = gameState.getState();

        // 补全 ship 运行时字段，与 saveCheckpoint 格式一致
        const ship = shipSystem.getActiveShip();

        

        const initialCheckpoint = {
            id: `checkpoint_${this._generateId()}`,
            name: '初始检查点',
            gameTime: gameTime,
            timeOffset: 0,
            timestamp: now,
            // 存入前清洗飞船对象，剔除运行时引用（_sasController），避免序列化循环引用
            ships: (state.ships || []).map(s => this._sanitizeShipForSave(s)),
            missions: state.missions || [],
            facilities: state.facilities || [],
            activeShipId: state.activeShipId || null,
            shipPos: ship ? { x: ship.pos.x, y: ship.pos.y } : undefined,
            shipVel: ship ? { x: ship.vel.x, y: ship.vel.y } : undefined,
            shipMode: ship ? ship.mode : undefined,
            shipCurrentSOI: ship ? ship.currentSOI : undefined,
            shipCurrentGM: ship ? ship.currentGM : undefined,
            currentScene: sceneManager.getCurrentScene()
        
        };

        this._worlds[worldId] = {
            metadata: {
                name: name || '新世界',
                createdAt: now,
                configVersion: state.version || '0.1.0',
                // 星系组合:创建时绑定,创建后不可更改
                starSystems: systemIds
            },
            player: this._sanitizePlayerForSave(this._playerProfile),
            checkpoints: [initialCheckpoint],
            activeCheckpointId: initialCheckpoint.id
        };

        this._worldList.unshift(worldId);
        this._saveToStorage();

        console.log(`[SaveManager] 世界创建成功: ${worldId}`);
        return worldId;
    }

    // 在当前世界创建新检查点
    saveCheckpoint(worldId, name) {
        const world = this._worlds[worldId];
        if (!world) {
            console.warn(`[SaveManager] 世界 ${worldId} 不存在`);
            return null;
        }

        // 使用 shipSystem 获取活动飞船
        const ship = shipSystem.getActiveShip();
        // 允许只有设施焦点没有活动飞船时存档
        if (!ship && !gameState.getState().activeFacilityId) {
            console.warn('[SaveManager] 无活动飞船或设施，无法获取存档引用');
            return null;
        }

        // 推力模式下禁止存档（仅飞船）
        if (ship && ship.mode === 'thrust') {
            console.warn('[SaveManager] 推力模式下禁止存档');
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('save.thrustBlocked'), 'warning');
            }
            return null;
        }

        // 存档前刷新 kepler，消除运行时累积偏差
        if (ship && ship.currentSOI) {
            const hostBody = celestialBodies.find(b => b.name === ship.currentSOI);
            if (hostBody) {
                // ship.pos 现在是相对宿主坐标，直接使用
                const freshKepler = stateToKepler(ship.pos, ship.vel, hostBody.gm);
                if (freshKepler) {
                    ship.kepler = freshKepler;
                    ship.orbitTime = 0;
                    console.log(`[SaveManager] 存档前 kepler 已刷新: a=${freshKepler.a.toFixed(2)}, e=${freshKepler.e.toFixed(4)}`);
                } else {
                    // 病态区间（径向/近抛物线）stateToKepler 返回 null：旧 kepler 可能为近抛物线
                    // 病态值（e-1 精度下溢会在双曲线分支产生 NaN），必须清空走物理层 RK4 兜底
                    ship.kepler = null;
                    ship.orbitTime = 0;
                    console.warn('[SaveManager] 存档前 kepler 刷新失败：stateToKepler 返回 null，已清空 kepler');
                }
            }
        }

        const gameTime = this._cachedTime;
        const activeFacId = gameState.getState().activeFacilityId;
        const activeFac = activeFacId ? facilitySystem.getFacility(activeFacId) : null;
        const timeOffset = ship ? (ship.orbitTime - gameTime) : (activeFac ? (activeFac.orbitTime - gameTime) : 0);

        const state = gameState.getState();

        const checkpointId = `checkpoint_${this._generateId()}`;
        const checkpoint = {
            id: checkpointId,
            name: name || `检查点 ${world.checkpoints.length + 1}`,
            gameTime: gameTime,
            timeOffset: timeOffset,
            // 保存飞船精确位置和速度
            shipPos: ship ? { x: ship.pos.x, y: ship.pos.y } : null,
            shipVel: ship ? { x: ship.vel.x, y: ship.vel.y } : null,
            timestamp: Date.now(),
            // 存入前清洗飞船对象，剔除运行时引用（_sasController），避免序列化循环引用
            ships: (state.ships || []).map(s => this._sanitizeShipForSave(s)),
            missions: state.missions || [],
            facilities: state.facilities || [],
            activeShipId: state.activeShipId || null,
            activeFacilityId: state.activeFacilityId || null,
            // 保存当前场景
            currentScene: sceneManager.getCurrentScene(),
            shipMode: ship ? ship.mode : null,
            shipCurrentSOI: ship ? ship.currentSOI : null,
            shipCurrentGM: ship ? ship.currentGM : null,
            shipThrottle: ship ? ship.throttle : null
        };

        world.checkpoints.unshift(checkpoint);
        world.activeCheckpointId = checkpointId;
        // 0.2.0 阶段4：同步玩家状态到世界档案与本地档案（读档按 world.player 恢复，不同步会回滚到初始 500 套）
        world.player = gameState.getState().player;
        this._playerProfile = world.player;
        this._savePlayerProfile();
        this._saveToStorage();

        console.log(`[SaveManager] 检查点创建成功: ${checkpointId}`);
        return checkpointId;
    }

    // 加载指定检查点
    loadCheckpoint(worldId, checkpointId) {
        const world = this._worlds[worldId];
        if (!world) {
            console.warn(`[SaveManager] 世界 ${worldId} 不存在`);
            return false;
        }

        const checkpoint = world.checkpoints.find(c => c.id === checkpointId);
        if (!checkpoint) {
            console.warn(`[SaveManager] 检查点 ${checkpointId} 不存在`);
            return false;
        }

        // 星系组合校验:存档绑定的星系必须全部存在于当前配置,否则拒绝加载
        // 旧存档无 starSystems 字段 → 默认 ['kerbolar'](创建于单星系时代,直接可读)
        const savedSystems = world.metadata.starSystems || ['kerbolar'];
        const validation = validateSystemSelection(savedSystems);
        if (!validation.ok) {
            console.warn(`[SaveManager] 拒绝加载:存档星系组合与当前配置不兼容 (${validation.reason})`);
            // 拒绝加载:弹模态信息框提示(仅"关闭"),玩家关闭后留在原场景
            createInfoDialog(t('save.systemIncompatibleTitle'), t('save.systemIncompatible'), t('common.close'));
            return false;
        }

        // 激活存档绑定的星系组合(重建天体集合,不改变任何物理逻辑)
        if (!setActiveSystems(savedSystems)) {
            console.warn('[SaveManager] 拒绝加载:星系组合激活失败');
            return false;
        }

        gameState.setState({
            ships: checkpoint.ships,
            player: this._sanitizePlayerForSave(world.player),
            missions: checkpoint.missions,
            facilities: checkpoint.facilities,
            gameTime: checkpoint.gameTime,
            activeShipId: checkpoint.activeShipId,
            activeFacilityId: checkpoint.activeFacilityId || null,
            // 同步存档绑定的星系组合(创建后不可改)
            starSystems: [...savedSystems],
            // 恢复当前场景
            currentScene: checkpoint.currentScene || 'menu'
        });

        // 旧存档字段迁移：为新版本新增属性提供默认值
        const allShips = gameState.getAllShipsRef();
        for (const s of allShips) {
            if (s.maneuverNodes === undefined) s.maneuverNodes = [];
            if (s.burnDuration === undefined) s.burnDuration = 120;
            // 0.2.0 阶段5：货仓默认值（无货运模块时为空池）
            if (s.cargo === undefined) s.cargo = {};
            // 0.2.0 迁移：旧 fuel/fuelCapacity（单一标量）→ resources（液氢/液氧，按 1:8 质量拆桶）
            if (!s.resources) {
                const oldFuel = typeof s.fuel === 'number' ? s.fuel : 0;
                const oldCap = typeof s.fuelCapacity === 'number' ? s.fuelCapacity : oldFuel;
                s.resources = {
                    hydrogen: { amount: oldFuel / 9, capacity: oldCap / 9 },
                    oxygen: { amount: oldFuel * 8 / 9, capacity: oldCap * 8 / 9 }
                };
                delete s.fuel;
                delete s.fuelCapacity;
            }
            // 0.2.0 阶段2：engineOut 默认值（旧存档无此字段视为正常状态）
            if (s.engineOut === undefined) s.engineOut = false;
        }

        // 0.2.0 阶段5：旧设施补存储槽（按类型 storageProfile 初始化空仓）
        for (const f of gameState.getAllFacilitiesRef()) {
            if (!f.storage) initFacilityStorage(f);
        }

        // 0.2.0 迁移：玩家字段（gameMode/scannedBodies/resources）
        const playerState = gameState.getState().player;
        if (!playerState.gameMode) playerState.gameMode = 'sandbox';
        if (!playerState.scannedBodies) playerState.scannedBodies = {};
        if (!playerState.visitedBodies) playerState.visitedBodies = {};
        if (!playerState.resources) {
            playerState.resources = {
                science: { amount: 50 }
            };
        }
        // 0.2.0 迁移：火箭零件 rocketParts → 材料套装 materialKits
        if (playerState.resources.rocketParts) {
            if (!playerState.resources.materialKits) {
                playerState.resources.materialKits = playerState.resources.rocketParts;
            }
            delete playerState.resources.rocketParts;
        }
        // 0.2.0 阶段5 迁移：全局实体资源（materialKits）退场 → 转入第一个设施的存储
        const legacyKits = playerState.resources.materialKits
            ? playerState.resources.materialKits.amount || 0
            : 0;
        delete playerState.resources.materialKits;
        if (legacyKits > 0) {
            const firstFacility = gameState.getAllFacilitiesRef()[0] || null;
            if (firstFacility) {
                addStorage(firstFacility, 'materialKits', legacyKits);
                console.log(`[SaveManager] 迁移：全局材料套装 ${legacyKits} 套转入设施 ${firstFacility.name} 存储`);
            }
        }
        if ('points' in playerState) delete playerState.points;
        gameState.setState({ player: playerState });

        // 切换到存档时的场景
        if (checkpoint.currentScene) {
            sceneManager.switchTo(checkpoint.currentScene);
        }

        // 加载后通过 shipSystem 切换活动飞船
        if (checkpoint.activeShipId) {
            shipSystem.switchShip(checkpoint.activeShipId);
        }

        world.activeCheckpointId = checkpointId;

        // 通过 EventBus 广播时间重置，由 main.js 统一处理天体更新
        eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: checkpoint.gameTime, dt: 0 });

        // 通过 shipSystem 获取活动飞船
        const ship = shipSystem.getActiveShip();

        // 根据偏移量还原飞船轨道时间
        if (ship && typeof checkpoint.timeOffset !== 'undefined') {
            ship.orbitTime = checkpoint.gameTime + checkpoint.timeOffset;
            console.log(`[SaveManager] 恢复 orbitTime: ${ship.orbitTime} (时间偏移: ${checkpoint.timeOffset})`);
        } else {
            // 兼容旧存档（没有 timeOffset 字段）
            if (ship) {
                ship.orbitTime = 0;
                console.warn('[SaveManager] 旧存档格式，orbitTime 已重置为 0');
            }
        }

        // 强制恢复到存档时的精确位置和速度
        if (ship && checkpoint.shipPos) {
            ship.pos.x = checkpoint.shipPos.x;
            ship.pos.y = checkpoint.shipPos.y;
            console.log(`[SaveManager] 恢复飞船位置: (${checkpoint.shipPos.x}, ${checkpoint.shipPos.y})`);
        }
        if (ship && checkpoint.shipVel) {
            ship.vel.x = checkpoint.shipVel.x;
            ship.vel.y = checkpoint.shipVel.y;
            console.log(`[SaveManager] 恢复飞船速度: (${checkpoint.shipVel.x}, ${checkpoint.shipVel.y})`);
        }

        // 重置帧计时器，防止读档后首帧 dt 异常大
        sceneManager.resetFrameTimer();

        // 恢复飞船运行时状态（兼容旧存档：无 shipMode 时默认为 on_rails）
        if (ship) {
            ship.mode = checkpoint.shipMode || 'on_rails';
            // 恢复 SOI 状态，避免 physicsUpdate 误判切换导致 vel 污染
            ship.currentSOI = checkpoint.shipCurrentSOI !== undefined ? checkpoint.shipCurrentSOI : null;
            ship.currentGM = checkpoint.shipCurrentGM !== undefined ? checkpoint.shipCurrentGM : 0;
        }

        // 根据恢复的 pos/vel 重算 kepler，消除与存档数据的不一致
        if (ship && ship.currentSOI && ship.mode === 'on_rails') {
            const hostBody = celestialBodies.find(b => b.name === ship.currentSOI);
            if (hostBody) {
                // ship.pos 现在是相对宿主坐标，直接使用
                const newKepler = stateToKepler(ship.pos, ship.vel, hostBody.gm);
                if (newKepler) {
                    ship.kepler = newKepler;
                    ship.orbitTime = 0;
                    console.log(`[SaveManager] kepler 已重算: a=${newKepler.a.toFixed(2)}, e=${newKepler.e.toFixed(4)}`);
                } else {
                    // 同存档前刷新：清空病态 kepler，由物理层 RK4 兜底（配合时间加速限档 ≤50x）
                    ship.kepler = null;
                    ship.orbitTime = 0;
                    console.warn('[SaveManager] kepler 重算失败：stateToKepler 返回 null，已清空 kepler');
                }
            }
        }

        this._saveToStorage();
        console.log(`[SaveManager] 检查点加载成功: ${checkpointId}`);
        return true;
    }

    // 获取世界列表
    getWorldList() {
        return this._worldList.map(worldId => {
            const world = this._worlds[worldId];
            if (!world) return null;
            return {
                id: worldId,
                name: world.metadata.name,
                createdAt: world.metadata.createdAt,
                checkpointCount: world.checkpoints.length,
                configVersion: world.metadata.configVersion
            };
        }).filter(Boolean);
    }

    // 获取世界完整数据
    getWorld(worldId) {
        return this._worlds[worldId] ? JSON.parse(JSON.stringify(this._worlds[worldId])) : null;
    }

    // 获取检查点列表
    getCheckpointList(worldId) {
        const world = this._worlds[worldId];
        if (!world) return [];
        return world.checkpoints.map(c => ({
            id: c.id,
            name: c.name,
            gameTime: c.gameTime,
            timestamp: c.timestamp
        }));
    }

    // 删除世界
    deleteWorld(worldId) {
        if (!this._worlds[worldId]) {
            console.warn(`[SaveManager] 世界 ${worldId} 不存在`);
            return false;
        }

        delete this._worlds[worldId];
        this._worldList = this._worldList.filter(id => id !== worldId);
        this._saveToStorage();

        console.log(`[SaveManager] 世界删除成功: ${worldId}`);
        return true;
    }

    // 删除检查点
    deleteCheckpoint(worldId, checkpointId) {
        const world = this._worlds[worldId];
        if (!world) {
            console.warn(`[SaveManager] 世界 ${worldId} 不存在`);
            return false;
        }

        const index = world.checkpoints.findIndex(c => c.id === checkpointId);
        if (index === -1) {
            console.warn(`[SaveManager] 检查点 ${checkpointId} 不存在`);
            return false;
        }

        world.checkpoints.splice(index, 1);
        if (world.activeCheckpointId === checkpointId) {
            world.activeCheckpointId = world.checkpoints.length > 0 ? world.checkpoints[0].id : null;
        }
        this._saveToStorage();

        console.log(`[SaveManager] 检查点删除成功: ${checkpointId}`);
        return true;
    }

    // 获取当前激活的检查点
    getActiveCheckpoint(worldId) {
        const world = this._worlds[worldId];
        if (!world || !world.activeCheckpointId) return null;
        return world.checkpoints.find(c => c.id === world.activeCheckpointId);
    }

    // 向后兼容：创建存档（默认使用第一个世界）
    createSave(name) {
        if (this._worldList.length === 0) {
            return null;
        }
        return this.saveCheckpoint(this._worldList[0], name);
    }

    // 向后兼容：加载存档（查找匹配的检查点）
    loadSave(id) {
        for (const worldId of this._worldList) {
            const world = this._worlds[worldId];
            if (world) {
                const checkpoint = world.checkpoints.find(c => c.id === id);
                if (checkpoint) {
                    return this.loadCheckpoint(worldId, id);
                }
            }
        }
        return false;
    }

    // 向后兼容：获取存档列表（返回第一个世界的检查点）
    getSaveList() {
        if (this._worldList.length === 0) return [];
        return this.getCheckpointList(this._worldList[0]);
    }

    // 向后兼容：删除存档
    deleteSave(id) {
        for (const worldId of this._worldList) {
            const world = this._worlds[worldId];
            if (world) {
                const checkpoint = world.checkpoints.find(c => c.id === id);
                if (checkpoint) {
                    return this.deleteCheckpoint(worldId, id);
                }
            }
        }
        return false;
    }

    // 向后兼容：获取存档数据
    getSaveData(id) {
        for (const worldId of this._worldList) {
            const world = this._worlds[worldId];
            if (world) {
                const checkpoint = world.checkpoints.find(c => c.id === id);
                if (checkpoint) {
                    return JSON.parse(JSON.stringify(checkpoint));
                }
            }
        }
        return null;
    }

    // ============================================================
    // 世界导入导出（0.2.5 存档交流：本地 JSON 文件跨设备迁移）
    // 导出：世界（含全部检查点）→ 单文件下载；导入分两步：
    //   readWorldExportFile 读取+校验（不落地）→ commitImportedWorld 落地
    // 导出不改变任何存储逻辑；导入走 _saveToStorage()，与本地存档同路径
    // ============================================================

    // 导出世界为本地 JSON 文件（浏览器下载）
    exportWorldToFile(worldId) {
        const world = this.getWorld(worldId);
        if (!world) {
            console.warn(`[SaveManager] 导出失败:世界 ${worldId} 不存在`);
            return false;
        }

        const exportData = {
            format: 'ksp2d_world_export',
            version: '1.0',
            exportedAt: Date.now(),
            appVersion: VERSION_TEXT,
            world: world
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this._sanitizeFileName(world.metadata.name)}_${this._formatFileTimestamp(Date.now())}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        // 延迟回收：部分浏览器在 click 后立即 revoke 会中断下载
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);

        console.log(`[SaveManager] 世界导出成功: ${worldId} (${world.metadata.name})`);
        return true;
    }

    // 清洗导出文件名：Windows 非法字符 → 下划线，去首尾点/空格
    _sanitizeFileName(name) {
        const cleaned = String(name || 'world')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/^[\s.]+|[\s.]+$/g, '')
            .trim();
        return cleaned || 'world';
    }

    // 导出时间戳格式：YYYYMMDD-HHMMSS
    _formatFileTimestamp(ts) {
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    // 读取并校验世界导出文件（不落地）
    // resolve(world) | reject(Error，err.code: 'format' | 'invalid' | 'system' | 'read')
    readWorldExportFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data || data.format !== 'ksp2d_world_export') {
                        reject(this._makeExportError('format', '文件格式不匹配'));
                        return;
                    }
                    const world = data.world;
                    if (!world || !world.metadata
                        || typeof world.metadata.name !== 'string' || !world.metadata.name.trim()) {
                        reject(this._makeExportError('invalid', '世界数据无效'));
                        return;
                    }
                    if (!Array.isArray(world.checkpoints) || world.checkpoints.length === 0) {
                        reject(this._makeExportError('invalid', '存档点数据无效'));
                        return;
                    }
                    // activeCheckpointId 指向不存在时重置为第一个检查点
                    if (!world.checkpoints.some(c => c.id === world.activeCheckpointId)) {
                        world.activeCheckpointId = world.checkpoints[0].id;
                    }
                    // 星系组合校验（与 loadCheckpoint 同一校验函数）
                    const savedSystems = world.metadata.starSystems || ['kerbolar'];
                    if (!validateSystemSelection(savedSystems).ok) {
                        reject(this._makeExportError('system', '星系配置不兼容'));
                        return;
                    }
                    resolve(world);
                } catch (err) {
                    if (err && err.code) {
                        reject(err);
                    } else {
                        reject(this._makeExportError('invalid', err && err.message ? err.message : '文件解析失败'));
                    }
                }
            };
            reader.onerror = () => reject(this._makeExportError('read', '文件读取失败'));
            reader.readAsText(file);
        });
    }

    // 构造带错误码的导入错误（供 UI 层分类提示）
    _makeExportError(code, message) {
        const err = new Error(message);
        err.code = code;
        return err;
    }

    // 导入世界落地：新 id、列表置顶、写入存储
    // nameOverride：导入命名（重名时由 UI 弹窗提供；缺省用世界原名称）
    commitImportedWorld(world, nameOverride) {
        if (!world || !world.metadata) {
            console.warn('[SaveManager] 导入失败:世界数据无效');
            return null;
        }
        const override = (typeof nameOverride === 'string' && nameOverride.trim()) ? nameOverride.trim() : '';
        const baseName = override || String(world.metadata.name || '').trim();
        if (!baseName) {
            console.warn('[SaveManager] 导入失败:世界名称为空');
            return null;
        }
        // 星系校验兜底（防调用方篡改；正常流程 readWorldExportFile 已校验）
        const savedSystems = world.metadata.starSystems || ['kerbolar'];
        if (!validateSystemSelection(savedSystems).ok) {
            console.warn('[SaveManager] 导入失败:星系配置不兼容');
            return null;
        }

        // 名称唯一兜底：冲突时追加 (2) (3)…（玩家自命名若重名同样生效）
        const name = this._ensureUniqueWorldName(baseName);
        const worldId = `world_${this._generateId()}`;
        // 深拷贝落地，切断与导入对象的外部引用
        const stored = JSON.parse(JSON.stringify(world));
        stored.metadata.name = name;
        this._worlds[worldId] = stored;
        this._worldList.unshift(worldId);
        this._saveToStorage();

        console.log(`[SaveManager] 世界导入成功: ${worldId} (${name})`);
        return worldId;
    }

    // 保证世界名唯一：冲突时追加 (2) (3)… 后缀
    _ensureUniqueWorldName(name) {
        const exists = (n) => this._worldList.some(id =>
            this._worlds[id] && this._worlds[id].metadata.name === n);
        if (!exists(name)) return name;
        let i = 2;
        while (exists(`${name} (${i})`)) i++;
        return `${name} (${i})`;
    }

    clearAll() {
        this._worlds = {};
        this._worldList = [];
        this._saveToStorage();
        console.log('[SaveManager] 所有世界已清空');
    }
}

export const saveManager = new SaveManager();

if (typeof window !== 'undefined') {
    window.__saveManager = saveManager;
    console.log('[SaveManager] 单例已创建，可通过 window.__saveManager 访问');
}
