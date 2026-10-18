'use strict';

// 云场的 **GLSL 逐行移植**（唯一真源是 src/planet/cloudRecipe.js）。
//
// ★★ 为什么可以（也必须）逐行对齐 ★★
//
//   场是纯函数：`f = F(u, v, 参数, w)`。CPU 与 GPU 必须算**同一个函数**，
//   否则"云场验收判据"（在 CPU 复刻上跑）描述的就不是画面里的那张场 ——
//   那正是本项目反复吃过的"检查通过了，但没在检查真正的东西"。
//   对齐由 tools/checkCloudField.mjs 的**逐像素对拍**守住。
//
// ★★ 四个必须刻意的细节（少一个就只能给容差）★★
//
//   ① **哈希取高 24 位**（`h >> 8`，除以 2²⁴）：32 位整数值在 float32 里
//      会丢到 24 位尾数 ⇒ 若按 `h / 2³²` 归一化，两侧必然差 ~2⁻²⁴。
//      24 位整数在 float32 里**精确可表示**，除数是 2 的幂 ⇒ 精确。
//      与 cloudRecipe.js 的 hashCell4 一字不差。
//
//   ② **绝不用 GLSL 的 `mix()`**：规范把它定义为 `x*(1-a) + y*a`，
//      而 JS 侧写的是 `a + (b-a)*t` —— 两者数学等价、**浮点不等价**。
//      所以这里自带 `cfLerp` 并全程使用，插值的**嵌套顺序**也与 JS 一致。
//
//   ③ **方向由 uv 解析求出，不用插值法线**：片元里的 `vNormal` 是三角面内
//      线性插值的（弦而非弧），与 CPU 的解析 `uvToDirection` 必然不同。
//      用解析式还有一个额外好处：**场与网格分段数无关**（128×64 与 96×48
//      渲出的云完全一样），可复现性更强。
//
//   ④ **全程四维，绝不按 w 分支**：曾经写成 `w == 0 ? 3D : 4D`，那是个陷阱 ——
//      四维噪声在 w = 0 处**不等于**三维噪声，于是"时间启动"或"把时间冻结回 0"
//      都会让图案**跳变**，直接违反"同一组参数渲染出同一张图"。
//      ⇒ 一切噪声（级联、两级域扭曲、脊线）统一走 `cfNoise4D`，`w` 一路穿透。
//      代价是比三维贵约三分之一，靠 LOD 控制；换来的是**时间连续**。
//
//   ⚠️ 仍然做不到"逐位全等"的地方：`sin/cos/log/floor` 在 GPU 上是 float32，
//      而 JS 是 double。差 ~1e-7 会让**恰好落在噪声格边界上**的像素取到
//      相邻格点、从而哈希完全不同（表现为极少数孤立像素）。
//      对拍工具因此报告**差值分布**而不是只报"是否全等"。

import { ZONE_POINTS } from '../cloudRecipe.js';

/**
 * CDF 重映射表的长度。必须与 cloudRecipe.buildCloudCdf 的 lutSize 一致，
 * 且着色器里以 `uniform float uCloudCdf[N]` 声明（GLSL 数组长度必须是编译期常量）。
 */
export const CLOUD_CDF_SIZE = 64;

/** 级联的最大层数（GLSL 的 for 循环上界必须是编译期常量） */
export const CLOUD_MAX_OCTAVES = 16;

/** 每次采样 `cfSampleField` 的噪声次数上限（诊断用；LOD 的预算依据） */
export const CLOUD_NOISE_BUDGET_PER_PIXEL = 6 + 6 + 3;

