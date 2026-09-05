'use strict';

// 机动节点 UI（0.3.0）— 加速计时器面板 + 节点图标 + 十字型四向手柄（DOM 层）
// 架构：UI 只订阅事件 + 每帧读渲染层预测缓存（getLastManeuverPrediction），
//       不直连物理引擎；数据写操作统一走 maneuverSystem
// 命中分层：图标/手柄/面板为 DOM 元素置于画布之上，天然拦截 canvas 事件
//   → 图标覆盖区优先于轨道线悬停/右键菜单（KSP 样式）
// 交互（0.3.0 定稿）：节点存在期间 图标/十字手柄/面板 全部常驻可操作；
//   空白点击仅终止进行中的拖拽（不隐藏任何元素，拖动能力永不失能）

import { t } from '../config/strings.js';
import { eventBus, Events } from '../eventBus.js';
import { maneuverSystem } from '../ship/maneuverSystem.js';
import { getLastManeuverPrediction, getLastOrbitSegments, findNearestOrbitPoint, resolveOrbitHit } from '../renderer.js';
import { screenToWorld, cssToCanvas, canvasToCss, worldToScreen } from '../camera.js';
import { getCachedTime, bodyFuturePos } from '../physics/orbitalPrediction.js';
import { walkToTime } from '../physics/maneuverPrediction.js';
import { celestialBodies } from '../physics/physics.js';
import { textureManager } from '../graphics/textureManager.js';
import { timeWarp } from '../timeWarp.js';
import { formatTCountdown } from '../utils/format.js';
import { MANEUVER_CONFIG } from '../config/maneuverConfig.js';

// ===== 模块状态 =====
let _panel = null;          // 加速计时器面板
let _icon = null;           // 节点图标（空心圆）
let _handles = {};          // 十字型四向手柄 DOM
let _lines = {};            // 中心圆 → 方向图标的实线衔接线
let _canvas = null;
let _initialized = false;
let _editing = true;        // 编辑态开关：true=十字手柄+衔接线显示；false=完全隐藏（点节点图标重开）
let _drag = null;           // { mode:'time' } | { mode:'dv', axis, dist, lastTick, rafId, axes }
let _lastShip = null;       // 本帧活动飞船（按钮点击/拖拽事件用）

// 十字型手柄布局（屏幕空间固定，不随轨道方向旋转）：
//   上=径向朝外 下=径向朝内 右=顺向 左=逆向（dy 向下为正，0.3.0 打磨定稿）
const HANDLE_AXES = ['pro', 'retro', 'radIn', 'radOut'];
const HANDLE_LAYOUT = {
    pro: { dx: 1, dy: 0 },
    retro: { dx: -1, dy: 0 },
    radIn: { dx: 0, dy: 1 },
    radOut: { dx: 0, dy: -1 }
};
// 手柄图标：复用 SAS 方向图标纹理（dir_*）+ 导航球配色（白线模板 source-in 染色）
const HANDLE_ICONS = {
    pro: { tex: 'dir_prograde', color: MANEUVER_CONFIG.handleProgradeColor },
    retro: { tex: 'dir_retrograde', color: MANEUVER_CONFIG.handleProgradeColor },
    radIn: { tex: 'dir_radial_in', color: MANEUVER_CONFIG.handleRadialColor },
    radOut: { tex: 'dir_radial_out', color: MANEUVER_CONFIG.handleRadialColor }
};
// 染色 dataURL 缓存（texture/color 组合，40px 高清底图）
const _iconDataUrlCache = new Map();

