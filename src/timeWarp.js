"use strict";

import { sceneManager } from './sceneManager.js';
import { eventBus, Events } from './eventBus.js';
import { t } from './config/ui/strings.js';

// 时间加速档位表（索引 0 = 暂停 / 0x）
// KSP2 原版档位 + 0x 暂停档：. 升档 / , 降档，0x 即暂停
// 其中 4x 为物理加速档（点火时最高允许档位，同时占面板第 3 格）
const WARP_RATES = [0, 1, 2, 4, 10, 50, 100, 1000, 10000, 100000, 1000000, 10000000];

// 面板档位表（时间加速 UI 的 11 格）— 从完整档位表派生，禁止手写第二份常量
// 仅过滤 0x 暂停档：4x 物理档与其余档位均占面板格（第三格 = 4x）
export const PANEL_RATES = WARP_RATES.filter((r) => r !== 0);

// 物理加速上限（物理通道允许的最大倍率；任何时刻可用，含点火中）
const PHYSICS_WARP_MAX = 4;

// KSP 式双通道划分 —— 均从同一档位表派生，禁止手写第二份常量：
// - 物理加速通道 PHYSICS_RATES = {2, 4}：**点火中唯一可用的加速**，只能按住 Alt 进入，
//   任何时刻可用（含点火中）；上限 4x。
// - 时间加速通道 = WARP_RATES 完整阶梯（1x/2x/4x/10x/50x …）：不按 Alt 的常规加速，
//   保留全部档位（含 2x/4x，物理通道不"取代"任何档位）；点火中锁 1x（>1x 操作被拒并弹通知）。
// - 1x 为两通道共有的中性档，0x 为暂停档。
export const PHYSICS_RATES = WARP_RATES.filter((r) => r > 1 && r <= PHYSICS_WARP_MAX);

// 病态区间（无解析轨道、RK4 兜底积分）时允许的最大倍率
// stateToKepler 返回 null 且 GM>0 时，物理层走 RK4 子步循环（每帧最多 simDt/0.05 步）。
// 高倍率下子步数随倍率线性增长（1e6x 一帧约 33 万步 → 明显卡顿），限档 50x 保证流畅。
// 该状态 RK4 窗口有界：逃逸则出 SOI 转深空 O(1)，回落则撞击/近天体后转为有效轨道，无需更高档。
const RK4_FALLBACK_WARP_MAX = 50;

/**
 * 时间加速单例
 * - 暂停被建模为 0x 档位：0 档 = sceneManager 暂停，其余档位按倍率推进 simDt
 * - 键盘无单独"恢复"逻辑：. 升档（0x→1x 即恢复）、, 降档（1x→0x 即暂停）
 * - 大圆按钮走 togglePause()：保存/恢复暂停前档位
 */
class TimeWarp {
    constructor() {
        this._index = WARP_RATES.indexOf(1);      // 默认 1x
        this._savedIndex = this._index;           // 大圆按钮暂停前档位
        this._maxIndex = WARP_RATES.length - 1;   // 档位上限（由场景每帧设置）
        this._warpTarget = null;                  // 定点加速目标 { time, onArrive }（0.2.4）
        this._thrustLocked = false;               // 点火锁：时间通道锁 1x（飞行场景每帧设置）
        // 加速模式（持久状态，不随 Alt 松开而失效）：
        //   'neutral'  1x 无加速（两通道共有）
        //   'physics'  物理加速（Alt 进入，1x<rate≤4x）：飞船保持实时物理与操控
        //   'time'     时间加速（常规通道，rate>1x）：飞船上轨，操控被忽略
        this._mode = 'neutral';
        this._initKeyListener();
    }

    // === 查询 ===

    getRate() {
        return WARP_RATES[this._index];
    }

    getIndex() {
        return this._index;
    }

    getSavedIndex() {
        return this._savedIndex;
    }

    // 暂停前保存的档位倍率值（大圆按钮恢复目标；UI 暂停态高亮显示用）
    // savedIndex 恒为面板档位（PANEL_RATES 含全部非 0 档），UI 可直接对应到单格
    getSavedRate() {
        return WARP_RATES[this._savedIndex];
    }

    // 最大档位索引（未点火时放开全部档位）
    getMaxIndex() {
        return WARP_RATES.length - 1;
    }