/**
 * ★★ 噪声内核（**云场与气态巨星共用同一份定义**）★★
 *
 * 为什么必须抽出来共用：
 *   气态巨星的云换掉的是**装配**（α 与云顶颜色的来源），
 *   而不是**内核**（噪声 / 域扭曲 / 脊线 / 经纬→方向）。
 *   两处各存一份文本 = 迟早漂移，而漂移的症状是"两颗天体的噪声质感不一样"，
 *   **没有任何判据能抓住它**（各自的验收都会通过）。
 *   ⇒ 唯一真源就是这一份；`cloudFieldGLSL()` 与本函数、以及
 *      `gasGiantCloudGLSL()` 都必须调它，不许各自复制。
 *
 * ⚠️ 抽取时的硬断言：`cloudFieldGLSL(64)` 的输出必须**逐字节不变**。
 *    验证方式是 sha256 比对，不是"看着一样"。
 *    基线：length 10044 / sha256 64805b973b171575cab1ef26c712d36059eceb0c7715dd3915eb2365b095738e
 *    （tools/checkShaderSource.mjs 会跑这条断言）
 *
 *    ⚠️ 基线在 2026-10-10 由 9837/2fe3e355… **同步升版**过一次：那次只改注释 +
 *       把 `uZoneProfile[13]` 的 13 换成 ZONE_POINTS 插值（当前值仍是 13）
 *       ⇒ 发出去的 GLSL 里**代码行一字未动**（声明仍是 uZoneProfile[13]，
 *       cfZoneAt 的 12.0/11.0 由 ZONE_POINTS−1 / ZONE_POINTS−2 算出、值相同）。
 *       因此「云场源码变化 = Kerbin 的云变了」这条判读**这一次不成立** ——
 *       如实验证方式：把 HEAD 版与工作区的 cloudFieldGLSL(64) 逐行 diff，
 *       差异只有注释行。
 *
 * 本段包含：32 位哈希 / 格点哈希 / fade / lerp / 四维值噪声 /
 *           三维域扭曲 / 脊状噪声 / 经纬→单位球方向。
 */
export function cloudNoiseGLSL() {
    return `// ---- 32 位整数哈希：与 JS 的 hashInt 同一套位运算 ----
//   Math.imul 就是 32 位环绕乘法，与 GLSL 的 uint 乘法同义；
//   >>> 16 / >>> 15 是逻辑右移，对应 uint 的 >> 。
uint cfHashInt(uint x) {
    uint h = x;
    h = (h ^ (h >> 16)) * 0x7FEB352Du;
    h = (h ^ (h >> 15)) * 0x846CA68Bu;
    return h ^ (h >> 16);
}

// 四维格点 → [0,1)，只取高 24 位（见文件头 ①）
float cfHashCell4(int ix, int iy, int iz, int iw, int seed) {
    uint h = cfHashInt(uint(ix) * 374761393u ^ uint(iy) * 668265263u
        ^ uint(iz) * 1274126177u ^ uint(iw) * 1013904223u
        ^ uint(seed) * 2246822519u);
    return float(h >> 8u) / 16777216.0;
}

// 五次平滑插值（Perlin fade）—— 与 JS 的 fade 同式同序
float cfFade(float t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// ★ 自带 lerp，**不要用 mix()** ★ —— 见文件头 ②
float cfLerp(float a, float b, float t) {
    return a + (b - a) * t;
}

// 四维值噪声，输出 [-1, 1]（16 个角，展开写以便与 JS 一一对应）
float cfNoise4D(vec4 p, int seed) {
    vec4 ip = floor(p);
    int ix = int(ip.x);
    int iy = int(ip.y);
    int iz = int(ip.z);
    int iw = int(ip.w);
    float fx = cfFade(p.x - ip.x);
    float fy = cfFade(p.y - ip.y);
    float fz = cfFade(p.z - ip.z);
    float fw = cfFade(p.w - ip.w);

    float a000 = cfHashCell4(ix, iy, iz, iw, seed);
    float a100 = cfHashCell4(ix + 1, iy, iz, iw, seed);
    float a010 = cfHashCell4(ix, iy + 1, iz, iw, seed);
    float a110 = cfHashCell4(ix + 1, iy + 1, iz, iw, seed);
    float a001 = cfHashCell4(ix, iy, iz + 1, iw, seed);
    float a101 = cfHashCell4(ix + 1, iy, iz + 1, iw, seed);
    float a011 = cfHashCell4(ix, iy + 1, iz + 1, iw, seed);
    float a111 = cfHashCell4(ix + 1, iy + 1, iz + 1, iw, seed);
    float b000 = cfHashCell4(ix, iy, iz, iw + 1, seed);
    float b100 = cfHashCell4(ix + 1, iy, iz, iw + 1, seed);
    float b010 = cfHashCell4(ix, iy + 1, iz, iw + 1, seed);
    float b110 = cfHashCell4(ix + 1, iy + 1, iz, iw + 1, seed);
    float b001 = cfHashCell4(ix, iy, iz + 1, iw + 1, seed);
    float b101 = cfHashCell4(ix + 1, iy, iz + 1, iw + 1, seed);
    float b011 = cfHashCell4(ix, iy + 1, iz + 1, iw + 1, seed);
    float b111 = cfHashCell4(ix + 1, iy + 1, iz + 1, iw + 1, seed);

    // 嵌套顺序与 JS 的 cfLerp(cfLerp(...), ..., fz) 严格一致
    float ya = cfLerp(cfLerp(cfLerp(a000, a100, fx), cfLerp(a010, a110, fx), fy),
                      cfLerp(cfLerp(a001, a101, fx), cfLerp(a011, a111, fx), fy), fz);
    float yb = cfLerp(cfLerp(cfLerp(b000, b100, fx), cfLerp(b010, b110, fx), fy),
                      cfLerp(cfLerp(b001, b101, fx), cfLerp(b011, b111, fx), fy), fz);
    return cfLerp(ya, yb, fw) * 2.0 - 1.0;
}

// 三维域扭曲：与 JS 的 domainWarp3D 同式
// （含 +977 的种子、以及 31.7 / 11.3 / 71.1 / 53.1 / 97.9 / 17.5 这几个偏移；
//   w 一路穿透 —— 时间一起来时，扭曲场自己也跟着演化）
vec3 cfDomainWarp3D(vec3 p, float strength, float scale, int seed, float w) {
    int s = seed + 977;
    float ox = cfNoise4D(vec4(p.x * scale, p.y * scale, p.z * scale, w), s);
    float oy = cfNoise4D(vec4(p.x * scale + 31.7, p.y * scale + 11.3, p.z * scale + 71.1, w), s);
    float oz = cfNoise4D(vec4(p.x * scale + 53.1, p.y * scale + 97.9, p.z * scale + 17.5, w), s);
    return p + vec3(ox, oy, oz) * strength;
}

// 脊状噪声（卷云状细丝）。与 JS 的 ridged3D 同式：3 层、gain 0.55、种子步进 197
float cfRidged3D(vec3 p, int seed, float w) {
    float freq = 1.0;
    float amp = 1.0;
    float sum = 0.0;
    float norm = 0.0;
    for (int o = 0; o < 3; o++) {
        float nz = cfNoise4D(vec4(p * freq, w), seed + o * 197);
        sum += (1.0 - abs(nz)) * amp;
        norm += amp;
        freq *= 2.0;
        amp *= 0.55;
    }
    return norm > 0.0 ? sum / norm : 0.0;
}

// 经纬 → 单位球方向（与 JS 的 uvToDirection 同式；v = 0 为南极）
vec3 cfUvToDirection(vec2 uv) {
    float lat = (uv.y - 0.5) * 3.14159265358979;
    float theta = (uv.x - 0.5) * 6.28318530717959;
    float cl = cos(lat);
    return vec3(cl * sin(theta), sin(lat), cl * cos(theta));
}
`;
}

