"use strict";

// 时间加速 UI — KSP2 风格时间加速面板（常驻 HUD，事件驱动、无轮询）
// 结构：单一面板 = 顶栏状态条(点击切换暂停/恢复) / 主内容行(UT+档位条) / 底栏倍率
// - 位置：屏幕底部居中
// - 仅 flight / tracking 场景显示（订阅 SCENE_CHANGED）
// - 状态刷新：订阅 TIME_WARP_CHANGED（档位/暂停变化）+ RENDER_DATA / CELESTIAL_TIME_UPDATED（每帧时间与上限）
// - 不注册 uiManager，独立常驻 DOM；只调用 timeWarp 公开 API，不侵入其内部

import { sceneManager } from '../sceneManager.js';
import { eventBus, Events } from '../eventBus.js';
import { timeWarp, PANEL_RATES } from '../timeWarp.js';
import { textureManager } from '../graphics/textureManager.js';

// ==== 纹理 key（textureConfig.js 已注册） ====
const TEX_CELL_ACTIVE = 'timewarp_cell_active';   // 档位格·启用（绿）
const TEX_CELL_INACTIVE = 'timewarp_cell_inactive'; // 档位格·未启用（灰）

// ==== 显示场景 ====
const SCENE_SHOW = ['flight', 'tracking'];

// ==== 图标尺寸 ====
const CELL_SIZE = 22;     // 档位格边长（11 格紧凑排列）

// ==== 配色（KSP2 风格：游戏面板标准黑底 + HUD 蓝/红状态色，简洁无特效） ====
// HUD 蓝与项目主色 #88ccff（flightUI/SAS 等）一致，保证与 HUD 数据同色
const COLOR_RUN = '#88ccff';                // 运行蓝（HUD 数据同色）
const COLOR_PAUSE = '#ff5050';              // 暂停红（不变）
const COLOR_PANEL_BG = 'rgba(0,0,0,0.85)';  // 面板底色（与全项目 HUD 面板统一）
const COLOR_CELL_BG = 'rgba(0,0,0,0.55)';   // 档位格底色（半透明黑，与面板一体）
const COLOR_CELL_ACTIVE_BG = 'rgba(136, 204, 255, 0.25)'; // 档位格高亮底（淡 HUD 蓝）
const COLOR_UT = '#9ecbff';                 // UT 时间浅蓝
const COLOR_UT_BADGE_BG = 'rgba(0,0,0,0.6)'; // UT 标签底
const COLOR_FOOTER = '#bbbbbb';             // 底部倍率文字
const COLOR_HEADER_BORDER = 'rgba(120, 140, 180, 0.25)'; // 顶栏分隔线

// ==== KSP2 历法：1 年 = 426 天，1 天 = 6 小时 ====
const SEC_PER_DAY = 6 * 3600;
const SEC_PER_YEAR = 426 * SEC_PER_DAY;

// 秒 → KSP2 格式：T+001y 009d 05:36:52（年/日 3 位，时/分/秒 2 位）
function formatUT(seconds) {
    const t = Math.max(0, Math.floor(seconds));
    const years = Math.floor(t / SEC_PER_YEAR);
    const remY = t % SEC_PER_YEAR;
    const days = Math.floor(remY / SEC_PER_DAY);
    const remD = remY % SEC_PER_DAY;
    const hours = Math.floor(remD / 3600);
    const remH = remD % 3600;
    const mins = Math.floor(remH / 60);
    const secs = remH % 60;
    const p2 = (n) => String(n).padStart(2, '0');
    const p3 = (n) => String(n).padStart(3, '0');
    return 'T+' + p3(years) + 'y ' + p3(days) + 'd ' + p2(hours) + ':' + p2(mins) + ':' + p2(secs);
}

