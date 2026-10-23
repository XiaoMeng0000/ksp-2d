'use strict';

// 星球渲染相关的 GLSL ES 3.00 着色器源码（以字符串导出，零构建、零网络请求）。
//
// 之所以不放在独立的 .glsl 文件里用 fetch 加载：原型要求零构建、零第三方依赖，
// 字符串常量可以被 import 直接引用，且仍然按逻辑分组，迁移时整文件搬走即可。
//
// 程序级 `#define` 由 createProgram 的 prefix 注入，因此两个顶点着色器
// 可以共用同一份片元着色器源码。

// ★ 大气光程（空气质量）的唯一真源 ★
//   2026-10-02：由 src/planet/airMass.js 的**二维太阳柱积分表**提供地表切片，
//   取代了原来的经验式 `(1+f)/max(f, cosZ+f)` —— 那是个在掠射端高估 244% 的
//   猜测式，还把"日落红强度 / 临边亮度 / 晨昏线硬度"三件事塞进了同一个滑块。
//   与大气散射层共用同一张表 ⇒ 两层的日落红口径不可能漂移。
import { SUNCOL_COS_BINS, sunColumnSurfaceGLSL } from '../airMass.js';

/**
 * 星球顶点着色器。
 * 宏：
 *   USE_POSITION_ATTR  几何自带位置（正确路径，网格渲染用）
 *   USE_POSITION_UNIFORM  由 uniform 提供 NDC 位置（全屏三角形用，location 0 当作 uv）
 */
export const PLANET_VERT = `#version 300 es
precision highp float;

#if defined(USE_POSITION_ATTR)
in vec3 aPosition;
in vec2 aTexCoord;
in vec3 aNormal;
#else
in vec2 aPosition2D;
#endif

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;

out vec2 vTexCoord;
out vec3 vNormal;
out vec3 vWorldPos;
// ★ 切平面基（世界空间）★ —— 波浪法线扰动需要它。
//   为什么在顶点算：球面是 UV 球，切向有**解析式**，不需要额外的顶点属性，
//   也不必在片元里从法线反推（那要在片元里知道世界空间的极轴，而 tilt/spin 会旋转它）。
//   物体空间（sphereMesh.js 的参数化）：
//     N = (cosLat·sinθ, sinLat, cosLat·cosθ)，θ = (u − 0.5)·2π
//     ∂P/∂u ∝ (cosθ, 0, −sinθ)                    ← 只依赖 u，处处单位长（无奇点）
//     ∂P/∂v ∝ (−sinLat·sinθ, cosLat, −sinLat·cosθ) = cross(N, ∂P/∂u)
out vec3 vTangent;
out vec3 vBitangent;

void main() {
#if defined(USE_POSITION_ATTR)
    vec4 world = uModel * vec4(aPosition, 1.0);
    vTexCoord = aTexCoord;
    vNormal = normalize(uNormalMatrix * aNormal);
    float thetaT = (aTexCoord.x - 0.5) * 6.28318530717959;
    vec3 tObj = vec3(cos(thetaT), 0.0, -sin(thetaT));
    vec3 bObj = cross(aNormal, tObj);
    vTangent = normalize(uNormalMatrix * tObj);
    vBitangent = normalize(uNormalMatrix * bObj);
#else
    // 全屏三角形：位置直接是 NDC，uv 走 location 0 的第二分量（由 JS 侧构造）
    vec4 world = vec4(0.0, 0.0, 0.0, 1.0);
    vTexCoord = aPosition2D;
    vNormal = vec3(0.0, 0.0, 1.0);
    vTangent = vec3(1.0, 0.0, 0.0);
    vBitangent = vec3(0.0, 1.0, 0.0);
#endif
    vWorldPos = world.xyz;
    gl_Position = uViewProj * world;
}
`;

/**
 * 星球片元着色器。
 *
 * 光照用途说明：实测原图接近平光、无方向性光照（见交接文档 §4.5），
 * 所以这里的方向光 + 环境光 + 径向边缘压暗只是「可选的整体观感项」，
 * 默认关闭（sunDir 指向相机、diffuse=0、edgeDarkening=0），以便与源图逐像素对比。
 *
 * ★ 细节层（抗平铺三件套）★
 *   细节纹理是**单通道打包的三层**（见 tools/bakePlanet.mjs 的 bakeDetailTile）：
 *     R = 细颗粒（高频）   G = 粗颗粒（中频）   B = 扭曲场（低频）
 *   三层都来自 4D 环面噪声 → 严格无缝可平铺。
 *
 *   为什么需要"抗平铺"：贴图是死的，重复必然露馅。三条措施叠加使用：
 *     ① **域扭曲**：用 B 通道把采样坐标整体偏移（warpAmount 个纹理周期）。
 *        这一条最有效 —— 它把规则的平铺网格揉成不规则形状，肉眼无法锁定网格。
 *     ② **多尺度叠加**：细颗粒用 scale，粗颗粒用 scale×2.37（无理数比）。
 *        两层周期的最小公倍数极大，实际不可见。
 *     ③ **逐群系强度/尺度**：从群系索引图查 detailStrength / detailScale，
 *        月海细而弱、环形山粗而强 —— 相邻群系用不同平铺参数，进一步打散规律性。
 *
 *   注意 uDetail 必须用 REPEAT 环绕，且细节强度为 0 时整段会被跳过（省采样）。
 */
