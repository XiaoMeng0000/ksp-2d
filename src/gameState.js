// GameState 单例模块

import { eventBus, Events } from './eventBus.js';

// 初始状态定义
const initialState = {
    starSystems: [],
    ships: [],
    facilities: [],
    activeShipId: null,
    activeFacilityId: null,
    player: {
        // 0.2.0：points 字段废弃，迁移到 resources
        gameMode: 'sandbox',            // 游戏模式：'sandbox' 自由 | 'career' 生涯
        unlockedBlueprints: [],
        scannedBodies: {},              // 天体扫描进度：{ bodyId: { tiersScanned: n } }
        visitedBodies: {},              // 天体访问记录（已废弃：首访奖励已移除，字段保留兼容存档）
        resources: {
            science: { amount: 50 }         // 科技点（唯一全局资源；实体资源存于设施 storage / 飞船货仓）
        }
    },
    missions: [],
    gameTime: 0,
    version: '0.2.0',
    // 追踪站 - 当前场景
    currentScene: 'menu'
};

// GameState 单例类
class GameState {
    constructor() {
        if (GameState._instance) {
            return GameState._instance;
        }
        GameState._instance = this;
        this._state = this._deepClone(initialState);
    }

    // 深拷贝工具
    _deepClone(obj) {
        return JSON.parse(JSON.stringify(obj, (key, value) => {
            if (key.startsWith('_')) return undefined;
            return value;
        }));
    }

    // 广播状态变化事件
    _notify(changedKeys) {
        eventBus.emit(Events.GAME_STATE_CHANGED, { changedKeys });
    }

    // 获取当前状态（只读副本）
    getState() {
        return this._deepClone(this._state);
    }

    // 深拷贝合并，确保替换数组时旧引用不会污染新数据
    // 0.2.5（方案 A）：值未变时跳过拷贝与广播 —— 消除"每帧 setState({activeFacilityId: null})"
    // 一类的 GAME_STATE_CHANGED 事件风暴（浅比较即可覆盖标量重复写入场景）
    setState(data) {
        const changedKeys = [];
        for (const key in data) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) {
                continue;
            }
            if (data[key] === this._state[key]) {
                continue;
            }
            this._state[key] = this._deepClone(data[key]);
            changedKeys.push(key);
        }
        if (changedKeys.length > 0) {
            this._notify(changedKeys);
        }
    }

    // ===== 0.2.5（方案 A）集合增量接口 =====
    // 旧实现所有"改一条"操作都走 getState() 深拷贝 → 改副本 → setState 整组替换，
    // 导致：① 已持有引用的模块（SAS 控制器等运行时挂载）随整组替换被 JSON 清洗剥离；
    // ② 其他实体引用全部悬空；③ 每次 O(全部实体) 深拷贝。
    // 增量接口保持数组引用不变、仅动单个元素，已持有引用持续有效。
    // 全量替换语义仍由 setState 承担（读档通道使用）。

    // 追加实体到集合（数组引用不变，返回入列对象本身）
    addToCollection(key, entity) {
        this._state[key].push(entity);
        this._notify([key]);
        return entity;
    }

    // 按 id 从集合移除实体
    removeFromCollection(key, id) {
        const arr = this._state[key];
        const index = arr.findIndex(e => e && e.id === id);
        if (index === -1) {
            return false;
        }
        arr.splice(index, 1);
        this._notify([key]);
        return true;
    }

    // 按 id 替换集合内单个实体（元素引用更新为该对象，数组与其余元素引用不变）
    replaceInCollection(key, entity) {
        const arr = this._state[key];
        const index = arr.findIndex(e => e && e.id === entity.id);
        if (index === -1) {
            return false;
        }
        arr[index] = entity;
        this._notify([key]);
        return true;
    }

    // 重置为初始状态
    reset() {
        this._state = this._deepClone(initialState);
        this._notify(['ships', 'activeShipId', 'activeFacilityId', 'missions', 'facilities', 'gameTime', 'currentScene']);
    }

    // 返回当前活动飞船
    getActiveShip() {
        if (!this._state.activeShipId) return null;
        return this._state.ships.find(ship => ship.id === this._state.activeShipId) || null;
    }

    // 返回所有飞船的直接引用（非深拷贝），供物理/渲染循环使用
    getAllShipsRef() {
        return this._state.ships;
    }

    // 返回所有设施的直接引用（非深拷贝），供物理/渲染循环使用
    getAllFacilitiesRef() {
        return this._state.facilities;
    }

    // 返回当前控制的设施
    getActiveFacility() {
        if (!this._state.activeFacilityId) return null;
        return this._state.facilities.find(f => f.id === this._state.activeFacilityId) || null;
    }

    // 返回指定飞船的直接引用
    getShipRef(id) {
        return this._state.ships.find(s => s.id === id) || null;
    }

    // 返回玩家状态直接引用（非深拷贝），供高频持续更新的系统（如扫描进度）使用
    getPlayerRef() {
        return this._state.player;
    }
}

// 导出单例实例
export const gameState = new GameState();

// 挂载到 window 供调试（与 shipSystem/facilitySystem 保持一致）
if (typeof window !== 'undefined') {
    window.__gameState = gameState;
}