/**
 * 生成云场的 GLSL 源码片段（函数 + uniform 声明）。
 *
 * @param {number} cdfSize CDF 表长（与 buildCloudCdf 的 lutSize 一致）
 * @returns {string} GLSL 源码
 */
export function cloudFieldGLSL(cdfSize) {
    const n = Math.max(4, Math.round(cdfSize === undefined ? CLOUD_CDF_SIZE : cdfSize));
    return `
// ===========================================================================
//  云场（唯一真源：src/planet/cloudRecipe.js，本段是它的逐行移植）
// ===========================================================================

uniform float uCloudCdf[${n}];   // CDF 重映射表（常量表，不是贴图）
uniform float uCloudLogMin;      // log 域下界
uniform float uCloudLogSpan;     // log 域跨度（> 0）
uniform float uBirthPhase;       // 生消的空间相位强度（0 = 退回旧行为）
uniform float uBirthMean;        // 生消的**球面平均**（CPU 每帧算一次）—— 必须减掉，见下
uniform float uZoneProfile[${ZONE_POINTS}];  // ★ 纬向气候带控制点（−90°→+90° 均匀铺开，长度 = cloudRecipe.ZONE_POINTS）★
uniform float uZoneStrength;     // 气候带强度：0 = 平坦
uniform float uZoneNorm;         // 面积加权归一化因子（CPU 算）⇒ zone 的球面均值恒为 1

/**
 * ★ 纬向气候带倍率 ★（与 cloudRecipe.zoneProfileAt 同式：线性插值）
 *
 *   zone(v) = [ 1 + strength·(profile(v) − 1) ] / norm，norm 是分子在球面上的
 * **面积加权（cos 纬度）平均** ⇒ zone 的球面平均恒为 1
 * ⇒ coverage 的语义（全局云量比例）**原样保住** ✓
 *
 * ⚠️ 本段在 JS 模板字符串里 ⇒ 注释里**绝不能出现反引号**（会截断模板字符串）。
 *    这个错已经被 checkShaderSource 抓到三次了。
 *
 * 物理依据（真实地球，从太空看第一眼认出来的就是这些带）：
 *   赤道辐合带多云 → 副热带高压**晴** → 中纬风暴带多云 → 极区中等
 */
// ⚠️ cfZoneAt 的定义挪到了 cfLerp 之后 —— GLSL **没有函数提升**，
//    先定义后使用。放前面会报 'cfLerp' : no matching overloaded function found。

` + cloudNoiseGLSL() + `
/**
 * 云场：**乘性级联**（与 JS 的 sampleCloudField 逐行对应）。
 *
 * @param uv 网格 uv
 * @param t  时间（秒）。四个时间效应都 ∝ t ⇒ t = 0 时逐位退化成静态场。
 * @param p0 (scale, lacunarity, gain, cascade)
 * @param p1 (warp, warpDetail, warpDetailScale, bandStretch)
 * @param p2 (ridge, octaves, birthScale, —)
 * @param p3 (windSpeed, windShear, evolveRate, birthAmount)
 * @param seed 种子（**必须 < 2²⁴**，见 cloudRecipe.CLOUD_SEED_MAX）
 * @return 单调于云量的连续值（> 0）
 */
float cfSampleField(vec2 uv, float t, vec4 p0, vec4 p1, vec4 p2, vec4 p3, int seed) {
    float scale = p0.x;
    float lacunarity = p0.y;
    float gain = p0.z;
    float cascade = p0.w;
    float warp = p1.x;
    float warpDetail = p1.y;
    float warpDetailScale = p1.z;
    float bandStretch = p1.w;
    float ridge = p2.x;
    int octaves = int(p2.y + 0.5);
    float windSpeed = p3.x;
    float windShear = p3.y;
    float evolveRate = p3.z;

    // ① 纬向组织：只抬高 dir.y 的频率 ⇒ 云系拉成东西向长条。
    //    不破坏 u 方向周期性（周期性由 dir.x/dir.z 承担）。
    vec3 dirRaw = cfUvToDirection(uv);
    float stretch = bandStretch > 0.0 ? 1.0 + bandStretch * 4.0 : 1.0;

    // ① 平流 + ② 切变：wind 随纬度变 ⇒ 相邻纬带相对滑动 ⇒ 切变自动出来。
    //   用 cos(2φ) = 1 − 2sin²φ 做剖面（赤道一个方向、两极反过来）。
    //   ⚠️ sin(纬度) 取 dirRaw.y（**不是** 2v−1 —— 那是线性的，不是正弦）。
    //   ★★ 微分位移必须**有界**，而且参数**直接就是上界** ★★
    //      见 cloudRecipe.js 的实测记录：只暴露角频率是个陷阱 ——
    //      ω 取小 ⇒ 上界 2·windShear/ω 巨大 ⇒ 云被剪成稀薄的水平细丝；
    //      ω = 0 还会退回**无界**累积（等于把修掉的 bug 重新打开）。
    //      现在参数是 D（急流进退幅度，圈）。代入后 windShear 被约掉：
    //        位移 = windSpeed·t + cos2φ · D · (1 − cos(ω·t)) / 2,  ω = 2·windShear / D
    //      ⇒ **上界恒等于 D**；D = 0 时整项为 0（而不是退化成无界）✓
    //   ⚠️ 不加 "t == 0 就走原路" 的分支：disp = 0 ⇒ uv 逐位不变 ⇒ 结果相同，
    //      而有分支就多一条 CPU/GPU 可能分歧的路径。
    float sinLat = dirRaw.y;
    float cos2phi = 1.0 - 2.0 * sinLat * sinLat;
    float dMax = p2.w;
    float disp = windSpeed * t;
    if (windShear != 0.0 && dMax > 0.0) {
        float omega = 2.0 * windShear / dMax;
        disp += cos2phi * dMax * (1.0 - cos(omega * t)) * 0.5;
    }
    vec3 dir = cfUvToDirection(vec2(uv.x + disp, uv.y));

    vec3 pA = vec3(dir.x * scale, dir.y * scale * stretch, dir.z * scale);
    vec3 base = vec3(dirRaw.x * scale, dirRaw.y * scale * stretch, dirRaw.z * scale);
    float w = t * evolveRate;   // 第 4 维

    // ③ 两级域扭曲，位移场取自**未平流**位置 ⇒ 云滑过固定的湍流场 ⇒ 拉伸/折叠。
    //    ★ t = 0 时 dir 与 dirRaw 相同、w = 0 ⇒ 与静态版逐位相同 ★
    vec3 p = pA;
    if (warp > 0.0) {
        vec3 w1 = cfDomainWarp3D(base, warp, 0.5, seed, w);
        vec3 d1 = w1 - base;
        p += d1;
        if (warpDetail > 0.0) {
            float k = warpDetailScale > 0.0 ? warpDetailScale : 1.0;
            vec3 b2 = (base + d1) * k;
            vec3 w2 = cfDomainWarp3D(b2, warp * warpDetail, 0.9, seed + 61, w);
            p += (w2 - b2) / k;
        }
    }

    // ③ 乘性级联：相乘而不是相加 ⇒ 对数正态 ⇒ 长尾 + 大片近零
    float value = 1.0;
    float freq = 1.0;
    float amp = cascade;
    for (int n = 0; n < ${CLOUD_MAX_OCTAVES}; n++) {
        if (n >= octaves) break;
        float nz = cfNoise4D(vec4(p * freq, w), seed + n * 131);
        value *= 1.0 + amp * nz;
        freq *= lacunarity;
        amp *= gain;
    }

    // ④ 脊线掺入（同为乘性，否则会把长尾重新抹平）
    if (ridge > 0.0) {
        float r = cfRidged3D(p * 0.6, seed + 907, w);
        value *= 1.0 + ridge * (r - 0.5) * 2.0;
    }

    return value > 0.0 ? value : 0.0;
}

/**
 * ④ 生消：低频 4D 噪声调制**局部覆盖率**。
 *
 * 返回的是对 b 的**零均值**增量 ⇒ 全局云量的期望不变，
 * 只是云成片地出现/消散（真实卫星云图里最显眼的那件事）。
 * birthAmount = 0 时恒返回 0 ⇒ 与静态场逐位一致。
 */
float cfBirthDelta(vec2 uv, float t, vec4 p2, vec4 p3, float birthPhase, int seed) {
    float birthScale = p2.z;
    float birthAmount = p3.w;
    if (birthAmount == 0.0) {
        return 0.0;
    }
    vec3 d = cfUvToDirection(uv);
    // ★ 空间相位 ★ —— 见 cloudRecipe.js 文件头「生消的格点停顿」。
    //   birthPhase = 0 时 ph = 0 ⇒ 与旧行为逐位一致（A/B 通路）。
    float ph = birthPhase * cfNoise4D(vec4(d * birthScale, 0.0), seed + 881);
    float nz = cfNoise4D(vec4(d * birthScale, t * p3.z + ph), seed + 4409);
    return nz * birthAmount;
}

/**
 * ★ 纬向气候带倍率 ★（与 cloudRecipe.zoneProfileAt 同式：线性插值）
 * 定义见文件上方 uniform 区的说明。**必须定义在 cfLerp 之后**（GLSL 无函数提升）。
 *
 * ⚠️ 下面三个数与数组长度**同源**（都是 ZONE_POINTS 推出来的），不要写回字面量：
 *    vy·(N−1) 把 uv.y 映射到节点区间，floor 上界 N−2 保证 i0+1 ≤ N−1。
 *    ⇒ 改 ZONE_POINTS 时插值口径跟着走，只有 uZoneProfile 的**长度**需要重链 uniform。
 */
float cfZoneAt(float vy) {
    if (uZoneStrength <= 0.0) {
        return 1.0;
    }
    float t = clamp(vy * ${(ZONE_POINTS - 1).toFixed(1)}, 0.0, ${(ZONE_POINTS - 1).toFixed(1)});
    int i0 = int(min(floor(t), ${(ZONE_POINTS - 2).toFixed(1)}));
    float f = t - float(i0);
    float p = cfLerp(uZoneProfile[i0], uZoneProfile[i0 + 1], f);
    return (1.0 + uZoneStrength * (p - 1.0)) / max(uZoneNorm, 1e-6);
}

/**
 * 把场值换成「这个像素变成云所需的覆盖率」b（= 1 − 面积分位）。
 *
 * 查表在 **log 域**（乘性级联是对数正态，线性域查表会把值全挤进第一格），
 * 插值用 cfLerp（与 JS 的 cloudFieldToB 同式）。
 */
float cfFieldToB(float f) {
    float lv = log(max(f, 1e-12));
    float t = (lv - uCloudLogMin) / uCloudLogSpan;
    t = clamp(t, 0.0, 1.0) * ${(n - 1).toFixed(1)};
    int i0 = int(min(floor(t), ${(n - 2).toFixed(1)}));
    float fr = t - float(i0);
    return 1.0 - cfLerp(uCloudCdf[i0], uCloudCdf[i0 + 1], fr);
}
`;
}
