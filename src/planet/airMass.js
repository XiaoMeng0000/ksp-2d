'use strict';

// 大气光程 / 太阳柱积分 —— **本体着色器与大气散射层共用的唯一真源**。
//
// ★★ 为什么必须有这个文件（2026-10-01）★★
//
// 原实现是两处**各自硬编码**的经验式：`airMass = (1+f)/max(f, cosZ+f)`，
// f 是面板上的「大气斜射最大光深」（默认 0.027）。它有三个结构性问题：
//
//   ① **两层可能漂移**：本体（planetShaders）与大气（atmosphereShaders）
//      各写一份。任何一侧改动都会让两层的地表红化/晨昏线口径错位，
//      而错位在画面上表现为"日落带与大气弧对不上"，很难归因。
//   ② **函数形式是猜的**：真实斜射光程的增长比 1/cosZ 慢得多。用本项目几何
//      （H/R = 0.013、大气外径 1.30）实测：地平线处真值 **11.05**，
//      经验式给 **38.04**（偏高 244%）。⇒ 晨昏线附近光深被系统性算大
//      ⇒ 红光被过早杀光 ⇒ 暮光带又窄又硬。
//   ③ **f 承担了三件事**：日落红强度、临边亮度、晨昏线硬度。物理量不该由
//      艺术参数兼职。
//
// ★★ 2026-10-02：从「一维地表空气质量」升级为「二维太阳柱积分」★★
//
// 上一版只烘了一张**地表**（高度 = 0）的空气质量表，着色器再乘一个本地密度：
//
//     sunOd = dens(本地高度) × H × airMass(cosZ)
//
// 这个"消光发生在采样点自己所在高度"的假设，对贴着地面的空气是对的，
// 但对**暮光带**是错的：夜侧那圈高空空气是被"从行星临边擦过来的阳光"照亮的，
// 真正的消光发生在**切线附近的稠密层**，与该点自身有多稀薄无关。
// 该假设令暮光带的消光被低估约 exp(高度/标高) 倍 —— 实测（8 位口径）
// 夜侧天空因此亮了 2~3 倍（线性口径约 10 倍），中性偏蓝，
// 把"暗而偏红的一圈暮光"糊成了一层罩住半个夜半球的灰蓝纱。
//
// ⇒ 现在直接烘**二维**表：sunColumn(高度, 太阳高度余弦)，
//   从该点沿太阳方向积到壳顶；被行星挡住则取**切点边界值**（见下）。
//   着色器只做一次双线性查表，不再需要"本地密度 × 空气质量"这个中间量。
//
// ★ 物理口径（写清楚，避免下一次又漂）★
//   · 积分在**有限球壳**内做（外径 = atmoScale），且计入球面曲率。
//   · 单位：行星半径（表内 Rp = 1）。着色器取用后要乘 Rp 换成世界单位。
//   · **遮挡区不留无穷大**：真值在该处是 +∞（阳光被行星挡住），但无穷大
//     无法插值。做法是在烘焙时把遮挡格填成**切点处的极限值**
//     （阳光恰好擦过地表时的柱积分，有限）。插值因此永远连续；
//     "是否被挡"由着色器里那条**严格**判据负责归零。
//   · 轴参数化（着色器必须用同一套）：
//       高度（单位 = 标高）  altOverH = ALT_MAX · w²       w ∈ [0,1]
//       太阳高度余弦         c = s·|s|                     s ∈ [-1,1]
//     两条都做成**平方/二次**是因为函数在这两端变化最快（近地面、近地平线）。

/** 高度轴的分档数（单位：标高，0…SUNCOL_ALT_MAX 二次分布）。 */
export const SUNCOL_ALT_BINS = 20;

/** 太阳高度余弦轴的分档数（二次分布，地平线附近最密）。 */
export const SUNCOL_COS_BINS = 32;