    // 当前生效档位上限索引（场景每帧 setMaxIndex 设置，UI 灰显不可达档位用）
    // 与 getMaxIndex() 的区别：getMaxIndex 是固定放开上限，此处是实际生效上限
    getCurrentMaxIndex() {
        return this._maxIndex;
    }

    // 当前生效档位上限对应的倍率值（UI 按"格子倍率 > 该值"判定灰显，避免 UI 持有完整档位表）
    getCurrentMaxRate() {
        return WARP_RATES[this._maxIndex];
    }

    // 物理加速档位上限索引（物理通道最高允许 4x）
    getPhysicsMaxIndex() {
        return WARP_RATES.indexOf(PHYSICS_WARP_MAX);
    }

    // 物理加速上限倍率（UI 判定"按住 Alt 时 >4x 变灰"用）
    getPhysicsMaxRate() {
        return PHYSICS_WARP_MAX;
    }

    // 是否物理加速档（2x/4x；1x 为两通道共有中性档，不计入）
    isPhysicsRate(rate) {
        return rate > 1 && rate <= PHYSICS_WARP_MAX;
    }

    // 是否时间加速档（10x 起）
    isTimeRate(rate) {
        return rate > PHYSICS_WARP_MAX;
    }

    // 当前加速模式：'neutral' | 'physics' | 'time'
    // 由玩家进入的通道决定并**保持**（物理加速不因松开 Alt 而退出），不按倍率推导
    getMode() {
        return this._mode;
    }

    // 是否处于物理加速模式（飞船保持实时物理与操控，点火中亦可）
    isPhysicsMode() {
        return this._mode === 'physics';
    }

    // 设置模式（内部：随通道请求切换；1x 回落中性态）
    _setModeForRate(mode, rate) {
        this._mode = rate > 1 ? mode : 'neutral';
    }

    // 点火锁状态（时间通道是否被锁 1x）
    isThrustLocked() {
        return this._thrustLocked;
    }

    /**
     * SOI 切换时间保护：剩余切换时间（游戏秒）→ 保护最高档位索引。
     * 规则：保护最高档 = WARP_RATES 中 ≤ secondsToSwitch 的最大档位（下限 1x，上限满档）。
     * 性质（由档位表结构保证）：
     *   ① 帧预算：60fps 下切换点至少保留 60·T/rate ≥ 60 帧（1 真实秒）——每帧推进 ≤ T/60 游戏秒；
     *   ② 档位阶梯相邻比值 ≤10 → 到达时间 T/rate < 10 真实秒，保护最高档下 10s 内必达切换；
     *   ③ T 巨大时饱和返回满档（远途不限制），T 极小（<2s）时下限 1x（1x 下仍 ≤10s 内到达）。
     * @param {number} secondsToSwitch - 到下一次 SOI 切换的剩余游戏秒（timeToNextSOISwitch 返回值）
     * @returns {number} 档位索引
     */
    getSOIProtectMaxIndex(secondsToSwitch) {
        const t = secondsToSwitch;
        if (!(t > 0) || !isFinite(t)) {
            return WARP_RATES.length - 1;
        }
        for (let i = WARP_RATES.length - 1; i >= 1; i--) {
            if (WARP_RATES[i] <= t) {
                return i;
            }
        }
        return 1;
    }

    // 病态区间安全档位上限索引（kepler=null 且 GM>0 时最高允许 50x，防 RK4 高倍率卡顿）
    getRk4FallbackMaxIndex() {
        return WARP_RATES.indexOf(RK4_FALLBACK_WARP_MAX);
    }

    isPaused() {
        return this._index === 0;
    }

    // === 场景接入 ===

    /**
     * 场景每帧设置档位上限
     * @param {number} maxIndex - 允许的最大档位索引（飞行点火时传物理加速上限，其余传最大档）
     */
    setMaxIndex(maxIndex) {
        const clamped = Math.max(1, Math.min(maxIndex, WARP_RATES.length - 1));
        if (clamped === this._maxIndex) {
            return;
        }
        this._maxIndex = clamped;
        if (this._index > this._maxIndex) {
            this.warpToIndex(this._maxIndex);
        }
    }

