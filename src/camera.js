"use strict";

const camera = { x: 0, y: 0, zoom: 1e-4 };

function handleWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(1e-12, Math.min(10, camera.zoom * zoomFactor));
}

function initCamera() {
    window.addEventListener('wheel', handleWheel);
}

function worldToScreen(worldX, worldY, canvas) {
    // 渲染时翻转Y轴，将数学坐标系转换为屏幕坐标系（返回画布物理像素坐标）
    return {
        x: (worldX - camera.x) * camera.zoom + canvas.width / 2,
        y: -(worldY - camera.y) * camera.zoom + canvas.height / 2
    };
}

// worldToScreen 的数学逆变换：屏幕坐标（画布物理像素）→ 世界坐标
function screenToWorld(screenX, screenY, canvas) {
    return {
        x: (screenX - canvas.width / 2) / camera.zoom + camera.x,
        y: -(screenY - canvas.height / 2) / camera.zoom + camera.y
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

export { camera, initCamera, worldToScreen, screenToWorld, cssToCanvas, canvasToCss };
