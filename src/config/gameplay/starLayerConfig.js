'use strict';

// 恒星 WebGL 层配置（接入侧开关与画布策略）
// 恒星外观参数不在这里：在 vendored 的 src/config/starRenderPresets.js（实验室真源），
// 哪颗恒星用哪套预设由 graphics/bodyRenderables.js 的 starPreset 字段声明。

export const STAR_LAYER_CONFIG = {
    // 按场景开关：关闭的场景继续走原有 Canvas2D 恒星（贴图 + 程序光晕）
    scenes: {
        flightScene: true,
        trackingScene: true
    },
    // 局部画布尺寸按此步长向上取整：缩放时不必每帧重新分配画布
    canvasBucketPx: 32
};
