'use strict';

// 不规则天体的低模网格生成（阶段 2 实现，阶段 0 先固化接口与公共结构）。
//
// 设计依据（来自实测，见 docs/交接文档.md §4.5 修正记录 3）：
//   Gilly / Bop 的轮廓是「直线段 + 折角」的低模特征，**不能用平滑径向位移**，
//   否则折角会被磨圆、丢失性格。因此做法是：
//     · 网格分辨率刻意取低（32×16 起）→ 轮廓自然出现棱面
//     · 径向函数 r(θ,φ) = R₀ · [1 + Σ 低阶谐波项]（3–6 阶）
//     · 法线用逐面 flat shading → 硬边折角
//   「表面细节的锐度由贴图承载」，网格只负责轮廓。

import { buildSphereGeometry } from './sphereMesh.js';

/**
 * 低阶球谐扰动：用若干 (l, m) 项叠加径向偏移，保留块状聚合感。
 * @param {number} theta 方位角（弧度）
 * @param {number} phi 极角（弧度，0 = 北极）
 * @param {Array<{l:number, m:number, amp:number, phase:number}>} harmonics 谐波项
 * @returns {number} 半径倍率（≈ 1 ± Σamp）
 */
export function radialHarmonics(theta, phi, harmonics) {
    let sum = 0;
    for (let i = 0; i < harmonics.length; i++) {
        const h = harmonics[i];
        // 用实球谐的简化形式：sin/cos(mθ) 与 cos/sin(lφ) 的组合，
        // 阶数低时天然给出「大块面」，不会产生高频噪声
        const azimuthal = Math.cos(h.m * theta + h.phase);
        const polar = Math.sin(h.l * phi);
        sum += h.amp * azimuthal * polar;
    }
    return 1 + sum;
}

/**
 * 构建不规则天体网格。
 * TODO: 阶段 2 实现 —— 逐顶点应用 radialHarmonics、逐面重算法线（flat）、
 *       并按「三角形深度排序 + 由远到近绘制」替代深度缓冲。
 * @param {object} config 见 docs/交接文档.md 阶段 2 参数
 * @returns {object} 与 buildSphereGeometry 同形的网格数据
 */
export function buildIrregularGeometry(config) {
    const cfg = config || {};
    const base = buildSphereGeometry({
        segments: cfg.segments === undefined ? 32 : cfg.segments,
        rings: cfg.rings === undefined ? 16 : cfg.rings,
        radius: cfg.radius === undefined ? 1 : cfg.radius,
    });
    // TODO: 阶段 2 在此对 base.vertices 施加径向函数并重建法线。
    return base;
}
