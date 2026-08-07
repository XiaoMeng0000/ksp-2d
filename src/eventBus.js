// 事件总线模块

// 预定义事件名常量
export const Events = {
    SHIP_MODE_CHANGED: 'ship:modeChanged',
    SHIP_THRUST_STARTED: 'ship:thrustStarted',
    SHIP_THRUST_ENDED: 'ship:thrustEnded',
    SOI_CHANGED: 'soi:changed',
    CELESTIAL_TIME_UPDATED: 'celestial:timeUpdated',
    GAME_STATE_CHANGED: 'game:stateChanged',
    // EventBus 迁移新增事件
    RENDER_DATA: 'render:data',           // 每帧向 UI 层广播飞行场景渲染数据
    SHIP_COMMAND: 'ship:command',         // UI 层向物理层发送飞船操作命令
    PHYSICS_TICK: 'physics:tick',         // 物理循环完成一步积分后广播
    SCENE_READY: 'scene:ready',           // 场景 enter 回调完成后广播
    SCENE_CHANGED: 'scene:changed',        // 场景切换时广播（from → to）
    // 纹理系统事件
    TEXTURES_READY: 'textures:ready',         // 所有纹理加载完成
    TEXTURE_PROGRESS: 'texture:progress',     // 单张纹理加载完成或失败时广播
    TEXTURE_LOAD_ERROR: 'texture:loadError',  // 单张纹理加载失败
    // 设施系统事件
    FACILITY_CREATED: 'facility:created',
    FACILITY_DELETED: 'facility:deleted',
    FACILITY_DOCKED: 'facility:docked',
    FACILITY_UNDOCKED: 'facility:undocked',
    // 时间加速事件
    TIME_WARP_CHANGED: 'timeWarp:changed'       // 档位/暂停状态变化
};

// EventBus 单例类
class EventBus {
    constructor() {
        if (EventBus._instance) {
            return EventBus._instance;
        }
        EventBus._instance = this;
        this._subscribers = {};
        this._debug = false;
    }

    // 开启/关闭调试日志，enable=true 时每次 emit 输出事件名和数据摘要
    setDebug(enabled) {
        this._debug = !!enabled;
    }

    // 订阅事件，返回 this 支持链式调用
    on(event, callback) {
        if (!this._subscribers[event]) {
            this._subscribers[event] = [];
        }
        this._subscribers[event].push(callback);
        return this;
    }

    // 取消订阅，返回 this 支持链式调用
    off(event, callback) {
        if (!this._subscribers[event]) {
            return this;
        }
        this._subscribers[event] = this._subscribers[event].filter(cb => cb !== callback);
        return this;
    }

    // 发布事件
    emit(event, data) {
        if (this._debug) {
            const dataStr = typeof data === 'object' && data !== null
                ? JSON.stringify(data).slice(0, 80)
                : String(data).slice(0, 80);
            const suffix = JSON.stringify(data).length > 80 ? '...' : '';
            console.log(`[EventBus] → ${event} ${dataStr}${suffix}`);
        }
        if (!this._subscribers[event]) {
            return;
        }
        for (const callback of this._subscribers[event]) {
            try {
                callback(data);
            } catch (e) {
                console.error(`[EventBus] 订阅者处理 "${event}" 时异常:`, e);
            }
        }
    }
}

// 导出单例实例
export const eventBus = new EventBus();

// 在控制台暴露 eventBus，方便调试
if (typeof window !== 'undefined') {
    window.__eventBus = eventBus;
    console.log('[EventBus] 单例已创建，可通过 window.__eventBus 访问');
}
