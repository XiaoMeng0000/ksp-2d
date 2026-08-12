'use strict';

// 程序化特效模块 — 封装径向渐变光晕等 Canvas 2D 绘制函数
// 纯渲染工具，不含业务逻辑，供 renderer.js 调用

/**
 * 绘制恒星光晕（多层径向渐变 additive 叠加）
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {number} cx, cy - 屏幕中心坐标
 * @param {number} baseRadius - 天体基础屏幕半径
 * @param {string} color - 光晕颜色（hex 格式，如 '#ffcc44'）
 * @param {number} scale - 光晕缩放倍率（相对 baseRadius）
 * @param {number} alpha - 光晕透明度（0~1）
 */
export function drawStarGlow(ctx, cx, cy, baseRadius, color, scale, alpha) {
    if (alpha <= 0 || scale <= 1) return; // scale<=1 时不绘制（被本体遮挡）

    const r = baseRadius * scale;
    // 光晕从球体内部开始（baseRadius * 0.5），与球体边缘渐隐自然衔接
    const grad = ctx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, r);

    // 解析 hex 颜色为 RGB
    const cr = parseInt(color.slice(1, 3), 16);
    const cg = parseInt(color.slice(3, 5), 16);
    const cb = parseInt(color.slice(5, 7), 16);

    // 内圈：从球体内部开始渐显
    grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.3})`);
    // 中圈：光晕峰值
    grad.addColorStop(0.2, `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.6})`);
    // 外圈：逐渐透明
    grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

/**
 * 绘制程序化纯色光球（恒星远景/过渡的主体，与贴图同尺寸替代）
 * 中心高亮 → 边缘基色的实心径向渐变球，颜色取天体表面代表色
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {number} cx, cy - 屏幕中心坐标
 * @param {number} radius - 球体基础屏幕半径（scale=1 即与贴图同尺寸）
 * @param {string} color - 球体颜色（hex 格式，如 '#ffaa33'）
 * @param {number} alpha - 透明度（0~1）
 */
export function drawStarBall(ctx, cx, cy, radius, color = '#ffffff', alpha = 1.0) {
    if (alpha <= 0 || radius <= 0) return;

    const cr = parseInt(color.slice(1, 3), 16);
    const cg = parseInt(color.slice(3, 5), 16);
    const cb = parseInt(color.slice(5, 7), 16);

    // 中心向白偏移，制造高亮感
    const brightR = Math.min(255, Math.round(cr + (255 - cr) * 0.6));
    const brightG = Math.min(255, Math.round(cg + (255 - cg) * 0.6));
    const brightB = Math.min(255, Math.round(cb + (255 - cb) * 0.6));

    // 边缘渐隐（alpha 从 1 降到 0.3），与外部光晕自然衔接
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(${brightR}, ${brightG}, ${brightB}, ${alpha})`);
    grad.addColorStop(0.7, `rgba(${cr}, ${cg}, ${cb}, ${alpha})`);
    grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.3})`);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

/**
 * 绘制天体平面环（2D 俯视视角）
 * 环位于天体赤道平面，从正上方看为与天体同心的正圆环带，与球体互不遮挡。
 * 支持多细分环带（bands）：每个环带独立内外半径比、透明度与边缘羽化，
 * 模拟真实行星环的疏密层次与柔和边界。
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {number} cx, cy - 屏幕中心坐标
 * @param {number} baseRadius - 天体基础屏幕半径
 * @param {Object} layer - 环配置层
 *   layer.bands: Array<{ inner, outer, alpha, feather? }>  多细分环带
 *     inner/outer: 相对天体半径的内外半径比
 *     alpha: 该环带相对透明度（会再乘 layer.alpha）
 *     feather: 边缘羽化比例（0~1，1 表示全带宽渐变），可选
 *   layer.innerRatio / layer.outerRatio          单环带兜底（无 bands 时）
 *   layer.color: string                          环颜色（hex）
 *   layer.alpha: number                          整体透明度（0~1）
 */
export function drawPlanetRing(ctx, cx, cy, baseRadius, layer = {}) {
    const alpha = layer.alpha !== undefined ? layer.alpha : 0.5;
    if (alpha <= 0) return;

    const color = layer.color || '#cccccc';
    const cr = parseInt(color.slice(1, 3), 16);
    const cg = parseInt(color.slice(3, 5), 16);
    const cb = parseInt(color.slice(5, 7), 16);

    // 多细分环带优先；无 bands 时回退为单环带（innerRatio/outerRatio）
    const bands = (layer.bands && layer.bands.length)
        ? layer.bands
        : [{ inner: layer.innerRatio || 1.6, outer: layer.outerRatio || 2.0 }];

    for (const band of bands) {
        const innerR = baseRadius * band.inner;
        const outerR = baseRadius * band.outer;
        if (outerR <= 0 || outerR <= innerR) continue;

        const bandAlpha = alpha * (band.alpha !== undefined ? band.alpha : 1);
        if (bandAlpha <= 0) continue;

        const feather = band.feather !== undefined ? band.feather : (layer.feather || 0);

        if (feather > 0 && outerR - innerR > 1) {
            // 边缘羽化：用径向渐变让环带内外边界自然淡出
            // feather 控制渐变带宽占环带宽度的比例；1 表示从中心到边缘全程渐变
            const midR = (innerR + outerR) / 2;
            const halfW = (outerR - innerR) / 2;
            const gradW = Math.max(0.5, halfW * Math.min(1, feather));
            const grad = ctx.createRadialGradient(cx, cy, midR - gradW, cx, cy, midR + gradW);
            grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0)`);
            grad.addColorStop(0.35, `rgba(${cr}, ${cg}, ${cb}, ${bandAlpha})`);
            grad.addColorStop(0.65, `rgba(${cr}, ${cg}, ${cb}, ${bandAlpha})`);
            grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

            ctx.beginPath();
            ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
            ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
            ctx.fillStyle = grad;
            ctx.fill();
        } else {
            // 环带 = 外圆减内圆（内圆反方向闭合路径）
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
            ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${bandAlpha})`;
            ctx.fill();
        }
    }
}
