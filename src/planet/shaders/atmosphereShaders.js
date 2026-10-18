'use strict';

// 大气散射着色器（阶段 2）。
//
// ★ 物理模型：单次散射（single scattering）★
//   沿视线穿过大气球壳做 ray marching，每步：
//     高度 h → 密度 exp(-h/H)          （H = 标高，指数大气）
//     累加视线方向的光学厚度 → 透射率
//     同时算该点朝**太阳方向**的光学厚度 → 太阳透射率（这一步产生晨昏线）
//     散射 = (Rayleigh + Mie) × 密度 × 太阳透射率 × 相位函数
//
//   · Rayleigh（分子散射，正比 1/λ⁴）→ 天空的蓝、临边的蓝边、日出日落泛红
//   · Mie（气溶胶散射）→ 日晕与雾感，相位用 Henyey-Greenstein（前向强）
//   · 行星遮挡：视线打到球面时积分到交点为止 —— 这是"大气只在地平线以上发光"的来源
//
// ★ 合成方式 ★
//   片元输出 vec4(scatter, 1 - T)，配合 gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)：
//     final = scatter + background × T
//   即「背景被大气衰减 + 叠加散射光」。这是正确的合成式，不是普通 alpha 覆盖。
//   ⚠️ 这条合成式**必须在线性域执行**才物理正确。所以两条输出路径都先渲到
//      SRGB8 离屏目标（硬件自动编码，混合发生在解码后的线性域），再由「铺屏」
//      那一步编码给画布 —— 见 glCore/context.js 与 meshRenderer 的 render()。
//      本着色器因此**永远输出线性值**，不需要 sRGB 开关。
//
// ⚠️ 已知近似（"基本正确"的边界，写清楚以免被误当成精确解）：
//   1. **只做单次散射**，不含多次散射 → 日出/日落方向的地平线会偏暗
//   2. 透射率 T 三通道不同，而混合只有一个 alpha → 这里取三通道平均。
//      若将来要更精确：把大气画到独立 target，再用 vec3 做合成
//   3. 无云、无臭氧吸收层
//
// ★★ 晨昏线为什么会"一刀切"—— 两个已修掉的数值病灶（2026-10-02）★★
//
// 病灶 ①（主因）**逐采样点二值遮挡** ⇒ "受光采样点个数"只能整数增减。
//   24 步均匀采样、路径跨约 23 个标高 ⇒ 步长 ≈ 1 个标高 ⇒ **一个采样点就承担
//   约半个光学柱**。于是每加/减一个受光样本，亮度就整档跳一次。
//   实测（kerbin 默认配方、过盘心横扫、8 位口径）：台阶位置在 0.11 / 0.19 /
//   0.25 / 0.29 / 0.33 / 0.37 星径处，最大相邻跳变 **17.25/255**，
//   暗带里的相对跳变 33%~61% —— 画面上就是 6 道沿晨昏线的硬边。
//   ⇒ 修法：**解析求出视线上"被行星遮挡"的参数区间**，每个采样段按
//     "段内受光长度占比"加权（见 blockedSpan）。求和量随区间端点**连续**变化。
//     实测：同样的 24 步，最大相邻跳变 17.25 → 2.25（≈ 真梯度），受光面逐位不变。
//
// 病灶 ②**太阳方向的光学厚度用"本地密度 × 空气质量"**，即假设消光发生在
//   采样点自己所在的高度。这对贴着地面的空气是对的，对**暮光带**是错的：
//   夜侧那圈高空空气是被"从行星临边擦过来的阳光"照亮的，消光发生在切线附近
//   的稠密层，与该点自身有多稀薄无关。误差约 exp(高度/标高) 倍
//   ⇒ 实测夜侧天空亮了 2~3 倍（线性口径约 10 倍）、色相偏中性，
//     把"暗而偏红的一圈暮光"糊成了罩住半个夜半球的灰蓝纱。
//   ⇒ 修法：换成**二维太阳柱积分查表** sunColumn(高度, 太阳高度角)。
//
// ⚠️ 本文件内容是 GLSL 字符串：**注释里不要出现反引号**，
//    它会把 JS 模板字符串提前截断（项目早期踩过，见交接文档 §13.17 教训 2）。

