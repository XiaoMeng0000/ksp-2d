'use strict';

// 云层配方（**唯一真源**）。
//
// 与 atmosphereSpecies.js 之于大气是同一个模式：一颗天体一整套观感，
// 切配方即切全套。**本文件不引入任何 GL / DOM 依赖** —— 这样 Node 侧的烘焙工具
// （tools/makeCloudMap.mjs）与浏览器侧的渲染器可以 import 到**同一份**数值，
// 不会像 §13.30 那 15 处预设漂移那样出现"两份定义迟早对不上"。
//
// ★★ 云场是**乘性级联**（multiplicative cascade），不是加性 fbm ★★
//
// 为什么（2026-10-01 一轮诊断的结论，实测数据见 §13.49）：
//
//   第一版用的是**加性** fbm（`Σ gain^n · noise`），阈值化之后画面是
//   「一团一团的浆糊」：大覆盖率糊成一张纸、小覆盖率只剩碎屑，中间没有可用的窗口。
//   三条实测证据：
//     ① 原始场 min 0.164 / mean 0.491 / max 0.842 —— **根本没有接近 0 的地方**，
//        也就是场上不存在"真正的晴空"；
//     ② 云块尺寸分布是「碎屑 + 巨兽」的双峰，0.1~1% 那一档几乎是空的；
//     ③ 覆盖率 0.35→0.55 之间，最大云块占云区从 14.5% 暴冲到 96.3%
//        —— 一次**渗透相变**，而且很陡。这就是"要么太稀、要么浆糊"的机理。
//
//   根因：加性 fbm 是**高斯型**场，集中在均值附近、没有长尾。对它做阈值，
//   等价于给一片固定地形**涨水** —— 云不会"新生"，只是被淹没、然后连成一片。
//   真实云场是**强间歇**的：大片区域接近零液态水、少数区域很厚，
//   云团尺寸近似幂律（小云多、大云少、各档都占可观比例）。
//
//   ⇒ 改用**乘性级联** `Π (1 + aₙ · noiseₙ)`：乘积的 log 是若干独立项之和
//     ⇒ 对数正态 ⇒ **长尾 + 大片近零** ⇒ 等值线变成稀疏、成簇、丝缕状，
//     阈值一动云是"长出来"而不是"淹上来"。
//
//   ⚠️ 一个必须说清的事实：烘焙端会做**直方图均衡化**（见 makeCloudMap.mjs），
//      而均衡化是**单调重映射 ⇒ 不改变等值线形状**。所以
//        · 改场的**边际分布**（比如加一个 f^γ 传递）**对最终画面没有任何影响**，
//          那是个无效旋钮，本项目不提供；
//        · 有效的是改变**空间结构** —— 乘性级联、域扭曲、纬向组织。
//      本文件里所有 FIELD 字段都必须按这条标准审视：
//      **"它改变的是形状，还是只是换了把尺子？"**
//
// ★★ 参数分两类，改动代价完全不同 ★★
//
//   【烘焙期】scale / octaves / gain / cascade / warp / warpDetail / bandStretch
//            / ridge / seed —— 决定 cloudMap.png 里存下来的那张场，
//            改了必须重跑 `node tools/makeCloudMap.mjs --body <id>`。
//
//   【渲染期】coverage / softness / opacity / altitude / color / enabled
//            + 时间项（windSpeed / windShear / windShearMax / evolveRate / birthAmount / birthScale）
//            —— **不进烘焙**：图里存的是未阈值化的场，阈值与不透明度由着色器
//               实时施加 ⇒ 可以现场拖，不必重烘。
//
//   ⇒ 判据：想在**现场**调什么，什么就必须留在渲染期。
//
// ⚠️ cloudMap.png 的 R 通道存的是 **「这个像素变成云所需的覆盖率」**（面积均匀分布），
//    既不是原始级联值、也不是烤好的最终 alpha。着色器判据因此只有一句
//    `b <= coverage`，而云量恰好等于 coverage —— 参数名与实际行为一致。
//    采样必须用 **LINEAR**（存的是连续场）
//    —— 与群系索引图（NEAREST，通道存号码）**恰好相反**，不要照抄那边。
//    完整理由（含"为什么必须按球面面积均衡化"）见 tools/makeCloudMap.mjs 的文件头。

import { GAS_GIANT_RECIPES } from './gasGiantCloudRecipe.js';

/**
 * 云场烘焙的基础参数（所有配方共用，逐配方可在 own 字段里覆盖）。
 *
 * 为什么用**方向空间**的 3D 噪声而不是 2D 经纬噪声：
 *   `uvToDirection(u, v)` 把等距圆柱坐标映射到单位球方向，噪声在方向空间里取值
 *   ⇒ u 方向**天生无缝**（绕一圈回到同一个方向），极区也不会像 2D 图那样挤压出
 *   放射状条纹。这与 bakePlanet 的细节层用的是同一套理由。
 */
const FIELD_BASE = {
    /** 云团基频。越大云团越小越碎 */
    scale: 4,
    /**
     * 级联层数。⚠️ **上限由 Nyquist 决定，不是凭感觉加的**：
     *   最细一层的周期 = (图宽 / 2π) / (scale · lacunarity^(octaves-1))，
     *   必须 >= 2 px，否则那一层退化成**走样噪声**（满屏细碎亮点，且随分辨率不可复现）。
     *   2048 宽 + scale 4 时最多 6 层（最细 2.55 px）。
     *   实测教训：初版用 10 层 ⇒ 最细层只有 1.27 px，四层都在走样 —— 这正是
     *   "云场发毛"的来源之一。工具每次烘焙都会打印这个余量（见 makeCloudMap.mjs）。
     */
    octaves: 6,
    lacunarity: 2,
    /**
     * 每层振幅比。
     *
     * ★★ 2026-10-01 从 0.95 降到 0.60 —— 这一项是"云太碎"的**主因** ★★
     *
     * 旧注释写的是"接近 1 = 普适多重分形，0.5 会让高频饿死" —— **那个推理是错的**，
     * 它只看到了"最大云块别太大"，没看到"小尺度还占多少振幅"。总监指出画面
     * "太碎、不像真的云"之后，量了一个真正该量的数：
     *
     *   **粗糙度 = √(S(2)/S(512))**，S 是结构函数（沿赤道 8192 点采样，无 FFT）
     *   即"最小可分辨尺度上的起伏 相对 大尺度起伏" —— 越小越"整块"。
     *
     *   实测（同一份配方，只改这一项）：
     *     gain 0.95 ⇒ 粗糙度 **0.207**   ← 第 6 层振幅 = 0.95⁵ = 0.77，几乎与大尺度等强
     *     gain 0.60 ⇒ 粗糙度 **0.029**   ← 第 6 层振幅 = 0.60⁵ = 0.078
     *   **7 倍**的差别。真实云场是大尺度主导的，所以取 0.60。
     *
     * ⚠️ 顺带纠正一条：**谱斜率 β 抓不到这个现象**。同一批配置下
     *    β 只在 1.53~2.41 之间变（全都落在"真实云场"区间），完全分不出好坏。
     *    所以判据换成了粗糙度比，见 tools/checkCloudFieldShape.mjs。
     */
    gain: 0.6,
    /** 首层振幅。**必须 < 1**，否则 `1 + a·noise` 会变号，乘积失去意义 */
    cascade: 0.55,
    /** 第一级域扭曲强度。
     *  ⚠️ 2026-10-01 从 1.6 降到 0.45：1.6 那档会在画面上留下**肉眼可见的漩涡状
     *  假纹理**（总监看出来了）。实测它对粗糙度的贡献是次要的（1.6→0.4 只把
     *  0.207 降到 0.122），主因是 gain —— 但它是"看起来假"的直接来源，所以一并降。 */
    warp: 0.45,
    /** 第二级域扭曲（小尺度撕扯）相对强度 */
    warpDetail: 0.2,
    /** 第二级域扭曲的频率倍率 */
    warpDetailScale: 3.3,
    /** 纬向组织：纬度方向频率放大倍数（0 = 各向同性）。
     *  真实云系沿纬向成带（信风带/西风带里经向温度梯度远大于纬向），
     *  拉长成东西向长条才有"天气"感，而不是一团各向同性的噪声 */
    bandStretch: 0.22,
    /** 脊线掺入（`ridged3D`）：给云带来丝缕/卷云状的细结构。
     *  ⚠️ 2026-10-01 从 0.18 降到 0.08 —— 它同样是"为了看起来像卷云"加上去的，
     *  没有物理依据，而且会在低 gain 下重新注入一批小尺度结构。 */
    ridge: 0.08,
    /**
     * 种子。⚠️ **必须 < CLOUD_SEED_MAX（2²⁴）** —— 见那条常量的说明：
     * 它以 float uniform 传给着色器，超过 2²⁴ 就不能精确表示，
     * GPU 会算出一个与 CPU 完全无关的场。
     * 原值 20261001 超界（实测对拍平均 |Δb| = 1/3），已改为 2026100。
     */
    seed: 2026100,
};

