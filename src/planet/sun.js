'use strict';

// 太阳（光源）的物理常量 —— 本项目**唯一真源**。
//
// ★ 为什么需要这个模块（2026-09-27）★
//   在此之前着色器把太阳当成**点光源**：只给它一个方向 uSunDir。
//   这对漫反射没问题（太阳的方向就是它的方向），但对**镜面反射**是错的 ——
//   高光不是"一个点"，而是**太阳的像**。水面越高光锐利，这个像越清晰可见
//   （真实海面从太空看，太阳耀斑是一大片，不是一个像素）。
//
//   不建这个模型会有什么后果（实测）：
//     rough = 0.02 ⇒ GGX 叶瓣半角 α = 4e-4 rad ≈ 0.023°，
//     而太阳视半径是 1.1° —— **光源比叶瓣宽 48 倍**。
//     于是渲染出来的高光是**亚像素的针尖**（实测足迹 4~6 px @ 盘径 894 px）。
//     主游戏里星球盘面只有几十像素 ⇒ 高光根本立不住，会随视角闪烁跳动。
//     这不是纹理走样，mipmap 救不了（走样发生在法线空间）。
//
// ★ 做法：把光源立体角折进"有效粗糙度"（按方差相加）★
//   α_eff² = α² + (θs/2)²
//   为什么是 θs/2 而不是 θs：镜面响应由**半向量** H = normalize(L+V) 决定。
//   太阳方向 L 在 ±θs 内游走时，H 只在 ±θs/2 内游走（L+V 的垂直分量被减半）。
//   所以要让 NDF 覆盖整个太阳圆面，叶瓣半角至少要 θs/2。
//   —— 这也是 Karis 2013「球光源高光」近似 `α' = α + r/(2d)` 里的那个 r/(2d)。
//
//   方差相加（而不是 α 相加）是刻意的：后面还有两项要并进来 ——
//   波浪法线扰动、大气 Mie 前向散射 —— 它们的贡献同样是**角度方差**。
//   统一写成"方差相加"，三项就是同一行代码，不会互相打架。
//
// ★ 数值来自 KSP 真实数据，不是拍的 ★
//   Kerbol 半径      261,600 km
//   Kerbin 轨道半长轴 13,599,840 km
//   ⇒ θs = asin(261600 / 13599840) = 0.0192374 rad = 1.10218°
//
// ⚠️ 迁移到主游戏时：视半径随**观察者到太阳的距离**变（Moho 上看更大、
//    Jool 上看更小）。游戏侧有轨道数据，调用 sunAngularRadiusDeg() 即可。

/** Kerbol（原版恒星）的物理常量 */
export const KERBOL = {
    /** 恒星半径（km）—— KSP 原版数据 */
    radiusKm: 261600,
    /** Kerbin 轨道半长轴（km）—— KSP 原版数据 */
    kerbinSemiMajorAxisKm: 13599840,
};

/**
 * 由「恒星半径 + 观察者到恒星的距离」求视半径。
 *
 * @param {number} sunRadiusKm 恒星半径（km）
 * @param {number} distanceKm 观察者到恒星中心的距离（km）
 * @returns {number} 视半径（度）
 */
export function sunAngularRadiusDeg(sunRadiusKm, distanceKm) {
    const sinTheta = Number(sunRadiusKm) / Number(distanceKm);
    if (!Number.isFinite(sinTheta) || sinTheta <= 0) {
        return 0;
    }
    // 距离小于半径这种退化情况没有物理意义，按 90° 封顶而不是出 NaN
    return Math.asin(Math.min(1, sinTheta)) * 180 / Math.PI;
}

/**
 * 从 Kerbin 看 Kerbol 的视半径（度）—— 本项目的默认值。
 *
 * 1.10218° 的来历：asin(261600 / 13599840)。
 * ⚠️ 顺带一个有用的尺度感：真实地球看太阳是 0.533°，Kerbin 看 Kerbol 是它的 **2.07 倍** ——
 *    所以 KSP 里的太阳在天空中比现实大一倍，高光本来就该更"胖"一些。
 */
export const DEFAULT_SUN_ANGULAR_RADIUS_DEG =
    sunAngularRadiusDeg(KERBOL.radiusKm, KERBOL.kerbinSemiMajorAxisKm);

/** 视半径的合法区间（面板滑块与求解共用）。0 = 当作点光源 = 历史口径。 */
export const SUN_ANGULAR_RADIUS_RANGE = [0, 5];

/**
 * 求解面板/配置给的值 → 弧度，并钳到合法区间。
 *
 * 面板收的是**度**（人对度有直觉），着色器收的是**弧度**（数学式直接用）。
 * 转换只在这一处做，避免两处各转一次、其中一处忘了转。
 *
 * @param {number} deg
 * @returns {number} 弧度
 */
export function solveSunAngularRadius(deg) {
    const v = Number(deg);
    const d = Number.isFinite(v)
        ? Math.min(SUN_ANGULAR_RADIUS_RANGE[1], Math.max(SUN_ANGULAR_RADIUS_RANGE[0], v))
        : DEFAULT_SUN_ANGULAR_RADIUS_DEG;
    return d * Math.PI / 180;
}
