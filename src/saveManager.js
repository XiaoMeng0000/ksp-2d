// 存档管理器模块

import { gameState } from './gameState.js';
// 导入轨道力学和物理计算函数
import { sceneManager } from './sceneManager.js';
// 导入 shipSystem 用于存档操作
import { shipSystem } from './ship/shipSystem.js';
import { facilitySystem } from './facility/facilitySystem.js';
import { stateToKepler } from './physics/orbitalMechanics.js';
import { getSOIHost, getRelativePosition, celestialBodies } from './physics/physics.js';
import { eventBus, Events } from './eventBus.js';

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
            points: 0,
            unlockedBlueprints: [],
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

    // 创建新世界
    createWorld(name) {
        // 名称冲突检测
        const nameExists = this._worldList.some(id => this._worlds[id].metadata.name === name);
        if (nameExists) {
            console.warn(`[SaveManager] 世界名称 "${name}" 已存在`);
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
            ships: state.ships || [],
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
                configVersion: state.version || '0.1.0'
            },
            player: { ...this._playerProfile },
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
                window.showNotification('推力模式下无法存档！', 'warning');
            }
            return null;
        }

        // 存档前刷新 kepler，消除运行时累积偏差
        if (ship && ship.currentSOI) {
            const hostBody = celestialBodies.find(b => b.name === ship.currentSOI);
            if (hostBody) {
                const relPos = getRelativePosition(ship.pos, hostBody);
                const freshKepler = stateToKepler(relPos, ship.vel, hostBody.gm);
                if (freshKepler) {
                    ship.kepler = freshKepler;
                    ship.orbitTime = 0;
                    console.log(`[SaveManager] 存档前 kepler 已刷新: a=${freshKepler.a.toFixed(2)}, e=${freshKepler.e.toFixed(4)}`);
                } else {
                    console.warn('[SaveManager] 存档前 kepler 刷新失败：stateToKepler 返回 null');
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
            ships: state.ships || [],
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

        gameState.setState({
            ships: checkpoint.ships,
            player: world.player,
            missions: checkpoint.missions,
            facilities: checkpoint.facilities,
            gameTime: checkpoint.gameTime,
            activeShipId: checkpoint.activeShipId,
            activeFacilityId: checkpoint.activeFacilityId || null,
            // 恢复当前场景
            currentScene: checkpoint.currentScene || 'menu'
        });

        // 旧存档字段迁移：为新版本新增属性提供默认值
        const allShips = gameState.getAllShipsRef();
        for (const s of allShips) {
            if (s.maneuverNodes === undefined) s.maneuverNodes = [];
            if (s.burnDuration === undefined) s.burnDuration = 120;
        }

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
            if (ship.currentSOI) {
                const hostBody = celestialBodies.find(b => b.name === ship.currentSOI);
                ship.currentHostPos = hostBody ? { x: hostBody.position.x, y: hostBody.position.y } : { x: 0, y: 0 };
            } else {
                ship.currentHostPos = { x: 0, y: 0 };
            }
        }

        // 根据恢复的 pos/vel 重算 kepler，消除与存档数据的不一致
        if (ship && ship.currentSOI && ship.mode === 'on_rails') {
            const hostBody = celestialBodies.find(b => b.name === ship.currentSOI);
            if (hostBody) {
                const relPos = getRelativePosition(ship.pos, hostBody);
                const newKepler = stateToKepler(relPos, ship.vel, hostBody.gm);
                if (newKepler) {
                    ship.kepler = newKepler;
                    ship.orbitTime = 0;
                    console.log(`[SaveManager] kepler 已重算: a=${newKepler.a.toFixed(2)}, e=${newKepler.e.toFixed(4)}`);
                } else {
                    console.warn('[SaveManager] kepler 重算失败：stateToKepler 返回 null');
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