/**
 * 渲染期字段的**含义**（不参与烘焙）。数值**一律写在各自的配方里，不设共用基准**。
 *
 * ⚠️ 曾经的写法是"kerbin 继承一个 RENDER_BASE"，那是个陷阱：
 *    将来给 Eve / Jool 调参时若顺手改了那个基准，**Kerbin 会被静默改掉** ——
 *    而这类改动在所有指标上都是"通过"的，只有人眼看图才发现。
 *    一颗天体一整套、各自写全，与 atmosphereSpecies.js 的 MIXTURES 同一个纪律。
 *
 * 字段：
 *   coverage   覆盖率 —— `b <= coverage` 的部分成为云。
 *              ⚠️ **它是"平均/渐近"云量，不是瞬时保证** —— 云量会随时间漂移
 *                 5~8 个百分点，见下面「coverage 是均值，不是瞬时保证」。
 *   softness   阈值过渡宽度（云缘柔和程度）。0 = 硬边（会露出 8 位台阶）
 *   opacity    最大不透明度
 *   altitude   云壳高度（星径倍数）。**必须 < 大气壳的 atmoScale**，否则云会穿出大气顶
 *   color      云体反照率的**艺术指定色**（线性域 RGB 乘子）。
 *              [1,1,1] = 物理正确的白（地球云就是白的）；Eve 紫 / Jool 绿走这里。
 *              ⚠️ 它是**乘在光照结果上**的，所以夜面云依然是黑的 —— 不会发光。
 *   enabled    这套配方开启时，云层默认是否打开。
 *              ★ 它取代了"一个全局的云层开关默认值" ★ —— 见下面「配方归属」。
 *
 * ---- 时间（第二步，2026-10-01）：四个现象各走一条路 ----
 *
 *   ① 平流   u += wind(lat) · t
 *   ② 切变   wind(lat) 随纬度变 —— **从①自动出来**，不需要另写
 *   ③ 折叠   位移场取自**未平流**的位置：云滑过固定的湍流场 ⇒ 被拉伸、折叠。
 *            用"位移随 t 增长"也能折叠，但那会**无界**（最终拉成无限细的丝）；
 *            取固定位移场则位移有界，长期也不会退化。
 *   ④ 生消   低频 4D 噪声调制**局部覆盖率**（b += birth · noise）⇒ 云成片出现/消散
 *
 *   windSpeed   纬向风基速（**圈/秒**，经度方向）
 *   windShear   纬向风随纬度的变化幅度（圈/秒）—— 即急流强度，成带靠它
 *   evolveRate  第 4 维速率（1/秒）—— 湍流演化与生消共用
 *   birthAmount 生消调制幅度（0 = 关；0.1 表示局部覆盖率最多偏 ±10%）
 *   birthScale  生消噪声的空间频率（低频；越小则出现/消散的片区越大）
 *   birthPhase  生消的**空间相位**强度（0 = 关）。见下面「生消的格点停顿」。
 *
 * ---- ★★ 生消的「格点停顿」：一个已定位并修掉的缺陷（2026-10-01）★★ ----
 *
 *   现象（总监）：「把生消幅度拉高之后能明显看出来云的变化是**动一会停一下**然后接着动」。
 *
 *   量测：把生消项本身在 2 秒步长下单独扫（birthAmount 0.08、evolveRate 0.005）——
 *     速率从 **t=0 时的精确 0** 单调爬升到 t=80 s 的 6.2e-4，一个噪声时间格内差 60 万倍。
 *
 *   根因：Perlin 的 `fade(u) = u³(6u²−15u+10)` 在格点处**导数恒为 0**。
 *     噪声的时间坐标 `w = t · evolveRate`，于是一格（Δt = 1/evolveRate = 200 s）里：
 *       w 在**整数**处（t = 0/200/400 s）⇒ 速率 0 ⇒ **完全停住**
 *       w 在**格心**（t = 100 s）⇒ 速率最大 ⇒ 动得最快
 *     `fade'` 是二阶零点（w 偏 0.1 时只剩 13%），所以"慢"的相位占了大半个周期，
 *     顿挫感很明显，不是一闪而过。
 *
 *   为什么拉高 birthAmount 才明显：这个停顿级联与域扭曲也有，但那时**平流还在继续**，
 *     画面仍在动；而生消项是**直接加在阈值 b 上**的 ⇒ 它一停，云的出现/消散当场停住。
 *
 *   ★ 关键在"全局同相"：`w` 是**一个全局标量** ⇒ 整个星球同时进入慢相位、同时停，
 *     没有任何空间上的错相来把它抹平。真实大气的生消是空间去相关的（此起彼伏）。
 *
 *   修法（甲）：给生消的时间坐标加一个**空间相位** `ph(d)`：
 *       w_local = t · evolveRate + birthPhase · noise(d · birthScale, 0)
 *     各区域因此落在时间格的不同相位上 ⇒ **全局停顿消失**，而且顺带把生消从
 *     "整颗星球一起出现/消散"变成"此起彼伏"——本来就是更真实的观感。
 *
 *   ⚠️ 代价（如实记）：这会**改变 t = 0 的图案**（生消项的取值变了）。这不是数值瑕疵，
 *      是**定义变了**；判据是统计性的，仍然通过。`birthPhase = 0` 是回到旧行为的开关。
 *   ⚠️ 级联与域扭曲的 `w` 有**同一个**格点停顿（只是被平流掩盖）。本轮只修生消，
 *      要不要一并处理待总监看观感再定。
 *
 * ---- ★★ coverage 是**均值**，不是瞬时保证（2026-10-01 订正）★★ ----
 *
 *   `coverage = 云量比例` 这条语义是靠 **CDF 重映射**撑起来的，而 CDF 只在 **t = 0
 *   算过一次**（见 buildCloudCdf）。随着搅拌推进，场的空间分布会漂移 ⇒ 映射不再
 *   精确均等 ⇒ **实际云量随时间漂移**。
 *
 *   实测（coverage = 0.11，t = 0…7200 s）：云量在 **5.2% ~ 13.4%** 之间飘，
 *   极差 **5~8 个百分点**。
 *
 *   ⚠️ **这个漂移与生消无关**：把 `birthAmount` 设成 0（完全不生消）极差仍有 **5.94 pp**。
 *      生消只在这个漂移之上再叠一点起伏。
 *
 *   ⚠️⚠️ 一条被推翻的旧结论（留着免得有人再走一遍）：
 *      曾经报过"实测极差仅 1.5 个百分点"——那是**采样巧合**。当时的预设
 *      `windSpeed = 0.004 圈/秒`，而我采的 t = 300 s 恰好是 **1.2 圈 ≈ 转回原处**，
 *      于是与 t = 0 读数几乎相同。补上 t = 600 / 2400 两个点后真相才出来。
 *      **教训：判据的采样点要先证明它能分辨被测现象，否则"通过"只是巧合。**
 *
 *   处分（总监 2026-10-01 决定）：**可接受，如实记为特性**。
 *     它读起来就像"天气变晴/变阴"，物理上也不算错。
 *     ⇒ 需要压住的话有两条路，都还没做：让 CDF 保鲜（周期性重算，代价是全局统计突变
 *       可能看见跳变）；或把时间变换做成保测的（难：搅拌本质上不保测）。
 *
 *   ★★ 所有时间效应都 ∝ t ⇒ t = 0 时**逐像素等于静态场** ★★
 *     所以默认值可以给好看的数，而"同参数同图"、冻结机制、既有验收全部继续成立。
 *
 * ★★ 配方归属：云配方**跟随大气配方**（2026-10-01 总监定）★★
 *
 *   `CLOUD_RECIPES` 的键与 `MIXTURES`（大气配方）的键是**同一个 id 空间**，
 *   都表示"这是哪颗天体"。选了大气的 kerbin，云就取 kerbin 那一套；
 *   该天体在云表里没有条目 ⇒ 取 `none`（**这不是静默回落，是"这颗天体没有云"**，
 *   面板上的「启用云层」会自动显示为关，人一眼就能看见）。
 *
 *   为什么不给云单独一个下拉：那会允许出现"大气选 Kerbin、云选 none"这种
 *   **自相矛盾**的组合。本项目对这类状态的一贯纪律是**让矛盾状态不可表达**
 *   （§13.28 太阳方位与光照模式、§13.31 天体与 albedo 图），而不是靠人去记。
 *   想做 A/B 对照的话，面板上仍有**显式的「启用云层」覆盖开关**，那是有意为之。

/**
 * 云层配方表。
 *
 * 本轮只交付 **kerbin** 一套（总监 2026-10-01 定的范围）：
 * Eve / Jool 暂不给预设 —— 它们要么吃 `bandPattern`（Jool 的带纹），
 * 要么对亮度极敏感（Eve，见 §13.48 第三节），都不该在没有对照图的情况下
 * 顺手塞一个数进来。**没有把握就不写数**。
 *
 * 但**结构上已经按"逐天体一套"准备好了**：新增一颗天体只要在这里加一条，
 * 面板的「云配方」下拉会自动出现它，切过去即切全套（含几何与观感），
 * 不需要改面板或渲染器代码。
 */
