'use strict';

// 机动节点 UI（0.3.0）— 加速计时器面板 + 节点图标 + 四向分离手柄（DOM 层）
// 架构：UI 只订阅事件 + 每帧读渲染层预测缓存（getLastManeuverPrediction），
//       不直连物理引擎；数据写操作统一走 maneuverSystem
// 命中分层：图标/手柄/面板为 DOM 元素置于画布之上，天然拦截 canvas 事件
//   → 图标覆盖区优先于轨道线悬停/右键菜单（KSP 样式）

import { t } from '../config/strings.js';
import { eventBus, Events } from '../eventBus.js';
import { maneuverSystem } from '../ship/maneuverSystem.js';
import { getLastManeuverPrediction, getLastOrbitSegments, findNearestOrbitPoint, resolveOrbitHit } from '../renderer.js';
import { screenToWorld, cssToCanvas, canvasToCss, worldToScreen } from '../camera.js';
import { getCachedTime, bodyFuturePos } from '../physics/orbitalPrediction.js';
import { celestialBodies } from '../physics/physics.js';
import { timeWarp } from '../timeWarp.js';
import { formatTCountdown } from '../utils/format.js';
import { MANEUVER_CONFIG } from '../config/maneuverConfig.js';

// ===== 模块状态 =====
let _panel = null;          // 加速计时器面板
let _icon = null;           // 节点图标（空心圆）
let _handles = {};          // 四向分离手柄 DOM
let _canvas = null;
let _initialized = false;
let _drag = null;           // { mode:'time' } | { mode:'dv', axis, startClientX/Y, lastDelta, axes }
let _lastShip = null;       // 本帧活动飞船（按钮点击/拖拽事件用）

// 手柄轴顺序：pro / retro / radIn / radOut
const HANDLE_AXES = ['pro', 'retro', 'radIn', 'radOut'];

// ===== DOM 构建（懒初始化） =====
function ensureDom() {
    if (_initialized) return;

    // 主题变量注入（CSS var 兜底之外由配置显式驱动）
    const root = document.documentElement;
    root.style.setProperty('--node-icon-border', MANEUVER_CONFIG.nodeIconBorder);
    root.style.setProperty('--handle-prograde', MANEUVER_CONFIG.handleProgradeColor);
    root.style.setProperty('--handle-radial', MANEUVER_CONFIG.handleRadialColor);

    // 面板
    _panel = document.createElement('div');
    _panel.id = 'maneuverPanel';
    _panel.style.display = 'none';
    _panel.style.left = MANEUVER_CONFIG.panelLeft + 'px';
    _panel.style.bottom = MANEUVER_CONFIG.panelBottom + 'px';
    _panel.innerHTML =
        '<div class="maneuver-title">' +
            '<div class="maneuver-badge"></div>' +
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
    _panel.querySelector('.maneuver-badge').textContent = t('maneuver.badge');
    const rows = _panel.querySelectorAll('.maneuver-row');
    const rowKeys = ['maneuver.dvNeeded', 'maneuver.burnStartAt', 'maneuver.burnStopAt'];
    for (let i = 0; i < rows.length; i++) {
        rows[i].querySelector('.maneuver-label').textContent = t(rowKeys[i]);
    }
    const greenBtn = _panel.querySelector('.maneuver-btn-green');
    greenBtn.textContent = '➤➤';
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

    // 节点图标 + 四向手柄
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
    }
    _icon.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        beginTimeDrag(e);
    });

    // 拖拽期间全局监听（mouseup/pointerup 到 window，防拖出元素丢事件）
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

// ===== 拖拽（时间 / Δv 轴） =====
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
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastDelta: 0,
        axes: pred.plan.axes
    };
    _handles[axis].setPointerCapture(e.pointerId);
}

