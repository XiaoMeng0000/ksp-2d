'use strict';

// 云层着色器（GLSL ES 3.00，字符串导出，零构建 / 零网络请求）。
//
// ★★ 几何与坐标约定：**与星球本体完全一致**（这是刻意的，不是偷懒）★★
//
//   §13.47 查明：sphereMesh.js 的三角形环绕方向实际是**顺时针**，
//   在 frontFace(CCW) + cullFace(BACK) 下屏幕上画出来的是**远半球** ——
//   星球本体的光照因此活在一个 z 轴镜像的世界里。
//
//   云层用**同一个网格、同一套剔除状态**渲染，于是它自动落在**同一个镜像世界**里：
//     · 云的 u/v 与地表特征在同一屏幕位置上对齐（云飘在哪个大陆上方是对的）；
//     · 云与地表共用同一个太阳方向（p.sunDir，**不取反**）⇒ 晨昏线一致。
//
//   ⚠️ 只有大气层那一层是特例（它按诚实几何 raymarch，所以要 atmosphereSunDir()
//      把 z 取反）。**云不要照抄大气那一处取反** —— 跟"本体"走才对。
//
// ★★ 光照：**照抄本体的直射光路**，一个字都不简化 ★★
//
//   2026-10-01 总监：「背阴面的云太难看了 又明显又丑」。实测量出来的机理是
//   **两层的光路口径不一致**：
//     · 本体：`lit = albedo × (uSunColor × (ambient + uDiffuse × ndl × sunTint × (1−mF0)))`
//       —— 吃 `sunTint`（阳光穿过大气后的红化与变暗）
//     · 云（改之前）：`lit = uSunColor × ndl + ambient` —— **完全不吃消光**
//   于是地表在晨昏线附近已经变暖、变暗，云却还是中性亮灰；加上云的反照率≈1
//   而海洋只有 ~0.1，云在暗下去的背景上格外扎眼 —— 就是"又明显又丑"。
//
//   ⇒ 本文件把本体那条光路**原样搬过来**（含晨昏线软化坡道与陡化幂），
//     并且**共用同一份真源**：`airMass.js` 的太阳柱积分地表切片 +
//     `solveExtinction` 的系数 + 同一个 `uTerminatorSoft/uTerminatorPow`。
//     两层因此不可能漂移 —— 这正是 §13.41 修掉"本体漏乘 Rp"那类事故的纪律。
//
//   ⚠️ 已知近似（如实记下）：云壳在 1.01 星径，而这张表是**地表（高度 0）**的切片。
//      云所在高度的大气柱略短，所以这里**略微高估**了云的消光。
//      之所以仍然用同一张表：**两层在晨昏线处对齐**比"各自算准"更重要 ——
//      错开一点点，观感上就是"云和地表不在同一个太阳下"，那正是本次要修的病。
//
// ★ 深度测试：关掉（与大气层一致）★
//   远半球的深度比星球本体更远，若开深度测试云会被星球整个挡掉（一片都看不见）。
//   关掉之后云壳覆盖整个盘面 + 壳外那圈环带（Rp 到 Rp·altitude），
//   后者与大气壳的表现同构，是**正确**的：云壳本来就比星球轮廓大一点。
//
// ★ 判据只有一句话 ★
//   cloudMap.png 的 R 通道存的是「该像素变成云所需的覆盖率」b，且 b 在球面上
//   **面积均匀** ⇒ `b <= coverage` 的部分恰好占 coverage 比例的面积。
//   所以下面的 `1 - smoothstep(coverage, coverage+softness, b)` 就是全部阈值逻辑，
//   而参数名 coverage 与它实际控制的云量**一致**（理由见 tools/makeCloudMap.mjs）。

import { SUNCOL_COS_BINS, sunColumnSurfaceGLSL } from '../airMass.js';
import { cloudFieldGLSL, CLOUD_CDF_SIZE } from './cloudFieldGLSL.js';
import { gasGiantCloudGLSL, GG_GLSL_VORTEX_MAX } from './gasGiantCloudGLSL.js';
import { GG_TABLE_POINTS, GG_LAT_STEP } from '../gasGiantBandTables.js';

