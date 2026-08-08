"use strict";

import { sceneManager } from './sceneManager.js';
import { eventBus, Events } from './eventBus.js';

// 时间加速档位表（索引 0 = 暂停 / 0x）
// KSP2 原版档位 + 0x 暂停档：. 升档 / , 降档，0x 即暂停
// 其中 4x 为物理加速档（点火时最高允许档位）
const WARP_RATES = [0, 1, 2, 3, 4, 10, 50, 100, 1000, 10000, 100000, 1000000, 10000000];

// 物理加速上限（thrust 模式允许的最大倍率）
const PHYSICS_WARP_MAX = 4;

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

    // 最大档位索引（未点火时放开全部档位）
    getMaxIndex() {
        return WARP_RATES.length - 1;
    }

    // 物理加速档位上限索引（thrust 模式最高允许 4x）
    getPhysicsMaxIndex() {
        return WARP_RATES.indexOf(PHYSICS_WARP_MAX);
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

    // === 加减档 ===

    // 升档（0x → 1x 即从暂停恢复）
    increase() {
        if (this._index >= this._maxIndex) {
            return;
        }
        this.warpToIndex(this._index + 1);
    }

    // 降档（1x → 0x 即暂停）
    decrease() {
        if (this._index <= 0) {
            return;
        }
        this.warpToIndex(this._index - 1);
    }

    // 跳到指定倍率
    warpTo(rate) {
        const idx = WARP_RATES.indexOf(rate);
        if (idx < 0) {
            return;
        }
        this.warpToIndex(idx);
    }

    // 一键重置至 1x（0x 暂停状态除外，保持暂停）
    resetTo1x() {
        if (this._index === 0) {
            return;
        }
        this.warpToIndex(WARP_RATES.indexOf(1));
    }

    /**
     * 大圆按钮：暂停 ↔ 恢复
     * 非暂停 → 保存当前档位并跳 0x；暂停 → 跳回暂停前档位（如 10x 暂停恢复回 10x）
     */
    togglePause() {
        if (this._index === 0) {
            this.warpToIndex(this._savedIndex);
        } else {
            this._savedIndex = this._index;
            this.warpToIndex(0);
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
                window.showNotification('游戏已暂停', 'info');
            }
        } else if (!paused && wasPaused) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('游戏已恢复', 'info');
            }
        }

        eventBus.emit(Events.TIME_WARP_CHANGED, {
            rate: WARP_RATES[this._index],
            index: this._index,
            paused
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
