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

    // Mun：单模式，表面贴图，无 LOD
    mun: {
        layers: [
            { texture: 'mun_surface', zIndex: 0 }
        ]
    },

    // Minmus：单模式，表面贴图，无 LOD
    minmus: {
        layers: [
            { texture: 'minmus_surface', zIndex: 0 }
        ]
    },

    // Duna：单模式，表面贴图，无 LOD
    duna: {
        layers: [
            { texture: 'duna_surface', zIndex: 0 }
        ]
    },

    // Ike：单模式，表面贴图，无 LOD
    ike: {
        layers: [
            { texture: 'ike_surface', zIndex: 0 }
        ]
    },

    // Eve：单模式，表面贴图，无 LOD
    eve: {
        layers: [
            { texture: 'eve_surface', zIndex: 0 }
        ]
    },

    // Gilly：单模式，表面贴图，无 LOD
    gilly: {
        layers: [
            { texture: 'gilly_surface', zIndex: 0 }
        ]
    },

    // Moho：单模式，表面贴图，无 LOD
    moho: {
        layers: [
            { texture: 'moho_surface', zIndex: 0 }
        ]
    },

    // Dres：单模式，表面贴图 + 程序星环（2D 俯视为正圆环带，多细分分层）
    // 参考 KSP2 官方效果：环带更暗、更薄、离天体更远，整体呈深灰半透明并带细密分层。
    dres: {
        layers: [
            { texture: 'dres_surface', zIndex: 0 },
            {
                program: 'planet_ring',
                color: '#9d9d9d',
                alpha: 0.55,
                zIndex: 1,
                bands: [
                    // 内侧主环带：内缘距表面 400km（半径比 (138000+400000)/138000 ≈ 3.90）
                    { inner: 3.90, outer: 3.97, alpha: 0.80 },
                    // 紧邻第二环带（缝隙 0.004，几乎贴合）
                    { inner: 3.974, outer: 4.04, alpha: 0.55 },
                    // 外侧主环带
                    { inner: 4.044, outer: 4.11, alpha: 0.68 },
                    // 最外侧稀薄晕：feather 1.0 = 渐变覆盖全带，向外自然消散且不产生额外暗缝
                    { inner: 4.114, outer: 4.18, alpha: 0.20, feather: 1.0 }
                ]
            }
        ]
    },

    // Jool：单模式，表面贴图，无 LOD（气态巨行星）
    jool: {
        layers: [
            { texture: 'jool_surface', zIndex: 0 }
        ]
    },

    // Laythe：单模式，表面贴图，无 LOD（海洋卫星）
    laythe: {
        layers: [
            { texture: 'laythe_surface', zIndex: 0 }
        ]
    },

    // Vall：单模式，表面贴图，无 LOD（冰卫星）
    vall: {
        layers: [
            { texture: 'vall_surface', zIndex: 0 }
        ]
    },

    // Tylo：单模式，表面贴图，无 LOD（大型冰卫星）
    tylo: {
        layers: [
            { texture: 'tylo_surface', zIndex: 0 }
        ]
    },

    // Bop：单模式，表面贴图，无 LOD（捕获小卫星）
    bop: {
        layers: [
            { texture: 'bop_surface', zIndex: 0 }
        ]
    },

    // Pol：单模式，表面贴图，无 LOD（捕获小卫星）
    pol: {
        layers: [
            { texture: 'pol_surface', zIndex: 0 }
        ]
    },

    // Eeloo：单模式，表面贴图，无 LOD（冰矮行星）
    eeloo: {
        layers: [
            { texture: 'eeloo_surface', zIndex: 0 }
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
