const camera = { x: 0, y: 0, zoom: 1 };

function handleWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(0.1, Math.min(5, camera.zoom * zoomFactor));
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

export { camera, initCamera, worldToScreen };