function onDragMove(e) {
    if (!_drag || !_canvas) return;
    const ship = _lastShip;
    if (!ship) {
        _drag = null;
        return;
    }

    if (_drag.mode === 'time') {
        // 图标沿轨道拖动 → 命中当前帧预测链 → 重算节点时刻与轨道坐标
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
                maneuverSystem.updateNodeTime(ship, {
                    time: absTime,
                    relX: cur ? cur.relX : null,
                    relY: cur ? cur.relY : null,
                    anchorBody: cur ? cur.anchorBody : null
                });
            }
        }
    } else if (_drag.mode === 'dv') {
        // 手柄沿节点参考系轴拖动 → 屏幕位移投影到轴方向 → Δv（灵敏度配置）
        const pred = getLastManeuverPrediction();
        if (!pred || !pred.plan || !pred.nodeScreen || !pred.plan.nodeState) return;
        const axis = _drag.axes[_drag.axis];
        if (!axis) return;
        const dir = axisScreenDir(axis, pred, _canvas);
        const signed = (e.clientX - _drag.startClientX) * dir.x + (e.clientY - _drag.startClientY) * dir.y;
        // CSS 像素 → Δv（灵敏度配置）
        const delta = signed * MANEUVER_CONFIG.handleDvPerPixel;
        maneuverSystem.updateNodeDeltaV(ship, _drag.axis, delta - _drag.lastDelta, _drag.axes);
        _drag.lastDelta = delta;
    }
}

function onDragEnd() {
    _drag = null;
}

// ===== 事件订阅：到达 / 完成 通知（音效由 audioDirector 订阅同一事件） =====
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
        // 手柄：沿节点参考系轴偏移（无轴数据时隐藏手柄）
        const axes = plan ? plan.axes : null;
        const showHandles = !!axes && !node.executed;
        for (const axis of HANDLE_AXES) {
            const h = _handles[axis];
            if (!showHandles || !axes[axis]) {
                h.style.display = 'none';
                continue;
            }
            // 轴屏幕方向
            const sDir = axisScreenDir(axes[axis], pred, canvas);
            h.style.display = 'block';
            h.style.left = (iconCss.x + sDir.x * cfg.handleOffset) + 'px';
            h.style.top = (iconCss.y + sDir.y * cfg.handleOffset) + 'px';
        }
    } else {
        _icon.style.display = 'none';
        for (const axis of HANDLE_AXES) _handles[axis].style.display = 'none';
    }

    // ---- 面板读卡 ----
    _panel.style.display = 'block';
    const rows = _panel.querySelectorAll('.maneuver-row');
    const values = rows[0].querySelector('.maneuver-value');
    values.textContent = Math.round(progress.remaining) + '/' + Math.round(progress.planned);
    const startVal = rows[1].querySelector('.maneuver-value');
    startVal.textContent = 'T-' + formatTCountdown(Math.max(0, node.time - now));
    const stopVal = rows[2].querySelector('.maneuver-value');
    stopVal.textContent = 'T-' + formatTCountdown(Math.max(0, node.time + burnT - now));

    // ---- 进度条（Δv 达成比例） ----
    const fill = _panel.querySelector('.maneuver-bar-fill');
    const ratio = progress.planned > 0
        ? Math.max(0, Math.min(1, 1 - progress.remaining / progress.planned))
        : 0;
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

// 轴向量 → 屏幕方向单位向量（画布物理像素空间；方向无量纲，CSS 空间点积同值）
function axisScreenDir(axis, pred, canvas) {
    if (!pred.nodeScreen || !pred.plan.nodeState) return { x: 1, y: 0 };
    const hp = bodyFuturePos(pred.plan.nodeState.host, getCachedTime());
    const wx = pred.plan.nodeState.relPos.x + hp.x;
    const wy = pred.plan.nodeState.relPos.y + hp.y;
    const tip = worldToScreen(wx + axis.x * 1000, wy + axis.y * 1000, canvas);
    const dx = tip.x - pred.nodeScreen.x;
    const dy = tip.y - pred.nodeScreen.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: 1, y: 0 };
    return { x: dx / len, y: dy / len };
}

// 世界坐标 → CSS 坐标（与 renderer.worldToScreen 同口径后转 CSS）
function worldToCanvasCss(wx, wy, canvas) {
    const s = worldToScreen(wx, wy, canvas);
    return canvasToCss(s.x, s.y, canvas);
}

// ===== 场景退出清理（flightScene exit 调用） =====
export function hideManeuverUI() {
    _drag = null;
    if (_panel) _panel.style.display = 'none';
    if (_icon) _icon.style.display = 'none';
    for (const axis of HANDLE_AXES) {
        if (_handles[axis]) _handles[axis].style.display = 'none';
    }
}

// 拖拽中（flightScene 跳过轨道悬停检测）
export function isManeuverDragging() {
    return !!_drag;
}
