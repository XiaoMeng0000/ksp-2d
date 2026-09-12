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
import { t } from '../config/strings.js';
import { showTooltip, hideTooltip } from './uiTooltip.js';

// 为元素绑定统一悬停提示（进入时触发一次，延迟显示、位置固定）
function bindTooltip(el, text) {
    el.addEventListener('mouseenter', (e) => {
        showTooltip(text, e.clientX, e.clientY);
    });
    el.addEventListener('mouseleave', () => {
        hideTooltip();
    });
}

// ==== 纹理 key（textureConfig.js 已注册） ====
const TEX_CELL_ACTIVE = 'timewarp_cell_active';
const TEX_CELL_INACTIVE = 'timewarp_cell_inactive';

// ==== 显示场景 ====
const SCENE_SHOW = ['flight', 'tracking'];

// ==== 图标尺寸 ====
const CELL_SIZE = 22;

// ==== 配色 ====
const COLOR_RUN = '#6153D0';
const COLOR_SPEED = '#55CC53';
const COLOR_PAUSE = '#ff5050';
const COLOR_CELL_BG = 'rgba(0,0,0,0.55)';
const COLOR_CELL_ACTIVE_BG = 'rgba(136, 204, 255, 0.25)';
const COLOR_FOOTER = '#6153D0';