/** 云层顶点着色器：与星球本体同构 */
export const CLOUD_VERT = `#version 300 es
precision highp float;

in vec3 aPosition;
in vec2 aTexCoord;
in vec3 aNormal;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;

out vec2 vTexCoord;
out vec3 vNormal;
// ★ 本地位置方向（球壳半径 = 1 ⇒ 归一化后就是方向）★
//   气态巨星的**纬度必须由它解析求**：lat = asin(dir.y)。
//   不能用 uv（那是等距圆柱参数，在远半球上不是屏幕位置），
//   也不用 vNormal（要过 normalMatrix，多一层"矩阵恰好是缩放"的假设）。
out vec3 vLocalDir;

void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vTexCoord = aTexCoord;
    vNormal = normalize(uNormalMatrix * aNormal);
    vLocalDir = aPosition;
    gl_Position = uViewProj * world;
}
`;

/** 云层片元着色器 */
export const CLOUD_FRAG = `#version 300 es
precision highp float;

in vec2 vTexCoord;
in vec3 vNormal;
in vec3 vLocalDir;

// ---- 云场：**完全程序化，不采样任何贴图**（2026-10-01 总监定）----
//   场参数打包成几个向量传进来（uniform 数量少、也好统一管理）：
//     P0 = (scale, lacunarity, gain, cascade)
//     P1 = (warp, warpDetail, warpDetailScale, bandStretch)
//     P2 = (ridge, octaves, birthScale, —)     ← octaves 用 float 传，GLSL 里 +0.5 转 int
//     P3 = (windSpeed, windShear, evolveRate, birthAmount)
//   ⚠️ seed 也用 float 传：setUniforms 对标量走 uniform1f，传 int uniform 会静默失配。
//      ⚠️ 且 seed **必须 < 2²⁴**，否则 float32 表示不了、GPU 会算另一个场。
uniform vec4 uFieldP0;
uniform vec4 uFieldP1;
uniform vec4 uFieldP2;
uniform vec4 uFieldP3;
uniform float uFieldSeed;

// 阈值（渲染期参数，改它们不必重算任何东西）
uniform float uCoverage;
uniform float uSoftness;
// 云缘过渡宽度的**屏幕空间下限**（像素）。见下面的 Beer–Lambert 段：
// 光有 softness 不够，坡道会被'b 的屏幕梯度'压成亚像素级 ⇒ 用这一项兜底。
uniform float uEdgePx;
// ★ 体积感两项（见下面的 B/A 段）★ 0 = 关，逐像素退化成"平面贴纸"（零变化通路）
uniform float uSelfShadow;   // B 方向自阴影强度（∂b/∂s 的系数）
uniform float uHeightShade;  // A 高度反照率强度（|∂b/∂s| 的系数）
uniform float uOpacity;
// 光照：与本体共用同一个太阳方向（**不做大气那处 z 取反**）
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uAmbient;
// 自转相位（弧度）。0 = 冻结 —— 所有比对工具都要求"同参数同图"。
// ★ 第 4 维（时间）现在统一走 uCloudTime；冻结时它也是 0 ★
uniform float uCloudTime;
uniform float uSpinAngle;
// 诊断开关：> 0.5 时直接输出 b（灰度），供 CPU↔GPU 逐像素对拍。
// 与 softKnee=0 / detailGrad=0 同类：**0 = normal 路径，逐像素不受影响**。
uniform float uDebugField;

// ---- 与本体共用的晨昏线 / 大气消光口径（**必须与 planetShaders 逐字一致**）----
uniform float uTerminatorSoft;   // 晨昏线艺术软化半角（弧度），0 = 物理口径
uniform float uTerminatorPow;    // 漫反射坡道的幂，1 = 物理口径
uniform float uAtmoEnabled;      // 0 = 关闭（sunTint 恒为 1）
uniform vec3 uAtmoExt;           // 消光系数（每星径）
uniform float uAtmoScaleHeight;  // 标高比 H/Rp（无量纲）
uniform float uSunColumnSurface[${SUNCOL_COS_BINS}];
uniform float uDiffuse;          // 直射强度；**平光模式 = 0**（那时云不该有晨昏线）
uniform float uNightLimbFade;    // 夜面边缘淡出强度（只作用于环境光项）
uniform float uNightLimbFadeWidth;
// 云体反照率的**艺术指定色**（线性域 RGB 乘子）。[1,1,1] = 物理正确的白。
// 逐天体可不同：Eve 紫 / Jool 绿这类配色走这里（与大气「色调」是同一个思路，
// 但含义不同 —— 那是散射源项的颜色，这是**云体本身的反射率**）。
uniform vec3 uCloudColor;

out vec4 fragColor;

const float TWO_PI = 6.28318530717959;

${sunColumnSurfaceGLSL(SUNCOL_COS_BINS)}

${cloudFieldGLSL(CLOUD_CDF_SIZE)}

${gasGiantCloudGLSL(GG_TABLE_POINTS, GG_LAT_STEP, GG_GLSL_VORTEX_MAX)}

void main() {
    vec2 uv = vTexCoord;

    // ---- 自转：绕极轴旋转 == 经度平移 ----
    //   sphereMesh.js 的参数化里 theta = (u - 0.5) * 2pi，即 u 与经度成正比，
    //   所以"转一个相位"就是给 u 加一个常数。
    //   fract 之后仍落在 [0,1] 内 —— 场在 u 方向本来就是无缝的（方向空间噪声），
    //   接缝处不会有跳变。
    //   ⚠️ 加上时间之后，"自转"与"风"在物理上是两回事（一个跟星球走、一个相对星球），
    //      本轮的 uSpinAngle 只是既有接口的延续；第二步会把两者分开。
    if (abs(uSpinAngle) > 1e-6) {
        uv.x = fract(uv.x + uSpinAngle / TWO_PI);
    }

    // ---- 场 → b（「变成云所需的覆盖率」）----
    //   全部程序化：无贴图、无查表图，只有噪声与一张 64 项的 CDF 常量表。
    //   ⚠️ 生消（④）作用在 **b** 上（局部覆盖率），不进场 —— 所以它不影响 CDF，
    //      也不破坏"coverage = 云量比例"这条语义的**期望**（零均值调制）。
    //
    // ★ 气态巨星：采样前先把**噪声场**沿经度剪开（总监定：只剪场，不剪色表）★
    //   放在这里而不是在 gg 装配里重算一次场，是为了省掉一整次场求值（约 +6%）。
    //   剪切的位移剖面只依赖纬度，且是 lat 的纯函数 ⇒ **有界**（不随时间累积）。
    //   ⚠️ uGgEnabled = 0 时 uvField 恒等于 uv ⇒ Kerbin 逐位不变。
    vec2 uvField = uv;
    if (uGgEnabled > 0.5) {
        //   ★★ 纬向急流：**不同纬度的流动方向不同**（总监 2026-10-04）★★
        //     廓线 = 色表的**带符号陡度**（急流住在带界、带中心为零、符号随带交替）。
        //   ⚠️ 与 ggShearUv **相加**而不是替换：剪切是**静态**位移（已标定样子的一部分），
        //      急流是**随时间摆动**的那一项。t = 0 时急流项恒为 0 ⇒ 静帧观感一字不变。
        uvField.x += ggJetDisp(ggLatOf(vLocalDir));
        uvField = ggShearUv(uvField, ggLatOf(vLocalDir));
        //   ★ 涡旋的螺旋位移叠在剪切**之后**（先剪切、后涡旋）★
        //     位移由**真实经纬**算出，且螺旋角在椭圆边界归零 ⇒ 有界、无接缝。
        uvField += ggVortexUvShift(vLocalDir);
    }
    //   ★★ 抗走样：按屏幕导数限制**倍频数**（2026-10-04 总监选"丙"）★★
    //     倍频数本来就是 uniform ⇒ 装配层算好传进去，**共享内核一字不动**
    //     ⇒ Kerbin 的 sha256 基线继续绿（而且 Kerbin 走不到这里：uGgEnabled = 0）。
    //     ⚠️ CDF 是**按配方的倍频数**烘焙的，这里用更少的层 ⇒ b 的分布会略偏
    //        （纹理对比度轻微下降）。这是可接受的代价，但**要量**（见交接文档）。
    vec4 P2eff = uFieldP2;
    if (uGgEnabled > 0.5) {
        P2eff.y = float(ggLodOctaves(cfUvToDirection(uvField), int(uFieldP2.y + 0.5)));
    }
    float f = cfSampleField(uvField, uCloudTime, uFieldP0, uFieldP1, P2eff, uFieldP3,
                            int(uFieldSeed + 0.5));
    //   ★ 减去 uBirthMean（生消的球面平均）★
    //   生消片区比半球还大 ⇒ 不归一化时整颗星球会**同时**进入"晴"相位，
    //   实测云量在 5.16%~16.20% 之间摆（名义 11%，相对 ±50%）。
    //   减掉球面平均后**全局云量的期望精确守恒**，而且物理上更对
    //   （水汽守恒：这边生成 = 那边消散，而不是整球一起变）。
    //   均值在 CPU 侧每帧用 288 个采样点算一次（与像素数无关）。
    float b = cfFieldToB(f) + cfBirthDelta(uv, uCloudTime, uFieldP2, uFieldP3,
                                           uBirthPhase, int(uFieldSeed + 0.5)) - uBirthMean;
    b = clamp(b, 0.0, 1.0);

    // 诊断路径：0 = 正常渲染（逐像素不受影响）
    if (uDebugField > 0.5) {
        fragColor = vec4(vec3(b), 1.0);
        return;
    }

    // ---- ★ A 光学厚度化（2026-10-01）★ ----
    //   改之前是「cloud = 1 − smoothstep(coverage, coverage+softness, b)」—— 一个
    //   **二值阈值**：像素要么是云、要么不是，中间只有 softness(0.005) 宽的细缝。
    //   后果实测：云缘的 α 过渡宽度只有 **1 px**（硬切），看着像剪下来的贴纸。
    //
    //   真实的云不是"在不在"，而是**光学厚度 τ**：
    //     · τ 小 ⇒ 半透明、发灰、能透过去
    //     · τ 大 ⇒ 反射率**饱和**在 ~0.9（多次散射）⇒ 亮白
    //   所以按 Beer–Lambert 写：  α = 1 − exp(−τ)
    //
    //   τ 的定义取「**在 b = coverage 处 α 恰为 0.5**」：
    //       τ = ln2 + (coverage − b) / softness
    //   这样：
    //     · coverage 的语义**原样保住** —— 50% 不透明度等值线仍落在 b = coverage，
    //       与 b ≤ coverage 的判据一致（对拍、形状验收都不用改）
    //     · softness 的含义从"阈值宽度"变成"**τ 下降 1 所需的 b 跨度**"，
    //       即"云缘的光学厚度尺度" —— 这正是它本来就该有的含义
    //     · 云缘自然变成**渐变的半透明过渡**（指数尾巴），不需要靠调大 softness 掩盖
    //
    //   ⚠️ exp 是逐像素的，但比一次噪声便宜两个数量级，可忽略。
    //   ⚠️ 本段在 JS 模板字符串里 ⇒ **注释里绝不能出现反引号**（会截断模板）。
    //
    //   ★★ 但只把阈值换成 Beer–Lambert **还不够**（实测打脸）★★
    //   480×480 下把 softness 从 0.005 提到 0.02（4 倍），云缘 α 的 10%→90%
    //   过渡**仍然只有 1 px**（P25/P75 = 1/1）。
    //   原因不是 softness 不够大，而是 **b 在屏幕空间变化太快**：场的最细结构
    //   在该分辨率下只有约 1.2 px 宽，b 每像素变 ~O(1) ⇒ 无论 softness 取多少，
    //   α 的坡道都是**亚像素级**的。（拉高分辨率也没用 —— 特征尺度与坡道
    //   同比例缩放，比值不变。）
    //   ⇒ 过渡宽度必须**跟着屏幕空间梯度走**：
    //        width = max(softness, uEdgePx · |∇b|)
    //      坡道因此恒为 uEdgePx 个像素左右，**与分辨率无关** ✓
    //   ⚠️ fwidth 必须在**没有任何分支**的地方求值（§13.35：导数不能在非一致控制流里）。
    //      这里紧跟在 b 算出之后、诊断分支之前，是安全的。
    //   ★ 纬向气候带：覆盖率按纬度调制（赤道多云 / 副热带晴 / 风暴带多云）★
    //   zone 已由 CPU 归一化到球面均值 1 ⇒ **全局云量仍精确等于 uCoverage** ✓
    //   ⚠️ 用 vTexCoord.y（纬度）而不是 uv.y —— uv 可能被自转相位平移过，
    //      而气候带必须跟着**纬度**走。
    //
    // =======================================================================
    //  ★★ 两条装配在这里分岔（内核共享、装配分离）★★
    // =======================================================================
    //   条件量是 **uniform**（uGgEnabled）⇒ 分支在整个 draw call 内一致，
    //   所以分支里的 fwidth 是良定义的（§13.35 的导数规则针对的是**非一致**控制流）。
    //   uGgEnabled = 0 时走的是**与改动前逐字相同**的那几行 ⇒ Kerbin 零行为变化。
    float cloud;
    vec3 albedoUse = uCloudColor;
    if (uGgEnabled > 0.5) {
        // ---- 气态巨星：云顶**就是**可见表面 ----
        //   α ≡ 1：参照图上天空从不露出（没有晴区、没有"半透明的云"）。
        //   ⚠️ 若这里改成 1 − exp(−τ)，云顶色就会被下面的**行星本体**污染 ——
        //      本体的颜色是"深层色"，只在将来做"看到多深"时才该透出来。
        if (uGgDebug > 0.5) {
            fragColor = vec4(ggDebugColor(vLocalDir, uv, b, int(uFieldSeed + 0.5)), 1.0);
            return;
        }
        cloud = 1.0;
        // ★★ 涡旋**由云形成**（2026-10-04：总监指出原来像"硬贴上去的"）★★
        //   改之前：c *= 1 + amp·mask(椭圆) —— 乘在**成品颜色**上，与云无关 ⇒ 贴纸。
        //   改之后：把 b（**噪声场 = 云本身**）在椭圆内推高/压低 ⇒「那里的云更厚/更薄」，
        //   亮度差由下面 ggCloudTop 里**已有的**云路径 1 + texAmp·(b−0.5) 自然长出来。
        //   vmask 是椭圆掩膜总量（给"内部纹理增强"用）。
        //   ⚠️ ggVortexApply 返回的是**未缩放的偏置和**（不是改好的 b）—— 因为涡旋要走**两条路**：
        //      ① b 路（让云真的更厚/更薄）② 色差路（不被 texAmp 缩放 ⇒ 各纬度一样强）。
        //      只走 ① 会被 **0.5 × texAmpAt(lat)** 卡死 ⇒ 带中心附近的涡旋完全看不见
        //      （实测 lat −19 是 26/255、lat +35 只有 ≤4/255；总监的原话
        //        「有些漩涡有点小，非常不明显」——「有些」正是这条纬度依赖）。详见 ggCloudTop。
        float vmask = 0.0;
        float vbias = ggVortexApply(vLocalDir, b, vmask);
        albedoUse = ggCloudTop(vLocalDir, b, vmask, vbias, int(uFieldSeed + 0.5));
    } else {
        float covEff = uCoverage * cfZoneAt(vTexCoord.y);
        float grad = max(fwidth(b), 1e-6);
        float width = max(uSoftness, uEdgePx * grad);
        float tau = 0.6931472 + (covEff - b) / max(width, 1e-6);
        cloud = tau > 0.0 ? 1.0 - exp(-tau) : 0.0;
    }

    // ---- ★★ B 自阴影 + A 高度反照率：体积感的分水岭 ★★ ----
    //   改之前：云色 = 纯白 × 球面 N·L —— 云**内部的亮度是常数**，
    //   所以它看着就是一张贴在球上的白色贴纸（总监原话：「涂上去的颜料」）。
    //   真实云的体积感来自**云自己的坡面**，分两半，物理上是两回事：
    //     A) **高度反照率**：云缘的陡坡比顶部暗 —— 与太阳方向无关，
    //        所以**平光模式下也存在**（多次散射的路径效应）
    //     B) **方向自阴影**：朝太阳的坡面亮、背向的暗 —— 乘 uDiffuse，
    //        平光模式下自动消失（与「平光模式下云不该有晨昏线」同一条约定）
    //
    //   ★ 两者只需要**同一个标量**：b 沿太阳切向的方向导数
    //         slope = ∂b/∂s      （s = 球面上朝太阳的方向，单位：弧度）
    //     物理依据：云的厚度 h 随 b **单调递减**（b 越小云越厚），
    //     故 ∂h/∂s ∝ −slope ⇒ **坡面法线朝太阳偏 ⟺ slope > 0 ⇒ 更亮** ✓
    //     A 需要的"陡不陡"就是 |slope| ⇒ 同一个采样，**一次额外的场求值**搞定两半。
    //
    //   成本：+1 次场求值（原 16 次 ⇒ +6%）。uSelfShadow 与 uHeightShade 都为 0
    //   时整段跳过，逐像素不受影响（零变化通路）。
    //
    //   eps 取 0.05 rad（≈3°）：场的可分辨下限约 0.008 rad，取得更大是为了量
    //   **宏观坡面**而不是噪声（顺带防走样）。
    float slope = 0.0;
    if (uSelfShadow > 0.0 || uHeightShade > 0.0) {
        const float EPS = 0.05;
        // ⚠️ 本段在「直射光」那一段**之前**（要先用 slope 才能算 shade），
        //    所以不能引用那里的 L —— 自己取一次。实测踩过：用 L 会编译失败。
        vec3 Lsun = normalize(uSunDir);
        vec3 dirC = cfUvToDirection(uv);
        vec3 Lt = Lsun - dirC * dot(dirC, Lsun);   // 太阳方向在切平面上的分量
        float ltLen = length(Lt);
        if (ltLen > 1e-4) {
            vec3 sHat = Lt / ltLen;
            // 切平面基（东、北）：由 cfUvToDirection 的解析导数归一化而来
            float th = (uv.x - 0.5) * 6.28318530717959;
            float la = (uv.y - 0.5) * 3.14159265358979;
            vec3 east = vec3(cos(th), 0.0, -sin(th));
            vec3 north = vec3(-sin(la) * sin(th), cos(la), -sin(la) * cos(th));
            // 1 弧度东移 ⇒ Δu = 1/(2π)；1 弧度北移 ⇒ Δv = 1/π
            vec2 stepUv = vec2(dot(sHat, east) * EPS / 6.28318530717959,
                               dot(sHat, north) * EPS / 3.14159265358979);
            int sd = int(uFieldSeed + 0.5);
            float bSun = cfFieldToB(cfSampleField(uv + stepUv, uCloudTime,
                                  uFieldP0, uFieldP1, uFieldP2, uFieldP3, sd))
                       + cfBirthDelta(uv + stepUv, uCloudTime, uFieldP2, uFieldP3, uBirthPhase, sd);
            slope = (clamp(bSun, 0.0, 1.0) - b) / EPS;
        }
    }
    // B：方向自阴影 —— 乘 uDiffuse（见上）
    float selfShade = clamp(1.0 + uSelfShadow * slope, 0.0, 2.0);
    // A：高度反照率 —— 与光照方向无关，平光模式下也保留
    float heightAlb = 1.0 - uHeightShade * min(abs(slope), 2.0) * 0.5;

    // ---- 直射光：与 planetShaders 的 main 同一段逻辑 ----
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDir);
    float ndlRaw = dot(N, L);
    float ndl = max(ndlRaw, 0.0);

    // 晨昏线艺术软化：在 ndlRaw ∈ [−s, +s] 内用抛物线接上（两端一阶连续）。
    // ⚠️ 必须与本体用**同一个 s**，否则两层的晨昏线会错开 —— 见文件头。
    if (uTerminatorSoft > 1e-6) {
        float s = uTerminatorSoft;
        if (ndlRaw >= s) {
            ndl = ndlRaw;
        } else if (ndlRaw <= -s) {
            ndl = 0.0;
        } else {
            ndl = (ndlRaw + s) * (ndlRaw + s) / (4.0 * s);
        }
    }

    // 陡化只作用于漫反射坡道；红化仍走陡化之前的坡道（与本体一致）
    float ndlRed = ndl;
    if (uTerminatorPow != 1.0) {
        ndl = pow(ndl, uTerminatorPow);
    }
    float cosZ = (uTerminatorSoft > 1e-6) ? ndlRed : ndlRaw;

    // ---- 阳光穿过大气后的颜色（日落红 + 变暗）----
    //   ★★ 这就是"背阴面云太明显"的修复点 ★★
    //   改之前云不吃这一项，于是地表暖下去、暗下去时云还是中性亮灰。
    //   现在两层共用同一张表、同一个式子 ⇒ 云随地表一起红化、一起变暗，
    //   过了晨昏线由 step(0, cosZ) 直接归零 ⇒ 夜面云不可见（物理正确）。
    vec3 sunTint = vec3(1.0);
    if (uAtmoEnabled > 0.5) {
        float airMass = surfaceAirMass(cosZ);
        sunTint = exp(-uAtmoExt * uAtmoScaleHeight * airMass) * step(0.0, cosZ);
    }

    // ---- 合成：与本体**同一个式子**（本体取 albedo=1、mF0=0 即得此式）----
    //   ⚠️ uDiffuse 这一项不能省：平光参照模式（ambient=1 / diffuse=0）下本体
    //      是均匀受光的，而云若仍乘 ndl 就会**凭空长出一条晨昏线** ——
    //      那正是"背阴面的云又明显又丑"的另一半来源。
    //   ⚠️ 夜面边缘淡出（uNightLimbFade）只作用于环境光项，且由 uDiffuse 门控，
    //      与本体逐字一致；本体与云因此不会在临边处出现亮度台阶。
    float ambientUse = uAmbient;
    if (uDiffuse > 1e-5 && uNightLimbFade > 0.0) {
        float noV = clamp(dot(N, vec3(0.0, 0.0, -1.0)), 0.0, 1.0);
        ambientUse = uAmbient * mix(1.0, smoothstep(0.0, uNightLimbFadeWidth, noV), uNightLimbFade);
    }
    // 云体反照率：Kerbin 走 uCloudColor（[1,1,1] = 物理正确的白）；
    // 气态巨星走逐纬度色表 × 乘性纹理（见上面那条分岔）。
    // ⚠️ 它乘在**整项**上（含环境光）⇒ 夜面云仍是黑的，**不会发光**；
    //    这一点与"给云加自发光"是两回事，后者会把夜面糊亮。
    vec3 lit = albedoUse * heightAlb * uSunColor
             * (ambientUse + uDiffuse * ndl * sunTint * selfShade);

    fragColor = vec4(lit, cloud * uOpacity);
}
`;