class TimeWarpUI {
    constructor() {
        // DOM 元素
        this._wrap = null;       // 面板容器（fixed 定位）
        this._right = null;      // 面板主体
        this._header = null;     // 顶栏状态文字
        this._utLabel = null;    // UT 时间标签
        this._cells = [];        // [{ rate, btn, img, fb }]
        this._footer = null;     // 底部倍率文字

        // 缓存状态（避免重复写 DOM）
        this._visible = undefined;    // 面板显隐
        this._lastPaused = undefined; // 暂停态（大圆图标/边框变化比对）
        this._lastHeaderKey = undefined; // 顶栏文案 + 颜色变化比对
        this._lastFooterKey = undefined; // 底部倍率文字变化比对
        this._lastUtText = '';        // UT 文本变化比对
        this._cellActive = [];        // 每格 active 图状态比对

        this._initDOM();
        this._initEvents();

        // 模块加载时主动查询初始场景（防读档直达飞行时 SCENE_CHANGED 已错过）
        if (SCENE_SHOW.includes(sceneManager.getCurrentScene())) {
            this.setVisible(true);
        }
    }

    // ==== DOM 构建 ====

    _initDOM() {
        // 面板容器（fixed 定位，偏右底部；整体缩放到 3/4）
        const wrap = document.createElement('div');
        wrap.style.cssText = `
            position:fixed;left:70%;bottom:18px;
            transform:translateX(-50%) scale(0.75);
            transform-origin:center center;
            z-index:950;display:none;flex-direction:column;
            user-select:none;font-family:monospace;color:#fff;
        `;

        // 面板主体（无大圆按钮：单一面板，全圆角）
        const right = document.createElement('div');
        right.style.cssText = `
            display:flex;flex-direction:column;
            background:${COLOR_PANEL_BG};border:1px solid ${COLOR_RUN};
            border-radius:6px;
            padding:0;min-width:280px;
        `;

        // 顶栏状态文字（点击切换暂停/恢复，替代原大圆按钮入口）
        const header = document.createElement('div');
        header.style.cssText = `
            font-size:11px;font-weight:bold;color:${COLOR_RUN};
            padding:3px 12px;text-align:center;letter-spacing:2px;
            border-bottom:1px solid ${COLOR_HEADER_BORDER};
            cursor:pointer;
        `;
        header.title = '点击暂停/恢复时间加速';
        header.addEventListener('click', () => {
            timeWarp.togglePause();
        });

        // 主内容行：UT 标签 + UT 时间 + 档位条
        const bodyRow = document.createElement('div');
        bodyRow.style.cssText = `
            display:flex;align-items:center;gap:8px;
            padding:5px 10px 3px 10px;
        `;

        // UT 标签（金色边框小圆角）
        const utBadge = document.createElement('div');
        utBadge.textContent = 'UT';
        utBadge.style.cssText = `
            font-size:10px;font-weight:bold;color:#d4c86a;
            border:1px solid #a8984a;border-radius:3px;
            background:${COLOR_UT_BADGE_BG};padding:1px 6px;
            letter-spacing:1px;flex-shrink:0;
        `;

        // UT 时间
        const ut = document.createElement('div');
        ut.style.cssText = `
            font-size:12px;color:${COLOR_UT};cursor:pointer;letter-spacing:1px;
            white-space:nowrap;flex-shrink:0;
        `;
        ut.textContent = 'T+000y 000d 00:00:00';
        ut.title = '点击切换时间显示模式（任务时间开发中）';
        ut.addEventListener('click', () => {
            if (typeof window.showNotification === 'function') {
                window.showNotification('任务时间开发中', 'info');
            }
        });

        // 档位行（11 格，紧凑排列，占满剩余空间）
        const cellRow = document.createElement('div');
        cellRow.style.cssText = 'display:flex;gap:1px;justify-content:flex-end;flex:1;';

        for (const rate of PANEL_RATES) {
            const cell = document.createElement('button');
            cell.style.cssText = `
                width:${CELL_SIZE}px;height:${CELL_SIZE}px;padding:0;
                background:${COLOR_CELL_BG};border:none;
                cursor:pointer;display:flex;align-items:center;justify-content:center;
                flex-shrink:0;overflow:hidden;box-sizing:border-box;
            `;
            cell.title = rate + 'x';
            const img = document.createElement('img');
            img.style.cssText = 'width:82%;height:82%;object-fit:contain;display:none;';
            const fb = document.createElement('span');
            fb.style.cssText = 'font-size:12px;font-weight:bold;line-height:1;display:none;';
            cell.appendChild(img);
            cell.appendChild(fb);
            cell.addEventListener('click', () => {
                // 灰显（不可达）格忽略点击：仅 rate ≤ 当前上限可直达
                if (rate <= timeWarp.getCurrentMaxRate()) {
                    timeWarp.warpTo(rate);
                }
            });
            cellRow.appendChild(cell);
            this._cells.push({ rate: rate, btn: cell, img: img, fb: fb });
        }

        bodyRow.appendChild(utBadge);
        bodyRow.appendChild(ut);
        bodyRow.appendChild(cellRow);

        // 底部倍率文字
        const footer = document.createElement('div');
        footer.style.cssText = `
            font-size:9px;color:${COLOR_FOOTER};text-align:center;letter-spacing:2px;
            padding:1px 0 3px 0;
        `;

        // 组装
        right.appendChild(header);
        right.appendChild(bodyRow);
        right.appendChild(footer);

        wrap.appendChild(right);
        document.body.appendChild(wrap);

        this._wrap = wrap;
        this._right = right;
        this._header = header;
        this._utLabel = ut;
        this._footer = footer;
        this._cellActive = new Array(this._cells.length).fill(undefined);
    }