// ===== DOM 构建（懒初始化） =====
function ensureDom() {
    if (_initialized) return;

    // 面板
    _panel = document.createElement('div');
    _panel.id = 'maneuverPanel';
    _panel.style.display = 'none';
    _panel.innerHTML =
        '<div class="maneuver-title">' +
            '<div class="maneuver-title-text"></div>' +
            '<div class="maneuver-title-line"></div>' +
        '</div>' +
        '<div class="maneuver-body">' +
            '<div class="maneuver-btns">' +
                '<div class="maneuver-btn maneuver-btn-green" title=""></div>' +
                '<div class="maneuver-btn maneuver-btn-red" title=""></div>' +
            '</div>' +
            '<div class="maneuver-card">' +
                '<div class="maneuver-row">' +
                    '<span class="maneuver-check">✓</span>' +
                    '<span class="maneuver-label"></span>' +
                    '<span class="maneuver-value"></span>' +
                '</div>' +
                '<div class="maneuver-row maneuver-time-row">' +
                    '<span class="maneuver-check">✓</span>' +
                    '<span class="maneuver-label"></span>' +
                    '<span class="maneuver-value"></span>' +
                '</div>' +
                '<div class="maneuver-row maneuver-time-row">' +
                    '<span class="maneuver-check">✓</span>' +
                    '<span class="maneuver-label"></span>' +
                    '<span class="maneuver-value"></span>' +
                '</div>' +
            '</div>' +
            '<div class="maneuver-leds">' +
                '<div class="maneuver-led"></div>' +
                '<div class="maneuver-led"></div>' +
                '<div class="maneuver-led"></div>' +
            '</div>' +
        '</div>' +
        '<div class="maneuver-bar-wrap"><div class="maneuver-bar-fill"></div></div>';
    document.body.appendChild(_panel);

    // 静态文案
    _panel.querySelector('.maneuver-title-text').textContent = t('maneuver.panelTitle');
    const rows = _panel.querySelectorAll('.maneuver-row');
    const rowKeys = ['maneuver.dvNeeded', 'maneuver.burnStartAt', 'maneuver.burnStopAt'];
    for (let i = 0; i < rows.length; i++) {
        rows[i].querySelector('.maneuver-label').textContent = t(rowKeys[i]);
    }
    const greenBtn = _panel.querySelector('.maneuver-btn-green');
    greenBtn.textContent = '>>';
    greenBtn.title = t('maneuver.warpToBurnTip');
    const redBtn = _panel.querySelector('.maneuver-btn-red');
    redBtn.textContent = '🗑';
    redBtn.title = t('maneuver.deleteTip');

    // 按钮事件
    greenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ship = _lastShip;
        const node = ship ? maneuverSystem.getNode(ship) : null;
        if (!ship || !node || node.executed) return;
        const target = node.time - MANEUVER_CONFIG.warpLeadTime;
        if (target <= getCachedTime()) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('maneuver.warpTooClose'), 'info');
            }
            return;
        }
        timeWarp.warpToTime(target);
        emitClickSound(greenBtn);
        if (typeof window.showNotification === 'function') {
            window.showNotification(t('maneuver.warpStarted'), 'info');
        }
    });
    redBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ship = _lastShip;
        if (!ship) return;
        maneuverSystem.deleteNode(ship);
        emitClickSound(redBtn);
        if (typeof window.showNotification === 'function') {
            window.showNotification(t('maneuver.deleted'), 'info');
        }
    });

    // 节点图标 + 十字手柄
    _icon = document.createElement('div');
    _icon.className = 'maneuver-node-icon';
    _icon.style.display = 'none';
    document.body.appendChild(_icon);

    for (const axis of HANDLE_AXES) {
        const h = document.createElement('div');
        h.className = 'maneuver-handle maneuver-handle-' + axis;
        h.style.display = 'none';
        document.body.appendChild(h);
        _handles[axis] = h;
        h.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            beginDvDrag(axis, e);
        });
        // 中心圆 → 方向图标衔接线（轴对齐实线，颜色 = 对应图标色；拖拽随手柄延伸）
        const ln = document.createElement('div');
        ln.className = 'maneuver-handle-line';
        ln.style.display = 'none';
        ln.style.background = HANDLE_ICONS[axis].color;
        document.body.appendChild(ln);
        _lines[axis] = ln;
    }
    _icon.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        _editing = true;          // 点图标 → 展开编辑
        beginTimeDrag(e);
    });

    // 拖拽期间全局监听（pointerup 到 window，防拖出元素丢事件）
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);

    _initialized = true;
}

function emitClickSound(el) {
    const rect = el.getBoundingClientRect();
    const yRatio = window.innerHeight > 0
        ? Math.max(0, Math.min(1, (rect.top + rect.height / 2) / window.innerHeight))
        : 0.5;
    eventBus.emit(Events.UI_CLICKED, { variant: 'normal', yRatio });
}

// 方向图标染色 dataURL（与 sasUI._tintImage 同款：白色单色模板 + source-in 纯色填充；
// 输出缓存，避免每帧重建）
function tintedIconDataUrl(texKey, color) {
    const cacheKey = texKey + '|' + color;
    if (_iconDataUrlCache.has(cacheKey)) return _iconDataUrlCache.get(cacheKey);
    const img = textureManager.get(texKey);
    if (!img) return null;
    const size = 40;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, size, size);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = color;
    octx.fillRect(0, 0, size, size);
    octx.globalCompositeOperation = 'source-over';
    const url = off.toDataURL();
    _iconDataUrlCache.set(cacheKey, url);
    return url;
}

