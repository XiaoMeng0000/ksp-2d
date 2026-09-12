"use strict";

const camera = { x: 0, y: 0, zoom: 1e-4, rotation: 0 };

// 缩放上下限（按视图档位设置：普通聚焦 [zoomMin, zoomMaxFocus]；机动视图 [zoomMin, fit 上限]）
let _zoomMin = 1e-12;
let _zoomMax = 10;

// 设置缩放上下限（视图切换时调用；会立即把当前缩放夹进新范围）
function setZoomLimits(min, max) {
    _zoomMin = isFinite(min) ? min : 1e-12;
    _zoomMax = (isFinite(max) && max > _zoomMin) ? max : _zoomMin;
    camera.zoom = Math.max(_zoomMin, Math.min(_zoomMax, camera.zoom));
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
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(_zoomMin, Math.min(_zoomMax, camera.zoom * zoomFactor));
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

export { camera, initCamera, worldToScreen, screenToWorld, cssToCanvas, canvasToCss, setZoomLimits, getZoomLimits, setZoom, setCameraRotation };
