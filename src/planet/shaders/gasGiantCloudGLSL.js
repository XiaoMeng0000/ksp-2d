'use strict';

// 气态巨星的**云层装配**（GLSL）。
//
// ★★ 与 Kerbin 云场的关系：内核共享、装配分离 ★★
//
//   共享（唯一真源 src/planet/shaders/cloudFieldGLSL.js 的 `cloudNoiseGLSL()`）：
//       噪声 / 域扭曲 / 脊线 / 经纬→方向 / cfLerp
//     这里**一个字都不重写**，只调用 —— 两处各存一份必然漂移，而漂移的症状
//     （"两颗天体的噪声质感不一样"）没有任何判据能抓住。
//
//   不共享（本文件）：
//     · **α 的来源**：Kerbin 是阈值口径（coverage / CDF / softness）⇒ 离散云块；
//       气态巨星 α ≡ 1 —— 云顶**就是**可见表面，天空从不露出。
//     · **云顶色的来源**：Kerbin 是常数 uCloudColor；气态巨星是逐纬度色表 + 纹理。
//
// ★★ 纬度口径（本文件最关键的一处）★★
//
//   `lat = asin(本地位置.y)`，**不经过 uv、也不经过 normalMatrix**。
//
//   ① 球面点的法线**就是**它的方向；正交投影下屏幕 y 分量就等于方向的 y 分量
//      ⇒ lat = asin(y) 是定义式，与"看到的是近半球还是远半球"无关。
//   ② uv 是**等距圆柱参数**，不是屏幕位置。网格渲染出来的是远半球，
//      在远半球上 v 与屏幕位置的关系是 v = sqrt(1 − y²)/2 + 0.5 ——
//      拿 uv.y 当纬度会得到"盘心 = 极点、盘缘 = 赤道"的错误映射。
//   ③ 用**本地位置**而不是 vNormal：虽然两者在球面网格上等价，
//      但本地位置不经过 normalMatrix —— 少一层"矩阵是不是恰好等于缩放"的假设。
//      ⚠️ 顶点位置在三角面内是线性插值的（弦而非弧），所以 normalize 后的方向
//      与真实球面点差一个矢高：128×64 分段下约 **0.017°**，远小于表步长 2°，
//      可忽略。**但换更粗的网格时要重估这条**。
//
// ★★ 临边辉光：为什么它**不在大气层**里做（实测否证）★★
//
//   参照的临边是**盘内一圈亮环**：r=0.94 处 luma 190.5 → r=0.995 处 **220.4**
//   （+30/255，+16%），而**盘外什么都没有**（r≥1.006 处 alpha 0.07、luma 0.07）。
//
//   先按"薄大气"做：壳 1.0→1.010、标高 0.006、浓度 4.0、强度 1.0。
//   结果**完全没有亮环**，反而把盘面压暗了（实测带纹 σ 4.02% → 3.36%）。
//   根因是合成式：`scatter + background·T` —— 薄壳的散射亮度远低于云顶亮度
//   （H₂/He 的 β 极小），所以 T < 1 只带来"变暗 + 对比被压缩"，
//   而 scatter 补不回来。物理上没有错，**是这个机制做不到那圈亮环**。
//   ⇒ 那一圈是**云顶自身在掠射角的增亮**（霾的前向散射 + 多次散射），
//     落在可见表面上，而不是壳外的新增光。
//
//   ★ 形态参数化的选择（诚实记）★
//   用它做幂律 `(1 − |dz|)^p` 而不是 1/cos 的空气质量：真实的空气质量在临边
//   发散得太快（1/dz 在 dz 0.34→0.10 之间变 3.4 倍），而实测的亮环在同区间
//   只变 **1.16 倍** ⇒ 比 1/cos 软得多。所以强度/幂次是**对着实测剖面标定的
//   艺术参数**，不声称它是物理量。
//
// ★★ b 的复用 ★★
//
//   纹理调制直接用 Kerbin 那条路径算出来的 **b**（经 CDF 重映射、球面面积均匀）。
//   这样做的三个理由：
//     ① 面积均匀 ⇒ (b − 0.5) 的 σ 恰好是 1/√12 ⇒ 纹理幅度**解析可算**，
//        不必靠试凑；
//     ② 与 Kerbin 共用同一张 CDF 机制 ⇒ 场的统计口径只有一处定义；
//     ③ 场的各向异性（bandStretch）自动继承 ⇒ 不需要另写"沿经度拉长"的代码。
//   ⚠️ 代价：纹理的**空间结构**就是该场参数下的级联噪声。参照的目标谱斜率
//      β ≈ 1.43，而本项目云场实测 1.53 —— 同档但不等，需要标定（见判据工具）。
//
// ⚠️ 本段在 JS 模板字符串里 ⇒ **注释里绝不能出现反引号**（会截断模板）。
//    这个错被 checkShaderSource 抓到过三次。

import { GG_TABLE_POINTS } from '../gasGiantBandTables.js';

/**
 * 纬度表点数的**默认值**。
 *
 * ⚠️ 它就是真源 `GG_TABLE_POINTS`（src/planet/gasGiantBandTables.js）本身，
 *    **不再另存一份数字** —— 原来这里写死 91，而真源是 181（同一文件里的
 *    注释也在说"必须一致"，但没有任何东西拦得住）。
 *    注释里写「必须一致」拦不住漂移，所以：这个常量由 checkShaderSource.mjs
 *    的 gg 常量断言守住（GG_GLSL_TABLE_POINTS === GG_TABLE_POINTS）。
 */
export const GG_GLSL_TABLE_POINTS = GG_TABLE_POINTS;

/**
 * 涡旋表的**容量**（GLSL 数组长度是编译期常量）。
 * 12 = 「每半球 6 条」（总监 2026-10-04 定）。表在 UBO 里，容量上限不受
 * `MAX_FRAGMENT_UNIFORM_VECTORS` 约束 ⇒ 将来要加条数只改这里 + 配方表长度。
 * ⚠️ 循环体里带 cos/sin，条数涨上去要靠**包围盒早退**撑着（已实现）。
 */
export const GG_GLSL_VORTEX_MAX = 12;

/**
 * 生成气态巨星装配的 GLSL 源码片段（uniform 声明 + 函数）。
 *
 * ⚠️ 必须在 `cloudNoiseGLSL()` **之后**插入（GLSL 没有函数提升）。
 *    本段调用 cfNoise4D / cfLerp / cfSampleField 之外的量都由调用方提供。
 *
 * @param {number} [points] 纬度表点数（默认 91）
 * @returns {string} GLSL 源码
 */
