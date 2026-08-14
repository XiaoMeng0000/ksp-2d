'use strict';

// 星空背景（天空盒）配置 — 飞行/追踪站场景共用的静态星空
// 视觉方案：屏幕空间固定背景（天空盒）+ 微闪烁
// 坐标与相机解耦：星点固定像素坐标、固定像素尺寸，不随缩放/平移变化
// 闪烁用真实时间驱动（performance.now），不受游戏时间加速影响

export const STARFIELD_CONFIG = {
    // 星星密度：每 px² 一颗的倒数值，越小越密（约 2500px² 一颗）
    density: 2500,

    // 星数上下限：防超小屏过稀 / 超大屏过密失控
    minCount: 200,
    maxCount: 1000,

    // 绘制边缘余量（px）：超出屏幕边缘也生成星星，避免平移/缩放时边缘露空
    margin: 64,

    // 星点半径范围（px）：固定像素尺寸，不随相机 zoom 缩放
    radiusRange: { min: 0.5, max: 1.8 },

    // 基准亮度范围（0~1）：基础明暗分层
    brightnessRange: { min: 0.2, max: 1.0 },

    // 颜色池：冷白为主，少量偏蓝 / 偏黄 / 偏红橙恒星，增加真实感
    colors: [
        '#ffffff', '#ffffff', '#ffffff', '#ffffff',
        '#ffffff', '#ffffff', '#ffffff',
        '#cfe0ff', '#cfe0ff',   // 偏蓝
        '#ffe9c9',               // 偏黄
        '#ffd2c9'                // 偏红橙
    ],

    // 微闪烁配置：亮度 = 基准亮度 × (1 + 振幅 × sin(2π·t/周期 + 相位))
    twinkle: {
        enabled: true,
        // 振幅范围（占基准亮度的比例，0 表示不闪）
        amplitudeRange: { min: 0.15, max: 0.45 },
        // 闪烁周期范围（秒）
        periodRange: { min: 1.5, max: 4.0 }
    },

    // 恒星遮挡星空：视角靠近恒星（星盘覆盖视野中央）时，恒星光芒淹没背景星空
    // 科学依据：靠近恒星时背景星光不可见（如白昼不见星）
    // 驱动指标 covered = 星盘屏幕半径 − 星心到屏幕中心距离（px）
    //   covered <= 0：恒星未覆盖视野中央，星空完整显示
    //   covered >= fadeStart 开始淡出；>= fadeEnd 完全消失
    // 用 covered 而非单纯屏幕半径，可排除"恒星在屏幕外但半径巨大"的误判
    starOcclusion: {
        enabled: true,
        // 推荐窗口：星盘边缘刚越过屏幕中央（0px）开始淡出，越过 300px 后完全消失
        fadeStart: 0,
        fadeEnd: 300
    }
};