    /**
     * 点火锁（KSP 语义）：点火中时间加速通道锁 1x —— 时间加速态强制落回 1x，
     * 且时间通道 >1x 的操作被拒绝（弹通知）；物理加速通道不受影响（任何时刻可用）。
     * 飞行场景每帧调用（追踪站无推力，传 false；切换场景后由当前场景覆盖）。
     * @param {boolean} locked
     */
    setThrustLock(locked) {
        const next = !!locked;
        if (next === this._thrustLocked) {
            return;
        }
        this._thrustLocked = next;
        // 点火瞬间：**时间加速态**（含常规通道的 2x/4x 低档）强制落回 1x；
        // 物理加速态（Alt 进入）不落档 —— 点火中物理加速照常可用（KSP 语义）
        if (next && this._mode === 'time' && WARP_RATES[this._index] > 1) {
            this._setModeForRate('time', 1);
            this.warpToIndex(WARP_RATES.indexOf(1));
            this._notify(t('timewarp.thrustLockedNotice'));
        }
    }

    // === 加减档（玩家手动操作 = 打断定点加速） ===

    /**
     * 取消定点加速（玩家手动切档打断时内部调用）
     * @param {boolean} notify - 是否弹"已取消"通知（玩家操作触发时 true）
     */
    _cancelWarpTarget(notify) {
        if (!this._warpTarget) {
            return;
        }
        this._warpTarget = null;
        if (notify && typeof window.showNotification === 'function') {
            window.showNotification(t('timewarp.warpCanceled'), 'info');
        }
    }