/** 高度轴上限，单位 = 标高。exp(-12) = 6.1e-6，再往上密度已无意义。 */
export const SUNCOL_ALT_MAX = 12;

// ---------------------------------------------------------------------------
// 轴映射（JS 侧；GLSL 侧的对应实现见 sunColumnTableGLSL / sunColumnSurfaceGLSL）
// ---------------------------------------------------------------------------

/**
 * 高度 → 轴参数 w ∈ [0,1]（二次分布：近地面更密）。
 * @param {number} altOverH 高度 / 标高
 * @returns {number}
 */
export function altAxisWarp(altOverH) {
    const t = Math.min(1, Math.max(0, altOverH / SUNCOL_ALT_MAX));
    return Math.sqrt(t);
}

/**
 * 太阳高度余弦 → 轴参数 u ∈ [0,1]（c = s·|s|，地平线附近最密）。
 * @param {number} cosZ
 * @returns {number}
 */
export function cosAxisWarp(cosZ) {
    const c = Math.min(1, Math.max(-1, cosZ));
    const s = Math.sign(c) * Math.sqrt(Math.abs(c));
    return s * 0.5 + 0.5;
}

// ---------------------------------------------------------------------------
// 数值积分（唯一真值实现；着色器不做这个积分，只查表）
// ---------------------------------------------------------------------------

/**
 * 沿**太阳方向**的柱积分：从半径 r0 = 1 + altOverH·hRatio 出发，
 * 方向与本地天顶的夹角余弦 = cosZ，积到穿出外球壳为止。
 *
 * 射线参数化：`r(t) = sqrt(r0² + t² + 2·r0·t·cosZ)`，高度 = `r(t) − 1`。
 *
 * ★ 遮挡 ⟺ `(p·L < 0) 且 (perp < Rp)` ★
 *   perp = r0·sqrt(1−cosZ²) 是点到"太阳轴"的垂直距离。
 *   （与着色器里 raySphere 的二值判据严格等价：p 在球外时，
 *     太阳射线与行星球相交的充要条件就是"背光侧 + 垂距小于星径"。）
 *   被挡住时**递归到切点**取值 —— 切点处 perp 恰好 = 1，判据不成立，
 *   于是得到有限的"擦地平线"柱积分，正是遮挡区的连续边界极限。
 *
 * @param {number} altOverH 起点高度 / 标高
 * @param {number} cosZ 太阳高度余弦（本地天顶与太阳方向的夹角余弦）
 * @param {number} hRatio 标高 / 星径
 * @param {number} outerRatio 大气外径 / 星径
 * @param {number} [steps=2048] 积分步数
 * @returns {number} 柱积分长度（单位 = 星径）
 */
export function integrateSunColumn(altOverH, cosZ, hRatio, outerRatio, steps) {
    const n = Math.max(64, Math.round(steps === undefined ? 2048 : steps));
    const H = Math.max(1e-9, hRatio);
    const r0 = 1 + Math.max(0, altOverH) * H;
    const c = Math.min(1, Math.max(-1, cosZ));
    const perp = r0 * Math.sqrt(Math.max(0, 1 - c * c));

    if (perp >= outerRatio) {
        return 0;                             // 这条射线根本不进壳
    }
    // 遮挡：退到切点（perp 恰好 = 1 的方向）取边界极限。
    // ⚠️ 用 1e-9 的余量而不是严格 < 1：切点附近浮点上会来回抖，
    //    不加余量会递归到栈溢出。
    if (c < 0 && perp < 1 - 1e-9) {
        const tangentCos = -Math.sqrt(Math.max(0, 1 - 1 / (r0 * r0)));
        return integrateSunColumn(altOverH, tangentCos, hRatio, outerRatio, steps);
    }
    const tExit = -r0 * c + Math.sqrt(Math.max(0, outerRatio * outerRatio - perp * perp));
    if (!(tExit > 0)) {
        return 0;
    }
    const dt = tExit / n;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * dt;
        const r = Math.sqrt(r0 * r0 + t * t + 2 * r0 * t * c);
        sum += Math.exp(-Math.max(0, r - 1) / H) * dt;
    }
    return sum;
}