export const PLANET_FRAG = `#version 300 es
precision highp float;

in vec2 vTexCoord;
in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vTangent;
in vec3 vBitangent;

uniform sampler2D uAlbedo;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uAmbient;
uniform float uDiffuse;
// ---- 大气对直射光的红化（日落红的地表部分）----
// 阳光斜穿大气时蓝光被散射殆尽、只剩红光到达地面 —— 这是日出日落颜色的主体。
// 大气散射层只管"空中那层光"，**地面的红必须在这里补**，否则晨昏线附近的地表仍是白的：
// 盘中央的晨昏线视线是垂直穿大气、路径短，那里本来就以地表为主。
uniform float uAtmoEnabled;      // 0 = 关闭（历史口径，sunTint 恒为 1）
uniform vec3 uAtmoExt;           // 消光系数 RGB（Rayleigh + Mie + 吸收），与大气层同一份口径
uniform float uAtmoScaleHeight;  // ★ 标高比 H/R（**无量纲**，不是世界单位）★
//   ⚠️⚠️ 2026-10-02 修正：这里曾经叫 uAtmoScaleHeightWorld，传的是 scaleHeight × Rp。
//      那是把量纲判反了 —— solveExtinction 的 β 是"每星径"的量
//      （判据见 atmosphereSpecies.solveScatterOpticalDepth：β × H/R 才是无量纲光深），
//      所以指数 βExt × (H/R) × airMass 本来就无量纲。乘 Rp 之后大气厚度被绑到了
//      世界尺寸上 ⇒ **画面随视口高度变化**，而且与大气层那侧差一个 Rp
//      （§13.41 当时把它当成"漏乘 Rp"去修，实验室 Rp≈0.98 只差 2% 看不出来，
//        但 512×480 的离屏量测 Rp=0.5 差了整整一倍）。
// ★ 地表空气质量查表（天顶恒为 1）★
//   来源 = airMass.js 的二维太阳柱积分表的**地表那一行** —— 与大气散射层同源。
//   取代了旧的 uAirMassFloor 经验式：那条曲线在掠射端偏高 244%
//   （本项目几何下地平线真值 11.05、经验式 38.04），把红光也一并饿死，
//   是"暮光带又窄又硬"的直接来源之一。该滑块已随物理量一起退役。
uniform float uSunColumnSurface[${SUNCOL_COS_BINS}];
// ★ 晨昏线艺术软化：半角（**弧度**）。0 = 物理口径（硬晨昏线，逐像素一致）。
//   ⚠️ 面板默认已由 6° 调到 **18.5°**（2026-10-02 总监亲手调定，与 kerbin 标高
//      0.013→0.008 配对：后者把暮光带宽收窄 22%，本项把视觉过渡补回来）。
//   这是**有意的非物理夸张** —— 真实行星晨昏线就是硬的（见 main 里的说明）。
uniform float uTerminatorSoft;
// ★ 晨昏线陡化：漫反射坡道 N·L 的幂（**1 = 物理口径 = 逐位不变**）★
//   与 uTerminatorSoft 方向相反（软化的反面是"更利"），做法与代价见 main 里的说明。
//   ⚠️ 只作用于漫反射的几何坡道；红化与镜面高光仍走真实 N·L。
uniform float uTerminatorPow;
// ★ 夜面边缘淡出（0 = 关闭 = 逐位一致；1 = 临边完全淡出）★
//   见 main 里的说明：让夜面补光在掠射处归零，消除行星暗面的硬边剪影。
uniform float uNightLimbFade;
uniform float uNightLimbFadeWidth;  // 淡出宽度（NoV 从 0 到该值完全淡出）
uniform float uEdgeDarkening;

// ---- 细节层 ----
uniform sampler2D uDetail;      // R 细 / G 粗 / B 扭曲场
uniform sampler2D uBiome;       // R 通道 = 群系下标
uniform float uDetailTiles;     // 细节贴图横跨整颗星球几次
uniform float uWarpAmount;      // 域扭曲强度（纹理周期数）
uniform float uCoarseWeight;    // 粗颗粒权重
uniform float uDetailEnabled;   // 0 = 关闭（省 3 次采样）
uniform vec2 uDetailAtlas;      // 图集网格 (列, 行)；1×1 = 单张图，2×2 = 4 群系图集
const int MAX_BIOMES = 8;
uniform float uBiomeDetailStrength[MAX_BIOMES];
uniform float uBiomeDetailScale[MAX_BIOMES];
// ---- 地表材质的光学层（逐群系）----
// 语义与默认值见 src/planet/materials.js。⚠️ **两个数组默认全为"无镜面"**
// （f0=0 / rough=1）⇒ 未声明材质时逐像素退回纯 Lambert，零行为变化。
uniform float uBiomeF0[MAX_BIOMES];      // F0 垂直入射反射率
uniform float uBiomeRough[MAX_BIOMES];   // 微表面粗糙度
// 太阳视半径（弧度）。0 = 当作点光源（历史口径）。
// 见 src/planet/sun.js —— 镜面高光不是"一个点"，而是**太阳的像**。
uniform float uSunAngularRadius;
// ---- 波浪法线扰动（逐群系，程序化）----
// 单位是**法线扰动的 RMS 角度（弧度）**，不是"振幅"也不是"强度"。
// 为什么直接给角度：它同时是几何扰动的幅度、又是要并进 α_eff 的**方差** ——
// 一个量两处直接用，不存在"参数改了但方差没跟着改"的脱节。
uniform float uBiomeWaveDeg[MAX_BIOMES];
uniform float uBiomeWaveScale[MAX_BIOMES];  // 横跨整颗星球的波浪周期数
uniform float uWaveTime;                    // 相位时间（秒，由 render(dt) 累加）
// ---- 地表起伏：切空间法线图（卡2，2026-10-17）----
// uNormalMap      : 法线图（与 albedo 同投影同尺寸，row 0 = 北极，切空间单位法线）
// uNormalStrength : 全局强度旋钮。**0 = 关闭（默认）**，整段分支跳过 ⇒ 逐像素与接图之前一致。
//                   ⚠️ 语义：1.0 = 该天体 p95 坡度达 45°（卡1 的 K 归一化口径）；
//                   实际生效强度还要**乘**逐群系比例 uBiomeRelief[群系下标]。
// uBiomeRelief    : 逐群系比例（0~1，数据驱动，见 src/config/biomeRelief.js）。
//                   **水群系恒 0** —— 水面不长山，继续只走下面的程序化波浪。
uniform sampler2D uNormalMap;
uniform float uNormalStrength;
uniform float uBiomeRelief[MAX_BIOMES];
// ---- 大气对镜面高光的作用（散射把太阳的像抹开并摊成光晕）----
// uAtmoScatterOd = 垂直方向的**散射光深** (β_R + β_M)·H（标量，取三通道均值）。
// 用散射光深而不是气溶胶光深：Kerbin 配方里 mie = 0（无气溶胶），
// 用 Mie 会让这一项对 Kerbin 恒等于 0 —— 分子散射同样会把高光抹开。
uniform float uAtmoScatterOd;
uniform float uGlintBlurK;      // 被散射的比例 = 1 − exp(−K · τ_sca · airMass)
uniform float uGlintHaloWidth;  // 光晕叶瓣的宽度倍数（相对锐利叶瓣）

// ---- ★ 第三卷：云影（512×256 等距柱状图，默认关）★ ----
//   uCloudShadowOn      0 = 关闭（**逐像素等于加这个特性之前**）
//   uCloudShadowTex     云影图：R = shade = 1 − exp(−τ_total)（竖直穿过各层云壳的光学厚度）
//   uCloudShadowStrength 影的强度（0 = 无影，1 = 完全遮挡直射光）
//   uCloudShadowAlt     云壳半径（R/Rp，与 clouds.altitude 同值）—— 视差偏移量由它决定
//   uSunDirLocal        太阳方向在**网格本地坐标系**里（与 vTexCoord 的经纬参数化同一个系）
//                       CPU 侧用模型矩阵的旋转部分转置得到（见 meshRenderer 的注释）
uniform float uCloudShadowOn;
uniform sampler2D uCloudShadowTex;
uniform float uCloudShadowStrength;
uniform float uCloudShadowAlt;
uniform vec3 uSunDirLocal;
// 视差系数：1 = 真实（按太阳方向穿到云壳的交点查图，影子与云错位），
// 0 = 影子直接落在云正下方（**只用于量"错位幅度"的对照**：两帧之差就是视差位移）。
uniform float uCloudShadowParallax;

// ---- 编辑预览：特征场（由 CPU 用 tools/shapeOps.mjs 烘焙后上传）----
// R = albedo 增量（0.5 为中性），G = 高度增量（0.5 为中性）
// 为什么走纹理而不是在着色器里求值：预览必须与烘焙**共用同一份形状函数**
// （任务书最高优先级的约束），而形状函数是 JS 写的。CPU 烘焙 → 上传 → 采样，
// 两边数学完全一致，避免"预览好看、烘焙变样"。
uniform sampler2D uFeature;
uniform float uFeatureEnabled;
uniform float uFeatureShading;  // 特征高度对明暗的贡献强度

// ---- 诊断开关（A/B 对照用）----
// uDetailLatStretch：u 方向是否按 cos(λ) 收窄。**默认 0（关闭）** ——
//   它虽然能压极地放射纹，但会改变镜像边界的映射，在 u=0.5 处制造一条
//   球面可见的分界线（实测 c399 ×3.9，可复现）。详见 poleTileScale 的注释。
uniform float uDetailLatStretch;
// uDetailUWrap：u 方向平铺方式（1 = fract 直接平铺，0 = 三角波镜像）。
//   同样默认 0：改成 fract 也会引入分界线（实测 c399 ×2.32）。
uniform float uDetailUWrap;
// uDetailPoleFade：极区淡出宽度（v 单位），0 = 关闭。
//   这是**不改变坐标映射**的极地修法，与上面两个开关相互独立。
uniform float uDetailPoleFade;
// uDetailSingleCell：图集是否只用第 0 格（1 = 单格，0 = 2×2 各用一格，**默认 0**）。
//   单格模式能消掉 u=0.5 处的分界线（实测列间差 ratio 2.33 → 1.52），
//   代价是四格共用同一张纹理 —— 详见 sampleDetail 的注释。
uniform float uDetailSingleCell;
// uDetailGrad：细节采样方式。
//   0 = 硬件隐式导数（**默认**，原始行为）
//   1 = textureGrad + 按 uv 侧符号补偿导数（修折返处的 LOD 不一致）
//   2 = 1 + **光滑折返**：折叠函数由 2·|fract(s)−0.5| 换成 cos² 型，
//       使 ∂tiled/∂s 在折返点连续地过零（不再是 +2 → −2 的尖角）
//   3 = 只用光滑折返，仍走硬件隐式导数（用于分离两个因素各自的作用）
//
//   起因见交接文档 §13.23：u=0.5 那条贯穿南北极的分界线，四个假说
//   （纹理边缘不匹配 / 镜像折返 / 图集格边界 / 采样开关）全部被否证，
//   最后用"把纹理放大到接近 1:1、mipmap 不参与时线消失"锁定在**过滤/LOD** 层。
//   机制：折返点让 u 方向导数从 +2 翻到 −2，硬件两侧选出的 LOD 与
//   各向异性方向不一致 ⇒ 一条可见的线。
uniform float uDetailGrad;

out vec4 outColor;

const float PI = 3.141592653589793;

/**
 * sRGB → 线性光。
 *
 * albedo / 细节层纹理是**美术按 sRGB 画的**，采样得到的是 sRGB 数值，
 * 必须解码成线性再参与光照与大气消光计算 —— 否则"消光"作用在 sRGB 数值上，
 * 量纲是错的：暗部被系统性高估、亮部被低估，晨昏线附近的颜色与渐变都会偏。
 *
 * ⚠️ 群系图 / 特征场是**数据**不是颜色，绝不能解码。
 * ⚠️ 输出侧**不需要**编码：本程序写的是 SRGB8 离屏目标，硬件自动编码。
 *    这条也是"画布上看到的"与"离屏量到的"能对上的前提 —— 两条路径都先渲到
 *    同一种目标，只有最后铺屏那一步做编码（见 meshRenderer 的 render()）。
 */
vec3 srgbToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(vec3(0.04045), c));
}
${sunColumnSurfaceGLSL(SUNCOL_COS_BINS)}

/**
 * 从细节图集里取某个群系的子图。
 * 图集按行主序排列：群系 0 在左上，1 在右上，2 在左下，3 在右下（2×2 时）。
 * 为什么用图集而不是逐群系单独纹理：一次绑定、一次采样开销，
 * 且平铺倍数与扭曲对所有群系一致，不会出现层间错位。
 *
 * ★ u 方向用「直接平铺」，v 方向用「镜像」 ★
 *   最初两个方向都用三角波（ping-pong）镜像：local = 2·|fract(uv) − 0.5|，
 *   理由是想让非无缝贴图在边界处不出现半纹素断层。
 *   **这个判断对颗粒纹理是错的**：颗粒的亮斑/暗斑互相独立，
 *   直接平铺时接缝处只是"下一个颗粒"，肉眼无从分辨；
 *   而镜像在**每一格边界**强行制造一个转折 —— 把原本不相邻的
 *   左右边缘并排放，实测两者相关系数 r = −0.067（完全无关）。
 *
 *   ⚠️ 但实测（tools/findSphereSeam.js）证明：把 u 从镜像改成 fract，
 *      反而在 u=0.5 处**引入**了一条球面可见的分界线（c399 ×2.32）。
 *      所以当前**两个方向都用镜像**（uDetailUWrap = 0），
 *      这是唯一实测无分界线的组合。要改必须先跑分界面检查。
 *
 *   ⚠️ 同样地，一度为了修极地放射纹而把 u 乘以 cos(λ)，
 *      那一项也在 u=0.5 处引入了分界线（c399 ×3.9）。
 *      极地问题改用**不改坐标映射**的极区淡出（uDetailPoleFade）。
 *
 * ★ 单格模式（uDetailSingleCell）★
 *   把 "+ cell/atlas" 那一项去掉，local 始终落在第 0 格，即全部群系共用同一张细节纹理。
 *
 *   为什么需要它（实测依据，tools/findSphereSeamLines.mjs + measureAtlasSeamCost.mjs）：
 *     镜像折返把相邻两格的边缘硬接在一起。而四张纹理都不是无缝的 ——
 *     逐行/逐列 RMS 差是格内基线的 **1.74~2.45 倍**（所有两两组合都差不多，
 *     所以**重排图集格位没用**）。于是每条落在格边界上的折返都暴露成一道缝。
 *     实测（相机正对 u=0.5）：最强列间差 ratio **2.33**；
 *     改成单格模式后降到 **1.52**，那条缝消失。
 *
 *   代价：四格共用同一张纹理（此处为 mare 的）。群系差异**仍然保留** ——
 *     detailStrength / detailScale 是按格查的逐群系参数，与取哪一格无关。
 *     也就是说只有"颗粒的质感"统一了，"颗粒的强弱与粗细"仍逐群系不同。
 *
 *   开关默认**关**（0 = 保持原有 2×2 图集行为），以免静默改变既有外观。
 */
/**
 * 折叠函数：s → tiled。
 *
 * 两种折返：
 *   · 尖角（原始）：tiled = 2·|fract(s) − 0.5|，∂tiled/∂s 在折返点由 +2 跳到 −2
 *     —— **导数不连续**。硬件按屏幕导数选 LOD，两侧因此不一致 ⇒ 可见的线（§13.23）。
 *   · 光滑（uDetailGrad >= 2）：用 cos² 型，tiled = 1 − 4·f·(1−f)（f = fract(s)）
 *     在 f=0 与 f=1 处 1 − 4f(1−f) 都等于 1，∂/∂f = 4 − 8f 在两端分别 +4 / −4，
 *     且折返处 f 折回 0、导数连续 ⇒ **∂tiled/∂s 在折返点连续地由正变负**，
 *     经过零点而不是跳变。LOD 因此连续。
 *
 *   ⚠️ 光滑版的代价：映射变为非线性 ⇒ 同一周期内颗粒疏密不均
 *      （靠近折返处密、中间疏），观感会变，需重跑颗粒度标定。
 */
float foldU(float s) {
    float f = fract(s);
    if (uDetailGrad >= 1.5) {
        return 1.0 - 4.0 * f * (1.0 - f);
    }
    return 2.0 * abs(f - 0.5);
}
float foldV(float s) {
    float f = fract(s);
    if (uDetailGrad >= 1.5) {
        return 1.0 - 4.0 * f * (1.0 - f);
    }
    return 2.0 * abs(f - 0.5);
}

/**
 * 细节采样（原始版）。纹理坐标走 foldU/foldV，u 方向可切换 fract 平铺。
 */
vec4 sampleDetail(vec2 uv, int biomeId, vec2 atlas) {
    vec2 cell = vec2(mod(float(biomeId), atlas.x), floor(float(biomeId) / atlas.x));
    // u：可切换（fract 直接平铺 / 折叠）；v：始终折叠
    float tu = uDetailUWrap > 0.5 ? fract(uv.x) : foldU(uv.x);
    vec2 tiled = vec2(tu, foldV(uv.y));
    // 单格模式下 cell 归零 → local 永远落在第 0 格，镜像折返不再跨越格边界
    if (uDetailSingleCell > 0.5) {
        cell = vec2(0.0, 0.0);
    }
    vec2 local = tiled / atlas + cell / atlas;
    return texture(uDetail, local);
}

/**
 * 细节采样（显式喂导数版本）。设备无关 —— 不用 dFdx，导数由调用方链式算出；
 * 导数接近 0 时退回 texture()。
 *
 * @param vec2 uv      纹理坐标（未折叠）
 * @param int biomeId  群系下标
 * @param vec2 atlas   图集网格
 * @param vec2 ddx     ∂uv/∂screen_x
 * @param vec2 ddy     ∂uv/∂screen_y
 * @return vec4 采样值
 *
 * ★ 按"纹理坐标侧的单调段"翻转导数符号 ★
 *   尖角折返让 ∂tiled/∂s 由 +2 翻成 −2。硬件两侧选出的 LOD 与各向异性方向
 *   因此不一致，表现为一条可见的线（§13.23）。
 *   修法：令 S = (∂s/∂x < 0) ? −1 : +1，把导数翻回同一方向再交给 textureGrad。
 *
 *   ⚠️ 为什么不是"对 dFdx(local) 取 abs"：
 *      dFdx(local) **本身已含**折返的符号翻转，两侧的 |dFdx| 本来就相等，
 *      取 abs 等于什么都没做。必须按 uv 侧的符号判断。
 *
 *   ⚠️ 符号补偿只解决"两侧方向不一致"，不解决"折返处导数是尖角"。
 *      后者要用 uDetailGrad >= 2 的光滑折返（见 foldU/foldV）。
 */
vec4 sampleDetailGrad(vec2 uv, int biomeId, vec2 atlas, vec2 ddx, vec2 ddy) {
    if (uDetailGrad < 0.5 || (dot(ddx, ddx) + dot(ddy, ddy)) < 1e-12) {
        return sampleDetail(uv, biomeId, atlas);
    }
    // u 侧符号翻转（v 侧同理）
    vec2 dx = vec2(ddx.x < 0.0 ? -ddx.x : ddx.x, ddx.y < 0.0 ? -ddx.y : ddx.y);
    vec2 dy = vec2(ddy.x < 0.0 ? -ddy.x : ddy.x, ddy.y < 0.0 ? -ddy.y : ddy.y);
    vec2 cell = vec2(mod(float(biomeId), atlas.x), floor(float(biomeId) / atlas.x));
    if (uDetailSingleCell > 0.5) {
        cell = vec2(0.0, 0.0);
    }
    // 折叠（与 sampleDetail 同一套规则），导数同步缩放 1/atlas
    float tu = uDetailUWrap > 0.5 ? fract(uv.x) : foldU(uv.x);
    vec2 tiled = vec2(tu, foldV(uv.y));
    vec2 local = tiled / atlas + cell / atlas;
    return textureGrad(uDetail, local, dx / atlas, dy / atlas);
}

/**
 * 把 uv 映射到平铺坐标（与 sampleDetail 同一套规则），供域扭曲复用。
 * @param vec2 uv 已含经度收窄后的坐标
 * @return 平铺坐标
 */
vec2 tileUv(vec2 uv) {
    float tu = uDetailUWrap > 0.5 ? fract(uv.x) : (2.0 * abs(fract(uv.x) - 0.5));
    return vec2(tu, 2.0 * abs(fract(uv.y) - 0.5));
}

/**
 * u 方向平铺密度的纬度修正：cos(λ)，下限 1/12（避免极区完全退化）。
 * @param float v 纬度参数（0 = 南极，1 = 北极）
 * @return 修正系数
 *
 * ⚠️ 默认关闭（uDetailLatStretch = 0）★
 *   这一项是为了修极地放射纹加的，但它**引入了更严重的问题**：
 *   把 u 收窄之后，镜像/平铺边界的映射随之改变，在 u=0.5 处出现一条
 *   可见的竖直分界线（实测球面渲染列 399、缝/基线 ×3.9，且完全可复现）。
 *   对照实验（tools/findSphereSeam.js，三种配置各测 3 次读数一致）：
 *       收窄0 + 镜像u（原始）  → 无分界线
 *       收窄1 + 镜像u          → c399 ×3.9
 *       收窄0 + fract u        → c399 ×2.32
 *       收窄1 + fract u        → c399 ×3.62
 *   结论：分界线是这两项修改引入的回归，不是细节纹理的问题。
 *   极地放射纹得换一种不改变坐标映射的修法（例如只做极区淡出）。
 */
float poleTileScale(float v) {
    if (uDetailLatStretch < 0.5) {
        return 1.0;
    }
    float lat = (v - 0.5) * PI;
    return max(cos(lat), 1.0 / 12.0);
}

// ★★ 地表材质的微表面 BRDF（GGX + Schlick Fresnel + Smith）★★
//
// 为什么是这一套而不是 Blinn-Phong（2026-09-27 与总监定下）：
//   · Fresnel 反正要做（水面 Plan A 就要求它）—— 有了它改成 GGX 只多两行数学；
//   · 与"大气那次物理基本正确、不对标参照图"的取向一致。
//
// ⚠️ 光照式里直射项要乘 (1 − F) 做**能量守恒**：镜面反射掉的能量不能再算进漫反射，
//    否则总能量凭空增加、整颗星球变亮（会直接破坏既有回归基线与 M5 对比）。
//    F 很小时 (1−F)≈1，所以**未声明材质时与历史口径代数等价**（见 main 的写法）。
//
// ⚠️ 视线方向 V 是**常量** (0,0,-1)：相机正交投影，不随像素变。
//    符号依据：实测「朝相机」是 z 的**负**方向（见 meshRenderer 的 sunDir 约定）。

/** GGX / Trowbridge-Reitz 法线分布。a = 粗糙度²
 *
 * ⚠️⚠️ 分母的下限**必须非常小**（2026-09-27 实测踩到）★
 *   原来写成 max(PI * d * d, 1e-7)。看着像个无害的防除零，实际是**致命**的：
 *   镜面越锐利，峰值 D 越大。本项目的 rough=0.02 ⇒ a = 4e-4 ⇒ a2 = 1.6e-7，
 *   峰值处 d = a2 = 1.6e-7 ⇒ π·d² = 8.0e-14 —— **比那个下限小 6 个数量级**。
 *   于是 max() 把分母钉在 1e-7，D 从应有的 1.99e6 掉到 1.6。
 *   再乘以 F≈0.02、NoL≈0.74，高光只剩 0.011 —— 在 0~255 的图上**完全看不见**，
 *   而且不报任何错、不出现任何异常颜色，只是"该有高光的地方没有高光"。
 *   （这正是 2026-09-27「加了材质层但看不到水面反光」的根因。）
 *
 *   下限只用于防 0 除：d 的最小值是 NoH=1 处的 a2，所以 π·d² 最小为 π·a2²，
 *   在本项目的取值范围（rough ≥ 0.01 ⇒ a2 ≥ 1e-8）下最小 3.1e-16。
 *   取 1e-20 ⇒ 实际永不触发，同时远在 float32 正常范围内（下限 ~1.2e-38）。
 *
 * ⚠️ 本文件整体是 **JS 模板字符串**，注释里**不能用反引号** ——
 *    会直接截断字符串导致模块语法错误（不是 GLSL 错误，浏览器只报
 *    "Unexpected identifier"，排查方向容易跑偏）。中文引号「」是安全的。
 */
float dGGX(float NoH, float a) {
    float a2 = a * a;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-20);
}

/** Smith 几何项（height-correlated 的可见性形式，已含 1/(4·NoL·NoV)） */
float vSmithGGX(float NoV, float NoL, float a) {
    float a2 = a * a;
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
}

/** Schlick Fresnel */
vec3 fSchlick(float VoH, vec3 f0) {
    return f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
}

/** 程序化波浪的**斜率梯度**（解析式，不是数值差分）。
 *
 *  为什么程序化（总监 2026-09-27 定）：
 *    · 它是唯一能**解析算出法线方差**的方案 —— 而方差正是要并进 α_eff 的东西。
 *      用法线图素材反而算不出（要预积分），高光会在波浪上走样。
 *    · 不需要新素材，参数可调，且能动画。
 *
 *  4 组方向 + 频率，全部取**无理数比**，所以永远叠不成规则网格：
 *    · 方向角步进 = 黄金角 2.39996 rad（≈137.5°）—— 向日葵排布，最均匀且不周期
 *    · 频率 = 1 + i·0.618（黄金比）—— 各组的周期比是无理数，看不到拍频
 *
 *  ⚠️ 返回值是**梯度的和**，量级是 sqrt(N/2) 而不是 1 —— 见调用处的归一化。
 *     4 组独立相位的余弦之和：E[g]=0，Var[g]=Σ(1/2)·|dᵢ|² = 2。
 */
vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float ang = fi * 2.39996323;
        vec2 d = vec2(cos(ang), sin(ang));
        float f = 1.0 + fi * 0.61803399;
        float ph = dot(p, d) * f + t * (1.0 + fi * 0.37);
        g += cos(ph) * d * f;
    }
    return g;
}

void main() {
    vec4 texel = texture(uAlbedo, vTexCoord);
    // ★ uv 的逐像素跨度（提到分支之外取）★
    //   ⚠️ fwidth / dFdx 在**非一致控制流**里是未定义行为。下面算波浪足迹时
    //   用得到它，但那段代码在 if (mF0 > 0 && uDiffuse > 0) 里面 ——
    //   每个像素是否进入分支取决于**逐群系**的材质声明，2×2 像素块可能在边界上分裂，
    //   于是导数可能取到未定义值。放在这里（无条件执行）就没有这个风险。
    vec2 uvPerPixel = fwidth(vTexCoord);
    // ★ albedo 是美术按 sRGB 画的 ⇒ 解码成线性再参与光照与消光计算 ★
    //   不解码的话，"消光"会作用在 sRGB 数值上，量纲是错的（见 srgbToLinear）。
    vec3 albedo = srgbToLinear(texel.rgb);

    // ---- 细节层叠加（乘性，均值 1 不改变整体亮度）----
    if (uDetailEnabled > 0.5) {
        // 逐群系的强度与尺度
        int biomeId = int(texture(uBiome, vTexCoord).r * 255.0 + 0.5);
        float strength = 1.0;
        float dScale = 1.0;
        for (int i = 0; i < MAX_BIOMES; i++) {
            if (i == biomeId) {
                strength = uBiomeDetailStrength[i];
                dScale = uBiomeDetailScale[i];
            }
        }

        if (strength > 0.001) {
            // 极区淡出：等距圆柱在极点附近只剩几个纹素的信息量，
            // 再怎么采样都是噪声或同心环。平滑收掉细节层。
            // ★ 这是**不改变坐标映射**的极地修法 ★
            //   上一版用 cos(λ) 收窄 u，虽然压住了放射纹，却在 u=0.5 处
            //   制造了一条球面可见的分界线（实测 c399 ×3.9，已回退）。
            //   淡出只缩放强度、完全不动采样坐标，因此不会影响平铺边界。
            float poleFade = uDetailPoleFade <= 0.0
                ? 1.0
                : smoothstep(0.0, uDetailPoleFade, min(vTexCoord.y, 1.0 - vTexCoord.y));
            // u 方向按 cos(纬度) 收窄：让平铺密度在球面上各向同性（见 sampleDetail 的注释）
            float uScale = poleTileScale(vTexCoord.y);

            // ① 域扭曲：用低频场偏移采样坐标（取群系 0 的 B 通道作扭曲源即可，
            //    扭曲场本身是低频的，群系间差异不影响"打碎网格"这个目的）
            //    显式给出 uv 与它的屏幕导数（链式：uv = vTexCoord × tiles × 0.5）
            vec2 uvWarp = vec2(vTexCoord.x * uDetailTiles * 0.5 * uScale,
                vTexCoord.y * uDetailTiles * 0.5);
            vec2 dWarpX = vec2(dFdx(vTexCoord.x) * uDetailTiles * 0.5 * uScale,
                dFdx(vTexCoord.y) * uDetailTiles * 0.5);
            vec2 dWarpY = vec2(dFdy(vTexCoord.x) * uDetailTiles * 0.5 * uScale,
                dFdy(vTexCoord.y) * uDetailTiles * 0.5);
            float warp = sampleDetailGrad(uvWarp, 0, uDetailAtlas, dWarpX, dWarpY).b - 0.5;
            vec2 warpOffset = vec2(warp, warp * 0.83) * uWarpAmount / uDetailTiles;

            // ② 多尺度：粗颗粒用无理数倍率，两层周期不可公约
            vec2 baseUv = vec2((vTexCoord.x + warpOffset.x) * uScale, vTexCoord.y + warpOffset.y);
            vec2 uvFine = baseUv * uDetailTiles * dScale;
            vec2 uvCoarse = baseUv * uDetailTiles * dScale * 2.37;

            // 屏幕导数：细层直接取，粗层是同一坐标乘 2.37
            vec2 dFineX = vec2(dFdx(uvFine.x), dFdx(uvFine.y));
            vec2 dFineY = vec2(dFdy(uvFine.x), dFdy(uvFine.y));
            vec2 dCoarseX = dFineX * 2.37;
            vec2 dCoarseY = dFineY * 2.37;

            float fine = sampleDetailGrad(uvFine, biomeId, uDetailAtlas, dFineX, dFineY).r - 0.5;
            float coarse = sampleDetailGrad(uvCoarse, biomeId, uDetailAtlas, dCoarseX, dCoarseY).g - 0.5;

            // 细节是乘性因子：1 + 偏差 × 强度
            float detail = 1.0 + (fine + coarse * uCoarseWeight) * strength * poleFade;
            albedo *= max(0.2, detail);
        }
    }

    // 正交俯视下法线即光照方向的判断依据（光照模型与后续特效层共用）
    //
    // ★★ 关于「晨昏线为什么是硬的」—— 一次被证伪的尝试（2026-09-27）★★
    //
    // 总监反馈晨昏线像刀切。很自然的想法是"太阳有视半径，所以应该有半影"，
    // 于是试过把这里换成 clamp((N·L + θs) / 2θs, 0, 1)。**两个问题**：
    //
    // ① **公式错**：那会把整个受光面钳到 1（盘心亮度实测 7 → 45），
    //    等于把 Lambert 的余弦衰减整个抹掉，受光面变成平光。
    //
    // ② **物理上也不成立**：正确的半影是「ndl × 太阳圆面在地平线以上的比例」。
    //    比例那条斜坡只在 |N·L| < θs 内起作用，而那条带内 |N·L| < θs ≈ 0.019
    //    ⇒ 带内的照度**最多只有满照度的 2%**。也就是说半影确实存在，
    //    但它是一条 2θs ≈ 2.2°（盘半径 502px 上约 19px）宽、
    //    **峰值只有 2% 亮度**的极暗斜坡 —— **肉眼根本看不出软化**。
    //    ⇒ **真实行星的晨昏线本来就是硬的**（太阳视直径只有 ~1°）。
    //    这条结论同样解释了 §13.36 之前那次「把大气二元遮挡换成半影软过渡」
    //    为什么没用 —— 不是实现问题，是这个效应本身太小。
    //
    //    ⚠️ 若将来确实要「艺术地」软化晨昏线（那是有意的非物理夸张），
    //    正确的做法是拉长 Lambert 的过渡（对 ndlRaw 做几度到十几度的 smoothstep，
    //    或 pow(ndl, k)），**不是**套太阳视半径。
    //    ⇒ 该开关见下面的 uTerminatorSoft（2026-09-27 按总监要求实现）。
    // ★★ 地表起伏：法线图扰动着色法线（卡2）★★
    //
    // 观感来自**阴影**，不是剪影：几何仍是完美球（sphereMesh 无位移），
    // 扰动的是参与 Lambert / 晨昏线 / 镜面的法线 ⇒ 坑谷长出光影。
    //
    // 强度 = uNormalStrength（全局，默认 0）× uBiomeRelief[群系下标]（逐群系）。
    // 水群系在配置里恒 0 ⇒ 这段对水像素是**恒等变换**，水面继续只走下面的程序化波浪。
    //
    // ⚠️⚠️ 与下面水波那段（见「波浪法线扰动」）**符号相反，不是笔误**：
    //   水波喂进来的是**高度梯度**（那里的注释写着"高度沿 +T 升高 ⇒ 法线朝 −T 倾"），
    //   所以写成「N − (T·g.x + B·g.y)」；
    //   而法线图存的是**已经取过负号的法线**（tools/makeNormalMap.mjs：
    //   n = normalize(−dH/ds_u, −dH/ds_v, 1)），解包后直接就是切平面的两个分量，
    //   所以这里是「N + (...)」。照抄成减号会得到"高地变暗、低地变亮"的**负地形** ——
    //   这正是负对照②要抓的那个错（见交付证据里的「符号自检」）。
    // ⚠️ 两个符号**都由实测钉死**，不是推导出来的摆设（见 tools/normalMapRender.mjs 的
    //   probeNormalEncoding / probeOrientation）：
    //   · 编码实测：corr(n_x, −gU) = 0.98、corr(n_y, −gV) = 0.987
    //     ⇒ 法线图确为 n = normalize(−dH/ds_u, −dH/ds_v, 1)，
    //       解包后就是切平面的两个分量，**直接相加**（水波那段喂的是梯度，所以是减号）。
    //   · 取向实测：本管线的纹理坐标是 t = 网格 v（sphereMesh 的 v: 0 = 南极 → 1 = 北极），
    //     沿行号增大 = 向北 ⇒ 解码出的 nTexel.y 与 vBitangent（= cross(N, T) = 北）**同向**。
    //   ⚠️ 若这里把 B 的符号取反，画面照样"有起伏"，但得到的是负地形（高地变暗）——
    //     肉眼分不出，只有与高度场做相关性才会露馅（这正是负对照②的判据）。
    vec3 Nsurf = normalize(vNormal);
    if (uNormalStrength > 1e-6) {
        // 群系查表：与细节层、材质层**同一个下标、同一套 MAX_BIOMES 循环**。
        int reliefId = int(texture(uBiome, vTexCoord).r * 255.0 + 0.5);
        float reliefBiome = 1.0;
        for (int i = 0; i < MAX_BIOMES; i++) {
            if (i == reliefId) {
                reliefBiome = uBiomeRelief[i];
            }
        }
        // ⚠️ 采样一律放在**一致控制流**里：uNormalStrength 是 uniform，
        //    进这一层后的采样不会算在逐像素分歧的分支里（隐式 LOD 取导数才是 UB）。
        vec3 nTexel = texture(uNormalMap, vTexCoord).rgb * 2.0 - 1.0;
        float reliefScale = uNormalStrength * reliefBiome;
        // 极点淡出（task-23，治极区径向条纹）：球面 UV 在极点退化（法线图 U 向
        // 梯度被 scaleU 放大 3.86×），叠加 polar 群系强度最高 ⇒ 极区条纹。
        // latAbs: 0=赤道 → 1=极点（abs 对两极对称，v 轴取向不影响结果）；
        // 从 67.5°（latAbs=0.75）开始渐隐，85.5°（0.95）后完全归零 —— 条纹起点
        // 约在 75°，故提前开始渐隐。极点附近不做起伏。
        float latAbs = abs(vTexCoord.y - 0.5) * 2.0;
        float poleFade = 1.0 - smoothstep(0.75, 0.95, latAbs);
        reliefScale *= poleFade;
        if (reliefScale > 1e-6) {
            // 切平面 → 世界：+vTangent = 东（+u）、+vBitangent = 北
            Nsurf = normalize(Nsurf + (vTangent * nTexel.x + vBitangent * nTexel.y) * reliefScale);
        }
    }
    float ndlRaw = dot(Nsurf, normalize(uSunDir));
    float ndl = max(ndlRaw, 0.0);

    // ★★ 晨昏线艺术软化（uTerminatorSoft，单位**弧度**；0 = 物理口径）★★
    //
    // ⚠️ **这是有意的非物理夸张** —— 上面刚证明了真实晨昏线就是硬的。
    //    总监明确要求「柔和过渡」，所以做成一个显式开关，默认值不为 0 但要标清楚。
    //
    // 形状：在 ndlRaw ∈ [−s, +s] 内用**抛物线**接上，带外完全不动。
    //   x ≥ +s → ndl = x        （保持 Lambert 原样）
    //   x ≤ −s → ndl = 0
    //   带内   → ndl = (x + s)² / (4s)
    //   两端都是一阶连续（x=+s 处导数 1、x=−s 处导数 0），所以不会出现折线。
    //
    // ⚠️⚠️ 只软化 ndl 是**不够的**：带内 ndlRaw < 0 ⇒ 红化那一步的空气质量
    //    取到"阳光擦过地平线"的切点极限值（约 11~13 倍），蓝绿通道的透射率
    //    已被压到 1e-2 量级以下，几何坡道会被消光削掉大半
    //    （实测：只软化 ndl 时带内几乎看不出变化）。
    //    所以**红化也要走同一条坡道**（下面的 cosZ = ndl）。
    //    带外两者恒等 ⇒ 日落红**完全不受影响**，只在带内被改。
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

    // ★★ 晨昏线陡化（uTerminatorPow：N·L 的幂；1 = 物理口径 = 逐位不变）★★
    //
    // **为什么需要**（2026-10-02，总监：「刚好侧光的晨昏线明显太宽了，超出了星球中线
    //   太多」）：太阳落在屏幕平面内时是 90° 相位，可见半球从 N·L = 1（临边）
    //   一路降到 N·L = 0（中线），**整条余弦本身就是一条横跨半个星径的斜坡** ——
    //   这是物理，不是 bug。实测分解（过盘心横扫、8 位）：
    //     纯 Lambert（无大气、环境光 0）：107,92,60 → 45,63,22 → 22,26,11 → 0,0,0
    //   也就是说"宽"这件事在**地表那一层就已经成立**了。
    //   物理上无法再窄：要让半相位球的边缘更"利"，只能对余弦本身做非线性。
    //
    // **做法**：ndl → pow(ndl, k)，k > 1 把低照度段整体压低 ⇒ 视觉上的过渡带
    //   向受光侧收窄（k = 1.5 时 ndl = 0.1 处只剩 0.032）。**这是有意的非物理夸张**，
    //   与 uTerminatorSoft（软化）方向相反，两者可叠加使用。
    //
    // ⚠️ 只作用于**漫反射的几何坡道**。红化（下面的 cosZ）与镜面高光仍走真实 N·L ——
    //    否则日落红带会跟着一起被削窄，那是另一件事（而且是你已经调定过的）。
    // ⚠️ uTerminatorPow = 1 时整个分支跳过 ⇒ 与加这个特性之前**逐位一致**（A/B 通路）。
    // ⚠️ 代价必须写清楚：受光面整体变"圆"（盘心不动、中段压暗）、临边变暗。
    // ⚠️ ndlRed 保存**陡化之前**的值，专供红化使用 —— 见下面的 cosZ。
    float ndlRed = ndl;
    if (uTerminatorPow != 1.0) {
        ndl = pow(ndl, uTerminatorPow);
    }

    // ---- 特征场：叠加 albedo 增量，并用高度场做坡度明暗 ----
    // 坡度明暗是"坑看起来像坑"的关键：只加亮度增量会得到发亮的斑块，
    // 加上朝阳/背阳的坡度调制才会有立体感。
    //
    // 编码约定（与 tools/featureField.mjs / featurePreviewBake.js 严格一致）：
    //   R = albedo 增量，128 为中性；解码回有符号增量再乘 1（已经是 0-255 量纲）
    //   G = 高度增量，128 为中性
    if (uFeatureEnabled > 0.5) {
        vec2 texel = 1.0 / vec2(textureSize(uFeature, 0));
        float hL = texture(uFeature, vTexCoord - vec2(texel.x, 0.0)).g;
        float hR = texture(uFeature, vTexCoord + vec2(texel.x, 0.0)).g;
        float hD = texture(uFeature, vTexCoord - vec2(0.0, texel.y)).g;
        float hU = texture(uFeature, vTexCoord + vec2(0.0, texel.y)).g;
        // 高度梯度 → 坡度明暗。uFeatureShading 把 0-1 的高度差还原成可用量级。
        float slopeLight = ((hR - hL) * uSunDir.x + (hU - hD) * uSunDir.y) * uFeatureShading * 255.0;

        vec4 feat = texture(uFeature, vTexCoord);
        albedo += (feat.r - 0.5) * 2.0 * 255.0;
        albedo += slopeLight;
    }

    // ★ 阳光穿过大气后的颜色（日落红的地表部分）★
    //   与大气散射层用同一套空气质量近似：斜射时光程剧增 → 蓝绿被散射掉、只有红光到达地面。
    //   这是"从太空看到的日落红"的主体 —— 大气散射层在盘中央本来就很薄（视线垂直穿大气），
    //   真正红的是**被红化阳光照亮的地面**。
    //   只作用于直射光（diffuse 项），不影响环境光；uAtmoEnabled = 0 时恒为 1，
    //   所以不开大气时与历史口径逐像素一致。
    vec3 sunTint = vec3(1.0);
    // 空气质量：**提到外面**，因为镜面高光的"大气抹开"也要用同一个量。
    // 不开大气时恒为 1 ⇒ 与历史口径一致（见下面的用法）。
    float airMass = 1.0;
    // 红化用的"太阳高度余弦"：软化打开时与 ndl 走同一条坡道（见上面的说明），
    // 关闭时就是原始的 N·L —— 那时两种写法逐位相同。
    float cosZ = (uTerminatorSoft > 1e-6) ? ndlRed : ndlRaw;
    if (uAtmoEnabled > 0.5) {
        // ★ 空气质量：查表（地表切片，天顶 = 1）★
        //   与大气散射层**同一张表** ⇒ 地表的日落红与空中的散射在晨昏线处必然对齐。
        //   ⚠️ 只对 cosZ >= 0 有意义：太阳在地平线以下时"直射光程"不存在，
        //      由下面的 step(0, cosZ) 把直射项归零；表在负区间给的是
        //      "阳光擦过地平线"的切点极限值（有限、可插值，不会出 NaN）。
        airMass = surfaceAirMass(cosZ);
        // step(0, cosZ)：夜面阳光到不了，直接归零
        sunTint = exp(-uAtmoExt * uAtmoScaleHeight * airMass) * step(0.0, cosZ);
    } else {
        airMass = 1.0;
    }

    // ---- 逐群系材质（光学层）----
    //
    // 查表方式与细节层一致（同一个 biomeId、同一套 MAX_BIOMES 循环）。
    // ⚠️ 默认 f0=0 ⇒ 下面的镜面分支整个跳过 ⇒ 逐像素退回纯 Lambert。
    //    这是本层能安全落地的前提：既有天体未声明材质，外观必须一字不变。
    float mF0 = 0.0;
    float mRough = 1.0;
    float mWaveDeg = 0.0;
    float mWaveScale = 1.0;
    {
        int bid = int(texture(uBiome, vTexCoord).r * 255.0 + 0.5);
        for (int i = 0; i < MAX_BIOMES; i++) {
            if (i == bid) {
                mF0 = uBiomeF0[i];
                mRough = uBiomeRough[i];
                mWaveDeg = uBiomeWaveDeg[i];
                mWaveScale = uBiomeWaveScale[i];
            }
        }
    }

    // 能量守恒：直射项乘 (1 − F0)。f0 = 0 时 (1−0) = 1.0，
    // 浮点上 x*1.0 == x 是精确的 ⇒ 与历史口径**逐像素一致**。
    //
    // ★★ 夜面边缘淡出（uNightLimbFade）：把"突出去的灰剪影"从根上做掉 ★★
    //
    // **病灶**（总监反复反馈「边缘有一块突出去的东西」「我实在是不想要这个突出」）：
    //   夜面亮度 = albedo × uAmbient，这个乘积**在整个夜面是常数**
    //   ⇒ 行星的暗面在太空里留下一个**硬边灰色剪影**（实测临边处 (3,7,9)，
    //   而太空是 (0,0,0)）⇒ 看上去就是"从大气弧后面突出来的一块灰"。
    //
    // **做法**：让这份补光**在临边淡出到 0**（用 NoV = 视线与法线的夹角余弦）——
    //   正对镜头处满、掠射处归零。于是行星的暗面**融进太空**，不再有剪影，
    //   只留下大气自身的那道弧（那才是该标记临边的东西）。
    //
    // ⚠️ 只作用于**环境光**项，且**只在方向性光照下生效**（uDiffuse > 0）：
    //   平光模式（ambient=1 / diffuse=0）是参照图与 M5 的基准口径，
    //   那里没有"夜面"这个概念，绝不能被这个淡出改动 ⇒ uDiffuse 门控。
    // ⚠️ uNightLimbFade = 0 时 mix(1.0, x, 0.0) = 1.0（精确），与加这个特性之前**逐位一致**。
    float ambientUse = uAmbient;
    if (uDiffuse > 1e-5 && uNightLimbFade > 0.0) {
        float noV = clamp(dot(normalize(vNormal), vec3(0.0, 0.0, -1.0)), 0.0, 1.0);
        ambientUse = uAmbient * mix(1.0, smoothstep(0.0, uNightLimbFadeWidth, noV), uNightLimbFade);
    }
    // ---- ★ 第三卷：云影 ★ ----
    //   把"这个地点上方有没有云"折成直射光的遮蔽系数 cloudShade。
    //
    //   ★ 为什么影子会与云**错位** ★
    //     地表点 P 沿太阳方向的射线穿到云壳（半径 uCloudShadowAlt）上的交点 P' 才是
    //     "遮住这个地点的云"。求交是解析的：t = −μ + sqrt(μ² + r² − 1)，μ = P·L。
    //     太阳越低（μ 小）t 越大 ⇒ 影子越往背光侧偏；正午（μ≈1）t≈0 ⇒ 影子在云正下方。
    //
    //   ★ 夜面为什么不会有影（物理负对照）★
    //     这一项**只乘在直射光项**上（uDiffuse·ndl·sunTint）。夜面 ndl = 0、
    //     sunTint 也被 step(0, cosZ) 归零 ⇒ 影子在夜面**数学上不可能出现**。
    //     （如果把它误乘到 ambientUse 上，夜面就会浮出影 —— 这条判据能失败。）
    float cloudShade = 1.0;
    if (uCloudShadowOn > 0.5) {
        // 地表点方向（与 cloudFieldGLSL 的 cfUvToDirection 同式：v=0 为南极）
        float lat = (vTexCoord.y - 0.5) * 3.14159265358979;
        float th = (vTexCoord.x - 0.5) * 6.28318530717959;
        vec3 dir = vec3(cos(lat) * sin(th), sin(lat), cos(lat) * cos(th));
        float mu = dot(dir, uSunDirLocal);
        float r = max(uCloudShadowAlt, 1.0);
        float tHit = -mu + sqrt(max(mu * mu + r * r - 1.0, 0.0));
        // 视差系数（1 = 真实；0 = 影子落在云正下方，只用于对照量测）
        tHit = max(tHit, 0.0) * uCloudShadowParallax;
        vec3 p2 = normalize(dir + tHit * uSunDirLocal);
        float lat2 = asin(clamp(p2.y, -1.0, 1.0));
        float th2 = atan(p2.x, p2.z);
        vec2 uv2 = vec2(fract(th2 / 6.28318530717959 + 0.5), lat2 / 3.14159265358979 + 0.5);
        float shade = texture(uCloudShadowTex, uv2).r;
        cloudShade = 1.0 - uCloudShadowStrength * shade;
    }
    vec3 lit = albedo * (uSunColor
        * (ambientUse + uDiffuse * ndl * sunTint * cloudShade * (1.0 - mF0)));

    // ---- 镜面项 ----
    //
    // 两个门控条件，缺一不可：
    //   ① mF0 > 0      —— 该群系声明了材质。未声明 ⇒ 跳过 ⇒ 逐像素退回纯 Lambert。
    //   ② uDiffuse > 0 —— **当前是方向性光照**。
    //
    // ⚠️ ② 是踩过坑才加的（2026-09-27）：镜面高光本质上是**方向性**现象，
    //    而平光模式（ambient=1 / diffuse=0）的口径是"无方向性光照" ——
    //    它是参照图与 M5 等对比实验的基准。第一版漏了这个开关，平光下照样算出高光，
    //    直接把基准口径破坏了。
    //    真太阳模式下 diffuse=1 ⇒ 顶格生效。
    if (mF0 > 1e-5 && uDiffuse > 1e-5) {
        // 用**已含地表起伏**的法线（水群系的 relief 恒 0 ⇒ 水像素上 Nsurf == vNormal，
        // 与接法线图之前逐位一致，波浪照旧叠在它上面）。
        vec3 N = Nsurf;
        vec3 L = normalize(uSunDir);
        vec3 V = vec3(0.0, 0.0, -1.0);        // 正交相机：常量，见文件头的约定说明
        vec3 H = normalize(L + V);
        float NoL = max(dot(N, L), 0.0);
        float NoV = max(dot(N, V), 1e-4);
        float a = max(mRough * mRough, 1e-4);

        // ---- ① 波浪法线扰动（程序化，逐群系）----
        //
        // N 先被波浪扰动，再算 NoL / NoH / NoV —— 顺序很重要：
        // 高光是由**被扰动后的法线**决定的，先算再扰动能得到"高光不随波浪动"的错结果。
        //
        // 归一化：waveGrad 的 4 组余弦之和除以 sqrt(2) 之后，
        // 扰动的 **RMS 角度 = mWaveDeg**（前提是各组同频同幅 —— 见 ② 里的说明）。
        vec2 wp = vec2(0.0);
        float unresolved = 0.0;
        float waveRad = mWaveDeg;
        if (waveRad > 1e-6) {
            // u 方向 mWaveScale 个周期；v 方向 ×0.5（经度一圈 2πR、纬度半圈 πR，等波长）
            wp = vec2(vTexCoord.x * mWaveScale, vTexCoord.y * mWaveScale * 0.5);
            vec2 g = waveGrad(wp, uWaveTime) * (1.0 / 1.41421356);
            // 高度沿 +T 升高 ⇒ 法线朝 −T 倾
            N = normalize(N - (vTangent * g.x + vBitangent * g.y) * tan(waveRad));

            // ★★ 关键：只有**未分辨**的那部分波浪才该并进 α_eff ★★
            //
            // 踩过的坑（2026-09-27）：第一版把**全部**波浪方差都并进 α_eff，
            // 结果 6° 的浪直接把高光抹没了（峰值降到 0.22，在 0~255 的图上什么都看不见）。
            // 错在哪：本项目 waveScale=26 ⇒ 赤道正视下浪的周期约 **108 px**，
            // 是**完全可分辨**的 —— 它应该表现为"高光被真实地打碎成闪烁的碎点"，
            // 而不是"叶瓣被展宽"。展宽只该用在**亚像素**的那部分（否则就是过度模糊）。
            //
            // 判据：本像素跨过多少波浪坐标单位，换算成一个周期占几个像素。
            //   周期 >> 几个像素 ⇒ 已分辨 ⇒ 不贡献方差（打碎由上面的法线扰动本身完成）
            //   周期 ≈ 一两个像素 ⇒ 未分辨 ⇒ 全额贡献（这里才需要抗走样）
            // 在主游戏里星球盘面只有几十像素 ⇒ 周期落到几个像素 ⇒ 自动进入展宽分支，
            // 这正是我们要的抗闪烁行为。
            // ⚠️ 用分支外取好的 uvPerPixel 换算，不要在这里直接 fwidth（见 main 顶部）。
            float pxPerPeriod = 6.2831853 / max(max(uvPerPixel.x, uvPerPixel.y) * mWaveScale, 1e-8);
            unresolved = 1.0 - smoothstep(2.0, 8.0, pxPerPeriod);
        }
        NoL = max(dot(N, L), 0.0);
        NoV = max(dot(N, V), 1e-4);
        float NoH = max(dot(N, H), 0.0);
        float VoH = max(dot(V, H), 0.0);

        // ---- ② 有效粗糙度：把各种角展宽**按方差相加** ----
        //
        //   α_eff² = α² + (θs/2)² + σ_wave²
        //
        // · 太阳视半径 θs（见 src/planet/sun.js）：镜面响应由**半向量** H 决定，
        //   太阳方向 L 在 ±θs 内游走时 H 只在 ±θs/2 内游走（垂直分量减半）。
        // · 波浪：法线本身的 RMS 扰动角就是 α 的方差贡献（上面已归一化到 mWaveDeg）。
        //
        // ⚠️ 每一项都自带"关闭时整个分支跳过"的路径 ——
        //    否则 sqrt(a*a + 0) 的 1 ulp 误差会毁掉 A/B 对照的可比性。
        if (uSunAngularRadius > 1e-6) {
            float halfAngle = uSunAngularRadius * 0.5;
            a = sqrt(a * a + halfAngle * halfAngle);
        }
        if (waveRad > 1e-6 && unresolved > 0.0) {
            float sigma = waveRad * unresolved;
            a = sqrt(a * a + sigma * sigma);
        }

        vec3 f0v = vec3(mF0);
        float dCore = dGGX(NoH, a) * vSmithGGX(NoV, NoL, a);

        // ---- ③ 大气散射对高光的作用（总监 2026-09-27 定：模糊 + 辉光）----
        //
        // ★ 把高光的能量按"被大气散射掉的比例"分成两份 ★
        //     f     = 1 − exp(−K · τ_sca · airMass)     被散射的那份
        //     (1−f) 走**锐利**叶瓣（只有太阳视半径 + 波浪的展宽）
        //     f     走**宽**叶瓣（宽度再乘 uGlintHaloWidth）
        //
        // · 为什么用 τ_sca（散射光深 β_R+β_M）× airMass：
        //   airMass 是现成的（上面刚算过），它让**斜射时高光被抹成一条光带** ——
        //   这正是"日落时海面耀斑拉成长条"的成因。
        // · 为什么用散射光深而不是气溶胶光深：**Kerbin 配方里 mie = 0**（无气溶胶），
        //   用 Mie 会让这一项对 Kerbin 恒为 0。分子散射同样会把高光抹开。
        // · 为什么是"分成两份"而不是"再加一份"：能量守恒。
        //   被摊开的那部分不能凭空多出来 —— 所以锐利项乘 (1−f)。
        //
        // ⚠️ f = 0 时整个分支跳过 ⇒ 与加这个特性之前**逐像素一致**。
        float fHalo = 0.0;
        float aHalo = a;
        if (uAtmoScatterOd > 0.0 && uGlintBlurK > 0.0) {
            float tauSca = uAtmoScatterOd * airMass;
            fHalo = 1.0 - exp(-uGlintBlurK * tauSca);
            // 光晕宽度随散射次数增长（随机游走：N 次散射后角宽度 ∝ √N）
            float widen = uGlintHaloWidth * (1.0 + sqrt(max(tauSca, 0.0)));
            aHalo = sqrt(a * a + (a * widen) * (a * widen));
        }

        float brdf = (1.0 - fHalo) * dCore;
        if (fHalo > 0.0) {
            brdf += fHalo * dGGX(NoH, aHalo) * vSmithGGX(NoV, NoL, aHalo);
        }
        // 光晕的颜色取 sunTint（阳光穿过大气后的颜色）—— 物理上就是这束光的颜色，
        // 不需要新参数，也不会与大气层自己那层散射打架。
        vec3 spec = brdf * fSchlick(VoH, f0v) * NoL * uSunColor * sunTint * uDiffuse;
        lit += spec;
    }

    // 可选的径向边缘压暗：用于模拟原图那个「很弱的径向渐变」
    float rLen = length(vWorldPos);
    float edge = smoothstep(0.85, 1.0, rLen);
    lit *= 1.0 - edge * uEdgeDarkening;

    outColor = vec4(lit, texel.a);
}
`;

