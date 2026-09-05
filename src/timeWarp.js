"use strict";

import { sceneManager } from './sceneManager.js';
import { eventBus, Events } from './eventBus.js';
import { t } from './config/strings.js';

// 时间加速档位表（索引 0 = 暂停 / 0x）
// KSP2 原版档位 + 0x 暂停档：. 升档 / , 降档，0x 即暂停
// 其中 4x 为物理加速档（点火时最高允许档位，同时占面板第 3 格）
const WARP_RATES = [0, 1, 2, 4, 10, 50, 100, 1000, 10000, 100000, 1000000, 10000000];

// 面板档位表（时间加速 UI 的 11 格）— 从完整档位表派生，禁止手写第二份常量
// 仅过滤 0x 暂停档：4x 物理档与其余档位均占面板格（第三格 = 4x）
export const PANEL_RATES = WARP_RATES.filter((r) => r !== 0);

// 物理加速上限（thrust 模式允许的最大倍率）
const PHYSICS_WARP_MAX = 4;

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
        this._warpTarget = null;                  // 定点加速目标 { time, onArrive }（0.3.0）
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

    // 物理加速档位上限索引（thrust 模式最高允许 4x）
    getPhysicsMaxIndex() {
        return WARP_RATES.indexOf(PHYSICS_WARP_MAX);
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

    // 升档（0x → 1x 即从暂停恢复）
    increase() {
        this._cancelWarpTarget(true);   // 玩家升档 = 打断定点
        if (this._index >= this._maxIndex) {
            return;
        }
        this.warpToIndex(this._index + 1);
    }

    // 降档（1x → 0x 即暂停）
    decrease() {
        this._cancelWarpTarget(true);   // 玩家降档 = 打断定点
        if (this._index <= 0) {
            return;
        }
        this.warpToIndex(this._index - 1);
    }

    // 跳到指定倍率
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
        this.warpToIndex(WARP_RATES.indexOf(1));
    }

    /**
     * 读档 / 进入飞行场景重置（0.2.5）：取消进行中的定点加速目标并回到 1x。
     * 与 resetTo1x 的区别：不弹"已取消"通知（系统流程而非玩家操作），
     * 且 0x 暂停也恢复到 1x（读档后时间线必须从 1x 起步，防止旧目标/高倍率继续推进）。
     */
    resetOnLoad() {
        this._warpTarget = null;
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

    // === 目标时刻加速（0.3.0 决策 1B 实现：定点时间加速） ===

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
            wasPaused
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

            // Alt+, / Alt+. — 物理加速微调（1x~4x）
            if (e.altKey && (e.code === 'Comma' || e.code === 'Period')) {
                e.preventDefault();
                const physicsMinIdx = WARP_RATES.indexOf(1);
                const physicsMaxIdx = WARP_RATES.indexOf(PHYSICS_WARP_MAX);
                if (e.code === 'Period') {
                    if (this._index >= physicsMaxIdx) {
                        this.warpToIndex(physicsMaxIdx);
                    } else if (this._index >= physicsMinIdx) {
                        this.increase();
                    } else {
                        this.warpToIndex(physicsMinIdx);
                    }
                } else {
                    if (this._index <= physicsMaxIdx && this._index > physicsMinIdx) {
                        this.decrease();
                    } else if (this._index > physicsMaxIdx) {
                        this.warpToIndex(physicsMaxIdx);
                    }
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
