'use strict';

// 天体渲染配置（尝鲜版）— 只有程序绘制层
//
// ⚠️ 尝鲜版不加载任何天体贴图（assets/images/celestial 下的 PNG 已移除），因此：
//   · 行星 / 卫星一律不注册渲染层 → 渲染层按天体代表色绘制纯色圆盘（含图标缩放保护）；
//   · 只有恒星 Kerbol 登记例外配置：near / far 两档 LOD，全部由程序光晕构成。
//   · 完整版的贴图层与 dres 程序星环配置在 `main` 分支维护。
//
// layer 字段：
//   texture: string       // 贴图路径（尝鲜版不出现）
//   program: string       // 程序效果名称（'star_ball' / 'star_glow' / 'planet_ring'）
//   alpha: number         // 0~1 透明度
//   scale: number         // 相对缩放倍率（光晕放大层用，默认 1）
//   color: string         // 程序效果的颜色参数（hex 格式）
//   zIndex: number        // 图层顺序（小的在下，大的在上）

import { renderableManager } from './renderable.js';
import { solarSystemData } from '../config/world/starSystemIndex.js';

export const bodyRenderableConfigs = {
    // Kerbol：LOD 分级渲染（两档均无贴图，纯程序光晕）
    // nearScreenR / farScreenR 定义两档的阈值（像素），中间为过渡区
    kerbol: {
        modes: {
            // 近景档（屏幕半径 >= 200px）：代表色圆盘 + 弱橙黄光晕（小范围，避免遮挡内行星）
            near: {
                layers: [
                    { program: 'star_ball', color: '#ffcc44', alpha: 1.0, scale: 1.0, zIndex: 0 },
                    { program: 'star_glow', color: '#ffaa33', alpha: 0.35, scale: 1.15, zIndex: 1 }
                ]
            },
            // 远景档（屏幕半径 <= 100px）：亮白光球 + 多层柔光晕
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
// 遍历全部天体静态数据，只登记例外表里的天体；其余天体不注册 → 渲染层走代表色纯色兜底
export function registerBodyRenderables() {
    let registered = 0;

    for (const body of solarSystemData) {
        const key = body.textureKey;
        if (!key) continue;
        const override = bodyRenderableConfigs[key];
        if (!override) continue;
        renderableManager.register(key, override);
        registered++;
    }

    console.log(`[BodyRenderables] 已注册 ${registered} 个天体渲染配置（尝鲜版：无贴图，仅程序层）`);
}
