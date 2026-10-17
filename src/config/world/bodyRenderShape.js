'use strict';

// 天体**渲染形状**表（手写，**不从资产生成**）。
//
// ★★★ 为什么单独一张表 ★★★
//   形状是**几何参数**（球 / 程序化径向球谐），资产是**文件**（albedo/biome/height…）。
//   两者分开存：本文件**禁止**出现任何图片路径；`src/config/assets/renderAssets.js`
//   **禁止**出现 harmonics / segments / rings 等几何参数。
//
// ★★★ 半径语义：`screenRadiusPx` 一律按「外接球半径」解释 ★★★
//   不规则体没有单一屏幕半径 ⇒ 统一取**外接球**（能包住整个形体的球）作上界：
//       physScreenR = screenRadiusPx × circumscribedRatio
//   · 球体          ⇒ circumscribedRatio = 1
//   · 径向球谐形体  ⇒ circumscribedRatio = 1 + Σ|harmonics[].amp|（**保守上界**）
//   池准入 / 三段式归属 / 图标 LOD 都用这个换算后的半径，避免"按平均半径算、形体却更大"的语义债。
//
// 口径说明：`circumscribedRatio` 的公式与实验室 `tools/assetBundle.mjs` 的
// `circumscribedRatioOf()` **完全一致**（同一份定义，两侧可交叉验证）。

/** 球体形状（默认；绝大多数天体） */
const SPHERE = { kind: 'sphere', circumscribedRatio: 1 };

export const BODY_RENDER_SHAPE = {
    // ---- 本批有 albedo 的天体（球体）----
    kerbin: SPHERE,
    mun: SPHERE,
    // jool：本批**没有 albedo**（只有 biome 图）⇒ 资产缺失见 renderAssets.js 的 RENDER_ASSETS_MISSING；
    //       形状先用球体占位，真实谐波属阶段 2。
    jool: SPHERE,

    // ---- ★ `circumscribedRatio > 1` 的样例（阶段 2 的形状通道验证用）★ ----
    // Gilly 的**占位**谐波（真实数据阶段 2 才有；此处只为让"外接球换算"可被验证）
    //   circumscribedRatio = 1 + (0.08 + 0.05 + 0.03) = 1.16
    //   ⇒ 若 screenRadiusPx = 7px，则 physScreenR = 7 × 1.16 = 8.12px
    gilly: {
        kind: 'irregular',
        harmonics: [
            { l: 2, m: 0, amp: 0.08, phase: 0.0 },
            { l: 3, m: 2, amp: 0.05, phase: 1.7 },
            { l: 5, m: 1, amp: 0.03, phase: 0.4 },
        ],
        segments: 96,
        rings: 48,
        circumscribedRatio: 1.16,
    },
};

/** 未登记的天体一律按球体（保守、无谐波） */
export const DEFAULT_RENDER_SHAPE = SPHERE;

/**
 * 取某天体的形状（未登记 ⇒ 球体）。
 * @param {string} bodyId
 * @returns {object}
 */
export function shapeOf(bodyId) {
    return BODY_RENDER_SHAPE[bodyId] || DEFAULT_RENDER_SHAPE;
}

/**
 * 外接球换算：`physScreenR = screenRadiusPx × circumscribedRatio`。
 * ★ 消费方（池准入 / 三段式归属 / 图标 LOD）应一律用本函数换算后的值。
 * @param {number} screenRadiusPx 名义屏幕半径（**按外接球语义**给出）
 * @param {string} bodyId 天体 id（用来查 ratio）
 * @returns {{physScreenR:number, ratio:number, bodyId:string}}
 */
export function toCircumscribedScreenR(screenRadiusPx, bodyId) {
    const ratio = shapeOf(bodyId).circumscribedRatio === undefined
        ? 1 : shapeOf(bodyId).circumscribedRatio;
    return { physScreenR: screenRadiusPx * ratio, ratio, bodyId };
}