/**
 * ★ 纬向气候带的**默认剖面**（每 15° 一个控制点，−90 → +90）★
 *
 * 数值取自地球云量的相对形状：副热带高压 ~0.45、赤道辐合带 ~0.70，比值约 1.55。
 * 它只是**乘法倍率**；真正生效前会被 `zoneNormalizer` 面积加权归一化到均值 1
 * ⇒ 全局云量仍精确等于 `coverage` ✓
 *
 * 用表而不是拟合公式：可直接读写、可直接调，没有"公式看着对但形状不对"的余地。
 */
export const DEFAULT_ZONE_PROFILE = [
    0.95,   // −90 南极
    1.05,   // −75
    1.30,   // −60 南风暴带
    1.45,   // −45
    0.70,   // −30 南副热带高压（晴）
    0.85,   // −15
    1.55,   //   0 赤道辐合带（多云）
    0.85,   // +15
    0.70,   // +30 北副热带高压（晴）
    1.45,   // +45
    1.30,   // +60 北风暴带
    1.05,   // +75
    0.95,   // +90 北极
];

export const CLOUD_RECIPES = {
    /** 无云：coverage = 0 ⇒ 判据 b <= 0 几乎处处不成立；opacity = 0 再兜一道 */
    none: {
        label: '无云',
        field: Object.assign({}, FIELD_BASE, { scale: 1 }),
        render: {
            coverage: 0,
            softness: 0.001,
            edgePx: 4,
            selfShadow: 0,
            heightShade: 0,
            opacity: 0,
            altitude: 1.004,
            color: [1, 1, 1],
            enabled: false,
            windSpeed: 0,
            windShear: 0,
            windShearMax: 0,
            evolveRate: 0,
            birthAmount: 0,
            birthScale: 2,
            birthPhase: 0,
        },
    },

    kerbin: {
        label: '类地 Kerbin（白）',
        field: Object.assign({}, FIELD_BASE),
        // ★★ 2026-10-01 由总监在实验室逐项调定 ★★
        //   调法：把「启用云层」打开，拖覆盖率 / 云缘柔和度 / 最大不透明度 / 云壳高度。
        //   ⚠️ 这四个数**只写在这里**。面板的初始值由 solveCloudRecipe('kerbin') 读出来
        //      （见 panelSchema.js 的 CLOUD_DEFAULT）—— 手写第二份必然漂移，
        //      §13.30 那 15 处预设漂移就是这么来的。
        //   ⚠️ 改这四个数**不需要重烘云图**：它们都在渲染期施加（这正是当初把
        //      "未阈值化的分位"存进图里、而不是烤最终 alpha 的原因）。
        render: {
            coverage: 0.11,
            // ★ 语义 2026-10-01 已变 ★ 阈值换成 Beer–Lambert 后，本项从"阈值宽度"
            //   变成"τ 下降 1 所需的 b 跨度"。旧调定值 0.005 在新口径下只给约 2 px
            //   的 α 过渡（仍是硬边），所以默认改为 0.02（约 9 px）。
            //   ⚠️ 这不是旧值的等价换算，需要总监重新用眼睛定。
            softness: 0.02,
            // ★ 体积感两项（2026-10-01 新增）★ 0 = 关（逐像素退化成「平面贴纸」）
            //   selfShadow  B 方向自阴影：朝太阳的坡面亮（乘 uDiffuse ⇒ 平光下消失）
            //   heightShade A 高度反照率：云缘陡坡比顶部暗（与光照方向无关）
            //   两者共用**一次**额外的场求值（b 沿太阳切向的方向导数）。
            //   ⚠️ 这两个数是**起始值**，需要总监看画面定 —— 我按「±15~30% 的亮度起伏」
            //      估的：∂b/∂s 对本场的量级约 0.5/rad，故 0.5 × 0.5 ≈ 0.25。
            selfShadow: 0.5,
            heightShade: 0.35,
            // ★★ 纬向气候带（2026-10-02）★★
            //   真实地球从太空看，**第一眼认出来的是"带"**：
            //     赤道辐合带 ITCZ 多云 → 副热带高压**晴** → 中纬风暴带多云 → 极区中等
            //   做法： `coverage_eff(纬度) = coverage × zone(纬度)`
            //   表是**每 15° 一个控制点**（−90 → +90，共 13 个），线性插值。
            //   用表而不是拟合公式：可直接读写、可直接调，且没有"公式看着对但形状不对"的余地。
            //
            //   ★ 归一化 ★ `zoneNormalizer` 会把表**面积加权（cos 纬度）归一化到均值 1**
            //   ⇒ **全局云量仍精确等于 coverage**，语义不破 ✓
            //   `zoneStrength` 是"气候带强度"：0 = 平坦（完全均匀），1 = 全强度。
            //
            //   数值取自地球云量的相对形状（副热带 ~0.45、ITCZ ~0.70，比值约 1.55）。
            zoneStrength: 1,
            zoneProfile: DEFAULT_ZONE_PROFILE,
            // 云缘过渡宽度的**屏幕空间下限**（像素）。见 cloudShaders.js 的 Beer–Lambert 段：
            // 光有 softness 不够 —— b 的屏幕梯度会把坡道压成亚像素级，实测 1 px 硬边。
            // 这一项让坡道恒为约 4 px，且与分辨率无关。
            edgePx: 4,
            // ★ 0.46 → 0.61（2026-10-02 总监在面板上亲手调定，固化）★
            //   背景：从真实地球参照图量出来，「亮且不饱和」判据下我们的云量只有 2.6%
            //   （地球 33%），其中一部分原因是**云太透明**（最厚处也只有 46% 不透明，
            //   合成后亮度够不上"亮"的阈值）。总监判定 0.61 的观感最好。
            opacity: 0.61,
            altitude: 1.004,
            // 白色 = 物理正确（水云就是白的）。将来 Eve / Jool 在这里给配色。
            color: [1, 1, 1],
            // ⚠️ enabled 只是"这套配方想不想要云"；**能否真的画出来还要看有没有大气** ——
            //    见 meshRenderer 的 drawClouds 与 panelSchema 的 cloudEnabled 映射：
            //    "没大气却有云"这个状态被做成了**不可表达**。
            enabled: true,
            // ---- 时间（第二步，2026-10-01 总监调定）----
            //   ① 平流 0.0005 圈/秒（整场绕一圈约 2000 s，慢而稳）
            //   ② 急流强度 **0** ⇒ 暂时不做切变成带；windOsc 因此当前不起作用，
            //      保留它是为了以后把强度调上去时不用再改结构
            //   ③ 折叠靠 warp 位移场随 evolveRate 演化
            //   ④ 生消幅度 0.08、片区尺度 0.75（片区比星径还大 ⇒ 大块出现/消散）
            windSpeed: 0.0005,
            // 急流强度（圈/秒）。它与 windShearMax 一起决定切变：
            //   **强度决定"剪得多快"，windShearMax 决定"最多剪到哪"**。
            windShear: 0,
            // ★ 急流进退幅度（圈）= 微分位移的**上界本身** ★
            //   0.3 圈 ≈ "云最多被纬向剪切 3/10 圈" —— 看得见成带，但不会变成细丝。
            //   ⚠️ 这里曾经是 `windOsc`（角频率 0.006），是个陷阱：上界 = 2·windShear/ω
            //      在 0.02 圈/秒下能到 **6.7 圈**，云会被剪成稀薄水平细丝。
            //      改成直接参数化上界之后，危险状态从参数空间里消失了。
            windShearMax: 0.3,
            evolveRate: 0.005,
            birthAmount: 0.08,
            birthScale: 0.75,
            // 空间相位：1 = 各区域的相位铺满两个时间格 ⇒ 彻底错相、全局停顿消失
            birthPhase: 1,
        },
    },

    /**
     * ★★ 气态巨星 Jool：**不同的装配**，不是"换几个数" ★★
     *
     * 判别字段 `model: 'gasGiant'` 让渲染器分派到**第二条 α/颜色来源**：
     *   地球的云问「这一像素**有没有**云」   ⇒ 阈值口径（coverage / CDF / softness）
     *   巨星的云问「这一像素的云顶**是什么**」⇒ 逐纬度色表 + 乘性纹理，α ≡ 1
     * 用判别字段而不是按天体 id 硬编码：将来再来一颗巨行星不必复制判断，
     * 而且「大气选 Kerbin、云选巨星级」这类矛盾组合在数据上就无法表达。
     *
     * ⚠️ field / render 按**引用**取自 gasGiantCloudRecipe.js（唯一真源），
     *    这里**不复制数值** —— 两处各存一份必然漂移（§13.30 的 15 处预设漂移）。
     *    气态巨星特有的 band / texture 两块也在那边，由 solveGasGiantRecipe 读。
     */
    jool: {
        label: GAS_GIANT_RECIPES.jool.label,
        model: GAS_GIANT_RECIPES.jool.model,
        field: GAS_GIANT_RECIPES.jool.field,
        render: GAS_GIANT_RECIPES.jool.render,
    },
};