    // ==== 事件订阅 ====

    _initEvents() {
        // 场景切换 → 显隐（仅 flight / tracking）
        eventBus.on(Events.SCENE_CHANGED, ({ to }) => {
            this.setVisible(SCENE_SHOW.includes(to));
        });

        // 档位/暂停变化 → 立即刷新（键盘与点击共用 timeWarp 单一入口，天然同步）
        eventBus.on(Events.TIME_WARP_CHANGED, () => {
            if (this._visible) {
                this.refresh();
            }
        });

        // 每帧时间与档位上限（flight：RENDER_DATA 载荷含 time；tracking：CELESTIAL_TIME_UPDATED）
        eventBus.on(Events.RENDER_DATA, (data) => {
            if (this._visible && typeof data.time === 'number') {
                this.onFrame(data.time);
            }
        });
        eventBus.on(Events.CELESTIAL_TIME_UPDATED, (data) => {
            if (this._visible && typeof data.time === 'number') {
                this.onFrame(data.time);
            }
        });

        // 纹理加载完成 → 刷新图标（首次加载完成时 fallback 换真实图片）
        eventBus.on(Events.TEXTURES_READY, () => {
            if (this._visible) {
                this.refresh();
            }
        });
    }

    // ==== 显隐 ====

    setVisible(visible) {
        if (this._visible === visible) {
            return;
        }
        this._visible = visible;
        this._wrap.style.display = visible ? 'flex' : 'none';
        if (visible) {
            this.refresh();
        }
    }

    // ==== 每帧驱动（UT 时间 + 档位上限灰显随帧更新） ====

    onFrame(time) {
        const text = formatUT(time);
        if (text !== this._lastUtText) {
            this._lastUtText = text;
            this._utLabel.textContent = text;
        }
        // 档位上限由场景每帧 setMaxIndex 设置且可能不触发 TIME_WARP_CHANGED
        // （如点火后上限收紧但当前档未被夹取），因此每帧同步一次状态
        this.refresh();
    }

    // ==== 状态刷新（全部带变化比对，每帧调用开销低） ====

