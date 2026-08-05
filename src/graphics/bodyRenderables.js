'use strict';

// 天体图层配置（数据驱动）— key 对应 celestialBody.textureKey
// 支持两种结构：
// 1. 单模式（无 LOD）：{ layers: [...] }  ← Kerbin 等行星用
// 2. 多模式（LOD 分级）：{ modes: { near: {...}, far: {...} }, nearScreenR: number, farScreenR: number }  ← Kerbol 等恒星用
//
// layer 字段：
//   texture: string       // textureConfig 中的纹理 key（贴图层用）
//   program: string       // 程序效果名称（如 'star_glow'，与 texture 二选一）
//   alpha: number         // 0~1 透明度
//   scale: number         // 相对缩放倍率（光晕放大层用，默认 1）
//   color: string         // 程序效果的颜色参数（hex 格式）
//   zIndex: number        // 图层顺序（小的在下，大的在上）

import { renderableManager } from './renderable.js';

export const bodyRenderableConfigs = {
    // Kerbin：单模式，表面贴图，无 LOD
    kerbin: {
        layers: [
            { texture: 'kerbin_surface', zIndex: 0 }
        ]
    },

    // Kerbol：LOD 分级渲染
    // nearScreenR / farScreenR 定义两档的阈值（像素），中间为过渡区
    kerbol: {
        modes: {
            // 近景档（屏幕半径 >= 200px）：表面清晰 + 弱橙黄光晕（小范围，避免遮挡内行星）
            near: {
                layers: [
                    { texture: 'kerbol_surface', alpha: 1.0, zIndex: 0 },
                    { program: 'star_glow', color: '#ffaa33', alpha: 0.15, scale: 1.15, zIndex: 1 }
                ]
            },
            // 远景档（屏幕半径 <= 100px）：贴图被同尺寸纯色白色光球替代 + 多层柔光晕
            far: {
                layers: [
                    { program: 'star_ball', color: '#ffffff', alpha: 1.0, scale: 1.0, zIndex: 0 },
                    { program: 'star_glow', color: '#ffffff', alpha: 0.9, scale: 2.0, zIndex: 1 },
                    { program: 'star_glow', color: '#ffffff', alpha: 0.6, scale: 4.0, zIndex: 2 },
                    { program: 'star_glow', color: '#ffffff', alpha: 0.35, scale: 8.0, zIndex: 3 },
                    { program: 'star_glow', color: '#ffffff', alpha: 0.15, scale: 16.0, zIndex: 4 }
                ]
            }
        },
        nearScreenR: 200,  // 近景档阈值（>= 此值用 near 模式）
        farScreenR: 100    // 远景档阈值（<= 此值用 far 模式）
    }
};

// 将配置注册进 RenderableManager（main.js 启动时调用一次）
export function registerBodyRenderables() {
    for (const [key, config] of Object.entries(bodyRenderableConfigs)) {
        renderableManager.register(key, config);
    }
    console.log(`[BodyRenderables] 已注册 ${Object.keys(bodyRenderableConfigs).length} 个天体渲染配置`);
}