/**
 * 取一个云层配方，返回**已展开为扁平结构**的一份拷贝。
 *
 * 展开而不是让调用方自己拼：烘焙工具与渲染器需要的字段名不同
 * （前者只要 field.*，后者只要 render.*），让它们各自解构极易写错。
 * 这里一次性给全，两边都只读自己那几个。
 *
 * @param {string} id 配方 id（CLOUD_RECIPES 的键）
 * @returns {object} { id, label, ...烘焙期字段, ...渲染期字段 }
 * @throws {Error} 配方不存在时 —— **不回落**（与 bodyResolve 同一条纪律）
 */
export function solveCloudRecipe(id) {
    const r = CLOUD_RECIPES[id];
    if (!r) {
        throw new Error('未知的云层配方「' + id + '」。可用：'
            + Object.keys(CLOUD_RECIPES).join(' / ')
            + '。这里刻意不回落默认配方 —— 静默用另一套云比报错危险得多'
            + '（同类事故见交接文档 §13.21 / §13.31）。');
    }
    const out = Object.assign({ id: id, label: r.label || id, model: r.model || 'overlay' },
        r.field, r.render);
    // ★ 种子必须能精确表示成 float32 ★
    //   不拦住的话症状是"GPU 算的是另一个场"，而画面看着仍然像云 ——
    //   只有 CPU↔GPU 对拍能发现，代价太大。这里直接报错。
    if (!(out.seed >= 0 && out.seed < CLOUD_SEED_MAX)) {
        throw new Error('云配方「' + id + '」的 seed = ' + out.seed
            + ' 超出可精确表示的范围 [0, ' + CLOUD_SEED_MAX + ')。'
            + 'seed 以 float uniform 传给着色器，超过 2²⁴ 会让 GPU 算出一个'
            + '与 CPU 完全无关的场（见 CLOUD_SEED_MAX 的说明）。');
    }
    return out;
}

/**
 * 由**大气配方 id**（= 天体 id）解析云配方 —— 「云跟随大气」的**唯一换算点**。
 *
 * 与 solveCloudRecipe 的分工：
 *   · solveCloudRecipe(id) —— **严格**：id 不存在就报错。给"已经确定要哪套"的调用方。
 *   · 本函数 —— **宽容**：该天体没有云条目就返回 `none`。
 *     因为"这颗天体没有云"是**合法状态**（Mun / Duna 就是没有），不是配置错误。
 *     但它返回的配方一律 `enabled: false`，面板上的「启用云层」会如实显示为关
 *     ⇒ 人一眼看得见，**不是静默回落**。
 *
 * @param {string} atmoPresetId 大气配方 id（atmosphereSpecies.js 的 MIXTURES 的键）
 * @returns {{recipe:object, matched:boolean}} matched=false 表示该天体无云、已取 none
 */
