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
        resources: {
            rocketParts: { amount: 500 },   // 火箭零件（建造耗材）
            science: { amount: 50 }         // 科技点
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

    // 获取当前状态（只读副本）
    getState() {
        return this._deepClone(this._state);
    }

    // 深拷贝合并，确保替换数组时旧引用不会污染新数据
    setState(data) {
        for (const key in data) {
            if (data.hasOwnProperty(key)) {
                this._state[key] = this._deepClone(data[key]);
            }
        }
        eventBus.emit(Events.GAME_STATE_CHANGED, {
            changedKeys: Object.keys(data)
        });
    }

    // 重置为初始状态
    reset() {
        this._state = this._deepClone(initialState);
        eventBus.emit(Events.GAME_STATE_CHANGED, {
            changedKeys: ['ships', 'activeShipId', 'activeFacilityId', 'missions', 'facilities', 'gameTime', 'currentScene']
        });
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
}

// 导出单例实例
export const gameState = new GameState();

// 挂载到 window 供调试（与 shipSystem/facilitySystem 保持一致）
if (typeof window !== 'undefined') {
    window.__gameState = gameState;
}