// ===== 拖拽（时间 / Δv 轴速率式） =====
function beginTimeDrag(e) {
    _drag = { mode: 'time' };
    _icon.setPointerCapture(e.pointerId);
}

function beginDvDrag(axis, e) {
    const pred = getLastManeuverPrediction();
    if (!pred || !pred.plan || !pred.plan.axes) return;
    _drag = {
        mode: 'dv',
        axis,
        // 拖拽基准 = 图标初始位置（按下点 client 坐标）：未拖动时零速率
        startClientX: e.clientX,
        startClientY: e.clientY,
        dist: 0,                        // 当前拖拽距离（CSS px，从初始位置沿布局轴向外）
        lastTick: performance.now(),    // 速率累计计时基准（真实秒）
        rafId: null,
        axes: pred.plan.axes
    };
    _handles[axis].setPointerCapture(e.pointerId);
}

// 速率式累计循环：rate = (拖拽距离/拖拽范围) × 最大速率(150 m/s·s)，按真实时间注入 Δv；
// 拖拽距离从图标初始位置起算（拖前零速率），反向被 clamp 为 0
function tickDvAccumulate() {
    if (!_drag || _drag.mode !== 'dv') return;
    const now = performance.now();
    const dtReal = Math.max(0, (now - _drag.lastTick) / 1000);
    _drag.lastTick = now;
    if (dtReal > 0) {
        const cfg = MANEUVER_CONFIG;
        const rate = (Math.min(_drag.dist, cfg.handleDragRange) / cfg.handleDragRange) * cfg.handleMaxRate;
        if (rate > 0.001 && _lastShip) {
            maneuverSystem.updateNodeDeltaV(_lastShip, _drag.axis, rate * dtReal, _drag.axes);
        }
    }
    _drag.rafId = window.requestAnimationFrame(tickDvAccumulate);
}

function onDragMove(e) {
    if (!_drag || !_canvas) return;
    const ship = _lastShip;
    if (!ship) {
        onDragEnd();
        return;
    }

    if (_drag.mode === 'time') {
        // 图标沿轨道拖动 → 命中当前帧预测链 → 重算节点时刻/轨道坐标/速度快照
        const rect = _canvas.getBoundingClientRect();
        const canvasPt = cssToCanvas(e.clientX - rect.left, e.clientY - rect.top, _canvas);
        const world = screenToWorld(canvasPt.x, canvasPt.y, _canvas);
        const segments = getLastOrbitSegments();
        if (segments && segments.length > 0) {
            const hit = findNearestOrbitPoint(segments, world, 30, _canvas);
            if (hit && hit.timeOffset !== null && hit.timeOffset !== undefined) {
                const seg = segments[hit.segmentIndex];
                const absTime = seg.anchorTime + hit.timeOffset;
                const cur = resolveOrbitHit(hit, _canvas);
                let velRel = null;
                try {
                    const st = walkToTime(segments, absTime);
                    if (st && st.relVel) velRel = st.relVel;
                } catch (err) { /* 瞬时缺失 → 跳过速度快照 */ }
                maneuverSystem.updateNodeTime(ship, {
                    time: absTime,
                    relX: cur ? cur.relX : null,
                    relY: cur ? cur.relY : null,
                    anchorBody: cur ? cur.anchorBody : null,
                    velRel
                });
            }
        }
    } else if (_drag.mode === 'dv') {
        // 速率式手柄：拖拽距离 = 从"图标初始位置（按下点）"沿布局轴的投影位移；
        // 从图标起算 → 未拖动时零速率；反向（向内）clamp 0，仅允许向外拖
        const dir = HANDLE_LAYOUT[_drag.axis];
        const signed = (e.clientX - _drag.startClientX) * dir.dx + (e.clientY - _drag.startClientY) * dir.dy;
        _drag.dist = Math.max(0, signed);
        if (!_drag.rafId) {
            _drag.rafId = window.requestAnimationFrame(tickDvAccumulate);
        }
    }
}

function onDragEnd() {
    if (_drag && _drag.rafId) {
        window.cancelAnimationFrame(_drag.rafId);
    }
    _drag = null;
}

// ===== 事件订阅：到达 / 完成（音效由 audioDirector 订阅同一事件） =====
eventBus.on(Events.MANEUVER_ARRIVED, () => {
    if (typeof window.showNotification === 'function') {
        window.showNotification(t('maneuver.arrived'), 'info');
    }
});
eventBus.on(Events.MANEUVER_COMPLETED, () => {
    if (typeof window.showNotification === 'function') {
        window.showNotification(t('maneuver.completed'), 'success');
    }
});