export function cloudRecipeForBody(atmoPresetId) {
    if (Object.prototype.hasOwnProperty.call(CLOUD_RECIPES, atmoPresetId)) {
        return { recipe: solveCloudRecipe(atmoPresetId), matched: true };
    }
    return { recipe: solveCloudRecipe('none'), matched: false };
}

/**
 * ★★ 种子的硬上界：2²⁴ = 16777216 ★★
 *
 * 为什么：seed 以 **float uniform** 传给着色器（`setUniforms` 对标量走 `uniform1f`），
 * 而 float32 只能**精确表示 ≤ 2²⁴ 的整数**。种子一旦超过它，
 * 着色器里 `int(uFieldSeed + 0.5)` 拿到的就是**另一个数** ⇒ 每个格点哈希都变
 * ⇒ GPU 算出一个与 CPU **完全无关**的场。
 *
 * 实测代价（2026-10-01）：`seed: 20261001` 超界，CPU↔GPU 对拍的平均 |Δb|
 * 是 **0.330 ≈ 1/3** —— 那正是两个互不相关的均匀分布之差的期望值。
 * 症状不是"略有差异"，而是"根本不是一个场"，所以很难从画面上看出来。
 *
 * ⇒ `solveCloudRecipe` 会**直接报错**，不允许静默取整。
 */
export const CLOUD_SEED_MAX = 16777216;

/**
 * ★★ 云场噪声：**自带实现，且刻意用 24 位归一化** ★★
 *
 * 为什么不复用 tools/noiseOps.mjs 的 valueNoise3D：
 *   那一个把 32 位哈希整数值直接 `h / 2³²` 归一化，而着色器里 `float(uint)`
 *   在 32 位时会丢到 24 位尾数 ⇒ **JS 与 GLSL 必然差 ~2⁻²⁴**。
 *   差这么一点在画面上无所谓，但会让"CPU↔GPU 逐像素对拍"永远只能给容差，
 *   而本项目的纪律是**能做成硬断言的就不要留容差**。
 *   ⇒ 这里只取哈希的高 24 位（`h >>> 8`）再除以 2²⁴：
 *     24 位整数在 float32 里**精确可表示**，除法又是 2 的幂 ⇒ 两侧逐位相同。
 *
 * ⚠️ 因此本函数与 noiseOps.valueNoise3D **不是同一个序列**（值不同、统计相同）。
 *    这是有意的：把"可为空的容差"换成"逐位一致"。
 *    tools/noiseOps.mjs 保持不动（它服务于烘焙/细节层/特征场，动它会作废既有产物）。
 *    GLSL 侧的逐行移植见 src/planet/shaders/cloudFieldGLSL.js，
 *    两者的一致性由 tools/checkCloudField.mjs 对拍守住。
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} seed
 * @returns {number} [-1, 1]
 */
export function cloudNoise3D(x, y, z, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);
    const s = seed | 0;
    const c000 = hashCell(ix, iy, iz, s);
    const c100 = hashCell(ix + 1, iy, iz, s);
    const c010 = hashCell(ix, iy + 1, iz, s);
    const c110 = hashCell(ix + 1, iy + 1, iz, s);
    const c001 = hashCell(ix, iy, iz + 1, s);
    const c101 = hashCell(ix + 1, iy, iz + 1, s);
    const c011 = hashCell(ix, iy + 1, iz + 1, s);
    const c111 = hashCell(ix + 1, iy + 1, iz + 1, s);
    const x00 = lerp(c000, c100, fx);
    const x10 = lerp(c010, c110, fx);
    const x01 = lerp(c001, c101, fx);
    const x11 = lerp(c011, c111, fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
}

/**
 * 四维值噪声（时间就是第 4 维）。输出 [-1, 1]。
 * 与 cloudNoise3D 同一套哈希，同样 24 位归一化。
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} w
 * @param {number} seed
 * @returns {number} [-1, 1]
 */
export function cloudNoise4D(x, y, z, w, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const iw = Math.floor(w);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);
    const fw = fade(w - iw);
    const s = seed | 0;
    // 16 个角：只有 w 那一位不同，展开写比双层循环快且与 GLSL 一一对应
    const a000 = hashCell4(ix, iy, iz, iw, s);
    const a100 = hashCell4(ix + 1, iy, iz, iw, s);
    const a010 = hashCell4(ix, iy + 1, iz, iw, s);
    const a110 = hashCell4(ix + 1, iy + 1, iz, iw, s);
    const a001 = hashCell4(ix, iy, iz + 1, iw, s);
    const a101 = hashCell4(ix + 1, iy, iz + 1, iw, s);
    const a011 = hashCell4(ix, iy + 1, iz + 1, iw, s);
    const a111 = hashCell4(ix + 1, iy + 1, iz + 1, iw, s);
    const b000 = hashCell4(ix, iy, iz, iw + 1, s);
    const b100 = hashCell4(ix + 1, iy, iz, iw + 1, s);
    const b010 = hashCell4(ix, iy + 1, iz, iw + 1, s);
    const b110 = hashCell4(ix + 1, iy + 1, iz, iw + 1, s);
    const b001 = hashCell4(ix, iy, iz + 1, iw + 1, s);
    const b101 = hashCell4(ix + 1, iy, iz + 1, iw + 1, s);
    const b011 = hashCell4(ix, iy + 1, iz + 1, iw + 1, s);
    const b111 = hashCell4(ix + 1, iy + 1, iz + 1, iw + 1, s);

    const x00a = lerp(a000, a100, fx);
    const x10a = lerp(a010, a110, fx);
    const x01a = lerp(a001, a101, fx);
    const x11a = lerp(a011, a111, fx);
    const ya = lerp(lerp(x00a, x10a, fy), lerp(x01a, x11a, fy), fz);

    const x00b = lerp(b000, b100, fx);
    const x10b = lerp(b010, b110, fx);
    const x01b = lerp(b001, b101, fx);
    const x11b = lerp(b011, b111, fx);
    const yb = lerp(lerp(x00b, x10b, fy), lerp(x01b, x11b, fy), fz);

    return lerp(ya, yb, fw) * 2 - 1;
}

/**
 * 32 位整数哈希（与 noiseOps.hashInt 同一套位运算，纯整数、跨引擎一致）。
 * @param {number} x
 * @returns {number} 无符号 32 位
 */
function hashInt(x) {
    let h = x | 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D);
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
}

/**
 * 三维格点 → [0,1)。**只取高 24 位**（见 cloudNoise3D 的说明）。
 * @returns {number}
 */
function hashCell(ix, iy, iz, seed) {
    const h = hashInt(Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)
        ^ Math.imul(iz, 1274126177) ^ Math.imul(seed | 0, 2246822519));
    return (h >>> 8) / 16777216;
}

/**
 * 四维格点 → [0,1)。第 4 维用另一个乘子混入。
 * @returns {number}
 */
function hashCell4(ix, iy, iz, iw, seed) {
    const h = hashInt(Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)
        ^ Math.imul(iz, 1274126177) ^ Math.imul(iw, 1013904223)
        ^ Math.imul(seed | 0, 2246822519));
    return (h >>> 8) / 16777216;
}