    refresh() {
        if (!this._visible) {
            return;
        }
        const paused = timeWarp.isPaused();
        const rate = timeWarp.getRate();
        const maxRate = timeWarp.getCurrentMaxRate();
        const savedRate = paused ? timeWarp.getSavedRate() : rate;

        // 顶栏文字 + 面板边框色（三态：暂停 / 1x 正常运行 / 加速中）
        const headerKey = paused ? 'p' : (rate > 1 ? 'w' : 'n');
        if (this._lastHeaderKey !== headerKey) {
            this._lastHeaderKey = headerKey;
            this._header.textContent = paused
                ? '|| TIME PAUSED'
                : (rate > 1 ? '>> TIME WARP ACTIVE' : '>> NORMAL FLIGHT');
            this._header.style.color = paused ? COLOR_PAUSE : COLOR_RUN;
            this._right.style.borderColor = paused ? COLOR_PAUSE : COLOR_RUN;
        }

        // 档位格：
        // - 运行态：累积高亮（rate ≤ 当前倍率 且 ≤ 上限）为绿，其余灰
        // - 暂停态：仅 savedRate 对应单格亮（savedRate=4x 物理档时降级为 ≤4 最大格=3）
        const targetRate = paused ? this._computeTargetRate(savedRate) : null;
        for (let i = 0; i < this._cells.length; i++) {
            const cell = this._cells[i];
            const active = paused
                ? (cell.rate === targetRate)
                : (cell.rate <= rate && cell.rate <= maxRate);
            if (this._cellActive[i] !== active) {
                this._cellActive[i] = active;
                this._applyIcon(
                    cell.img, cell.fb,
                    active ? TEX_CELL_ACTIVE : TEX_CELL_INACTIVE,
                    '>',
                    active ? COLOR_RUN : '#888'
                );
                // 高亮格加淡绿底，其余保持深色底
                cell.btn.style.background = active ? COLOR_CELL_ACTIVE_BG : COLOR_CELL_BG;
                // 不可达格灰显：not-allowed 提示不可点
                cell.btn.style.cursor = (cell.rate <= maxRate) ? 'pointer' : 'not-allowed';
                cell.btn.style.opacity = (cell.rate <= maxRate) ? '1' : '0.45';
            }
        }

        // 底部倍率文字（运行显示当前倍率，暂停显示恢复目标倍率）
        const footerKey = (paused ? 'p' : 'r') + ':' + savedRate;
        if (this._lastFooterKey !== footerKey) {
            this._lastFooterKey = footerKey;
            this._footer.textContent = 'TIME WARP= ' + savedRate + 'x';
            this._footer.style.color = paused ? COLOR_PAUSE : COLOR_FOOTER;
        }
    }

    // 暂停态高亮目标：PANEL_RATES 中 ≤ savedRate 的最大档位（4x 物理档降级到 3 格）
    _computeTargetRate(savedRate) {
        let target = null;
        for (const r of PANEL_RATES) {
            if (r <= savedRate) {
                target = r;
            } else {
                break;
            }
        }
        return target;
    }

    // 图标应用：纹理就绪用图片，否则 fallback 文本（沿用 textureManager + emoji 模式）
    _applyIcon(imgEl, fbEl, texKey, fbText, fbColor) {
        const tex = textureManager.get(texKey);
        if (tex && tex.complete && tex.naturalWidth > 0) {
            imgEl.src = tex.src;
            imgEl.style.display = 'block';
            fbEl.style.display = 'none';
        } else {
            fbEl.textContent = fbText;
            fbEl.style.color = fbColor;
            imgEl.style.display = 'none';
            fbEl.style.display = 'block';
        }
    }
}

// 导出单例
export const timeWarpUI = new TimeWarpUI();

// 控制台调试暴露
if (typeof window !== 'undefined') {
    window.__timeWarpUI = timeWarpUI;
    console.log('[TimeWarpUI] 时间加速面板已创建，可通过 window.__timeWarpUI 访问');
}