/**
 * 烘焙二维太阳柱积分表。
 *
 * 行 = 高度（0 … SUNCOL_ALT_MAX 标高，二次分布），列 = 太阳高度余弦（二次分布）。
 * 索引 = `altIdx * cosBins + cosIdx`。
 *
 * @param {number} hRatio 标高 / 星径
 * @param {number} outerRatio 大气外径 / 星径
 * @param {number} [altBins=SUNCOL_ALT_BINS]
 * @param {number} [cosBins=SUNCOL_COS_BINS]
 * @returns {Float32Array}
 */
export function buildSunColumnTable(hRatio, outerRatio, altBins, cosBins) {
    const nA = Math.max(2, Math.round(altBins === undefined ? SUNCOL_ALT_BINS : altBins));
    const nC = Math.max(2, Math.round(cosBins === undefined ? SUNCOL_COS_BINS : cosBins));
    const out = new Float32Array(nA * nC);
    for (let ia = 0; ia < nA; ia++) {
        const w = ia / (nA - 1);
        const altOverH = SUNCOL_ALT_MAX * w * w;
        for (let ic = 0; ic < nC; ic++) {
            const s = (ic / (nC - 1)) * 2 - 1;
            const cosZ = s * Math.abs(s);
            out[ia * nC + ic] = integrateSunColumn(altOverH, cosZ, hRatio, outerRatio);
        }
    }
    return out;
}

/**
 * 从二维表里取**地表那一行**，并归一化成"空气质量"（天顶 = 1）。
 *
 * 本体着色器（planetShaders）用的就是这一份：它与大气层的二维表同源，
 * 只是换了个归一化 —— 地表红化仍然沿用 βExt × H_world × 空气质量 的形式，
 * 于是高光抹开（glint）那类下游用法一字不改。
 *
 * @param {Float32Array} table buildSunColumnTable 的结果
 * @param {number} cosBins
 * @returns {Float32Array} 长度 = cosBins
 */
export function surfaceAirMassRow(table, cosBins) {
    const nC = Math.max(2, Math.round(cosBins));
    const zenith = table[nC - 1];             // ia = 0（地表）、ic = 末列（cosZ = 1）
    const out = new Float32Array(nC);
    if (!(zenith > 0)) {
        out.fill(1);
        return out;
    }
    for (let ic = 0; ic < nC; ic++) {
        out[ic] = table[ic] / zenith;
    }
    out[nC - 1] = 1;                          // 天顶必须精确为 1
    return out;
}

// ---------------------------------------------------------------------------
// 带缓存的取表（渲染器每帧调用；参数不变则不重算）
// ---------------------------------------------------------------------------

let cacheKey = '';
let cacheValue = null;

/**
 * 取（必要时烘焙）一张二维太阳柱积分表。
 *
 * 缓存键 = 标高比 + 壳厚比。两者在交互中几乎从不变化 ⇒ 实际只算一次。
 * 烘焙成本：20 × 32 格 × 2048 步 ≈ 130 万次 exp —— 单次约 20 ms，
 * 只在启动/换天体/拖标高滑块时发生。
 *
 * @param {number} hRatio 标高 / 星径
 * @param {number} outerRatio 大气外径 / 星径
 * @returns {{altBins:number, cosBins:number, altMax:number, data:Float32Array, surface:Float32Array}}
 */
export function getSunColumnTable(hRatio, outerRatio) {
    const key = hRatio + '|' + outerRatio;
    if (key !== cacheKey) {
        const data = buildSunColumnTable(hRatio, outerRatio);
        cacheValue = {
            altBins: SUNCOL_ALT_BINS,
            cosBins: SUNCOL_COS_BINS,
            altMax: SUNCOL_ALT_MAX,
            data,
            surface: surfaceAirMassRow(data, SUNCOL_COS_BINS),
        };
        cacheKey = key;
    }
    return cacheValue;
}