/** 五次平滑插值（Perlin fade），一阶二阶导连续 */
function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 线性插值 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * 经纬度 → 单位球方向（与本项目 UV 约定一致：u = 经度、v = 纬度，v = 0 为南极）。
 * 与 noiseOps.uvToDirection 同一个式子 —— 这里自带一份是为了让 cloudRecipe.js
 * **不依赖 tools/**（它是 src/ 侧的模块，而 GLSL 也要用同一个式子）。
 *
 * @param {number} u [0,1)
 * @param {number} v [0,1]
 * @returns {number[]} 单位向量 [x, y, z]
 */
export function uvToDirection(u, v) {
    const lat = (v - 0.5) * Math.PI;
    const theta = (u - 0.5) * Math.PI * 2;
    const cl = Math.cos(lat);
    return [cl * Math.sin(theta), Math.sin(lat), cl * Math.cos(theta)];
}

/**
 * 三维域扭曲：用一层噪声偏移采样坐标，制造「流动感」（涡旋 / 云带都要用）。
 * 与 noiseOps.domainWarp3D 同一个式子，但走本文件的 24 位噪声。
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} strength 偏移强度（以噪声格为单位）
 * @param {number} scale 扭曲噪声的频率
 * @param {number} seed
 * @returns {number[]} 扭曲后的 [x, y, z]
 */
function domainWarp3D(x, y, z, strength, scale, seed, w) {
    const s = (seed | 0) + 977;
    const ox = cloudNoise4D(x * scale, y * scale, z * scale, w, s);
    const oy = cloudNoise4D(x * scale + 31.7, y * scale + 11.3, z * scale + 71.1, w, s);
    const oz = cloudNoise4D(x * scale + 53.1, y * scale + 97.9, z * scale + 17.5, w, s);
    return [x + ox * strength, y + oy * strength, z + oz * strength];
}

/**
 * 脊状噪声（卷云状的细丝）。与 noiseOps.ridged3D 同一个式子。
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {object} params { octaves, gain, seed }
 * @returns {number} [0,1]
 */
function ridged3D(x, y, z, params, w) {
    const octaves = Math.max(1, params.octaves === undefined ? 4 : params.octaves);
    const gain = params.gain === undefined ? 0.5 : params.gain;
    const seed = params.seed | 0;
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
        const n = 1 - Math.abs(cloudNoise4D(x * freq, y * freq, z * freq, w, seed + o * 197));
        sum += n * amp;
        norm += amp;
        freq *= 2;
        amp *= gain;
    }
    return norm > 0 ? sum / norm : 0;
}

/**
 * ★★ CDF 重映射表：把场值换成「这个像素变成云所需的覆盖率」★★
 *
 * 这是烘焙版「面积加权直方图均衡化」的**运行时等价物**，也是
 * `coverage = 云量比例` 这条语义在"不搞贴图"之后还能成立的全部理由。
 *
 * 为什么可以只算一次：场是**平稳随机过程** —— 值分布与位置无关、与时间无关。
 * 所以 CDF 是场参数的函数，不是像素的函数。着色器只拿一张几十项的常量表
 * （**不是贴图**：以 uniform 数组传入）做一次插值即可。
 *
 * ⚠️ 必须**按球面面积加权**：等距圆柱采样里每行代表的球面面积 ∝ cos(纬度)，
 *    不加权的话"45% 的云"会变成"45% 的采样点"。这一条与烘焙版一字不差。
 * ⚠️ 必须在 **log 域**建表：乘性级联是对数正态，线性域里几乎所有值会挤进第一个 bin。
 *
 * @param {object} field 场参数
 * @param {object} [opts]
 * @param {number} [opts.width=256] 采样列数（一次性开销；256×128 ≈ 0.1 s）
 * @param {number} [opts.height=128]
 * @param {number} [opts.lutSize=64] 表长（作为 uniform 数组传进着色器）
 * @returns {{lut: Float64Array, logMin: number, logMax: number, samples: number}}
 */
export function buildCloudCdf(field, opts) {
    const o = opts || {};
    const w = Math.max(8, o.width === undefined ? 256 : o.width | 0);
    const h = Math.max(4, o.height === undefined ? 128 : o.height | 0);
    const lutSize = Math.max(4, o.lutSize === undefined ? 64 : o.lutSize | 0);
    const bins = 1024;
    const TINY = 1e-12;

    const rowW = new Float64Array(h);
    const values = new Float64Array(w * h);
    let weightSum = 0;
    let logMin = Infinity;
    let logMax = -Infinity;

    for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h;
        const rw = Math.cos((v - 0.5) * Math.PI);   // 面积权重
        rowW[y] = rw;
        weightSum += rw * w;
        for (let x = 0; x < w; x++) {
            const f = sampleCloudField((x + 0.5) / w, v, field);
            const i = y * w + x;
            values[i] = f;
            const lv = Math.log(f > TINY ? f : TINY);
            if (lv < logMin) logMin = lv;
            if (lv > logMax) logMax = lv;
        }
    }

    const span = Math.max(1e-9, logMax - logMin);
    const hist = new Float64Array(bins);
    for (let y = 0; y < h; y++) {
        const rw = rowW[y];
        for (let x = 0; x < w; x++) {
            const f = values[y * w + x];
            const lv = Math.log(f > TINY ? f : TINY);
            let b = Math.floor((lv - logMin) / span * (bins - 1));
            if (b < 0) b = 0;
            if (b > bins - 1) b = bins - 1;
            hist[b] += rw;
        }
    }

    const cum = new Float64Array(bins);
    let acc = 0;
    for (let i = 0; i < bins; i++) {
        acc += hist[i];
        cum[i] = acc / weightSum;
    }
    const lut = new Float64Array(lutSize);
    for (let i = 0; i < lutSize; i++) {
        const t = i / (lutSize - 1) * (bins - 1);
        const b0 = Math.min(bins - 1, Math.floor(t));
        const b1 = Math.min(bins - 1, b0 + 1);
        const fr = t - b0;
        lut[i] = cum[b0] * (1 - fr) + cum[b1] * fr;
    }

    return { lut: lut, logMin: logMin, logMax: logMax, samples: w * h };
}

/**
 * 把场值换成「这个像素变成云所需的覆盖率」b = 1 − 面积分位。
 *
 * ★ 这是 CPU 侧的**规范映射**，与 GLSL 的 `cfFieldToB` **同式同序** ★
 *   （查表在 log 域、clamp 后在 [0, n−1] 上取整、插值用 `a + (b−a)·t`）。
 *   对拍工具与验收工具都走这一个函数，避免"两条路各写一遍"。
 *
 * @param {number} f 场值
 * @param {{lut: Float64Array, logMin: number, logMax: number}} cdf buildCloudCdf 的返回
 * @returns {number} b ∈ [0,1]（**未量化**；着色器同样用浮点比较，不经过 8 位）
 */
export function cloudFieldToB(f, cdf) {
    const n = cdf.lut.length;
    const lv = Math.log(f > 1e-12 ? f : 1e-12);
    const span = Math.max(1e-9, cdf.logMax - cdf.logMin);
    let t = (lv - cdf.logMin) / span;
    t = Math.min(1, Math.max(0, t)) * (n - 1);
    const i0 = Math.min(n - 2, Math.floor(t));
    const fr = t - i0;
    return 1 - (cdf.lut[i0] + (cdf.lut[i0 + 1] - cdf.lut[i0]) * fr);
}