export function gasGiantCloudGLSL(points, stepDeg, vortexMax) {
    const n = Math.max(4, Math.round(points === undefined ? GG_GLSL_TABLE_POINTS : points));
    const step = Number(stepDeg) > 0 ? Number(stepDeg) : 2;
    const V = Math.max(1, Math.round(vortexMax === undefined ? GG_GLSL_VORTEX_MAX : vortexMax));
    // ★ 高纬带纹的抖动衰减系数（真正的定义在这里 —— 模板里只有它的用法与说明）★
    //   见模板内 GG_POLAR_JITTER 那段注释：7.5° 周期的极冠带吃满 ±2.5° 的带缘抖动会被揉平。
    const GG_POLAR_JITTER = 0.35;
    // ★ 涡旋色差路的**参考亮度**（线性空间）★
    //   色差是**加性**的 ⇒ 用这个常数把"要加多少光"定标成一个绝对量，
    //   而不是跟着局部亮度走（跟着走的话暗带上的涡旋会看不见，
    //   实测暗带 +2/255 vs 亮区 +16/255）。0.25 ⇒ 满强度时约 +0.25 线性。
    const GG_VORTEX_LUMA = 0.25;
    const last = (n - 2).toFixed(1);
    const span = (n - 1).toFixed(1);
    // UBO 里用 vec4 数组装 float 表 ⇒ 每个数组要 ceil(n/4) 个 vec4（尾部补零）
    const v4 = Math.ceil(n / 4);
    return `
// ===========================================================================
//  气态巨星装配（唯一真源：src/planet/gasGiantCloudRecipe.js）
// ===========================================================================

uniform float uGgEnabled;        // 0 = 走 Kerbin 阈值口径（零变化通路）；1 = 气态巨星
// ★★ 云顶色表改走 **uniform block（UBO）**，不再是「uniform float[N]」（2026-10-04）★★
//   原因：MAX_FRAGMENT_UNIFORM_VECTORS 的规格保证下限只有 **224**，而三张 181 点色表
//   原本要占 136 个 ⇒ 实测已用到 **218/224 = 97%**，再加东西就会在弱 GPU 上链不上
//   （症状是"云凭空消失"，而本机上限 1024 完全复现不出来）。
//   UBO 的数据**不占**这个额度，另受 MAX_UNIFORM_BLOCK_SIZE（规格保证 ≥16 KB）约束。
//
//   ⚠️ 为什么没做成纹理：那会给云着色器加上第一个 sampler，与
//   「云场完全程序化、**不采样任何贴图**」这条既定决策相抵触。
//
//   std140 布局：vec4 数组的步长恰为 16 字节 ⇒ 三张表紧密排列，
//   偏移分别是 0 / 16·v4 / 32·v4。访问用下面的 ggBand* 包一层，调用处仍按下标写。
//
//   ⚠️⚠️ 这段注释里**绝对不能出现反引号**：本文件是 JS 模板字符串，
//   反引号会把字符串提前截断，报错位置看着完全正常。改用「」。（已踩 5 次。）
layout(std140) uniform GgBandTable {
    vec4 uGgBandR[${v4}];
    vec4 uGgBandG[${v4}];
    vec4 uGgBandB[${v4}];
    vec4 uGgJet[${v4}];      // ★ 急流廓线 P(lat) ∈ [−1,1]，球面均值已扣零
};

float ggBandR(int i) { return uGgBandR[i >> 2][i & 3]; }
float ggBandG(int i) { return uGgBandG[i >> 2][i & 3]; }
float ggBandB(int i) { return uGgBandB[i >> 2][i & 3]; }
float ggJet(int i) { return uGgJet[i >> 2][i & 3]; }

/**
 * ★★ 抗走样（LOD）：按**屏幕导数**限制倍频数 ★★（2026-10-04 总监选"丙"）
 *
 * 问题：程序化噪声没有 mipmap。场的倍频是 scale·lacunarity^k，
 *   最细那几层在**小缩放**下是**亚像素**的 —— 点采样会把它们折回低频，
 *   表现成"不连续的小块 / 横向碎片"（总监的原话）。缩放越小越严重。
 *
 * 做法：算出**第 0 层的坐标在屏幕空间每像素走多少**（df），
 *   第 k 层就是 df·lac^k 个格/像素 ⇒ 一格只占 1/(df·lac^k) 像素。
 *   要求一格至少占 uGgLodPx 个像素（Nyquist 意义上 ≥2 才够），反解出 k 的上界。
 *
 * ★ 为什么**不用改共享内核**：倍频数本来就是 uniform（uFieldP2.y），
 *   装配层算好一个**有效倍频数**传进去即可 ⇒ cloudFieldGLSL 的源码**一字不动**，
 *   Kerbin 的 sha256 基线继续绿；而且 Kerbin 走不到这里（uGgEnabled = 0 时
 *   ggLodOctaves 直接返回原值）。
 *
 * ⚠️ 用 max(|dFdx|, |dFdy|) 而不是只看向量长度：场在纬度方向被 bandStretch
 *   额外压缩（各向异性），两个方向的"每像素格数"可以差好几倍，取大的那个才安全。
 * ⚠️ 导数必须在**一致控制流**里取 —— 调用点是 if (uGgEnabled > 0.5)，条件是 uniform ✓
 * ⚠️⚠️ 本段在 JS 模板字符串里，**注释里绝不能出现反引号**（已踩 12 次，
 *   但 checkShaderSource 现在会直接报行号 ⇒ 修起来只要几秒）。
 */
uniform float uGgLodOn;      // 1 = 开（0 = 退回原来的固定倍频数，A/B 用）
uniform float uGgLodPx;      // ★ 一格至少占几个像素（Nyquist 是 2；越大越保守越平滑）

int ggLodOctaves(vec3 dirRaw, int octMax) {
    if (uGgLodOn < 0.5) {
        return octMax;
    }
    float scale = max(uFieldP0.x, 1e-6);
    float lac = max(uFieldP0.y, 1.0001);
    vec3 pB = dirRaw * scale;                       // 第 0 层的噪声坐标
    float df = max(length(dFdx(pB)), length(dFdy(pB)));   // 方向空间单位 / 像素
    if (df <= 1e-9) {
        return octMax;
    }
    float kmax = log(1.0 / max(df * uGgLodPx, 1e-8)) / log(lac);
    return clamp(int(floor(kmax)) + 1, 1, octMax);
}

// ⚠️ 这四个 uniform 必须**声明在使用它们的函数之前** —— GLSL 没有函数提升。
//    （第一次写的时候放在下面，编译直接报 "undeclared identifier"。）
uniform float uGgJetAmp;         // ★ 急流位移的上界（**圈**；0 = 关）
uniform float uGgJetOmega;       // ★ 急流摆动的角频率（弧度/秒）
uniform float uGgJetKappa;       // ★ 各带的相位差（弧度/度；0 = 同步摆动）
uniform float uGgJetTime;        // ★ 急流用的时间（**限幅后**，与 uCloudTime 分开）

/**
 * ★★ 纬向急流：**不同纬度的云流动方向不同**（总监 2026-10-04）★★
 *
 * 物理：气态巨行星的急流**一条隔一条反向**（木星：亮带东向、暗带西向），
 *   峰值在**带界**、带中心为零。我们**不新增数据** —— 廓线就是色表的
 *   **带符号陡度** d(亮度)/dlat（CPU 侧算好、球面均值扣零、归一化到 [−1,1]）。
 *   14 条带 ⇒ 14 条急流，方向自动交替（实测 16 次符号翻转）。
 *
 * 位移式（**有界摆动**，总监选定）：
 *     disp = P(lat) · D · [cos(φ) − cos(ω·t + φ)] / 2 ,  φ = κ·lat
 *
 *   · **t = 0 时恒为 0**（cosφ − cosφ）⇒ 前面所有静帧标定（带纹 σ / 各向异性 /
 *     涡旋信噪比）**一个字都不用重标**，也是"同参数同图"对照口径的前提。
 *   · **上界恒等于 D**（|cos−cos| ≤ 2）⇒ 满足"位移必须有界"这条铁律
 *     （无界的话云会被剪成稀薄的水平细丝 —— 项目踩过）。
 *   · κ ≠ 0 时各带**不同时**达到极值 ⇒ 图案沿纬度**行波式起伏**（罗斯贝波的样子），
 *     而不是整颗星球一起"呼吸"。κ = 0 退回最简单的同步摆动。
 *
 * ⚠️ 时间用的是 uGgJetTime（**限幅后的**），与图案演化的 uCloudTime **分开** ——
 *    高速 warp 下位移被压住，但图案仍在演化，不会闪成一团。
 * ⚠️⚠️ 本段在 JS 模板字符串里，**注释里绝不能出现反引号**（已踩 8 次）。
 */
float ggJetAt(float latDeg) {
    float t = clamp((latDeg + 90.0) / ${step.toFixed(4)}, 0.0, ${span});
    int i0 = int(min(floor(t), ${last}));
    float fr = t - float(i0);
    return cfLerp(ggJet(i0), ggJet(i0 + 1), fr);
}

float ggJetDisp(float latDeg) {
    if (uGgJetAmp == 0.0) {
        return 0.0;
    }
    float P = ggJetAt(latDeg);
    float phi = uGgJetKappa * latDeg * (3.14159265358979 / 180.0);
    return P * uGgJetAmp * (cos(phi) - cos(uGgJetOmega * uGgJetTime + phi)) * 0.5;
}
uniform float uGgEdgeAmount;     // 带缘扰动的纬度幅度（**度**）
uniform float uGgEdgeScale;      // 带缘扰动的空间频率（方向空间）
uniform float uGgTexAmp;         // 纹理乘性幅度（乘在 (b − 0.5) 上）
uniform float uGgTexEdge;        // ★ 幅度重分配：带界（陡度）权重
uniform float uGgTexLat;         // ★ 幅度重分配：纬度（赤道更乱）权重
uniform float uGgTexNorm;        // ★ 幅度重分配的归一化因子（CPU 算）⇒ 总量守恒
uniform float uGgSlopeMean;      // 归一化陡度的面积加权均值（居中用）
uniform float uGgSlopeMax;       // 陡度的最大值（归一化用；与 CPU 同一个数）
uniform float uGgPolarStart;     // ★ 高纬带纹：起算纬度（度）
uniform float uGgPolarPeriod;    // ★ 带间距（度）
uniform float uGgPolarAmp;       // ★ 幅度（乘性）
uniform float uGgPolarFade;      // ★ 渐入宽度（度）
uniform float uGgEnvMean;        // (1 − |lat|/90) 的面积加权均值（居中用）
uniform float uGgShearAmp;       // ★ 纬向剪切幅度（**圈**）
uniform float uGgShearCycles;    // ★ 纬向剪切的急流周期数
uniform float uGgLimbGlow;       // 临边辉光强度（0 = 关；临边归大气层，这里留作 A/B）
uniform float uGgLimbPow;        // 临边辉光的幂次（越大越贴边）
uniform float uGgTime;           // 第 4 维（第 1 步恒为 0）
uniform float uGgDebug;          // 诊断档位：0 = 正常渲染

const float GG_RAD2DEG = 57.29577951308232;

/**
 * ★ 高纬带纹（**设计值，不是实测**）★
 *
 * 参照在 |lat| > 50° 处的剖面被临边污染（实测 ±71.5° 报出假亮带）⇒ 那一段没有可信数据。
 * 与其让外推给出一片平滑，不如**明确设计**几条纹（总监 2026-10-04 的观感决定）。
 *
 * 乘性调制「1 + amp·w(lat)·sin(2π(|lat| − start)/period)」，w 是 smoothstep 渐入
 * ⇒ 在 start 处**没有硬台阶**，与实测剖面平滑接上。
 * ⚠️ 它**只改颜色**，不参与 ggTexAmpAt 的陡度（陡度仍从色表求）—— 所以高纬不会
 *    因为"多了几条带"而被顺带塞进一堆纹理。
 */
/**
 * ★★ 高纬带纹的**抖动衰减系数** —— 2026-10-04 排查"高纬带纹看不见"时加的 ★★
 *
 * 症状：amp 从 0.07 提到 0.14（甚至 0.6）后，沿中轴量出的调制仍只有 ±3/255，
 *   比「amp × 亮度」该有的值**小一个量级**。
 * 根因：ggColorAt 收到的是 **latEff（被带缘扰动过的纬度）**，而 edgeAmount = 2.5°。
 *   极冠带的周期只有 **7.5°** ⇒ ±2.5° 的抖动等于**把一条带揉掉三分之一个周期**，
 *   波峰被抹平（把 amp 拉到 0.6 时差值呈现出**周期恰好 7.5° 的正弦** ⇒ 机制本身是通的，
 *   只是被抖动压扁了）。
 * 处置：极冠带**只吃一部分抖动** —— 保留一点撕裂感（不然会与整盘其余部分脱节），
 *   但不再把带揉没。0.35 ⇒ 有效抖动 ±0.9°，约占周期的 1/8。
 *
 * ⚠️ 与之对照：主色表的带缘**应该**继续吃满抖动（那是"带缘随经度摆动/撕裂"的既定观感，
 *    且主带宽度 ~5–8°、周期远大于抖动）⇒ 这个系数**只作用于 ggPolarBand**。
 *
 * ⚠️⚠️ 它的**真身是 JS 常量**（在模板外，见文件里 GG_POLAR_JITTER 的定义）——
 *    第一版把 const 声明直接写进了模板里，编译期报 "GG_POLAR_JITTER is not defined"。
 */

/**
 * ★★ 高纬带纹（|lat| > start）★★
 *
 * 背景：参照在 |lat| > 50° 处的剖面被**临边污染**（实测 ±71.5° 报出假亮带）⇒ 那段没有可信数据。
 *   与其让外推给出一片平滑，不如**明确设计**几条纹（总监 2026-10-04 的观感决定）。
 *
 * 乘性调制 1 + amp·w(lat)·sin(2π(|lat| − start)/period)，w 是 smoothstep 渐入
 * ⇒ 在 start 处**没有硬台阶**，与实测剖面平滑接上。
 * ⚠️ 它**只改颜色**，不参与 ggTexAmpAt 的陡度（陡度仍从色表求）—— 所以高纬不会
 *    因为"多了几条带"而被顺带塞进一堆纹理。
 *
 * @param latDeg    **未抖动**的纬度（抖动由下面 jitter 参数单独按比例施加）
 * @param jitter    带缘抖动量（度）—— 见 GG_POLAR_JITTER
 */
float ggPolarBand(float latDeg, float jitter) {
    if (uGgPolarAmp == 0.0 || uGgPolarPeriod <= 0.0) {
        return 1.0;
    }
    float a = abs(latDeg + jitter * ${GG_POLAR_JITTER});
    float w = smoothstep(uGgPolarStart, uGgPolarStart + max(uGgPolarFade, 0.001), a);
    float s = sin(6.28318530717959 * (a - uGgPolarStart) / uGgPolarPeriod);
    return 1.0 + uGgPolarAmp * w * s;
}

/**
 * 云顶色表查表（−90..+90，按配方的步长，线性插值）。
 * ⚠️ 用 cfLerp 而不是 mix()：与 JS 侧的取整/插值顺序必须一致（见 cloudFieldGLSL 文件头）。
 */
vec3 ggColorAt(float latDeg, float jitter) {
    float t = clamp((latDeg + 90.0) / ${step.toFixed(4)}, 0.0, ${span});
    int i0 = int(min(floor(t), ${last}));
    float fr = t - float(i0);
    // ⚠️ 极冠带要的是**未抖动**的纬度（latDeg − jitter）—— 抖动由 ggPolarBand 按比例施加。
    //    直接吃满抖动会把 7.5° 周期的带揉平（见 GG_POLAR_JITTER 的说明）。
    return vec3(
        cfLerp(ggBandR(i0), ggBandR(i0 + 1), fr),
        cfLerp(ggBandG(i0), ggBandG(i0 + 1), fr),
        cfLerp(ggBandB(i0), ggBandB(i0 + 1), fr)) * ggPolarBand(latDeg - jitter, jitter);
}

/**
 * 由本地位置方向解析求纬度（度）。见文件头「纬度口径」。
 */
float ggLatOf(vec3 localDir) {
    return asin(clamp(normalize(localDir).y, -1.0, 1.0)) * GG_RAD2DEG;
}

/**
 * ★★ 纬向剪切：把**噪声场**沿经度剪开（只剪场，不剪色表）★★
 *
 * 位移剖面用交替的急流「sin(cycles·π·lat/90)」：正/负交替，赤道与两极同相。
 * 拉伸强度 ∝ 剖面的**导数** ⇒ ∝ cycles —— 所以"急流条数"与"剪多狠"是两个独立旋钮。
 *
 * ⚠️ 单位是**圈**（与 windSpeed 同一口径）：uGgShearAmp = 0.03 即 ±10.8° 经度。
 * ⚠️ **有界**：S(lat) 是 lat 的纯函数，不随时间累积 —— 这正是当初
 *    「windShearMax」把"速率型参数"换成"上界型参数"要守住的那条纪律。
 * ⚠️ uv.x 在着色器里是 [0,1) 的参数（绕一圈 = +1）。位移直接加在 x 上即可，
 *    因为方向空间噪声在 u 方向**天生无缝**（cfUvToDirection 用 sin/cos，
 *    加整数圈等价于回到原处）。
 */
vec2 ggShearUv(vec2 uv, float latDeg) {
    if (uGgShearAmp == 0.0 || uGgShearCycles == 0.0) {
        return uv;
    }
    float s = sin(latDeg * 3.14159265358979 * uGgShearCycles / 90.0);
    return vec2(uv.x + uGgShearAmp * s, uv.y);
}

/**
 * ★ 纹理幅度（**重分配**，不是加总量）★
 *
 *   幅度(lat) = texAmp · texNorm · [ 1 + texEdge·(陡度(lat) − 均值)
 *                                      + texLat·((1 − |lat|/90) − 均值) ]
 *
 * 两个驱动都经过**居中**（减面积加权均值）⇒ 括号里的均值恒为 1，
 * 再乘 CPU 算的 texNorm（= 1/面积加权 RMS）⇒ **全局纹理 σ 精确守恒**。
 * 于是这一项只改变"纹理长在哪"，不会把总量做超 —— 这是刻意设计的安全性质。
 *
 * 实测支撑：陡度 r=+0.433（最强）、纬度 r=−0.339、带的**幅度** r=+0.102（无关）。
 */
float ggTexAmpAt(float latDeg) {
    if (uGgTexEdge == 0.0 && uGgTexLat == 0.0) {
        return uGgTexAmp;
    }
    float t = clamp((latDeg + 90.0) / ${step.toFixed(4)}, 0.0, ${span});
    int i0 = int(min(floor(t), ${last}));
    float fr = t - float(i0);
    // ★ 陡度在着色器里现算（省掉一整张 181 点的表，uniform 预算才够）★
    //   用**线性**亮度做中心差分（口径差异如实记在 recipe 文件里）。
    int ia = max(i0 - 1, 0);
    // ⚠️ 这里必须是**整数**字面量：写成 (n-1).toFixed(1) 会生成「min(int, 180.0)」
    //    ⇒ GLSL 报 "no matching overloaded function found"，整个云着色器编译失败。
    int ib = min(i0 + 2, ${n - 1});
    float la = 0.299 * ggBandR(ia) + 0.587 * ggBandG(ia) + 0.114 * ggBandB(ia);
    float lb = 0.299 * ggBandR(ib) + 0.587 * ggBandG(ib) + 0.114 * ggBandB(ib);
    float slope = abs(lb - la) / 2.0;
    slope = uGgSlopeMax > 0.0 ? slope / uGgSlopeMax : 0.0;
    float env = 1.0 - min(abs(latDeg), 90.0) / 90.0;
    float m = 1.0 + uGgTexEdge * (slope - uGgSlopeMean)
                  + uGgTexLat * (env - uGgEnvMean);
    return uGgTexAmp * uGgTexNorm * m;
}

/**
 * 带缘扰动（度）。
 *
 * 参照图的带缘**不是水平的圆环**：暗带边缘被细丝撕裂、随经度摆动。
 * 没有这一项，14 条带会退化成"等间距清晰条纹" —— 那是明确不做的形态。
 * 用与纹理**不同源**的噪声（不同种子、不同频率），否则带缘会被纹理拽着走。
 */
float ggEdgeShift(vec3 dir, int seed) {
    if (uGgEdgeAmount <= 0.0) {
        return 0.0;
    }
    // ★★ 2026-10-04：从**单一倍频**改成**三层小级联** —— 治"带缘太干净" ★★
    //   症状（总监选做的那条，也是我从分区扫描里认定的"参照结构感的主力"）：
    //     参照的带缘是**波浪状、卷曲、有舌状突出**的；我们是**一条基本笔直的横线**。
    //   根因：原来只有 cfNoise4D(dir · edgeScale) **一个倍频**，而 edgeScale = 6
    //     ⇒ 波长 6/360 分之一圈 ≈ **60°** ⇒ 只有长波起伏，**1–5° 尺度上什么都没有**。
    //   做法：叠三层（60° / 16° / 5.5°）。倍率取 3.7 / 12（近似几何级数）。
    //   ⚠️ 归一化用 **RMS**（√(1+0.25+0.0625) ≈ 1.146）而不是"绝对值上界 1.75" ——
    //      用上界归一会让 edgeAmount 的**表观强度**悄悄变小，那是"改了一个旋钮的语义"。
    float s = uGgEdgeScale;
    float nz = cfNoise4D(vec4(dir * s, uGgTime), seed + 3301);
    nz += 0.50 * cfNoise4D(vec4(dir * (s * 3.7), uGgTime), seed + 3313);
    nz += 0.25 * cfNoise4D(vec4(dir * (s * 12.0), uGgTime), seed + 3319);
    return nz * uGgEdgeAmount * 0.8729;      // 1/1.1456
}

/**
 * ★★ 涡旋（椭圆色差 + 内部螺旋）★★
 *
 * 为什么这一项**不像 Kerbin 的气旋那样注定失败**（交接文档 §13.52 记的那次）：
 *   那次的目标是体积云的观感（螺旋 + 自阴影 + 多次散射），而我们只有一张 α 遮罩
 *   ⇒ "用 2D 追 3D"，每加一层就更假。
 *   而气态巨星的云是 **α ≡ 1 的彩色表面**，参照里的涡旋**本来就是颜色异常**
 *   （实测：4–7° 的椭圆、峰值 ±30/255 ≈ 2 倍纹理 σ、集中在 |lat| 16–29°）
 *   ⇒ 这里做的是**同一个维度上的加法**，不需要体积感。
 *
 * 表结构（每条 8 个 float = 2 个 vec4，std140 对齐简单）：
 *   A = (lat0, lon0, a【经向半轴·度】, aspect【b/a】)
 *   B = (amp【色差，带符号】, spin【旋转角幅度·弧度，带符号】, —, —)
 *
 * 两条铁律都守住了：
 *   ① **位移有界**：螺旋角「spin·(1 − smoothstep(0,1,r))」在边界 r=1 处**归零**
 *      ⇒ 出不了接缝，也不会像"速度场积分"那样无界累积应变
 *   ② **先剪切、后涡旋**：涡旋作用在**已被剪开的场**上；色差掩膜用**真实经纬**
 *      ⇒ 椭圆不会被剪切拉歪
 */
layout(std140) uniform GgVortices {
    vec4 uGgVortexA[${vortexMax}];
    vec4 uGgVortexB[${vortexMax}];
};
// ⚠️ 条数必须是 **float**：setUniforms 对标量一律走 uniform1f，声明成 int 会**静默失配**
//    （写不进去 ⇒ 恒为 0 ⇒ 整个涡旋段被早退跳过，画面看起来"就是没效果"）。
//    这是项目里记过的坑，本轮又踩了一次。GLSL 侧用 int(x + 0.5) 转回来。
uniform float uGgVortexCountF;   // 实际条数（≤ 表容量）
uniform float uGgVortexAmp;      // ★ 云场 b 的**偏移倍率**（0 = 关；标定用）
uniform float uGgVortexSpin;     // 全局螺旋倍率（0 = 只留椭圆色差）
uniform float uGgVortexEdge;     // ★ 椭圆边界的**云化**程度（半径被 b 扰动的幅度）
uniform float uGgVortexRim;      // ★ 外环反号强度（"眼"结构；0 = 退回纯凸包）
uniform float uGgVortexGate;     // ★ 色差路的**云门控**强度（0 = 不门控 ⇒ 会退回"贴纸"）
uniform float uGgVortexStretch;  // ★ 切向拉伸（< 1 ⇒ 把云丝拉成方位向 ⇒ 才卷得出螺旋臂；1 = 关）
uniform float uGgVortexTexBoost; // ★ 椭圆内部的纹理增强（参照实测有到 2.0 倍的）

int ggVortexCount() {
    return int(uGgVortexCountF + 0.5);
}

/** 经度（度）—— 与 cfUvToDirection 的 theta 同口径 */
float ggLonOf(vec3 localDir) {
    vec3 d = normalize(localDir);
    return atan(d.x, d.z) * GG_RAD2DEG;
}

/**
 * ★★ 经度：配方表用的是**量具口径**，与 uv 口径差一个「远半球镜像」★★
 *
 * 量具（measureReferenceDisc.mjs）按**近半球**约定把屏幕位置换成经纬：
 *   lon = atan2(dx, +√(1−dx²−dy²))。
 * 而我们的球面网格渲染的是**远半球**（同一屏幕位置上 d.z < 0）⇒
 *   同一个屏幕位置，uv 口径的经度是 180° − 量具经度。
 *
 * ★ 这一条是**实测确证**的，不是推的：把 (lon+180)/360 画出来（诊断档位 12），
 *   ±180° 的接缝**正好竖直切在盘心** ⇒ 可见的只有 lon ∈ [90°, 270°] 那一半。
 *   ⇒ 配方表里严格照抄参照实测的涡旋（|lon| ≤ 57°）**一个都看不见** ——
 *     这曾经让整件事看起来「完全没生效」（uniform、UBO、数据、条数全是对的）。
 *
 * ⇒ 所以配方表**照抄量具口径**（"抄实测"是字面的、可逐条对拍），换算放在这里。
 *
 * ⚠️⚠️ 本段是 JS 模板字符串的一部分，**注释里绝不能出现反引号**（已踩 7 次）。
 */
float ggLonToolOf(vec3 localDir) {
    vec3 d = normalize(localDir);
    return atan(d.x, -d.z) * GG_RAD2DEG;
}

/**
 * 椭圆半径：1 = 边界，内部 < 1。
 * 经度差先按该纬度的 cos 折算成**实际弧长**再与半轴比 —— 否则高纬的椭圆会被拉长。
 */
float ggVortexR(vec4 A, float dLat, float dLon) {
    float x = dLon * cos(A.x * (3.14159265358979 / 180.0)) / A.z;
    float y = dLat / (A.z * A.w);
    return sqrt(x * x + y * y);
}

/**
 * ★ 涡旋随**当地急流**漂移（2026-10-04）★
 *
 * 物理上涡旋住在急流里，必须跟着走 —— 否则急流一开，涡旋会**"钉"在流上**，一眼假。
 * 用的是与场**同一个** ggJetDisp(lat0)，所以涡旋与周围的云同步移动。
 *
 * 符号：场在 uv.x + disp 处采样 ⇒ 图案向 −uv.x 移动；而 lon_tool = 180 − lon_uv
 *   ⇒ 涡旋（用**量具口径**的经度）漂移量是 +disp · 360（度）。
 * ⚠️ t = 0 时 disp = 0 ⇒ 位置恒等于表里的值 ⇒ **"照抄实测位置"在 t=0 严格成立**。
 */
float ggVortexLonNow(float lon0, float lat0) {
    return lon0 + ggJetDisp(lat0) * 360.0;
}

/**
 * 颜色剖面：**平台 + 紧边** —— 内部平、边界清。
 *
 * ★ 边界宽度是"看不看得见"的关键（2026-10-04 实测）★
 *   第一版是 smoothstep(0.70, 1.0) ⇒ 半径的 **30%** 都在渐变里，
 *   一个 5° 的椭圆有 1.5° 是糊的，读出来是"一团渐变"而不是"一个椭圆"。
 *   参考图的涡旋是"内部平、边界清"的（这正是人眼把它识别成**一个东西**的原因）。
 *   ⇒ 收到 (0.86, 1.0)：只有最外 14% 过渡，边界收紧约 2 倍。
 */
float ggVortexMask(float r) {
    // ★★ 2026-10-04：从"纯凸包"改成**"亮核 + 暗环"的眼结构** ★★
    //
    // 症状（总监：「涡旋在整盘尺度上根本看不见」）：把核心 Δ 一路加到 **+21.8**
    //   （比参照的 +12.8 还高），画面**依然读不出来** —— 那块区域只是"稍亮一点"。
    //
    // 定案靠**同位置同尺度 1:1 对照**（lat 27.9 / lon 1.5，±6°）：
    //   参照那里有一块**边界清楚的亮斑，且它上面压着一条暗边** ——
    //   是个「**亮核 + 暗环**」的**眼结构**，不是单纯的亮斑。
    //
    // 为什么纯凸包读不出来：我们的纹理在**同一个尺度（3–6°）上本来就有 ±25/255 的
    //   随机起伏** ⇒ 一个只做**平滑均值偏移**的 6° 凸包，和"随机的一块纹理"在统计上
    //   没有区别，眼睛没有**边**可抓。核心 Δ 从 11.7 加到 21.8 都不动，就是这个原因。
    //   ⇒ **能读出来靠的是"对比的边缘"，不是"更大的均值"。**
    //
    // 剖面：中心 +1 → r≈0.85 归零 → r≈0.93 反向到 −rim → r=1 归零。
    //   ⚠️ rim 为 0 时退回原来的纯凸包（A/B 用）。
    float core = 1.0 - smoothstep(0.0, 0.85, r);
    float ring = smoothstep(0.55, 0.88, r) * (1.0 - smoothstep(0.88, 1.0, r));
    return core - uGgVortexRim * ring;
}

/**
 * ★★ 涡旋对**云场**的调制 —— 这是「由云形成」的关键 ★★（2026-10-04 总监：像硬贴的）
 *
 * **改之前**：c *= 1 + amp·mask(r) —— 乘在**成品颜色**上。无论那里的云在干什么，
 *   都往上糊一个光滑椭圆。这就是"贴纸"的定义：色差是**几何量**，和云没有任何关系。
 *
 * **改之后**：b' = clamp(b + bias·mask(r), 0, 1) —— 改的是 **b（噪声场 = 云本身）**。
 *   "椭圆更亮"因此变成"**那里的云更厚**"：亮度差由**已有的**云路径
 *   1 + texAmp·(b' − 0.5) 自然长出来，而不是涂上去。
 *   数值上够：texAmp 0.95 ⇒ b 推 +0.26 就带来约 +25% 的颜色变化。
 *
 * 三条配套：
 *   ① **边界由场决定**：椭圆半径被**同一个 b** 扰动（r·(1 + edge·(b−0.5)·2)）
 *      ⇒ 边缘是**云的轮廓**而不是几何椭圆。**零额外开销**（b 已经在手上）。
 *   ② **内部湍流度**：掩膜总量从 maskOut 带出去，供 ggCloudTop 提升 texAmp
 *      （参照实测：涡旋内部的高频 σ 与环带之比有的到 **2.0 倍**，有的反而 0.76 ——
 *      所以"更湍流"不能一刀切，但"内部的云纹理**不一样**"是事实）。
 *   ③ 螺旋位移（ggVortexUvShift）本来就是从云来的，保留。
 *
 * ⚠️⚠️ 本段在 JS 模板字符串里，**注释里绝不能出现反引号**（已踩 10 次）。
 *
 * @param dir     本地方向
 * @param b       面积均匀的场值（云本身）
 * @param maskOut [out] 椭圆掩膜总量 ∈ [0,1]，供纹理增强用
 * @return 修改后的 b
 */
float ggVortexApply(vec3 dir, float b, out float maskOut) {
    maskOut = 0.0;
    if (ggVortexCount() <= 0 || uGgVortexAmp == 0.0) {
        return 0.0;                       // ★ 返回的是**未缩放的偏置和**（调用处再决定怎么用）
    }
    float latV = ggLatOf(dir);
    float lonV = ggLonToolOf(dir);
    float bias = 0.0;
    for (int i = 0; i < ${vortexMax}; i++) {
        if (i >= ggVortexCount()) {
            break;
        }
        vec4 A = uGgVortexA[i];
        float dLat = latV - A.x;
        if (abs(dLat) > A.z * A.w) {
            continue;                       // ★ 纬度方向包围盒早退
        }
        float dLon = mod(lonV - ggVortexLonNow(A.y, A.x) + 540.0, 360.0) - 180.0;   // 最短路径
        float r = ggVortexR(A, dLat, dLon);
        // ① 边界由场决定：用**同一个 b** 扰动半径 ⇒ 边缘是云的轮廓，不是几何椭圆
        r *= 1.0 + uGgVortexEdge * (b - 0.5) * 2.0;
        if (r > 1.0) {
            continue;
        }
        float m = ggVortexMask(r);
        if (m <= 0.0) {
            continue;
        }
        bias += uGgVortexB[i].x * m;
        maskOut = max(maskOut, m);
    }
    return bias;
}

/**
 * 涡旋引起的**场采样位移**（uv 单位）。
 *
 * 做法：把局部 (Δlon·cos(lat0), Δlat) 绕涡旋中心转 ang 再转回经纬，
 *       取差值作为位移。ang = spin·(1 − smoothstep(0,1,r)) ⇒ 中心最大、边界归零。
 * ⚠️ 12 次循环里每次都有 cos/sin —— 靠**包围盒早退**把绝大多数像素的开销压到两次比较。
 */
vec2 ggVortexUvShift(vec3 dir) {
    if (ggVortexCount() <= 0 || uGgVortexSpin == 0.0) {
        return vec2(0.0);
    }
    float latV = ggLatOf(dir);
    float lonV = ggLonToolOf(dir);
    float du = 0.0;
    float dv = 0.0;
    for (int i = 0; i < ${vortexMax}; i++) {
        if (i >= ggVortexCount()) {
            break;
        }
        vec4 A = uGgVortexA[i];
        float dLat = latV - A.x;
        if (abs(dLat) > A.z * A.w) {
            continue;
        }
        float dLon = mod(lonV - ggVortexLonNow(A.y, A.x) + 540.0, 360.0) - 180.0;
        float r = ggVortexR(A, dLat, dLon);
        if (r > 1.0) {
            continue;
        }
        float spin = uGgVortexSpin * uGgVortexB[i].y;
        if (spin == 0.0) {
            continue;
        }
        float ang = spin * (1.0 - smoothstep(0.0, 1.0, r));
        float cl = cos(A.x * (3.14159265358979 / 180.0));
        float x = dLon * cl;                 // 局部弧长坐标（度）
        float y = dLat;
        float ca = cos(ang);
        float sa = sin(ang);
        float x2 = x * ca + y * sa;          // 采样坐标反向转 ⇒ 图案正向转
        float y2 = -x * sa + y * ca;
        // ★★ 2026-10-04 新增：**沿切向的拉伸** —— 这是"螺旋臂"能不能出来的关键 ★★
        //   症状：spin 已经 195–240°，画面里却**没有可见的臂**（总监：「还是觉得像污渍」）。
        //   原因（想清楚才发现）：**把各向同性的噪声转一圈，得到的还是各向同性噪声** ——
        //     位移本身不产生对比，它只能**搬运已有的结构**。
        //   参照那些臂是**沿流向拉长的丝**被卷起来的结果 ⇒ **得先有丝**。
        //   做法：把采样坐标在**切向压缩** uGgVortexStretch 倍
        //     ⇒ 图案沿切向被**拉伸 1/stretch 倍** ⇒ 得到方位向的丝；
        //     再由上面的 ang(r) 卷起来 ⇒ 螺旋臂。
        //   ⚠️ 在**局部极坐标**里做（径向/切向单位向量），不是在 (x,y) 里各向异性缩放 ——
        //     后者对偏离主轴的点方向是错的。
        //   1.0 = 关（退回纯旋转，A/B 用）。
        float rl = max(length(vec2(x, y)), 1e-3);
        vec2 rad = vec2(x, y) / rl;
        vec2 tanv = vec2(-rad.y, rad.x);
        vec2 p2 = vec2(x2, y2);
        p2 = rad * dot(p2, rad) + tanv * (dot(p2, tanv) * uGgVortexStretch);
        x2 = p2.x;
        y2 = p2.y;
        du += (x2 - x) / max(cl, 1e-3) / 360.0;
        dv += (y2 - y) / 180.0;
    }
    return vec2(du, dv);
}

/**
 * 气态巨星的云顶色（线性 RGB）。
 *
 * @param dir  本地位置方向（单位）
 * @param b    面积均匀的场值（Kerbin 路径算出来的同一张 b；σ = 1/√12）
 * @param seed 场种子
 */
vec3 ggCloudTop(vec3 dir, float b, float vmask, float vbias, int seed) {
    float lat = ggLatOf(dir);
    float edgeJit = ggEdgeShift(dir, seed);
    float latEff = lat + edgeJit;
    // ⚠️ 第二个参数是**抖动量**：色表吃满，极冠带只吃一部分（见 GG_POLAR_JITTER）
    vec3 c = ggColorAt(latEff, edgeJit);
    // 乘性纹理：b 面积均匀 ⇒ (b − 0.5) 的 σ = 1/√12，幅度解析可算。
    // ⚠️ 必须是 (b − 0.5) 而不是 b：否则整体亮度被抬高 0.5·texAmp，
    //    盘面均值会偏 —— 那是"看起来没问题但数不对"的典型。
    // ★ 幅度随**带界陡度**与**纬度**重分配（总量由 texNorm 守恒）★
    // ② 椭圆内部纹理增强：真实风暴内部的云纹理与外面**不一样**
    float ampEff = ggTexAmpAt(lat) * (1.0 + uGgVortexTexBoost * vmask);
    // ---- ★★ 涡旋的两条路（2026-10-04 定案）★★ ----
    //  ⚠️⚠️ **只走 b 是不行的** —— 这是一条硬约束，值得记牢：
    //    b 路的色差 = texAmpAt(lat) × Δb，而 clamp(b+Δb, 0, 1) 在 b 均匀分布下
    //    把有效偏移压成 Δb − Δb²/2（Δb 越大吃得越多）⇒ **天花板 = 0.5 × texAmpAt(lat)**。
    //    而 texAmpAt 被"带缘陡度"重分配过，**随纬度能差好几倍** ⇒
    //    实测：lat −19（带界附近）核心 Δ **26/255**、lat +35（带中心附近）**≤4/255**。
    //    总监的原话就是「有些漩涡有点小，非常不明显」—— **"有些"正是这条纬度依赖**。
    float bV = b;
    if (vbias != 0.0) {
        // ① b 路（次要）：让**云真的更厚/更薄**，纹理随之变化 —— 这是"由云形成"的那一半。
        //    除以 ampEff 是为了让它**不被纬度缩放**；clamp 会截顶，所以它是次要项。
        bV = clamp(b + uGgVortexAmp * vbias / max(ampEff, 0.05), 0.0, 1.0);
    }
    c *= 1.0 + ampEff * (bV - 0.5);
    if (vbias != 0.0 && uGgVortexAmp != 0.0) {
        // ② 色差路（主要）：**加性**（绝对量），**不随局部亮度缩放**。
        //    ⚠️ 必须加性 —— 乘性时暗带上的涡旋会被"按亮度打折"：
        //      实测同一组参数，lat −19（**亮区** 117/255）Δ=**+16**、
        //      lat +35（**暗带** 56/255）Δ=**+2**（8 倍差）。总监的原话
        //      「**有些**漩涡有点小，非常不明显」—— "有些"就是这条亮度依赖。
        //    ⚠️⚠️ 但**绝不能等量加到 RGB 三个通道上** —— 那是**加白**：
        //      Jool 是强饱和的黄绿（tint 里 B 只有 0.26），等量加会把蓝抬得相对最多
        //      ⇒ **涡旋中心发灰发白**。总监一眼看出来：「为什么漩涡中心变颜色了？很丑啊？」
        //      ⇒ 加的量必须**沿当地色相**：把底色按**亮度归一**当载体（亮度 1、色相与饱和度不变），
        //        再乘一个绝对量 ⇒ **只加亮度、不改色相**。
        //    ⚠️ 但**必须被云门控**，否则就退回"贴纸"（2026-10-04 总监：「硬贴上去的」）。
        //      门控 = 云薄的地方少上色 ⇒ 色差落在**云的结构**上，而不是平涂一块椭圆。
        //    ⚠️ 门控的**过渡宽度**很关键：0.30–0.70 太窄 ⇒ 等于一个**近乎二值的硬阈值**
        //      ⇒ 加的光变成一块块硬边的斑，暗涡旋看起来**突兀**（总监：「颜色变深的很突兀」）。
        //      放宽到 0.10–0.90 ⇒ 软阈值 ⇒ 既有云的结构、又不会硬边。
        float gate = mix(1.0, smoothstep(0.10, 0.90, b), uGgVortexGate);
        float lc = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 carrier = c / max(lc, 1e-3);            // 亮度归一 ⇒ 保持色相与饱和度
        c += carrier * (uGgVortexAmp * vbias * gate * ${GG_VORTEX_LUMA});
        c = max(c, vec3(0.0));
    }
    // ★ 临边辉光（见文件头「临边辉光」）★
    //   (1 − |dz|)：盘心 0、临边 1；用 |dz| 是因为"看到的是远半球"，
    //   而此时**可见面的朝向余弦就是 |dz|**（正交投影下 r² = 1 − dz²，与半球无关）。
    if (uGgLimbGlow > 0.0) {
        float dz = abs(normalize(dir).z);
        c *= 1.0 + uGgLimbGlow * pow(max(0.0, 1.0 - dz), uGgLimbPow);
    }
    return c;
}

/**
 * 诊断档位（**"把它画出来"**：任何换算先证明它画出来是对的，再动手调）。
 *   1 = 纬度 lat（灰度，(lat+90)/180）
 *   2 = 扰动后的纬度 latEff
 *   3 = 场值 b
 *   4 = 色表（无纹理）
 *   5 = 纹理因子 (1 + texAmp(b−0.5)) 的灰度
 * 0 = 正常渲染（逐像素不受影响）
 */
vec3 ggDebugColor(vec3 dir, vec2 uv, float b, int seed) {
    if (uGgDebug < 0.5) {
        return vec3(0.0);
    }
    if (uGgDebug < 1.5) {
        return vec3((ggLatOf(dir) + 90.0) / 180.0);
    }
    if (uGgDebug < 2.5) {
        return vec3((ggLatOf(dir) + ggEdgeShift(dir, seed) + 90.0) / 180.0);
    }
    if (uGgDebug < 3.5) {
        return vec3(b);
    }
    if (uGgDebug < 4.5) {
        float jit = ggEdgeShift(dir, seed);
        return ggColorAt(ggLatOf(dir) + jit, jit);
    }
    if (uGgDebug < 5.5) {
        float m = 1.0 + ggTexAmpAt(ggLatOf(dir)) * (b - 0.5);
        return vec3(m);
    }
    if (uGgDebug < 6.5) {
        // 6 = 临边几何量 (1 − |dz|)：盘心 0、临边 1（应当是"中心黑、边缘白"的圆）
        return vec3(max(0.0, 1.0 - abs(normalize(dir).z)));
    }
    if (uGgDebug < 7.5) {
        // 7 = 临边辉光因子减 1（归一化后 = (1−|dz|)^pow，用来核对幂次与几何）
        float dz = abs(normalize(dir).z);
        return vec3((1.0 + uGgLimbGlow * pow(max(0.0, 1.0 - dz), uGgLimbPow) - 1.0)
            / max(1e-3, uGgLimbGlow));
    }
    if (uGgDebug < 8.5) {
        // 8 = 纬向剪切的位移剖面（0.5 = 无位移）—— 应当是**南北交替的横向条纹**
        float s = sin(ggLatOf(dir) * 3.14159265358979 * uGgShearCycles / 90.0);
        return vec3(0.5 + 0.5 * s);
    }
    if (uGgDebug < 9.5) {
        // 9 = 纹理幅度的**空间分布**（相对 texAmp 的倍率；0.5 = 恰好等于 texAmp）
        //     —— 用来肉眼核对"幅度是不是长在带界上"
        return vec3(0.5 + 0.5 * (ggTexAmpAt(ggLatOf(dir)) / max(1e-4, uGgTexAmp) - 1.0));
    }
    if (uGgDebug < 10.5) {
        // 10 = 涡旋对**云场**的作用量（0.5 = 无变化；>0.5 = 云更厚、<0.5 = 云更薄）
        //      ★ 改版后它画的是 b 的偏移，不再是"颜色乘子" —— 一眼能看出椭圆
        //        是不是**长在云上**（边界应当参差，而不是光滑的几何椭圆）。
        float vm = 0.0;
        float bb = ggVortexApply(dir, b, vm);
        return vec3(0.5 + (bb - b) * 2.0, 0.5 + vm, 0.5);
    }
    if (uGgDebug < 12.5) {
        // 12 = 经度映射探针：(ggLonOf(dir) + 180) / 360。
        //      用来定案"渲染的是近半球还是远半球" —— 远半球时 ±180 的接缝正好在盘心。
        //      ★ 这条探针查出过一个会让整件事"看起来完全没生效"的坑（见 ggLonToolOf）。
        return vec3((ggLonOf(dir) + 180.0) / 360.0);
    }
    // 13 = ★ 急流廓线 P(lat)：0.5 = 无风、>0.5 = 一个方向、<0.5 = 反方向。
    //      用来肉眼确认"方向确实一条隔一条交替"，以及最强急流落在哪两条纬线上。
    return vec3(0.5 + 0.5 * ggJetAt(ggLatOf(dir)));
}
`;
}