// ---------------------------------------------------------------------------
// GLSL 片段（由本模块导出，保证与 JS 侧同源）
// ---------------------------------------------------------------------------

/**
 * 二维查表函数。调用方需先声明 uniform：
 *     uniform float uSunColumnTable[SUNCOL_ALT_BINS * SUNCOL_COS_BINS];
 *
 * @param {number} altBins
 * @param {number} cosBins
 * @param {number} altMax
 * @returns {string} GLSL 源码
 */
export function sunColumnTableGLSL(altBins, cosBins, altMax) {
    const nA = Math.max(2, Math.round(altBins === undefined ? SUNCOL_ALT_BINS : altBins));
    const nC = Math.max(2, Math.round(cosBins === undefined ? SUNCOL_COS_BINS : cosBins));
    const lastA = (nA - 1).toFixed(1);
    const lastC = (nC - 1).toFixed(1);
    const altTop = (altMax === undefined ? SUNCOL_ALT_MAX : altMax).toFixed(1);
    return `
// 二维太阳柱积分查表：行 = 高度/标高（二次分布），列 = 太阳高度余弦（二次分布，地平线最密）。
// 单位 = 行星半径（表内 Rp = 1）⇒ 调用方要乘 Rp 换成世界单位。
// 表由 src/planet/airMass.js 的数值积分烘焙；遮挡区已被填成**切点极限值**，
// 所以这里插值出来永远是有限且连续的，"是否被挡"由调用方另行归零。
float sunColumnFromTable(float altOverH, float cosZ) {
    float wa = sqrt(clamp(altOverH, 0.0, ${altTop}) / ${altTop}) * ${lastA};
    float c = clamp(cosZ, -1.0, 1.0);
    float wc = (sign(c) * sqrt(abs(c)) * 0.5 + 0.5) * ${lastC};
    int ia = int(min(floor(wa), ${lastA} - 1.0));
    int ic = int(min(floor(wc), ${lastC} - 1.0));
    float fa = wa - float(ia);
    float fc = wc - float(ic);
    int b = ia * ${nC} + ic;
    float c0 = mix(uSunColumnTable[b], uSunColumnTable[b + 1], fc);
    float c1 = mix(uSunColumnTable[b + ${nC}], uSunColumnTable[b + ${nC} + 1], fc);
    return mix(c0, c1, fa);
}
`;
}

/**
 * 地表（高度 = 0）的空气质量查表，天顶恒为 1 —— 与旧的 airMass 同口径。
 * 调用方需先声明：`uniform float uSunColumnSurface[SUNCOL_COS_BINS];`
 *
 * @param {number} cosBins
 * @returns {string} GLSL 源码
 */
export function sunColumnSurfaceGLSL(cosBins) {
    const nC = Math.max(2, Math.round(cosBins === undefined ? SUNCOL_COS_BINS : cosBins));
    const lastC = (nC - 1).toFixed(1);
    return `
// 地表空气质量（= 地表柱积分 / 天顶柱积分，天顶恒为 1）。
// 只对 cosZ >= 0 有意义：太阳在地平线以下时不存在"直射光程"这个概念，
// 由调用方的 step(0, cosZ) 归零；表在负区间给的是切点极限值（有限，可插值）。
float surfaceAirMass(float cosZ) {
    float c = clamp(cosZ, -1.0, 1.0);
    float wc = (sign(c) * sqrt(abs(c)) * 0.5 + 0.5) * ${lastC};
    int ic = int(min(floor(wc), ${lastC} - 1.0));
    return mix(uSunColumnSurface[ic], uSunColumnSurface[ic + 1], wc - float(ic));
}
`;
}