/**
 * ④ 生消：低频 4D 噪声对**局部覆盖率**的零均值增量。
 *
 * 与 GLSL 的 `cfBirthDelta` 同式同序（对拍会一起验）。
 * 作用在 **b** 上而不是场上 ⇒ 不影响 CDF、也不破坏"coverage = 云量比例"的**期望**
 * （零均值调制），只是让云成片地出现/消散 —— 那是真实卫星云图里最显眼的一件事。
 *
 * @param {number} u
 * @param {number} v
 * @param {object} field
 * @param {number} t 时间（秒）
 * @returns {number} [-birthAmount, +birthAmount]
 */
export function birthNoise(u, v, field, t) {
    const d = uvToDirection(u, v);
    const bs = field.birthScale === undefined ? 2 : field.birthScale;
    const seed = field.seed | 0;
    // ★ 空间相位 ★ —— 见文件头「生消的格点停顿」。birthPhase = 0 时退回旧行为。
    const ph = (field.birthPhase || 0)
        * cloudNoise4D(d[0] * bs, d[1] * bs, d[2] * bs, 0, seed + 881);
    return cloudNoise4D(d[0] * bs, d[1] * bs, d[2] * bs,
        t * (field.evolveRate || 0) + ph, seed + 4409);
}

/**
 * 纬向气候带的控制点数（−90° → +90°，每 15° 一个）。**必须与 GLSL 的数组长度一致**。
 */
export const ZONE_POINTS = 13;

/**
 * 纬度处的气候带倍率（线性插值）。**与 GLSL 的 cfZoneAt 同式。**
 * @param {number} v uv.y ∈ [0,1]（v = 0 为南极，与 uvToDirection 一致）
 * @param {Array<number>|Float32Array} profile 13 个控制点
 */
export function zoneProfileAt(v, profile) {
    const t = Math.min(ZONE_POINTS - 1, Math.max(0, v * (ZONE_POINTS - 1)));
    const i0 = Math.min(ZONE_POINTS - 2, Math.floor(t));
    const f = t - i0;
    const a = profile[i0];
    const b = profile[i0 + 1];
    return a + (b - a) * f;
}

/**
 * 把「强度混合 + 面积加权归一化」合并成一个标量。
 *
 * 定义：`zone(v) = [1 + strength·(profile(v) − 1)] / norm`，
 * 其中 `norm` 是分子在球面上的**面积加权（cos 纬度）平均**。
 * ⇒ `zone` 的球面平均恒为 **1** ⇒ `coverage` 的语义（全局云量比例）**原样保住** ✓
 *
 * ⚠️ norm 必须按**插值后**的曲线积分，不能只对 13 个控制点求平均 ——
 *    两者在控制点之间不等价（实测会差百分之几）。
 *    这里用 1° 步长采样插值曲线，精度足够且与 GLSL 的插值一致。
 *
 * @param {Array<number>|Float32Array} profile
 * @param {number} strength 0 = 平坦
 * @returns {number} norm（strength = 0 时恒为 1）
 */
export function zoneNormalizer(profile, strength) {
    if (!(strength > 0)) {
        return 1;
    }
    let sum = 0;
    let wsum = 0;
    const N = 360;
    for (let i = 0; i < N; i++) {
        const v = (i + 0.5) / N;
        const w = Math.cos((v - 0.5) * Math.PI);
        sum += w * (1 + strength * (zoneProfileAt(v, profile) - 1));
        wsum += w;
    }
    return sum / wsum;
}

/**
 * 生消对 b 的增量（**未归一化**）。真正使用时必须减去 cloudBirthMean。
 *
 * ⚠️ 别直接用它 —— 见 cloudBirthMean 的说明。
 */
export function cloudBirthDelta(u, v, field, t) {
    const amt = field.birthAmount || 0;
    if (amt === 0) {
        return 0;
    }
    return birthNoise(u, v, field, t) * amt;
}

/**
 * ★★ 生消的**球面平均** —— 必须从 b 里减掉它 ★★
 *
 * 为什么：`birthScale` 很小（0.75）意味着生消片区**比半球还大** ⇒ 整个可见半球会
 * **同时**进入"晴"相位 ⇒ 全局云量剧烈摆动。实测（nominal coverage 0.11）：
 * 云量在 **5.16% ~ 16.20%** 之间摆，相对摆幅 **±50%**。
 * 总监截到的"稀薄水平细丝"画面就是云量低谷（5%）的时刻 —— 稀疏的云自然读作细丝。
 *
 * 减掉球面平均之后：
 *   · **全局云量的期望精确守恒**（不再只是"平均意义上"守恒）
 *   · **物理上更对**：大气水汽守恒 —— 云在这边生成就意味着在那边消散，
 *     而不是"整颗星球一起变多变少"
 *   · 观感上生消从"整球一起变晴变阴"变成"此起彼伏"
 *
 * 成本：生消场是低频的，**24×12 = 288 个采样点**就足够（每帧一次，与像素数无关）。
 *
 * @param {object} field
 * @param {number} t 时间（秒）
 * @returns {number} 球面面积加权的平均增量
 */
export function cloudBirthMean(field, t) {
    const amt = field.birthAmount || 0;
    if (amt === 0) {
        return 0;
    }
    const NU = 24;
    const NV = 12;
    let sum = 0;
    let wsum = 0;
    for (let j = 0; j < NV; j++) {
        const v = (j + 0.5) / NV;
        const w = Math.cos((v - 0.5) * Math.PI);
        for (let i = 0; i < NU; i++) {
            sum += w * birthNoise((i + 0.5) / NU, v, field, t);
            wsum += w;
        }
    }
    return (sum / wsum) * amt;
}

/**
 * 逐像素求云场值（**乘性级联**）—— 本文件是它的**唯一真源**。
 *
 * ★ 2026-10-01：从"烘焙成贴图"改为"**着色器里实时算**"（总监定：云场不搞贴图）★
 *   理由：云要随时间流动与变化，还要逐天体不同；贴图版既不能原地演化，
 *   又要为每颗天体各存一张 8 MB 的图。
 *   GLSL 侧的逐行移植见 src/planet/shaders/cloudFieldGLSL.js，
 *   一致性由 tools/checkCloudField.mjs 的 **CPU↔GPU 逐像素对拍**守住。
 *
 * ⚠️ 因此本文件不再接受"注入噪声算子"：噪声自带（cloudNoise3D/4D，24 位归一化），
 *    这样 JS 与 GLSL 才可能逐位对齐。详见 cloudNoise3D 的说明。
 *
 * ⚠️ 返回的是**单调于"云量"的连续值**，绝对量纲无所谓 —— 渲染端会用一张
 *    **CDF 重映射表**把它换成"变成云所需的覆盖率"（见 buildCloudCdf）。
 *    这里只负责**空间结构**。
 *
 * @param {number} u 经度参数 [0,1)
 * @param {number} v 纬度参数 [0,1]，v=0 为南极（与 uvToDirection 一致）
 * @param {object} field 场参数（scale/octaves/gain/cascade/warp/…/ridge/seed）
 * @param {number} [t=0] **时间（秒）**。四个时间效应都 ∝ t ⇒ t = 0 时逐位退化成静态场：
 *        ① 平流 `u += wind(lat)·t`；② 切变随纬度的 wind 自动出来；
 *        ③ 折叠来自"位移场取自未平流位置"；④ 生消走第 4 维噪声（w = t·evolveRate）。
 *        不按 t 分支是有意的 —— 见 shaders/cloudFieldGLSL.js 文件头第 ④ 条。
 * @returns {number} 单调于云量的连续值（> 0）
 */
