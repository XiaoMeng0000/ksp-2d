"use strict";

const camera = { x: 0, y: 0, zoom: 1e-4, rotation: 0 };

// 缩放上下限（按视图档位设置：普通聚焦 [zoomMin, zoomMaxFocus]；机动视图 [zoomMin, fit 上限]）
let _zoomMin = 1e-12;
let _zoomMax = 10;

// 设置缩放上下限（视图切换时调用；动画期间只记录不夹取当前值，
// 否则切换瞬间会把当前缩放硬拉到新范围 → 破坏平滑过渡）
function setZoomLimits(min, max) {
    _zoomMin = isFinite(min) ? min : 1e-12;
    _zoomMax = (isFinite(max) && max > _zoomMin) ? max : _zoomMin;
    if (!_anim) camera.zoom = Math.max(_zoomMin, Math.min(_zoomMax, camera.zoom));
}

function getZoomLimits() {
    return { min: _zoomMin, max: _zoomMax };
}

// 直接设置缩放（按当前上下限夹取）；"视图初值 = 放大上限"由调用方传入
function setZoom(zoom) {
    if (!isFinite(zoom)) return camera.zoom;
    camera.zoom = Math.max(_zoomMin, Math.min(_zoomMax, zoom));
    return camera.zoom;
}

// 预留：镜头旋转（弧度，0 = 不旋转）。当前无 UI 入口，
// 供后续"机动视图镜头旋转"接入——worldToScreen/screenToWorld 已按旋转实现
function setCameraRotation(angle) {
    camera.rotation = isFinite(angle) ? angle : 0;
}

function handleWheel(e) {
    e.preventDefault();
    if (_anim) _anim = null;      // 玩家滚轮接管 → 立即中止进行中的过渡动画
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(_zoomMin, Math.min(_zoomMax, camera.zoom * zoomFactor));
}

// ===== 相机平滑过渡动画（0.2.5）：视图切换 / 聚焦天体切换时平滑移动 + 平滑缩放 =====
// · 目标由函数动态提供（可跟随正在公转的天体，落点始终准确）
// · 缩放按 log 空间插值（跨数量级时观感均匀，而非前半段几乎不动、后半段猛冲）
// · 与滚轮/场景跟随的协作：动画期间由动画独占写值；滚轮按下即中止动画交还玩家
let _anim = null;

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateCameraTo(getTarget, durationMs) {
    if (typeof getTarget !== 'function') return;
    const dur = (isFinite(durationMs) && durationMs > 0) ? durationMs : 1;
    _anim = {
        t0: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
        dur,
        fromX: camera.x,
        fromY: camera.y,
        fromZoom: camera.zoom,
        getTarget
    };
}

// 每帧推进动画；返回 true 表示本帧相机由动画驱动（调用方应跳过跟随/视图写值）
function updateCameraAnimation(nowMs) {
    if (!_anim) return false;
    const now = isFinite(nowMs)
        ? nowMs
        : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    const p = Math.max(0, Math.min(1, (now - _anim.t0) / _anim.dur));
    const e = easeInOutCubic(p);
    const tgt = _anim.getTarget() || {};
    if (isFinite(tgt.x)) camera.x = _anim.fromX + (tgt.x - _anim.fromX) * e;
    if (isFinite(tgt.y)) camera.y = _anim.fromY + (tgt.y - _anim.fromY) * e;
    if (isFinite(tgt.zoom) && tgt.zoom > 0) {
        const z0 = Math.log(_anim.fromZoom);
        const z1 = Math.log(tgt.zoom);
        camera.zoom = Math.exp(z0 + (z1 - z0) * e);
    }
    if (p >= 1) {
        _anim = null;
        // 动画结束：把最终值夹回当前档位的缩放范围（保证不越界）
        camera.zoom = Math.max(_zoomMin, Math.min(_zoomMax, camera.zoom));
    }
    return true;
}

function isCameraAnimating() {
    return !!_anim;
}

function cancelCameraAnimation() {
    _anim = null;
}

function initCamera() {
    window.addEventListener('wheel', handleWheel);
}

function worldToScreen(worldX, worldY, canvas) {
    // 世界 → 相机系（先旋转后缩放），渲染时翻转 Y 轴（数学坐标 → 屏幕坐标）
    const dx = worldX - camera.x;
    const dy = worldY - camera.y;
    const cos = Math.cos(camera.rotation || 0);
    const sin = Math.sin(camera.rotation || 0);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return {
        x: rx * camera.zoom + canvas.width / 2,
        y: -ry * camera.zoom + canvas.height / 2
    };
}

// worldToScreen 的数学逆变换：屏幕坐标（画布物理像素）→ 世界坐标
function screenToWorld(screenX, screenY, canvas) {
    const rx = (screenX - canvas.width / 2) / camera.zoom;
    const ry = -(screenY - canvas.height / 2) / camera.zoom;
    const cos = Math.cos(camera.rotation || 0);
    const sin = Math.sin(camera.rotation || 0);
    // 逆旋转（旋转矩阵转置）
    return {
        x: camera.x + (rx * cos + ry * sin),
        y: camera.y + (-rx * sin + ry * cos)
    };
}

// ===== 坐标空间统一换算（0.2.5：高清屏 DPR 修复）=====
// 约定：所有鼠标事件处理得到的是「画布 CSS 像素」（clientX - rect.left），
// 所有 Canvas 绘制/命中检测使用「画布物理像素」（canvas.width 缓冲空间）。
// 二者关系：物理 = CSS × (canvas.width / rect.width)，在 DPR≠1 或画布被
// CSS 缩放时该比例不恒等于 1 —— 此前设施命中直接用 cssX×devicePixelRatio，
// 与轨道命中/悬停口径不一致，高清屏上点击偏移。全部换算必须收敛到这两个函数。

// CSS 像素 → 画布物理像素
function cssToCanvas(cssX, cssY, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sx = (rect.width || 1) > 0 ? canvas.width / rect.width : 1;
    const sy = (rect.height || 1) > 0 ? canvas.height / rect.height : 1;
    return { x: cssX * sx, y: cssY * sy };
}

// 画布物理像素 → CSS 像素（DOM 定位用，如轨道标签/轨道菜单锚点层）
function canvasToCss(x, y, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sx = (rect.width || 1) > 0 && canvas.width > 0 ? rect.width / canvas.width : 1;
    const sy = (rect.height || 1) > 0 && canvas.height > 0 ? rect.height / canvas.height : 1;
    return { x: x * sx, y: y * sy };
}

export { camera, initCamera, worldToScreen, screenToWorld, cssToCanvas, canvasToCss, setZoomLimits, getZoomLimits, setZoom, setCameraRotation, animateCameraTo, updateCameraAnimation, isCameraAnimating, cancelCameraAnimation };