    // 统一通知出口（拒绝/锁定提示一律走这里，文案一律 strings.js）
    _notify(text) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(text, 'info');
        }
    }

    // === 通道请求（面板点击与键盘统一入口；含点火锁 / 上限拒绝与通知） ===

    /**
     * 时间加速通道请求（不按 Alt）：完整阶梯 1x/2x/4x/10x/50x …（物理通道不取代任何档位）。
     * 拒绝路径（均弹通知）：
     *   1) 点火中且 >1x → 时间通道锁 1x（此时只能用 Alt 物理加速）
     *   2) 超出当前生效上限（SOI 保护 / 病态兜底 / 撞击点 / 物理上限）
     * @param {number} rate - 目标倍率
     * @returns {{ok: boolean, reason?: string}}
     */
    requestTimeWarp(rate) {
        this._cancelWarpTarget(true);   // 玩家切档 = 打断定点
        const idx = WARP_RATES.indexOf(rate);
        if (idx < 0) {
            return { ok: false, reason: 'invalid' };
        }
        if (this._thrustLocked && rate > 1) {
            this._notify(t('timewarp.blockedByThrust'));
            return { ok: false, reason: 'thrustLocked' };
        }
        if (idx > this._maxIndex) {
            this._notify(t('timewarp.capped', { rate: WARP_RATES[this._maxIndex] }));
            return { ok: false, reason: 'capped' };
        }
        this._setModeForRate('time', rate);
        this.warpToIndex(idx);
        return { ok: true };
    }

    /**
     * 物理加速通道请求（按住 Alt）：接受 1x/2x/4x，任何时刻可用（含点火中）。
     * 拒绝路径（均弹通知）：>4x（物理上限）、超出当前生效上限。
     * @param {number} rate - 目标倍率
     * @returns {{ok: boolean, reason?: string}}
     */
    requestPhysicsWarp(rate) {
        this._cancelWarpTarget(true);   // 玩家切档 = 打断定点
        if (rate > PHYSICS_WARP_MAX) {
            this._notify(t('timewarp.physicsCap'));
            return { ok: false, reason: 'physicsCap' };
        }
        const idx = WARP_RATES.indexOf(rate);
        if (idx < 0) {
            return { ok: false, reason: 'invalid' };
        }
        if (idx > this._maxIndex) {
            this._notify(t('timewarp.capped', { rate: WARP_RATES[this._maxIndex] }));
            return { ok: false, reason: 'capped' };
        }
        this._setModeForRate('physics', rate);
        this.warpToIndex(idx);
        return { ok: true };
    }

    // 时间通道升档（. 键）：0x → 1x 恢复；1x → 2x → 4x → 10x → … 沿完整阶梯逐级
    // （2x/4x 属时间阶梯的正常档位，物理通道不取代任何档位）
    increase() {
        if (this._index >= WARP_RATES.length - 1) {
            return;                                       // 已到最高档
        }
        this.requestTimeWarp(WARP_RATES[this._index + 1]);
    }

    // 时间通道降档（, 键）：1x → 0x 暂停；其余逐级降（10x → 4x → 2x → 1x）
    decrease() {
        if (this._index <= 0) {
            return;
        }
        const target = WARP_RATES[this._index - 1];
        if (target === 0) {
            this._cancelWarpTarget(true);
            this.warpToIndex(0);                          // 暂停不受点火锁限制
            return;
        }
        this.requestTimeWarp(target);
    }

    // 物理通道升档（Alt+.）：暂停 → 1x；1x → 2x → 4x；时间加速态（≥10x）一次落到 4x
    increasePhysics() {
        const cur = WARP_RATES[this._index];
        let target;
        if (cur < 1) {
            target = 1;                                   // 暂停 → 先恢复 1x
        } else if (cur > PHYSICS_WARP_MAX) {
            target = PHYSICS_WARP_MAX;                    // 时间加速态 → 一次落 4x
        } else if (cur < PHYSICS_WARP_MAX) {
            target = PHYSICS_RATES.find((r) => r > cur) || PHYSICS_WARP_MAX;
        } else {
            target = cur;                                 // 已在 4x
        }
        if (target === cur) {
            return;
        }
        this.requestPhysicsWarp(target);
    }

    // 物理通道降档（Alt+,）：4x → 2x → 1x；时间加速态（≥10x）退到 1x
    decreasePhysics() {
        const cur = WARP_RATES[this._index];
        let target;
        if (cur <= 1) {
            target = cur;                                 // 0x/1x 不再降
        } else if (cur > PHYSICS_WARP_MAX) {
            target = 1;                                   // 时间加速态 → 退到 1x
        } else {
            target = 1;
            for (const r of PHYSICS_RATES) {
                if (r < cur) { target = r; }
            }
        }
        if (target === cur) {
            return;
        }
        this.requestPhysicsWarp(target);
    }

    // 跳到指定倍率（低层 API：不校验通道与点火锁；玩家操作走上面两条 request* 通道入口）
    warpTo(rate) {
        this._cancelWarpTarget(true);   // 玩家指定倍率 = 打断定点
        const idx = WARP_RATES.indexOf(rate);
        if (idx < 0) {
            return;
        }
        this.warpToIndex(idx);
    }

    // 一键重置至 1x（0x 暂停状态除外，保持暂停）
    resetTo1x() {
        this._cancelWarpTarget(true);   // 玩家手动重置 = 打断定点
        if (this._index === 0) {
            return;
        }
        this._mode = 'neutral';
        this.warpToIndex(WARP_RATES.indexOf(1));
    }

    /**
     * 读档 / 进入飞行场景重置（0.2.5）：取消进行中的定点加速目标并回到 1x。
     * 与 resetTo1x 的区别：不弹"已取消"通知（系统流程而非玩家操作），
     * 且 0x 暂停也恢复到 1x（读档后时间线必须从 1x 起步，防止旧目标/高倍率继续推进）。
     */
    resetOnLoad() {
        this._warpTarget = null;
        this._mode = 'neutral';
        this.warpToIndex(WARP_RATES.indexOf(1));
    }

    /**
     * 大圆按钮：暂停 ↔ 恢复
     * 非暂停 → 保存当前档位并跳 0x；暂停 → 跳回暂停前档位（如 10x 暂停恢复回 10x）
     */
    togglePause() {
        this._cancelWarpTarget(true);   // 玩家暂停/恢复 = 打断定点
        if (this._index === 0) {
            this.warpToIndex(this._savedIndex);
        } else {
            this._savedIndex = this._index;
            this.warpToIndex(0);
        }
    }

    // === 目标时刻加速（0.2.4 决策 1B 实现：定点时间加速） ===

    /**
     * 设定定点时间加速目标（轨道菜单"时间加速至目标点"入口）
     * 由 flightScene.update 每帧驱动：以当前可用最大档位加速（SOI 保护等限档照常生效），
     * 到达后自动切 1x 并触发 onArrive；玩家任意手动切档（. , \ 或 UI）即打断并弹通知。
     * @param {number} targetTime - 目标游戏时刻（秒，与 flightScene 的 _getCelestialTime() 同口径）
     * @param {Function} [onArrive] - 到达回调（可选）
     */
    warpToTime(targetTime, onArrive) {
        if (targetTime === null || targetTime === undefined || !isFinite(targetTime)) {
            return;
        }
        this._warpTarget = { time: targetTime, onArrive: onArrive || null };
    }

    /** 查询当前定点加速目标（无则 null）—— flightScene 每帧驱动用 */
    getWarpTarget() {
        return this._warpTarget;
    }

    /** 定点加速完成：清目标 → 直接切 1x → 触发回调 */
    completeWarpToTime() {
        const cb = this._warpTarget ? this._warpTarget.onArrive : null;
        this._warpTarget = null;
        this._mode = 'neutral';
        this.warpToIndex(WARP_RATES.indexOf(1));
        if (typeof cb === 'function') {
            cb();
        }
    }

    // === 核心：设置档位索引并联动暂停 / 事件 ===

    warpToIndex(index) {
        const clamped = Math.max(0, Math.min(index, this._maxIndex));
        if (clamped === this._index) {
            return;
        }
        const wasPaused = this._index === 0;
        this._index = clamped;
        const paused = this._index === 0;

        // 0x 档联动场景暂停门控（main.js 的 isPaused() 检查）
        sceneManager.setPaused(paused);
        if (paused && !wasPaused) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('timewarp.pausedNotice'), 'info');
            }
        } else if (!paused && wasPaused) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('timewarp.resumedNotice'), 'info');
            }
        }

        eventBus.emit(Events.TIME_WARP_CHANGED, {
            rate: WARP_RATES[this._index],
            index: this._index,
            paused,
            // 切换前是否处于暂停：供 audioDirector 区分"取消暂停(恢复)"与普通切档
            wasPaused,
            // 通道模式（由倍率推导）：'neutral' | 'physics' | 'time'，供 UI / 音效区分物理与时间加速
            mode: this.getMode()
        });
    }

    // === 全局按键监听（暂停会跳过场景 update，必须挂全局层） ===

    _initKeyListener() {
        document.addEventListener('keydown', (e) => {
            // TEMP: 按键调试日志 — 控制台执行 window.__timeWarpKeyDebug = true 开启，false 关闭
            // 打印所有到达 document 的按键信息，用于排查"按键没反应"问题
            if (window.__timeWarpKeyDebug === true) {
                console.log(
                    `[TimeWarp][KeyDebug] code=${e.code} key=${e.key} alt=${e.altKey} ctrl=${e.ctrlKey} repeat=${e.repeat} ` +
                    `scene=${sceneManager.getCurrentScene()} activeTag=${document.activeElement ? document.activeElement.tagName : 'null'}`
                );
            }

            // 仅飞行 / 追踪场景生效
            const scene = sceneManager.getCurrentScene();
            if (scene !== 'flight' && scene !== 'tracking') {
                return;
            }
            // 输入框内不触发（飞船命名等）
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                return;
            }
            if (e.repeat) {
                return;
            }

            // Alt+, / Alt+. — 物理加速通道（1x/2x/4x）：任何时刻可用（含点火中）；
            // 时间加速态（≥10x）下 Alt+. 一次落到 4x、Alt+, 退到 1x
            if (e.altKey && (e.code === 'Comma' || e.code === 'Period')) {
                e.preventDefault();
                if (e.code === 'Period') {
                    this.increasePhysics();
                } else {
                    this.decreasePhysics();
                }
                return;
            }

            // 一键重置至 1x 快捷键（\ / 、）— 0x 暂停除外，保持暂停
            // 兼容三种按键：\（Backslash）、/（Slash）、、（顿号，中文输入法下按 \ 键产生的字符）
            if (!e.altKey && (e.code === 'Backslash' || e.code === 'Slash' || e.key === '、')) {
                e.preventDefault();
                this.resetTo1x();
                return;
            }

            // , — 降档（1x → 0x 即暂停）
            if (!e.altKey && e.code === 'Comma') {
                e.preventDefault();
                this.decrease();
                return;
            }

            // . — 升档（0x → 1x 即恢复）
            if (!e.altKey && e.code === 'Period') {
                e.preventDefault();
                this.increase();
                return;
            }
        });
    }
}

// 导出单例实例
export const timeWarp = new TimeWarp();
