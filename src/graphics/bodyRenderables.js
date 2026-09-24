'use strict';

// 天体渲染配置（0.3.0）— 默认规则 + 例外表
//
// 默认规则：天体配置（systems/*.js）里声明了 texture → 自动注册一层表面贴图（zIndex 0），
//           无需在本文件登记。新增普通天体因此只需改天体配置 + 放图，本文件零改动。
// 例外表：只登记无法由默认规则推导的特殊渲染配置，key 为 celestialBody.textureKey（渲染查找键）
//   - dres  ：表面贴图 + 程序星环（4 条环带）
//   - kerbol：near / far 两档 LOD 分级（远景档不含贴图，整档由程序光晕构成）
//
// 注意：例外表内的贴图路径与其天体配置中的 texture 同值 —— 这是刻意的显式声明
//       （LOD 阈值 / 星环参数属于渲染层专属配置，不宜下沉到物理数据层）；
//       若调整 Dres / Kerbol 的贴图路径，需一并修改此处。
//
// layer 字段：
//   texture: string       // 贴图路径（贴图层用）
//   program: string       // 程序效果名称（如 'star_glow'，与 texture 二选一）
//   alpha: number         // 0~1 透明度
//   scale: number         // 相对缩放倍率（光晕放大层用，默认 1）
//   color: string         // 程序效果的颜色参数（hex 格式）
//   zIndex: number        // 图层顺序（小的在下，大的在上）

import { renderableManager } from './renderable.js';
import { solarSystemData } from '../config/world/starSystemIndex.js';

export const bodyRenderableConfigs = {
    // Dres：表面贴图 + 程序星环（2D 俯视为正圆环带，多细分分层）
    // 参考 KSP2 官方效果：环带更暗、更薄、离天体更远，整体呈深灰半透明并带细密分层。
    dres: {
        layers: [
            { texture: 'assets/images/celestial/kerbolar/dres.png', zIndex: 0 },
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

    // Kerbol：LOD 分级渲染
    // nearScreenR / farScreenR 定义两档的阈值（像素），中间为过渡区
    kerbol: {
        modes: {
            // 近景档（屏幕半径 >= 200px）：表面清晰 + 弱橙黄光晕（小范围，避免遮挡内行星）
            near: {
                layers: [
                    { texture: 'assets/images/celestial/kerbolar/kerbol.png', alpha: 1.0, zIndex: 0 },
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
// 遍历全量星系静态数据（starSystemRegistry 的超集）而非当前激活集，
// 保证后续切换到任意星系组合时，其天体渲染层已注册就绪
export function registerBodyRenderables() {
    let registered = 0;

    for (const body of solarSystemData) {
        const key = body.textureKey;
        if (!key) continue;

        const override = bodyRenderableConfigs[key];
        if (override) {
            renderableManager.register(key, override);
            registered++;
        } else if (body.texture) {
            // 默认规则：声明了贴图就画一层
            renderableManager.register(key, {
                layers: [{ texture: body.texture, zIndex: 0 }]
            });
            registered++;
        }
        // 既无例外配置也无贴图的占位天体（如测试星系）→ 不注册，渲染层走代表色纯色兜底
    }

    console.log(`[BodyRenderables] 已注册 ${registered} 个天体渲染配置`);
}