// ==== KSP2 历法 ====
const SEC_PER_DAY = 6 * 3600;
const SEC_PER_YEAR = 426 * SEC_PER_DAY;

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
        this._wrap = null;
        this._right = null;
        this._header = null;
        this._headerContainers = {};
        this._utLabel = null;
        this._cells = [];
        this._footer = null;

        // 缓存状态
        this._visible = undefined;
        this._lastHeaderKey = undefined;
        this._lastFooterKey = undefined;
        this._lastUtText = '';
        this._lastOnFrameMs = 0;   // 0.2.5 B12：同帧双事件去重
        this._cellActive = [];
        this._cellLocked = [];

        this._initDOM();
        this._initEvents();

        if (SCENE_SHOW.includes(sceneManager.getCurrentScene())) {
            this.setVisible(true);
        }
    }

    _initDOM() {
        // 注入样式（仅一次）
        if (!document.getElementById('timewarp-wave-style')) {
            const style = document.createElement('style');
            style.id = 'timewarp-wave-style';
            style.textContent = `
                .tw-char {
                    display: inline-block;
                    transform-origin: center center;
                    animation: twWaveScale 0.5s ease-in-out infinite alternate;
                    color: inherit;
                }
                @keyframes twWaveScale {
                    0% { transform: scale(1); }
                    100% { transform: scale(1.3); }
                }
                .tw-char-space {
                    display: inline-block;
                    min-width: 0.3em;
                    animation: none !important;
                    transform: scale(1) !important;
                }

                /* 顶栏整体显隐：使用 opacity，不改变 display */
                #timeWarpHeader {
                    position: relative;
                    min-height: 1.8em;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #timeWarpHeader.hidden {
                    opacity: 0;
                    pointer-events: none;
                }

                .tw-header-state {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.05s;
                }
                .tw-header-state.active {
                    opacity: 1;
                    pointer-events: auto;
                }
            `;
            document.head.appendChild(style);
        }

        const wrap = document.createElement('div');
        wrap.id = 'timeWarpWrap';

        // ---- 顶栏 ----
        const header = document.createElement('div');
        header.id = 'timeWarpHeader';
        bindTooltip(header, t('timewarp.pauseTip'));
        header.addEventListener('click', () => {
            timeWarp.togglePause();
        });

        const stateTexts = {
            p: t('timewarp.paused'),
            w: t('timewarp.active'),
            n: t('timewarp.normal')
        };
        const containers = {};
        for (const [key, text] of Object.entries(stateTexts)) {
            const container = document.createElement('span');
            container.className = 'tw-header-state';
            container.dataset.state = key;
            const chars = Array.from(text);
            chars.forEach((ch, index) => {
                const span = document.createElement('span');
                // 只有加速状态（'w'）才添加动画类，暂停（'p'）和正常（'n'）不加
                if (key === 'w') {
                    span.className = 'tw-char';
                    span.style.animationDelay = (index % 20) * 0.04 + 's';
                } else {
                    span.className = ''; // 无动画
                }
                if (ch === ' ' || ch === '\u00A0') {
                    span.classList.add('tw-char-space');
                    span.textContent = '\u00A0';
                } else {
                    span.textContent = ch;
                }
                container.appendChild(span);
            });
            header.appendChild(container);
            containers[key] = container;
        }
        this._headerContainers = containers;

        // ---- 面板主体 ----
        const right = document.createElement('div');
        right.id = 'timeWarpPanel';

        const bodyRow = document.createElement('div');
        bodyRow.className = 'timewarp-body';

        // ---- UT 组（badge + 时间） ----
        const utGroup = document.createElement('div');
        utGroup.className = 'timewarp-ut-group';

        const utBadge = document.createElement('div');
        utBadge.textContent = 'UT';
        utBadge.className = 'timewarp-ut-badge';

        const ut = document.createElement('div');
        ut.className = 'timewarp-ut';
        ut.textContent = 'T+000y 000d 00:00:00';
        bindTooltip(ut, t('timewarp.utTip'));
        ut.addEventListener('click', () => {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('timewarp.wip'), 'info');
            }
        });

        utGroup.appendChild(utBadge);
        utGroup.appendChild(ut);
        bodyRow.appendChild(utGroup);

        // ---- 档位格 ----
        const cellRow = document.createElement('div');
        cellRow.className = 'timewarp-cells';

        for (const rate of PANEL_RATES) {
            const cell = document.createElement('button');
            cell.className = 'timewarp-cell';
            cell.dataset.rate = String(rate);
            bindTooltip(cell, rate + 'x');
            const img = document.createElement('img');
            img.className = 'timewarp-cell-img';
            const fb = document.createElement('span');
            fb.className = 'timewarp-cell-fb';
            cell.appendChild(img);
            cell.appendChild(fb);
            cell.addEventListener('click', () => {
                if (rate <= timeWarp.getCurrentMaxRate()) {
                    timeWarp.warpTo(rate);
                }
            });
            cellRow.appendChild(cell);
            this._cells.push({ rate, btn: cell, img, fb });
        }

        bodyRow.appendChild(cellRow);

        const footer = document.createElement('div');
        footer.className = 'timewarp-footer';

        right.appendChild(bodyRow);
        right.appendChild(footer);

        wrap.appendChild(header);
        wrap.appendChild(right);
        document.body.appendChild(wrap);

        this._wrap = wrap;
        this._right = right;
        this._header = header;
        this._utLabel = ut;
        this._footer = footer;
        this._cellActive = [];
        this._cellLocked = [];
    }

    _initEvents() {
        eventBus.on(Events.SCENE_CHANGED, ({ to }) => {
            this.setVisible(SCENE_SHOW.includes(to));
        });

        eventBus.on(Events.TIME_WARP_CHANGED, () => {
            if (this._visible) this.refresh();
        });

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

        eventBus.on(Events.TEXTURES_READY, () => {
            if (this._visible) this.refresh();
        });
    }

    setVisible(visible) {
        if (this._visible === visible) return;
        this._visible = visible;
        this._wrap.style.display = visible ? 'flex' : 'none';
        if (visible) this.refresh();
    }

    // 0.2.5 B12：同一真实帧内可能先后收到 RENDER_DATA 与 CELESTIAL_TIME_UPDATED
    //（飞行场景两个事件每帧各发一次）→ 帧级去重，refresh 每帧最多执行一次
    onFrame(time) {
        const now = performance.now();
        if (now - (this._lastOnFrameMs || 0) < 6) {
            return;
        }
        this._lastOnFrameMs = now;
        const text = formatUT(time);
        if (text !== this._lastUtText) {
            this._lastUtText = text;
            this._utLabel.textContent = text;
        }
        this.refresh();
    }

    refresh() {
        if (!this._visible) return;

        const paused = timeWarp.isPaused();
        const rate = timeWarp.getRate();
        const maxRate = timeWarp.getCurrentMaxRate();
        const savedRate = paused ? timeWarp.getSavedRate() : rate;

        // 决定当前状态 key
        let stateKey;
        if (paused) {
            stateKey = 'p';
        } else if (rate > 1) {
            stateKey = 'w';
        } else {
            stateKey = 'n';
        }

        // ---- 边框颜色 / 控制状态容器显隐 / 顶栏显隐：只在状态 key 变化时更新 ----
        // 0.2.5 B12：状态容器 classList 与顶栏 hidden 原为每帧无条件 toggle，移入缓存分支
        const headerKey = stateKey;
        if (this._lastHeaderKey !== headerKey) {
            this._lastHeaderKey = headerKey;
            this._right.style.borderColor = paused ? COLOR_PAUSE : COLOR_RUN;
            this._header.style.borderColor = paused ? COLOR_PAUSE : COLOR_SPEED;
            for (const [key, container] of Object.entries(this._headerContainers)) {
                const isActive = (key === stateKey);
                container.classList.toggle('active', isActive);
            }
            this._header.classList.toggle('hidden', stateKey === 'n');
        }

        // ---- 档位格 ----
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
            }
            const locked = active ? false : cell.rate > maxRate;
            if (this._cellLocked[i] !== locked) {
                this._cellLocked[i] = locked;
                cell.btn.style.cursor = locked ? 'not-allowed' : 'pointer';
                cell.btn.style.opacity = locked ? 0.45 : 1;
            }
        }

        // ---- 底部倍率 ----
        const footerKey = (paused ? 'p' : 'r') + ':' + savedRate;
        if (this._lastFooterKey !== footerKey) {
            this._lastFooterKey = footerKey;
            this._footer.textContent = t('timewarp.label', { rate: savedRate });
            this._footer.style.color = paused ? COLOR_PAUSE : COLOR_FOOTER;
        }
    }

    _computeTargetRate(savedRate) {
        let target = null;
        for (const r of PANEL_RATES) {
            if (r <= savedRate) target = r;
            else break;
        }
        return target;
    }

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

export const timeWarpUI = new TimeWarpUI();

if (typeof window !== 'undefined') {
    window.__timeWarpUI = timeWarpUI;
    console.log('[TimeWarpUI] 时间加速面板已创建（暂停文本无动画，加速文本有动画）');
}