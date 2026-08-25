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
    // 渲染时翻转Y轴，将数学坐标系转换为屏幕坐标系
    return {
        x: (worldX - camera.x) * camera.zoom + canvas.width / 2,
        y: -(worldY - camera.y) * camera.zoom + canvas.height / 2
    };
}

// worldToScreen 的数学逆变换：屏幕坐标（canvas 物理像素）→ 世界坐标
// 注意：入参必须是 canvas 坐标空间的像素（cssX × canvas.width/rect.width），
// 与 flightScene 事件处理中设施命中检测的坐标口径一致
function screenToWorld(screenX, screenY, canvas) {
    return {
        x: (screenX - canvas.width / 2) / camera.zoom + camera.x,
        y: -(screenY - canvas.height / 2) / camera.zoom + camera.y
    };
}

export { camera, initCamera, worldToScreen, screenToWorld };