/**
 * 全屏三角形顶点着色器（位置直接来自属性，UV 线性映射到 [0,1]²）。
 * 复用于经纬度反投影、差异图、离屏目标铺屏三处。
 */
export const UNPROJECT_VERT = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aTexCoord;

out vec2 vUv;

void main() {
    vUv = aTexCoord;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * 经纬度反投影片元着色器。
 * 每个输出像素对应一个行星坐标（与网格 UV 约定严格一致）：
 *   x → 经度 u = (x + 0.5) / width
 *   y → 纬度 v = 1 - (y + 0.5) / height
 * 采样方向与该点球面法线一致，因此输出图与「按同解析式栅格化的球体」是同一件事。
 *
 * ⚠️ 这里只做 u ∈ [-0.5, 1.5) 的范围平移，**不要**再对 t 做 1-x 翻转：
 * 网格侧 vTexCoord = v 直接等于贴图在文件空间的 v，反投影侧必须用同一口径，
 * 否则两条路径会南北对调（实测踩过这个坑）。
 */
export const UNPROJECT_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uAlbedo;
out vec4 outColor;

const float PI = 3.141592653589793;

void main() {
    float lat = (vUv.y - 0.5) * PI;
    float theta = (vUv.x - 0.5) * 2.0 * PI;
    float cl = cos(lat);
    vec3 dir = vec3(cl * sin(theta), sin(lat), cl * cos(theta));

    // 与网格同样的向心投影（正交俯视）：采样方向就是法线方向
    vec2 uv = vec2(atan(dir.x, dir.z) / (2.0 * PI) + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5);
    outColor = vec4(texture(uAlbedo, uv).rgb, 1.0);
}
`;

/**
 * 铺屏片元着色器：恒等拷贝 + 可选 sRGB 编码。
 *
 * ★ 为什么主渲染需要它（2026-10-02，R4）★
 *   本渲染器内部的合成式是 `final = scatter + background × T`，这条式子
 *   **必须在线性域执行**才物理正确。而画布按 sRGB 解释缓冲 —— 如果直接往画布上
 *   合成，着色器就得先把散射编码成 sRGB，混合就变成了"在伽马域相加"：
 *   暗处的散射被系统性放大（实测同一像素与线性域合成差可达 24/255），
 *   而且量测路径（离屏 SRGB8，线性域混合）与画布路径**算的不是同一件事** ——
 *   "量着没问题、看着不对"正是这么来的。
 *
 *   做法：场景先渲到离屏的 SRGB8 目标（硬件解码后线性域混合），
 *   再由本程序铺到画布；画布这一侧只需要一次编码。
 *   于是画布上看到的 = 离屏量到的（除 MSAA 边缘像素外逐像素一致）。
 *
 * ⚠️ 源纹理若是普通 RGBA8（数值本身就是显示色），`uSrgbOut` 必须为 0，
 *    否则会多编一次 sRGB（画面整体提亮、暗部过曝）。
 *
 * ⚠️ **v 要翻过来**：全屏三角形的 uv 以屏幕上方为 v=0（见 buildFullscreenGeometry），
 *    而 GL 纹理坐标以 v=0 为最下一行 —— 直接按 vUv 采样会把画面上下颠倒。
 *    历史实现里那次"用反投影程序当铺屏"还额外把球面重投影了一遍，
 *    所以这一条一直没被发现。
 */
export const BLIT_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSource;
uniform float uSrgbOut;
out vec4 outColor;

vec3 linearToSrgb(vec3 c) {
    vec3 x = max(c, vec3(0.0));
    vec3 lo = x * 12.92;
    vec3 hi = 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), x));
}

void main() {
    vec3 c = texture(uSource, vec2(vUv.x, 1.0 - vUv.y)).rgb;
    outColor = vec4(mix(c, linearToSrgb(c), uSrgbOut), 1.0);
}
`;

/**
 * 差异图片元着色器（实验室专用）。
 *
 * 口径：**亮度差**（RGB 平均），而不是"取三通道最大差"。
 * 原因：取最大差时，光照明暗造成的三通道同步变化会把红/蓝/绿三个通道同时顶到 1，
 * 差异图整体泛青、看不出结构（实测踩过）。亮度差只有一个有符号标量：
 *   红 = 渲染比基准亮，蓝 = 渲染比基准暗，中灰 = 无差异。
 * 深灰底（0x2b2f36）是"零"的参考色。
 */
export const DIFF_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uReference;
uniform sampler2D uActual;
uniform float uGain;

out vec4 outColor;

const vec3 ZERO_COLOR = vec3(0.169, 0.184, 0.212); // #2b2f36

vec3 linearToSrgb(vec3 c) {
    vec3 x = max(c, vec3(0.0));
    vec3 lo = x * 12.92;
    vec3 hi = 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), x));
}

void main() {
    // ⚠️ 输入是 SRGB8 目标 ⇒ 采样时硬件已解码成**线性**。本程序的差异增益
    //    （uGain 默认值）是按**显示值**标定的，所以这里先编回去，
    //    保持这张差异图的口径与历史上完全一致（否则图会整体变暗、对比变钝）。
    vec3 ref = linearToSrgb(texture(uReference, vUv).rgb);
    vec3 act = linearToSrgb(texture(uActual, vUv).rgb);
    float refLuma = dot(ref, vec3(0.333333));
    float actLuma = dot(act, vec3(0.333333));
    float d = clamp((actLuma - refLuma) * uGain, -1.0, 1.0);

    vec3 color = ZERO_COLOR;
    if (d > 0.0) {
        color = mix(ZERO_COLOR, vec3(0.91, 0.38, 0.29), d);
    } else {
        color = mix(ZERO_COLOR, vec3(0.23, 0.53, 1.0), -d);
    }
    outColor = vec4(color, 1.0);
}
`;