// ===== 每帧更新（flightScene render 尾调用，仅活动飞船） =====
export function updateManeuverUI(canvas, ship) {
    _canvas = canvas;
    _lastShip = ship;
    ensureDom();

    const node = maneuverSystem.getNode(ship);
    if (!node) {
        hideManeuverUI();
        return;
    }

    const pred = getLastManeuverPrediction();
    const now = getCachedTime();
    const cfg = MANEUVER_CONFIG;
    const progress = maneuverSystem.getProgress(ship);
    const plan = pred && pred.plan ? pred.plan : null;
    const burnT = (plan && plan.burnDuration !== null && plan.burnDuration !== undefined)
        ? plan.burnDuration : 0;

    // ---- 图标屏幕位置：预测链内优先；退化用冻结轨道坐标 ----
    let iconCss = null;
    if (pred && pred.nodeScreen) {
        iconCss = canvasToCss(pred.nodeScreen.x, pred.nodeScreen.y, canvas);
    } else if (node.relX !== undefined && node.relX !== null && node.anchorBody) {
        const b = celestialBodies.find(x => x.name === node.anchorBody);
        const hp = b ? bodyFuturePos(b, now) : { x: 0, y: 0 };
        const wx = node.relX + hp.x;
        const wy = node.relY + hp.y;
        iconCss = worldToCanvasCss(wx, wy, canvas);
    }
    if (iconCss) {
        _icon.style.display = 'block';
        _icon.style.left = iconCss.x + 'px';
        _icon.style.top = iconCss.y + 'px';
        // 十字手柄：编辑态开关控制（true=显示；false=完全隐藏——空白点击关闭后
        // 需点击节点图标重新进入编辑；轴数据不可用/节点完成时同样隐藏）。
        const axes = plan ? plan.axes : null;
        const showHandles = _editing && !!axes && !node.executed;
        const iconHalf = cfg.handleIconSize / 2;
        for (const axis of HANDLE_AXES) {
            const h = _handles[axis];
            const ln = _lines[axis];
            if (!showHandles || !axes[axis]) {
                h.style.display = 'none';
                if (ln) ln.style.display = 'none';
                continue;
            }
            // 屏幕固定十字方向；拖拽该轴时从初始位置向外递进（动画反馈，距离∝速率；
            // 反向被 clamp 0 → 手柄不低于静止位）
            const dir = HANDLE_LAYOUT[axis];
            const dragDist = (_drag && _drag.mode === 'dv' && _drag.axis === axis)
                ? _drag.dist
                : null;
            const dist = dragDist !== null
                ? cfg.handleOffset + Math.min(dragDist, cfg.handleDragRange)
                : cfg.handleOffset;
            h.style.display = 'block';
            h.style.left = (iconCss.x + dir.dx * dist) + 'px';
            h.style.top = (iconCss.y + dir.dy * dist) + 'px';
            // 图标：现行 SAS 方向图标（dir_* 纹理 + 导航球色染色），纹理未就绪时兜底无底色
            const icon = HANDLE_ICONS[axis];
            if (icon) {
                const url = tintedIconDataUrl(icon.tex, icon.color);
                if (url && h.style.backgroundImage !== 'url(' + url + ')') {
                    h.style.backgroundImage = 'url(' + url + ')';
                }
            }
            // 衔接线：编辑态显示（中心圆边缘 → 当前手柄图标边缘，各让 4px 间隙）
            const startD = 11 + 4;
            const endD = dist - iconHalf - 4;
            if (endD > startD + 1) {
                ln.style.display = 'block';
                if (dir.dx === 0) {
                    // 垂直轴（上/下）
                    const yTop = dir.dy < 0 ? (iconCss.y - endD) : (iconCss.y + startD);
                    ln.style.left = (iconCss.x - 1) + 'px';
                    ln.style.top = yTop + 'px';
                    ln.style.width = '2px';
                    ln.style.height = (endD - startD) + 'px';
                } else {
                    // 水平轴（左/右）
                    const xLeft = dir.dx < 0 ? (iconCss.x - endD) : (iconCss.x + startD);
                    ln.style.left = xLeft + 'px';
                    ln.style.top = (iconCss.y - 1) + 'px';
                    ln.style.width = (endD - startD) + 'px';
                    ln.style.height = '2px';
                }
            } else {
                ln.style.display = 'none';
            }
        }
    } else {
        _icon.style.display = 'none';
        for (const axis of HANDLE_AXES) {
            _handles[axis].style.display = 'none';
            if (_lines[axis]) _lines[axis].style.display = 'none';
        }
    }

    // ---- 面板（常驻：节点存在即显示；空白点击仅收起手柄编辑） ----
    // 锚定：时间加速面板（#timeWarpWrap bottom 12px 居中）正上方居中
    const warpWrap = document.getElementById('timeWarpWrap');
    const warpH = warpWrap ? warpWrap.offsetHeight : 0;
    _panel.style.bottom = (12 + warpH + cfg.panelGap) + 'px';
    _panel.style.display = 'block';
    const rows = _panel.querySelectorAll('.maneuver-row');
    const values = rows[0].querySelector('.maneuver-value');
    values.textContent = Math.round(progress.remaining) + '/' + Math.round(progress.planned);
    const startVal = rows[1].querySelector('.maneuver-value');
    startVal.textContent = 'T-' + formatTCountdown(Math.max(0, node.time - now));
    const stopVal = rows[2].querySelector('.maneuver-value');
    stopVal.textContent = 'T-' + formatTCountdown(Math.max(0, node.time + burnT - now));

    // ---- 进度条（0.3.0 打磨：项目绿满 → 消耗式向左缩小归零；宽度 = 剩余/计划） ----
    const fill = _panel.querySelector('.maneuver-bar-fill');
    const ratio = progress.planned > 0
        ? Math.max(0, Math.min(1, progress.remaining / progress.planned))
        : 1;
    fill.style.width = (ratio * 100).toFixed(1) + '%';

    // ---- 三段倒计时状态灯 ----
    updateLeds(node, burnT, now);

    // ---- 按钮可用性 ----
    const greenBtn = _panel.querySelector('.maneuver-btn-green');
    greenBtn.disabled = node.executed || (node.time - cfg.warpLeadTime <= now);
}