export function sampleCloudField(u, v, field, t) {
    const tt = t === undefined ? 0 : t;
    const dirRaw = uvToDirection(u, v);

    // ---- ① 纬向组织：把纬度方向的频率抬高 ⇒ 云系拉成东西向长条 ----
    //   方向向量里 dir.y = sin(纬度)，dir.x/dir.z 张成经度方向。
    //   只放大 dir.y 不会破坏 u 方向的周期性（周期性由 dir.x/dir.z 承担）
    //   ⇒ 无缝性不受影响。
    const stretch = field.bandStretch > 0 ? 1 + field.bandStretch * 4 : 1;
    const s = field.scale;

    // ---- ① 平流 + ② 切变 ----
    //   纬向风让 u 平移。wind 随纬度变 ⇒ 相邻纬带相对滑动 ⇒ **切变自动出来**
    //   （拉伸、倾斜、成带），不需要另写一项。
    //   用 cos(2φ) = 1 − 2sin²φ 做剖面：赤道一个方向、两极反过来，像真实的急流带。
    //   ⚠️ sin(纬度) 直接取 dirRaw[1]（而不是 2v−1）—— 后者是**线性**的，不是正弦，
    //      会让 CPU 与 GLSL 的"纬度"定义出现分歧。
    //
    //   ★★ 微分位移必须**有界**，否则图案会被剪成无限细的丝 ★★
    //   实测（2026-10-01）：单纯 `u += windShear·cos2φ·t`，在 0.003 圈/秒下
    //   t = 1200 s 时各纬度之间相对滑了 **7.2 圈**，画面变成一片水平细丝。
    //   物理上真实急流本来就会南北**进退**，所以这里让切变按 sin(ωt) 摆动，
    //   并把平流写成**积分形式**，且**直接以"上界"为参数**：
    //       位移 = windSpeed·t + cos2φ · D · (1 − cos(ω·t)) / 2,   ω = 2·windShear / D
    //   前一项（均匀漂移）线性增长 —— **无害**，因为 u 是周期量、整场旋转看不出来；
    //   后一项（微分部分）**上界恒等于 D**（代入即知 windShear 被约掉了）✓
    //
    //   ★★ 为什么参数是 D（「急流进退幅度」，单位：圈）而不是角频率 ★★
    //   曾经暴露的是 `windOsc`（角频率）。那是个**陷阱**：上界 = 2·windShear/ω，
    //   而 ω 取小一点（预设里是 0.006）就让"有界"在实用上失效 ——
    //   实测 windShear 0.02（面板上限）配上 ω=0.006 ⇒ 上界 **6.7 圈**，
    //   云会被剪成稀薄的水平细丝（总监就是这么撞上的）。
    //   更糟：ω = 0 曾是**可选中**的档位，而代码在 ω ≤ 0 时退回线性累积
    //   —— 等于把当初修掉的无界 bug 重新打开。
    //   ⇒ 改成直接参数化"上界"之后：用户设多少就是多少，**不可能失控**；
    //     D = 0 时整项恒为 0（而不是退化成无界），危险状态从参数空间里**消失**。
    const sinLat = dirRaw[1];
    const cos2phi = 1 - 2 * sinLat * sinLat;
    const shearAmt = field.windShear || 0;
    const dMax = field.windShearMax === undefined ? 0 : field.windShearMax;
    let disp = (field.windSpeed || 0) * tt;
    if (shearAmt !== 0 && dMax > 0) {
        const omega = 2 * shearAmt / dMax;
        disp += cos2phi * dMax * (1 - Math.cos(omega * tt)) * 0.5;
    }
    //   u + disp 可以超出 [0,1)：uvToDirection 用的是 sin/cos(theta)，天然按周期处理 ✓
    //   ⚠️ 不加 "t === 0 就走原路" 的分支：disp = 0 ⇒ u 逐位不变 ⇒ 结果与静态版相同，
    //      而有分支就多一条 CPU/GPU 可能分歧的路径（GLSL 侧同样不分）。
    const dir = uvToDirection(u + disp, v);

    const px0 = dir[0] * s;
    const py0 = dir[1] * s * stretch;
    const pz0 = dir[2] * s;
    // 未平流的位置（位移场的求值点）
    const bx = dirRaw[0] * s;
    const by = dirRaw[1] * s * stretch;
    const bz = dirRaw[2] * s;

    // 第 4 维：湍流演化与生消共用
    const wv = tt * (field.evolveRate || 0);

    // ---- ③ 两级域扭曲（"扭曲的扭曲"），位移场取自**未平流**的位置 ----
    //   云被平流带走、却滑过一个**固定在星球坐标系里的**湍流位移场
    //   ⇒ 被拉伸、折叠、撕开 —— 这才是"流动"而不是"整张图平移"。
    //   用"位移随 t 增长"也能折叠，但那会**无界**（最终拉成无限细的丝）；
    //   取固定位移场则位移有界，长时间也不会退化。
    //   ★ t = 0 时 dir === dirRaw ⇒ p 与静态版**逐位相同**（零变化保证）★
    let px = px0;
    let py = py0;
    let pz = pz0;
    if (field.warp > 0) {
        const w1 = domainWarp3D(bx, by, bz, field.warp, 0.5, field.seed, wv);
        const d1x = w1[0] - bx;
        const d1y = w1[1] - by;
        const d1z = w1[2] - bz;
        px += d1x;
        py += d1y;
        pz += d1z;
        if (field.warpDetail > 0) {
            // 第二级在 (位移场 + 一级位移) 处求值 —— 与静态版的嵌套一致，
            // 只是在**未平流**的坐标系里；位移量按 k 归一化。
            const k = field.warpDetailScale > 0 ? field.warpDetailScale : 1;
            const w2 = domainWarp3D((bx + d1x) * k, (by + d1y) * k, (bz + d1z) * k,
                field.warp * field.warpDetail, 0.9, field.seed + 61, wv);
            px += (w2[0] - (bx + d1x) * k) / k;
            py += (w2[1] - (by + d1y) * k) / k;
            pz += (w2[2] - (bz + d1z) * k) / k;
        }
    }

    // ---- ③ 乘性级联（本函数的核心）----
    //   每一层是 `1 + aₙ·noise`，**相乘**而不是相加。
    //   相加得到高斯场（集中、无长尾）；相乘得到对数正态场（长尾、大片近零）
    //   ⇒ 等值线稀疏成簇、有丝缕感，阈值化之后云会"长出来"而不是"淹上来"。
    let value = 1;
    let freq = 1;
    let amp = field.cascade;
    const octaves = Math.max(1, field.octaves | 0);
    for (let n = 0; n < octaves; n++) {
        const nz = cloudNoise4D(px * freq, py * freq, pz * freq, wv, field.seed + n * 131);
        value *= 1 + amp * nz;
        freq *= field.lacunarity;
        amp *= field.gain;
    }

    // ---- ④ 脊线掺入（卷云状的细丝）----
    //   同样是**乘性**掺入，否则会把上面辛苦堆出来的长尾重新抹平成高斯。
    if (field.ridge > 0) {
        const r = ridged3D(px * 0.6, py * 0.6, pz * 0.6, {
            octaves: 3,
            gain: 0.55,
            seed: field.seed + 907,
        }, wv);
        value *= 1 + field.ridge * (r - 0.5) * 2;
    }

    // 数值兜底：乘积理论上恒正，但浮点误差可能压到极小值；不允许返回负值
    return value > 0 ? value : 0;
}
