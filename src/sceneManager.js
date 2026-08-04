// 场景管理器模块

// 导入依赖
import { eventBus, Events } from './eventBus.js';

// SceneManager 单例类
class SceneManager {
    constructor() {
        if (SceneManager._instance) {
            return SceneManager._instance;
        }
        SceneManager._instance = this;
        this._scenes = {};
        this._currentScene = null;
        this._paused = false;
    }

    // 注册场景
    registerScene(id, config) {
        this._scenes[id] = {
            name: config.name || id,
            enter: config.enter || (() => {}),
            exit: config.exit || (() => {}),
            update: config.update || (() => {}),
            render: config.render || (() => {})
        };
        return this;
    }

    // 切换场景
    switchTo(id, data) {
        const from = this._currentScene;
        const to = id;

        if (from && this._scenes[from]) {
            this._scenes[from].exit();
        }

        if (!this._scenes[to]) {
            console.warn(`[SceneManager] 场景 ${to} 未注册`);
            return this;
        }

        this._currentScene = to;
        this._scenes[to].enter(data);

        eventBus.emit(Events.SCENE_CHANGED, { from, to });
        console.log(`[SceneManager] 场景切换: ${from} -> ${to}`);

        return this;
    }

    // 获取当前场景 ID
    getCurrentScene() {
        return this._currentScene;
    }

    // 更新当前场景
    update(dt) {
        if (!this._currentScene || !this._scenes[this._currentScene]) {
            return;
        }
        this._scenes[this._currentScene].update(dt);
    }

    // 渲染当前场景
    render(ctx) {
        if (!this._currentScene || !this._scenes[this._currentScene]) {
            return;
        }
        this._scenes[this._currentScene].render(ctx);
    }

    // 暂停/恢复游戏循环
    setPaused(paused) {
        this._paused = paused;
        return this;
    }

    // 检查是否暂停
    isPaused() {
        return this._paused;
    }

    // 重置帧计时器，防止场景重入后首帧 dt 异常大
    resetFrameTimer() {
        eventBus.emit(Events.SCENE_READY, { scene: this._currentScene });
        return this;
    }
}

// 导出单例实例
export const sceneManager = new SceneManager();

// 在控制台暴露 sceneManager，方便调试
if (typeof window !== 'undefined') {
    window.__sceneManager = sceneManager;
    console.log('[SceneManager] 单例已创建，可通过 window.__sceneManager 访问');
}
