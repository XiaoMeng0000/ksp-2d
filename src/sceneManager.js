'use strict';
// 场景管理器模块

// 导入依赖
import { eventBus, Events } from './eventBus.js';
import { SCENE_LOADING_CONFIG } from './config/ui/sceneLoadingConfig.js';

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
        // 场景过渡状态（异步准备 + 首帧确认）；null = 无过渡
        this._transition = null;
        this._transitionPromise = null;
    }

    // 注册场景
    // prepare(data, reporter): 可选异步准备阶段（加载界面消费其进度）
    // shouldLoad(data): 可选，判断本次进入是否需要加载界面（默认：有 prepare 就需要）
    registerScene(id, config) {
        this._scenes[id] = {
            name: config.name || id,
            enter: config.enter || (() => {}),
            exit: config.exit || (() => {}),
            update: config.update || (() => {}),
            render: config.render || (() => {}),
            prepare: typeof config.prepare === 'function' ? config.prepare : null,
            shouldLoad: typeof config.shouldLoad === 'function' ? config.shouldLoad : null
        };
        return this;
    }

    // 切换场景（同步：立即 exit 旧场景 + enter 目标场景）
    // 异步过渡进行中收到同步切换时，先中止过渡，避免加载遮罩与场景状态脱节
    switchTo(id, data) {
        if (this._transition && !this._transition.internal) {
            this._abortTransition('被同步场景切换打断');
        }

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

    // 异步切换场景：目标场景声明了 prepare（且本次确实需要加载）时，
    // 先显示加载界面 → 执行准备 → 进入场景 → 等目标首帧 → 最短可见时间后隐藏遮罩。
    // 不满足条件的场景直接走同步 switchTo，不显示加载界面、不增加等待。
    // 返回 Promise<boolean>：true = 已切换，false = 未切换（未注册）
    switchToAsync(id, data) {
        const target = this._scenes[id];
        if (!target) {
            console.warn(`[SceneManager] 场景 ${id} 未注册`);
            return Promise.resolve(false);
        }
        if (this._transition) {
            // 过渡进行中：排队到当前过渡结束后再切换（不静默丢弃用户操作）
            console.warn(`[SceneManager] 场景过渡进行中，排队切换: ${id}`);
            const pending = this._transitionPromise || Promise.resolve(false);
            return pending.then(() => this.switchToAsync(id, data));
        }
        if (!target.prepare || (target.shouldLoad && !target.shouldLoad(data))) {
            this.switchTo(id, data);
            return Promise.resolve(true);
        }

        const promise = new Promise((resolve) => {
            const transition = {
                from: this._currentScene,
                to: id,
                data,
                resolve,
                progress: 0,
                preparing: true,
                awaitingFirstFrame: false,
                internal: false,
                done: false,
                deadline: 0,     // 加载层最短可见截止时间（performance.now 口径）
                guard: null      // 首帧兜底定时器
            };
            this._transition = transition;
            this._runTransition(transition);
        });
        this._transitionPromise = promise;
        return promise;
    }

    // 过渡主流程
    async _runTransition(transition) {
        transition.startedAt = performance.now();
        eventBus.emit(Events.SCENE_LOADING_STARTED, { from: transition.from, to: transition.to });

        // 先让加载层真正绘制到屏幕，再执行可能阻塞主线程的准备工作
        const frames = Math.max(1, SCENE_LOADING_CONFIG.waitFrames | 0);
        for (let i = 0; i < frames; i++) {
            await this._nextFrame();
            if (!this._isActive(transition)) return;
        }
        // 最短可见时间从「加载层已绘制」开始计时
        transition.deadline = performance.now() + SCENE_LOADING_CONFIG.minVisibleMs;

        const reporter = (progress, stage) => {
            if (!this._isActive(transition)) return;
            this._reportProgress(transition, progress, stage);
        };

        transition.prepareStartedAt = performance.now();
        try {
            await this._scenes[transition.to].prepare(transition.data, reporter);
        } catch (e) {
            // 准备阶段抛错：场景自身应已降级；这里记录后继续进入，避免遮罩永久卡死
            console.error(`[SceneManager] 场景准备异常: ${transition.to}`, e);
        }
        if (!this._isActive(transition)) return;
        transition.prepareDoneAt = performance.now();

        transition.preparing = false;
        transition.awaitingFirstFrame = true;
        transition.internal = true;
        try {
            this.switchTo(transition.to, transition.data);
        } finally {
            transition.internal = false;
        }

        // 首帧兜底：目标场景 render 一直未执行（异常/空场景）时强制结束
        transition.guard = setTimeout(() => {
            if (!this._isActive(transition) || transition.done) return;
            console.warn(`[SceneManager] 目标场景首帧超时，强制结束加载界面: ${transition.to}`);
            this._completeTransition(transition);
        }, SCENE_LOADING_CONFIG.firstFrameTimeoutMs);
    }

    // 进度上报（只增不减）
    _reportProgress(transition, progress, stage) {
        const next = Math.max(transition.progress, Math.min(1, Number(progress) || 0));
        transition.progress = next;
        eventBus.emit(Events.SCENE_LOADING_PROGRESS, {
            from: transition.from,
            to: transition.to,
            progress: next,
            stage: stage || null
        });
    }

    // 首帧已完成：进度补满，等最短可见时间结束后收起加载界面
    _completeTransition(transition) {
        if (!transition || transition.done) return;
        transition.done = true;
        if (transition.guard) {
            clearTimeout(transition.guard);
            transition.guard = null;
        }
        this._reportProgress(transition, 1, null);
        const wait = Math.max(0, (transition.deadline || 0) - performance.now());
        transition.hideTimer = setTimeout(() => this._endTransition(transition), wait);
    }

    // 真正结束过渡：隐藏加载界面 + 释放锁
    _endTransition(transition) {
        if (transition.hideTimer) {
            clearTimeout(transition.hideTimer);
            transition.hideTimer = null;
        }
        if (this._transition === transition) {
            this._transition = null;
        }
        eventBus.emit(Events.SCENE_LOADING_FINISHED, { from: transition.from, to: transition.to });
        // 调试统计（仅控制台核对用，业务代码不消费）
        this._transitionStats = {
            to: transition.to,
            // 加载层显示 → 准备开始 的间隔（≥ 2 帧 ⇒ 遮罩已先绘制）
            overlayToPrepareMs: Math.round((transition.prepareStartedAt || 0) - (transition.startedAt || 0)),
            // 准备阶段总耗时（含同步 WebGL 初始化 / 贴图上传）
            prepareMs: Math.round((transition.prepareDoneAt || 0) - (transition.prepareStartedAt || 0)),
            visibleMs: Math.round(performance.now() - (transition.startedAt || performance.now()))
        };
        if (typeof window !== 'undefined') window.__sceneTransitionStats = this._transitionStats;
        transition.resolve(true);
    }

    // 中止过渡（同步切换抢占 / 外部打断）：隐藏遮罩并解锁
    _abortTransition(reason) {
        const transition = this._transition;
        if (!transition) return;
        console.warn(`[SceneManager] 场景过渡中止：${reason}`);
        if (transition.guard) clearTimeout(transition.guard);
        if (transition.hideTimer) clearTimeout(transition.hideTimer);
        transition.done = true;
        transition.awaitingFirstFrame = false;
        this._transition = null;
        eventBus.emit(Events.SCENE_LOADING_FINISHED, { from: transition.from, to: transition.to });
        transition.resolve(false);
    }

    // 过渡是否仍然有效
    _isActive(transition) {
        return this._transition === transition && !transition.done;
    }

    // 等待下一帧（定时器兜底：窗口隐藏/遮挡时 rAF 会被暂停，不能让它卡死过渡）
    _nextFrame() {
        return new Promise((resolve) => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(done);
            }
            setTimeout(done, SCENE_LOADING_CONFIG.frameFallbackMs);
        });
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
        // 异步准备期间暂停旧场景业务更新（加载遮罩下不推进游戏状态）
        if (this._transition && this._transition.preparing) {
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

        // 目标场景完成一次真实绘制 → 记为「首帧可见」，据此结束加载界面
        const transition = this._transition;
        if (transition && transition.awaitingFirstFrame && !transition.done) {
            transition.awaitingFirstFrame = false;
            this._completeTransition(transition);
        }
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