function updateLeds(node, burnT, now) {
    if (!_panel) return;
    const leds = _panel.querySelectorAll('.maneuver-led');
    const win = MANEUVER_CONFIG.ledWindowSeconds;
    const rem = node.time - now;
    let classes;
    if (rem > 0) {
        // 节点前：距节点 ≤3s 时自上而下每秒点亮（白）
        const lit = rem <= win ? win - Math.floor(rem) : 0;
        classes = ledsToClasses(leds.length, lit, 'lit');
    } else {
        const remEnd = node.time + burnT - now;
        if (remEnd > 0) {
            // 节点后（燃烧窗口内）：全绿；距燃烧结束 ≤3s 时自上而下每秒变红
            const red = remEnd <= win ? win - Math.floor(remEnd) : 0;
            classes = ledsToClasses(leds.length, red, 'red', 'green');
        } else {
            // 燃烧结束归零 → 恢复灰
            classes = ledsToClasses(leds.length, 0, null);
        }
    }
    for (let i = 0; i < leds.length; i++) {
        leds[i].className = 'maneuver-led' + (classes[i] ? ' ' + classes[i] : '');
    }
}

// 生成状态灯 class 序列：[前 count 盏 topClass，其余 baseClass]
function ledsToClasses(total, count, topClass, baseClass) {
    const arr = [];
    for (let i = 0; i < total; i++) {
        arr.push(i < count ? topClass : baseClass);
    }
    return arr;
}

// 世界坐标 → CSS 坐标（与 renderer.worldToScreen 同口径后转 CSS）
function worldToCanvasCss(wx, wy, canvas) {
    const s = worldToScreen(wx, wy, canvas);
    return canvasToCss(s.x, s.y, canvas);
}

// ===== 场景退出清理（flightScene exit 调用） =====
export function hideManeuverUI() {
    onDragEnd();
    _editing = true;          // 下次进入恢复展开态
    if (_panel) _panel.style.display = 'none';
    if (_icon) _icon.style.display = 'none';
    for (const axis of HANDLE_AXES) {
        if (_handles[axis]) _handles[axis].style.display = 'none';
        if (_lines[axis]) _lines[axis].style.display = 'none';
    }
}

// 空白点击：彻底关闭编辑（收起方向图标与衔接线；面板/节点图标常驻；
// 点击节点图标重新进入编辑）
export function collapseManeuverEditing() {
    onDragEnd();
    _editing = false;
}

// 拖拽中（flightScene 跳过轨道悬停检测）
export function isManeuverDragging() {
    return !!_drag;
}