import {
    SUNCOL_ALT_BINS, SUNCOL_COS_BINS, SUNCOL_ALT_MAX,
    sunColumnTableGLSL,
} from '../airMass.js';

/** 太阳柱积分表的元素个数（uniform 数组长度）。 */
export const SUNCOL_TABLE_LEN = SUNCOL_ALT_BINS * SUNCOL_COS_BINS;

/**
 * 大气层顶点着色器：全屏三角形，只把 uv 传给片元。
 */
export const ATMOSPHERE_VERT = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;
out vec2 vUV;
void main() {
    vUV = aTexCoord;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * 大气层片元着色器。
 *
 * 由 createProgram 的 prefix 注入的宏：
 *   ATMO_STEPS  积分步数（缺省 24）
 */
export const ATMOSPHERE_FRAG = `#version 300 es
precision highp float;

#ifndef ATMO_STEPS
#define ATMO_STEPS 24
#endif

in vec2 vUV;
out vec4 outColor;

uniform vec2 uHalfExtent;      // 世界空间半宽/半高 = 视口 / (2 · zoom)
uniform vec2 uCameraXY;        // 相机世界位置
uniform float uPlanetRadius;   // 行星球半径（世界单位）
uniform float uAtmoScale;      // 大气外半径 / 行星半径（<= 1 视为无大气）
uniform vec3 uSunDir;          // 指向太阳（已归一化，世界空间）
uniform vec3 uSunColor;
uniform vec3 uRayleighCoeff;   // Rayleigh 散射系数（每世界单位，RGB 不同）
uniform float uMieCoeff;       // Mie 散射系数
uniform float uMieG;           // Mie 相位各向异性（约 0.76 = 偏前向）
uniform float uScaleHeight;    // 标高 / 行星半径
uniform float uIntensity;      // 总强度（只调观感，不改物理量）
uniform float uRayStart;       // 射线起点 z（正交相机取足够远处）
uniform vec3 uAbsorbCoeff;     // 吸收系数（RGB）—— 吸收性气体与霾，**色相的主要来源**
uniform vec3 uScatterTint;     // 色调乘子（艺术指定色，默认 1,1,1；只作用在散射上）
uniform float uMultiScatter;   // 多次散射近似强度（0 = 退回纯单次散射）
uniform float uSelfAbsorb;     // 自吸收松弛（1 = 严格单次；<1 = 承认部分光会绕回来）
uniform float uSoftKnee;       // 临边高光软压缩的膝点（0 = 关闭 = 历史口径）
// ⚠️ 2026-10-02 记录：这里试过并**已删除**两个"影侧补光/收窄"的艺术滑块 ——
//   ① 影内弥散光托底（给影内一个随影深衰减的残余照度）：能把夜侧那半圈晕补回来、
//      藏住圆柱阴影的直边，但会把夜面点亮（Eve 配方下尤其难看）⇒ 总监判"不要"。
//   ② 暮光收窄（把影侧有效标高换成 H×比例）：能把尾巴缩短，但它**同时把整条暮光调暗**
//      （有效柱积分 ∝ 比例），一旦调暗，被暮光盖住的**圆柱阴影直边**就露出来了
//      ⇒ 观感"又窄又硬"，总监判"很垃圾"。
//   ⇒ 结论（留给下一个人）：**"宽"和"软"是同一枚硬币** —— 那圈柔光是唯一遮住
//      "阴影是圆柱、边界是直线"这件事的东西。想要更窄的晨昏线，正确方向是
//      **物理上的标高 H**（尾巴宽 ∝ sqrt(2H)，且盘面雾感 ∝ βH 可以靠配对浓度保住），
//      而不是给影侧单独打补丁。实测见 tools/checkTerminator.mjs 的【观测】段。
// ★ 二维太阳柱积分查表（高度 × 太阳高度余弦）★
//   取代了旧的「本地密度 × 空气质量」近似，见文件头"病灶 ②"。
//   唯一真源是 src/planet/airMass.js（数值积分烘焙），本体着色器用的是同一份
//   数据的地表切片 —— 两层的日落红/晨昏线口径由此不可能漂移。
uniform float uSunColumnTable[${SUNCOL_TABLE_LEN}];

const float PI = 3.14159265358979;

// 密度低于此值的高度直接不参与积分：exp(-11.6) = 9.1e-6。
// 这条截断把**积分范围**从"整个 1.30R 的壳"收到"还有空气的那 11.6 个标高"——
// 少掉的那段柱积分不到 1e-5 个标高，对透射率的影响在小数点后第 6 位，
// 但省下来的采样步数全部回到稠密区（原实现 24 步里有约一半落在空壳里）。
const float DEN_CUT = 11.6;

/**
 * ★★ 临边高光软压缩（2026-09-27）★★
 *
 * **解决什么问题**：盘心与临边的光程差 = Chapman 掠射/垂直比 = sqrt(2πR/H)。
 * 本项目 H/R 下约 30 倍，而 8 位输出没有高光余量：实测临边散射值可达
 * (0.63, 1.83, 3.0) —— 蓝通道是可用上限的 3 倍 ⇒ 整条边缘带被顶死在 255、
 * **内部梯度全丢**，观感是"一条霓虹灯管"，而不是柔和的大气辉光。
 *
 * **做法**：带膝盖的软压缩 —— 膝点以下**逐位不变**，只压膝点以上。
 *   · 不用全局 Reinhard：那会连**盘面**一起压暗（盘面是总监已经调好的观感）。
 *   · 膝点处 C1 连续（f(knee)=knee、f'(knee)=1），不会出现折线。
 *   · 渐近线是 1.0：无论多亮都不再截断 ⇒ **梯度永远保留**。
 *
 * ⚠️ uSoftKnee = 0 时**整个分支跳过** ⇒ 与加这个特性之前逐像素一致（A/B 通路）。
 *
 * @param c 散射颜色（线性，可超过 1）
 * @param knee 膝点（<= 0 = 关闭）
 */
vec3 softKnee(vec3 c, float knee) {
    if (knee <= 0.0) {
        return c;
    }
    float head = max(1.0 - knee, 1e-4);
    vec3 over = max(c - vec3(knee), vec3(0.0));
    // ⚠️ 膝点以下要返回 **c 本身**，不是 knee ——
    //    写成 vec3(knee) + ... 会把所有低于膝点的像素抬到 knee（实测整屏变 0.5 灰）。
    //    用 min(c, knee) 取"膝点以下的原值"，over 在膝点以下恒为 0 ⇒ 逐位不变。
    // f = min(c,knee) + over / (1 + over/head)：过膝点后斜率连续、渐近 1.0
    return min(c, vec3(knee)) + over / (vec3(1.0) + over / vec3(head));
}

// 射线与球（球心在原点）求交，返回 (近交点, 远交点)；无交时 远 <= 近
vec2 raySphere(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) {
        return vec2(0.0, -1.0);
    }
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
}

// Rayleigh 相位函数（前后对称，两侧略强）
float phaseRayleigh(float mu) {
    return (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
}

// Henyey-Greenstein 相位函数（g > 0 时前向散射强 → Mie 的日晕）
float phaseHG(float mu, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * mu;
    return (1.0 - g2) / (4.0 * PI * pow(max(denom, 1e-4), 1.5));
}
${sunColumnTableGLSL(SUNCOL_ALT_BINS, SUNCOL_COS_BINS, SUNCOL_ALT_MAX)}

/**
 * ★★ 沿视线解出「被行星遮挡」的参数区间 [lo, hi]（无遮挡时 lo > hi）★★
 *
 * **遮挡的几何判据**（与逐点 raySphere 二值判断**严格等价**）：
 *     blocked  <=>  p·L < 0  且  perp² < Rp²
 * 其中 perp² = |p|² − (p·L)² 是点到"太阳轴"的垂直距离平方。
 * 推导：p 在球外时，太阳射线与之相交的充要条件就是"点在背光侧（p·L < 0）
 * 且垂距小于星径"—— 前半由射线方程的较大根为正给出，后半由判别式给出。
 *
 * 沿直线 p(t) = ro + rd·t：
 *   · p·L 是 **t 的一次式**  ⇒ {p·L < 0} 是半直线
 *   · perp² 是 **t 的二次式**（qa = 1 − (rd·L)² >= 0）⇒ {perp² < Rp²} 是区间
 * 交集仍是**一个区间**，两端点可解析求出。
 *
 * ★ 为什么要解析求它 —— 这是"晨昏线台阶"的根治办法（见文件头 病灶 ①）★
 *   逐点二值判断时，积分结果随"受光采样点个数"整数跳变；改成按段内受光长度
 *   加权后，求和量随区间端点连续变化，采样步数不变。
 *
 * ⚠️ 这里**不求"太阳侧球冠"那一支**：本函数只服务"相机看行星"这一种几何，
 *    采样点全在星球外（|p| >= Rp），此时 blocked 的两个条件即为充分必要。
 *    逐点二值判据仍保留在下方循环里做真值兜底（不影响连续性，见那里的说明）。
 */
vec2 blockedSpan(vec3 ro, vec3 rd, vec3 L, float Rp) {
    float a0 = dot(ro, L);                 // p·L 的常数项
    float a1 = dot(rd, L);                 // p·L 的一次项
    float qa = 1.0 - a1 * a1;              // |rd|² − (rd·L)²
    float qb = 2.0 * (dot(ro, rd) - a0 * a1);
    float qc = dot(ro, ro) - a0 * a0 - Rp * Rp;
    // 空区间哨兵：始终保持 lo > hi
    float lo = -1.0e30;
    float hi = 1.0e30;
    // ① p·L < 0
    if (abs(a1) < 1.0e-9) {
        if (a0 >= 0.0) { lo = 1.0; hi = -1.0; }
    } else if (a1 > 0.0) {
        hi = min(hi, -a0 / a1);
    } else {
        lo = max(lo, -a0 / a1);
    }
    // ② perp² < Rp²
    if (abs(qa) < 1.0e-9) {
        // 退化：太阳方向与视线平行（正对/背对镜头），perp² 沿视线是常数
        if (abs(qb) < 1.0e-12) {
            if (qc >= 0.0) { lo = 1.0; hi = -1.0; }
        } else if (qb > 0.0) {
            hi = min(hi, -qc / qb);
        } else {
            lo = max(lo, -qc / qb);
        }
    } else {
        float disc = qb * qb - 4.0 * qa * qc;
        if (disc < 0.0) {
            lo = 1.0; hi = -1.0;
        } else {
            float sq = sqrt(disc);
            float inv = 0.5 / qa;
            lo = max(lo, (-qb - sq) * inv);
            hi = min(hi, (-qb + sq) * inv);
        }
    }
    return vec2(lo, hi);
}

void main() {
    // 屏幕 uv → NDC → 世界坐标（正交相机，视线固定沿 -Z）
    vec2 ndc = vec2(vUV.x * 2.0 - 1.0, 1.0 - vUV.y * 2.0);
    vec3 ro = vec3(uCameraXY + ndc * uHalfExtent, uRayStart);
    vec3 rd = vec3(0.0, 0.0, -1.0);

    float Rp = uPlanetRadius;
    float Ra = Rp * uAtmoScale;
    if (Ra <= Rp) {
        outColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    // ★★ 积分一律换算到**星径单位**（2026-10-02）★★
    //
    // 为什么必须这样：βExt（solveExtinction）与二维柱积分表都是"每星径"的量
    //   （判据见 atmosphereSpecies.solveScatterOpticalDepth：β × H/R 才是无量纲光深）。
    // 而 t（射线参数）是世界单位，且 Rp = 视口高 / (2·zoom) **随视口尺寸变** ⇒
    //   直接拿世界单位的 t 去乘/累加，等于给大气亮度与消光都乘了一个 Rp：
    //     · 画布（1509×1005）Rp ≈ 0.98 → 大气比 512×480 量测（Rp = 0.5）厚一倍、亮一倍；
    //     · 换个窗口大小，同一颗星的画面就跟着变 —— "每次看着不一样"的一个真凶。
    // 归一化之后：dens 用 exp(-hRp / (H/R))，od 与 seg 都是星径单位，
    //   指数 βExt × od、亮度 βR × seg 全部无量纲 ⇒ **与视口尺寸无关**。
    float hRatio = max(1e-5, uScaleHeight);   // H/R（无量纲）
    float invRp = 1.0 / Rp;
    // 积分上界：只积到"还有密度"的高度（见 DEN_CUT）
    float Rcap = min(Ra, Rp * (1.0 + DEN_CUT * hRatio));

    vec2 atmoHit = raySphere(ro, rd, Rcap);
    if (atmoHit.y <= atmoHit.x) {
        outColor = vec4(0.0, 0.0, 0.0, 0.0);   // 这条视线根本没进入大气壳
        return;
    }
    float tStart = max(0.0, atmoHit.x) * invRp;
    float tEnd = atmoHit.y * invRp;

    // 行星遮挡：打中球面就只积分到交点（球体本身照常由 planet 程序绘制）
    vec2 planetHit = raySphere(ro, rd, Rp);
    if (planetHit.x > 0.0 && planetHit.x * invRp < tEnd) {
        tEnd = planetHit.x * invRp;
    }
    if (tEnd <= tStart) {
        outColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    float seg = (tEnd - tStart) / float(ATMO_STEPS);
    // 散射源项：带色调乘子（艺术指定色，默认 1,1,1 即不覆盖）—— 决定**天空**的颜色
    vec3 betaR = uRayleighCoeff * uScatterTint;
    vec3 betaM = vec3(uMieCoeff) * uScatterTint;
    // ★ 消光不带色调乘子（2026-09-26 修正）★
    //   tint 是给天空调色的艺术参数，没有物理依据。它一旦进入消光，就会连带把
    //   **直射阳光**的衰减也改掉 —— 正午白平衡被拉暖：Kerbin 冰盖从白变淡黄、
    //   草地从青绿变橄榄绿。而 Rayleigh 本身的配比 β_B/β_G = 2.23 已与真实 1/λ⁴
    //   完全一致，乘 tint 后变成 3.58 ⇒ 蓝通道消光超标 89%。
    //   消光 = 散射 + 吸收；吸收只衰减、不再发射（这就是色相的来源）。
    //   ⚠️ 本口径必须与 atmosphereSpecies.js 的 solveExtinction 保持一致。
    vec3 betaExt = uRayleighCoeff + vec3(uMieCoeff) + uAbsorbCoeff;
    float mu = dot(rd, uSunDir);

    // ★ 受光区间（解析）★ 见 blockedSpan 的说明
    //   ⚠️ blockedSpan 返回的是**世界单位**的 t，这里换算成星径单位再裁剪。
    vec2 blk = blockedSpan(ro, rd, uSunDir, Rp);
    float bLo = max(blk.x * invRp, tStart);
    float bHi = min(blk.y * invRp, tEnd);

    vec3 scatter = vec3(0.0);
    float od = 0.0;                       // 视线方向的光学厚度（星径单位）

    for (int i = 0; i < ATMO_STEPS; i++) {
        float tMid = tStart + (float(i) + 0.5) * seg;      // 星径单位
        vec3 p = ro + rd * (tMid * Rp);                    // 世界单位（只为求位置）
        float rRp = length(p) * invRp;                     // 半径（星径单位）
        float hRp = max(0.0, rRp - 1.0);                   // 高度（星径单位）
        float dens = exp(-hRp / hRatio);
        // ⚠️ 视线光学厚度**无条件累加**（背景衰减必须覆盖整条路径）。
        //    旧写法把 dens < 1e-5 的样本整段跳过，连 od 一起漏掉；
        //    现在积分上界已经收到 DEN_CUT，这点差别在小数点后第 6 位。
        od += dens * seg;
        if (dens < 1.0e-5) {
            continue;
        }

        // 本采样段内**受光**的长度占比：区间端点解析给出 ⇒ 连续变化，不产生台阶
        float sLo = tMid - 0.5 * seg;
        float sHi = tMid + 0.5 * seg;
        float shadowFrac = clamp((min(sHi, bHi) - max(sLo, bLo)) / seg, 0.0, 1.0);
        float litFrac = 1.0 - shadowFrac;
        if (litFrac <= 0.0) {
            continue;
        }

        // 太阳透射率：查二维表（单位 = 星径，与 βExt 同口径 ⇒ 指数无量纲）
        //   ⚠️ 表在遮挡区已被烘焙成**切点极限值**（有限），所以这里的插值永远连续；
        //      "是否被挡"由上面的 litFrac 负责，不再需要二值分支。
        //   ⚠️ cosZ 就是本地天顶与太阳方向的夹角余弦；对夜侧那圈"受光却在地影里"
        //      的高空空气，表给的是"阳光擦过地平线"的柱积分 —— 这正是暮光带的
        //      正确消光（旧实现按本地稀薄密度算，误差约 exp(高度/标高) 倍）。
        float cosZ = dot(normalize(p), uSunDir);
        float col = sunColumnFromTable(hRp / hRatio, cosZ);
        vec3 sunT = exp(-betaExt * col);

        // （影侧补光 / 暮光收窄：两次尝试都已删除，完整记录见文件头 2026-10-02 那段）
        // ⚠️ 夜面溢光（uNightSpill / effSun 托底）曾在此处，2026-09-27 **已删除**：
        //   总监反馈「这个夜面溢光过头了 删掉」。实现本身是对的（托底、不重复计能量），
        //   但夜面亮起来之后整体观感偏"发灰的球"，不如保持夜面暗。
        //   若要恢复：git 里 §13.39 那次提交，做法是
        //     effSun = max(sunT, vec3(spill * smoothstep(-0.9, 0.0, cosZ)))
        //   把太阳透射率托底（**不是**额外加一项 —— 那会把受光面糊掉）。

        // ★ 自吸收松弛（B）★
        //   严格单次散射下掠射视线的光深极大（蓝通道 betaExt·od 可达 5），
        //   exp(-5) ≈ 0.007 会把散射压死 —— CPU 侧实测：擦边亮度只有 10/255，
        //   而且把散射系数放大 100 倍也只涨到 12（增益全被自吸收吃掉了）。
        //   物理上这是因为被散射掉的光有一部分会再散射回来（多次散射），
        //   uSelfAbsorb < 1 正是这个"会绕回来"的松弛系数。
        vec3 viewT = exp(-betaExt * od * uSelfAbsorb);

        // ★ 多次散射用**独立的、更宽松的**自吸收（2026-09-26）★
        //   弥漫光来自四面八方，不该被"视线方向的光深"完全压制。
        //   这一项是让日落带（低空 + 斜射）的红光透出来的关键。
        vec3 viewTMs = exp(-betaExt * od * uSelfAbsorb * 0.3);

        float phR = phaseRayleigh(mu);
        float phM = phaseHG(mu, uMieG);
        // 单次散射：带相位函数（有方向性）
        vec3 single = betaR * phR + betaM * phM;
        // ★ 多次散射近似（A）★
        //   各向同性、不做相位加权 —— 代表"在大气内部反复散射后弥漫的光"。
        //   真实天空的亮度主要来自它。uMultiScatter = 0 可退回纯单次散射做对照。
        vec3 multi = (betaR + betaM) * uMultiScatter;
        // 段长按受光比例打折：部分受光的段只贡献那一部分
        scatter += (viewT * single + viewTMs * multi) * dens * sunT * (seg * litFrac);
    }

    scatter *= uSunColor * uIntensity;
    // ★ 临边高光软压缩 ★（uSoftKnee = 0 时是恒等，见函数说明）
    scatter = softKnee(scatter, uSoftKnee);

    // 背景衰减用**严格**消光（不松弛）—— 松弛是为了补偿散射光的绕回，
    // 而背景光穿过大气被衰减这件事本身是真实的。
    float tRr = exp(-betaExt.r * od);
    float tGg = exp(-betaExt.g * od);
    float tBb = exp(-betaExt.b * od);
    float transmittance = (tRr + tGg + tBb) / 3.0;

    // 输出**线性**值：混合发生在 SRGB8 目标的解码后线性域（见文件头"合成方式"）
    outColor = vec4(scatter, 1.0 - transmittance);
}
`;
