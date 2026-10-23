'use strict';

// 星球网格渲染器：矩形等距圆柱贴图 → 球体网格 → 正交俯视呈现。
//
// 对外接口（与 docs/交接文档.md §5.1 完全一致，迁移回 ksp—2d 时形状不变）：
//   createPlanetRenderer(gl)                 → 创建实例
//   renderer.setPlanet(bodyParams)           → 换天体（贴图 / 几何 / 光照参数；
//                                               白名单校验，不认字段显式报错 = B2-fix）
//   renderer.setCamera({ cx, cy, zoom })     → 俯视正交相机
//   renderer.render(dt)                      → 画一帧
//   renderer.setViewport({ x, y, width, height })  → 画面中的子矩形（一张画布分屏用）
//   renderer.unprojectToTexture({...})       → 把贴图按经纬度重投影（对比实验用）
//   renderer.measurePlanet({...})            → 离屏渲染并取回像素（对比实验用）
//   renderer.dispose()
//
// ★ 显式半径通道（标定层 T1，2026-10-16）★ —— 加参数实现，默认行为逐像素不变：
//   · params.screenRadiusPx（可选，默认 undefined）→ render(dt) 的交互路径
//   · desc.screenRadiusPx / desc.planetRadius / desc.zoom（可选）→ measurePlanet() 的量测路径
//   语义：以屏幕像素半径为锚，zoom_world = viewHeight/2、R_world = 2·R_px/viewHeight
//   （投影半高恒 ≈1、世界单位恒 O(1)，不越 ±8 裁剪体）；游戏口径
//   displayRadius × zoom → R_px 的换算属于标定工具层，渲染器只收像素。
//   默认 undefined 时两处保留原有表达式逐字不动，迁移契约不依赖本通道。
//
// 本模块**不读任何全局单例**（无 gameState / eventBus / sceneManager），
// 所有可变状态来自外部传入的参数对象，满足可迁移判据 M1 / M2。

import { createProgram, setUniforms, destroyProgram } from '../glCore/shader.js';
import { createMesh, drawMesh, destroyMesh } from '../glCore/mesh.js';
import { bindTexture, createTextureFromImage, createTextureFromData, destroyTexture } from '../glCore/texture.js';
import { createRenderTarget, destroyRenderTarget, readPixelsTopDown, resolveRenderTarget } from '../glCore/context.js';
import { buildSphereGeometry, buildFullscreenGeometry } from '../geometry/sphereMesh.js';
import { buildIrregularGeometry } from '../geometry/irregularMesh.js';
import { createAtmosphereLayer, ATMOSPHERE_PRESETS } from './atmosphereLayer.js';
import { createCloudLayer, CLOUD_PRESETS, CLOUD_SHELL_SEGMENTS, CLOUD_SHELL_RINGS } from './cloudLayer.js';
import { CLOUD_SHADOW_VERT, CLOUD_SHADOW_FRAG } from './shaders/cloudShaders.js';
import { buildCloudCdf, cloudBirthMean, zoneNormalizer, ZONE_POINTS, DEFAULT_ZONE_PROFILE } from './cloudRecipe.js';
import { solveGasGiantRecipe } from './gasGiantCloudRecipe.js';
import { RENDER_PARAM_EXTRA_KEYS } from '../config/renderParamKeys.js';

/**
 * 气态巨星的观感旋钮**默认值** —— 从配方读，**不在这里手写数值**。
 * ⚠️ 手写第二份必然漂移（§13.30 的 15 处预设漂移就是这么来的）：
 *    配方改了、这里的默认值没改，面板一进页面就把它顶掉，而画面"看着还行"。
 */
const GG_DEFAULT = solveGasGiantRecipe('jool');

/**
 * ★ 急流位移的**单帧时间上限**（秒）—— 总监 2026-10-04 选的「限幅」策略 ★
 *
 * 现在云有两个时间：`cloudTime`（图案演化，**跟随**游戏时间）与 `cloudWindTime`
 * （急流位移，**限幅**）。原因是 warp 之后 dt 会变成几秒，位移一快就**闪成一团**，
 * 而图案演化稍快反而更自然。
 *
 * ⚠️ 0.1 秒 ⇒ 正常帧（dt ≈ 1/60 ≈ 0.017）**完全不受影响**；
 *    只有 warp 到 6 倍以上才开始起作用。**改这个数就是改"多快算太快"。**
 */
const CLOUD_WIND_DT_MAX = 0.1;

import { solveExtinction, solveScatterOpticalDepth } from './atmosphereSpecies.js';
// ★ 大气光程（空气质量）的唯一真源 —— 与大气散射层**同一张表** ★
//   见 src/planet/airMass.js。本体着色器取的是这张表的"地表那一行"。
import { getSunColumnTable } from './airMass.js';
import { solveBiomeMaterials, applyMaterialOverride } from './materials.js';
import { solveSunAngularRadius, DEFAULT_SUN_ANGULAR_RADIUS_DEG } from './sun.js';
import {
    multiply4, orthographic, identity4, translation, rotationX, rotationY, scaling, normalMatrixFromModel,
} from '../glCore/matrix.js';
import {
    PLANET_VERT, PLANET_FRAG, UNPROJECT_VERT, UNPROJECT_FRAG, BLIT_FRAG, DIFF_FRAG,
} from './shaders/planetShaders.js';

/**
 * 逐群系参数表的默认值（未设置细节层时使用，长度与着色器的 MAX_BIOMES 对齐）。
 * 必须是 Float32Array —— setUniforms 对定长数组走 uniform1fv 路径。
 */
const IDENTITY_STRENGTH = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
const IDENTITY_SCALE = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
/** 逐群系起伏强度表为空时的缺省值（全 1 = 不缩放，与逐群系 detailStrength 同一个思路） */
const IDENTITY_RELIEF = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
/** 着色器里 MAX_BIOMES 的取值，改这里必须同步改 shader */
const MAX_BIOMES = 8;

/**
 * 逐群系**材质**参数表的默认值 = "没有材质"。
 *
 * ⚠️ f0 全 0 ⇒ 着色器跳过整个镜面分支 ⇒ 逐像素退回纯 Lambert。
 *    这是零行为变化的保证（与 IDENTITY_STRENGTH 同一个思路）。
 *    语义与合法区间见 src/planet/materials.js。
 */
const NO_MATERIAL_F0 = new Float32Array(MAX_BIOMES);
const NO_MATERIAL_ROUGH = new Float32Array(MAX_BIOMES).fill(1);
const NO_MATERIAL_WAVE_DEG = new Float32Array(MAX_BIOMES);
const NO_MATERIAL_WAVE_SCALE = new Float32Array(MAX_BIOMES).fill(1);
/** 没有细节层时的空材质表（f0 全 0 ⇒ 镜面分支整个跳过） */
const NO_MATERIAL_SOLVED = {
    f0: NO_MATERIAL_F0,
    rough: NO_MATERIAL_ROUGH,
    waveDeg: NO_MATERIAL_WAVE_DEG,
    waveScale: NO_MATERIAL_WAVE_SCALE,
    declared: 0,
};

/** 大气抹开高光的默认系数（见 DEFAULT_RENDER_PARAMS 的说明） */
const DEFAULT_GLINT_BLUR_K = 0.5;
const DEFAULT_GLINT_HALO_WIDTH = 3.0;

/**
 * 默认渲染参数（M2：全部可被外部覆盖，模块内不出现魔法数字）。
 *
 * 注意 uDiffuse / uEdgeDarkening 默认 0、uSunDir 指向相机：
 * 实测原图接近平光（无方向性光照，见交接文档 §4.5），所以阶段 0 的对比实验
 * 必须能在「无光照」下进行，光照只作为可选的观感项。
 */
export const DEFAULT_RENDER_PARAMS = {
    // 几何
    segmentCount: 128,
    ringCount: 64,
    useIrregularGeometry: false,
    irregular: null,

    // 姿态（绕 X = 轴倾角，绕 Y = 自转）
    tiltDeg: 0,
    spinDeg: 0,

    // 相机：zoom 单位为「世界单位 → 物理像素」的倍率
    zoom: 512,

    // ★ 光照方向 ★
    // ⚠️ 约定：**「朝相机」是 z 的负方向**（[0,0,-1]），不是 [0,0,1]。
    //    2026-09-26 实测：sunDir=[0,0,1] 时可见面亮像素 0.0%（全黑）、
    //    [0,0,-1] 时 99.4% 受光 —— 此前的注释写反了，缺省值也是反的。
    //    之所以长期没暴露：平光模式 ambient=1/diffuse=0 把 N·sunDir 消掉了；
    //    真实太阳模式又把 sunZ 强制为 0。两条路都绕开了它。
    //    ⚠️ 它还有一个"看不出但影响真实"的后果：平光 + 大气开启时，
    //       sunDir 会作为**大气散射的太阳方向**传下去，反了会让辉光图案错误。
    sunDir: [0, 0, -1],
    sunColor: [1, 1, 1],
    // ★ 太阳视半径（度）★ —— 镜面高光的角尺寸由 **max(粗糙度, 太阳视半径/2)** 决定，
    // 而不是只由粗糙度决定。见 src/planet/sun.js。
    // 默认 = 从 Kerbin 看 Kerbol 的真实值 1.102°（asin(261600/13599840)）。
    // 0 = 当作点光源（加这个特性之前的口径，用于 A/B 对照）。
    sunAngularRadiusDeg: DEFAULT_SUN_ANGULAR_RADIUS_DEG,
    // ★ 受光系数：1 = 完全受光，0 = 完全在阴影里（阳光被别的天体挡住）★
    //
    // 这是「食」与「飞船被星球遮挡光源」共用的接口 ——
    // 上游《渲染改造方案》§5.4 明确要求这两件事共用同一套光照模型。
    // 2D 俯视下的阴影是**圆柱阴影**：太阳在轨道平面内，天体投出一条带状阴影。
    // 判定（游戏侧算，渲染器只接收结果）：
    //   v = 遮挡体位置 − 被照体位置；t = v·sunDir；垂距 = |v − t·sunDir|
    //   t > 0 且 垂距 < 遮挡体半径 ⇒ 在阴影里 ⇒ 本参数置 0
    // 它同时作用于星球本体的直射光与大气散射 —— 没有阳光就没有散射（散射源已乘 sunT）。
    // 环境光（ambient）不受影响，所以阴影里不是绝对黑，仍有一点底光。
    sunOcclusion: 1,
    ambient: 1,
    diffuse: 0,
    edgeDarkening: 0,
    // ★ 水体材质的**实验室覆盖**（null = 用 biome-styles.json 里的真值）★
    //   { rough, waveDeg(度), waveScale } —— 只作用于**已声明材质**（f0>0）的群系。
    //
    //   为什么要开这个口：水面那三个参数是**观感参数**，靠"改 JSON → 重载页面 → 看一眼"
    //   来调太慢，总监需要实时拖。实验室面板把它们同步成配置值，拖完再折回配置。
    //
    //   ⚠️ 迁移到主游戏时**不带这个参数**（null ⇒ 完全走配置）。
    //   ⚠️ 它**不会**把未声明材质的群系打开镜面（见 materials.js 的 applyMaterialOverride）。
    waterMaterialOverride: null,
    // ★ 波浪动画速度（相位推进速率）★
    // ⚠️ 默认 **0 = 冻结**。刻意的：本项目所有 A/B 对照、差异图与回归自检
    //    都要求"同一组参数渲染出同一张图"。波浪一动，两次渲染就不可比了。
    //    想看动态把它推上去即可（实验室面板有滑块）。
    waveSpeed: 0.1,
    // ★ 大气散射对镜面高光的作用（2026-09-27 总监定：模糊 + 辉光）★
    //   被散射的比例 f = 1 − exp(−glintBlurK · τ_sca · airMass)。
    //   τ_sca 是垂直散射光深，Kerbin 约 0.20（蓝通道 0.37）。
    //   取 0.5：正午 f≈0.10（高光基本清晰）、太阳高度 6° 时 f≈0.63、
    //   贴地平线时 f→0.95（耀斑被彻底摊成光带）。
    glintBlurK: 0.5,
    //   光晕叶瓣的宽度倍数。1 = 与锐利叶瓣同宽（等于没做辉光）。
    glintHaloWidth: 3.6,
    // ★ 晨昏线艺术软化的半角（**度**）★
    //   ⚠️ **这是有意的非物理夸张**：真实晨昏线本来就是硬的（太阳视直径 ~1°，
    //   半影带峰值仅满照度的 2%，肉眼看不出），这条已实测证伪过两次尝试。
    //   总监明确要求"柔和过渡"，所以做成显式开关。
    //   0 = 物理口径（硬晨昏线，逐像素与历史一致）。
    //   面板给度、着色器收弧度，转换只在 drawSphere 一处做。
    terminatorSoftDeg: 6,
    // ★ 夜面边缘淡出（0 = 关闭；1 = 临边完全淡出）★
    //   夜面 = albedo × 环境光，是常数 ⇒ 行星暗面在太空里留下硬边灰剪影。
    //   让它随 NoV 淡出 ⇒ 暗面融进太空，只留大气那道弧。
    //   ⚠️ 只在方向性光照下生效（shader 用 uDiffuse 门控）—— 平光是 M5 基准，不能动。
    nightLimbFade: 1,
    nightLimbFadeWidth: 0.55,

    // 纹理
    mipmap: true,
    filter: 'linear',
    anisotropy: 8,

    // 细节层（抗平铺）
    detailEnabled: true,
    detailTiles: 6,
    detailWarpAmount: 0.30,
    detailCoarseWeight: 0.45,
    // 细节坐标映射的两个开关，默认 0 = 原始行为（u 用镜像、不做纬度收窄）。
    // 为什么显式给默认值：这两个开关直接决定球面有没有分界线，
    // 必须在诊断出口（getState/params）里能一眼看到实际生效值，
    // 不能靠 undefined 隐式兜底。历史见 planetShaders.js 的 poleTileScale 注释。
    detailLatStretch: 0,
    detailUWrap: 0,
    // 极区淡出宽度（v 单位）。这是不改坐标映射的极地修法；
    // 0 = 关闭。实测 0.20 能把极区方位峰从 21~35 压到 12~21。
    detailPoleFade: 0.20,
    // 图集单格模式：1 = 全部群系共用第 0 格纹理（能消 u=0.5 的分界线），
    // 0 = 2×2 各用一格（原始行为，默认）。显式给默认值以便在诊断出口看到实际生效值。
    detailSingleCell: 0,
    // 细节采样方式（见 planetShaders.js 的 foldU / sampleDetailGrad）：
    // 0=硬件隐式导数 1=textureGrad+符号补偿 2=1+光滑折返 3=只光滑折返
    // ★ 默认 3（光滑折返）★ —— 2026-09-26 经开发者视觉验收选定：
    //   默认（赤道正视）视角下 u=0.5 那条贯穿南北极的分界线 ratio 4.11 → 2.01（改善 51%），
    //   极点俯视只从 1.69 变到 1.75（+3.5%），在真实光照下不可感知。
    //   实测依据与两个视角的完整矩阵见交接文档 §13.24 / §13.25。
    detailGrad: 3,

    // ---- 地表起伏：法线图（2026-10-17，卡2）----
    // ★ 语义：**1.0 = 该天体 p95 坡度达 45°**（卡1 的 K 归一化口径，见
    //   src/config/biomeRelief.js 的 RELIEF_NORMALIZATION）。
    //   实际生效强度 = normalStrength × 逐群系强度[群系下标]（后者同样在
    //   src/config/biomeRelief.js，数据驱动、海洋群系恒 0）。
    //
    // ★ 默认 **0 = 关闭** ★ —— 与 detailEnabled / atmosphereEnabled 同一条纪律：
    //   全部历史验收、对比口径与回归基线都是在"无法线图"下建立的，
    //   默认打开会让既有基线整体漂移。0 时着色器整段分支跳过，
    //   渲染结果与接法线图之前**逐像素一致**（4/4 用例哈希为证）。
    //
    // ⚠️ 只有 `setNormalMap(image)` 挂上纹理之后才可能生效（没挂图 ⇒ 渲染器把
    //    强度强制归零，不会去采样一个未绑定的纹理）。
    normalStrength: 0,

    // ---- 大气层（阶段 2）----
    // 默认**关**：Mun 无大气，且全部历史验收/对比口径都是在"无大气"下建立的。
    // 做 Kerbin 时由配置或面板打开（打开后 sunDir 建议挪到侧前方才看得到晨昏线）。
    atmosphereEnabled: false,
    // 大气参数是**物理量**（Rayleigh/Mie 散射系数、标高、相位各向异性），
    // 说明与量级依据见 atmosphereLayer.js 的 ATMOSPHERE_PRESETS。
    // 这里拷一份 kerbin 预设当"打开开关后的起点"，而不是引用同一对象 ——
    // 否则面板改值会把只读的预设本身改掉。
    atmosphere: Object.assign({}, ATMOSPHERE_PRESETS.kerbin),

    // ---- 云层（阶段 2）----
    // 默认**关**：与 atmosphereEnabled 同一个理由 —— 全部历史验收/对比口径
    // 都是在"无云"下建立的，默认打开会让既有基线整体漂移。
    cloudEnabled: false,
    // 云层参数（唯一真源是 cloudRecipe.js 的 CLOUD_RECIPES）。
    // 这里拷一份 kerbin 配方当"打开开关后的起点"，而不是引用同一对象 ——
    // 否则面板改值会把只读的配方本身改掉。
    clouds: Object.assign({}, CLOUD_PRESETS.kerbin),
    // 云的合成顺序：'below' = 画在大气**之下**（云被大气衰减、吃日落红；物理更正确）
    //               'above' = 画在大气**之上**（云更白更锐，但不吃日落红）
    // 默认 below；两种都保留是为了能出 A/B 对照图（总监 2026-10-01 要的）。
    cloudOrder: 'below',

    // ---- 气态巨星的观感旋钮（第 1 步只有三个）----
    // ★ 默认值从 gasGiantCloudRecipe.js 的配方读（见模块顶部的 GG_DEFAULT）★
    //   面板把它们做成**实验室覆盖**：能实时拖、拖完看画面，定下来的值再写回配方。
    //   真源始终是配方 —— 面板不是缺省来源。
    gasGiantEdgeAmount: GG_DEFAULT.band.edgeAmount,
    gasGiantEdgeScale: GG_DEFAULT.band.edgeScale,
    gasGiantTexAmp: GG_DEFAULT.texture.texAmp,
    gasGiantTexEdge: GG_DEFAULT.texture.texEdge,
    gasGiantTexLat: GG_DEFAULT.texture.texLat,
    gasGiantShearAmp: GG_DEFAULT.shear.amp,
    gasGiantShearCycles: GG_DEFAULT.shear.cycles,
    gasGiantPolarStart: GG_DEFAULT.polarBands.start,
    gasGiantPolarPeriod: GG_DEFAULT.polarBands.period,
    gasGiantPolarAmp: GG_DEFAULT.polarBands.amp,
    gasGiantPolarFade: GG_DEFAULT.polarBands.fade,
    gasGiantVortexAmp: GG_DEFAULT.vortexAmp,
    gasGiantVortexSpin: GG_DEFAULT.vortexSpin,
    gasGiantVortexEdge: GG_DEFAULT.vortexEdge,
    gasGiantVortexTexBoost: GG_DEFAULT.vortexTexBoost,
    gasGiantVortexRim: GG_DEFAULT.vortexRim,
    gasGiantVortexGate: GG_DEFAULT.vortexGate,
    gasGiantVortexStretch: GG_DEFAULT.vortexStretch,
    gasGiantJetAmp: GG_DEFAULT.jetAmp,
    gasGiantJetOmega: GG_DEFAULT.jetOmega,
    gasGiantJetKappa: GG_DEFAULT.jetKappa,
    gasGiantLodOn: GG_DEFAULT.lodOn,
    gasGiantLodPx: GG_DEFAULT.lodPx,
    gasGiantLimbGlow: GG_DEFAULT.limb.glow,
    gasGiantLimbPow: GG_DEFAULT.limb.pow,
    // 诊断档位（0 = 正常渲染）。见 gasGiantCloudGLSL.js 的 ggDebugColor。
    gasGiantDebug: 0,

    // 全屏解算增益（对比图专用）
    diffGain: 16,
};

/**
 * setPlanet 的字段白名单（B2-fix，总监 2026-10-16 批准）。
 *
 * 构成 = DEFAULT_RENDER_PARAMS 的全部键（渲染参数契约本体，单一真源）
 *      ∪ 运行时动态字段（src/config/renderParamKeys.js 的 RENDER_PARAM_EXTRA_KEYS，
 *        逐键注明读取点依据）。
 * 不在白名单内的键 = 渲染器不认 ⇒ setPlanet 显式报错，不再静默塞进 params
 * （接入主游戏时 displayRadius / radius / atmosphereHeight / hasAtmosphere 必须
 *   由接入方先换算成渲染参数 —— 见 setPlanet 的注释）。
 */
const PARAM_WHITELIST = new Set(Object.keys(DEFAULT_RENDER_PARAMS).concat(RENDER_PARAM_EXTRA_KEYS));

/**
 * 「不认字段」的统一报错（B2-fix 与 B2-fix-2 **共用同一份格式**，防止两处漂移）。
 * @param {string[]} keys 不认的字段名
 * @param {string} source 报错来源标注（'setPlanet' / 'createPlanetRenderer(gl, { params })'）
 * @returns {Error}
 */
function unknownParamKeysError(keys, source) {
    return new Error(source + ' 收到渲染器不认的字段: ' + keys.join(', ')
        + ' —— 以前它们会被静默塞进 params 而不生效（阻断点 B2）。'
        + ' 接入方必须先换算成渲染参数。可用字段（' + PARAM_WHITELIST.size + ' 个）: '
        + Array.from(PARAM_WHITELIST).sort().join(', '));
}

/**
 * 创建星球渲染器。
 * @param {WebGL2RenderingContext} gl
 * @param {object} [options]
 * @param {object} [options.params] 初始参数（会与 DEFAULT_RENDER_PARAMS 合并）
 * @param {boolean} [options.transparent] **透明背景模式**（卡1 / 决策 D-9）：
 *   离屏目标的背景清成 alpha=0，铺屏时 alpha **透传**到画布 ⇒ 画布可与主游戏
 *   Canvas2D 底图叠加。默认 `false`（不透明路径逐像素不变）。也可用
 *   `renderer.setTransparent(bool)` 运行时切换。
 *   ⚠️ 透明模式需要**带 alpha 的上下文**（`createGLContext(canvas, { alpha: true })`），
 *      否则 WebGL 会把画布当作不透明（alpha 位被忽略）。
 * @returns {object} 渲染器实例
 */
export function createPlanetRenderer(gl, options) {
    const opts = options || {};
    // ★ B2-fix-2（总监 2026-10-16 授权）：构造期 opts.params 走同一白名单校验 ★
    //   根因与 setPlanet 的 B2 相同（不认字段静默并进 params 而不生效），只是入口
    //   不同 —— 而"构造时传参"恰恰是接入主游戏最自然的写法。不传 params 时
    //   initParams = {} ⇒ 一个键都不校验 ⇒ **默认路径逐字不变**。
    const initParams = opts.params || {};
    const unknownInitKeys = Object.keys(initParams).filter((key) => !PARAM_WHITELIST.has(key));
    if (unknownInitKeys.length > 0) {
        throw unknownParamKeysError(unknownInitKeys, 'createPlanetRenderer(gl, { params })');
    }
    const params = Object.assign({}, DEFAULT_RENDER_PARAMS, initParams);
    // ★ 卡1：透明背景模式开关（默认 false ⇒ 默认路径一行都不变）★
    //   不放进 PARAM_WHITELIST：它**不是天体参数**（不是"画什么"），而是输出模式
    //   （"背景透不透"）。放进 whitelist 会让 setPlanet 也能改它，语义更乱。
    let transparentMode = opts.transparent === true;

    /** 运行时状态：全部显式，便于诊断 */
    // 材质覆盖的逐帧缓存（见 drawSphere 的说明）：键 = 覆盖值 + 材质表**身份**。
    // 放 state 里而不是模块级：createPlanetRenderer 是工厂，可能同时存在多个实例。
    let matCache = null;
    let matCacheSrc = null;
    let matCacheKey = '';

    const state = {
        params,        albedo: null,              // { texture, width, height }
        albedoSource: null,        // 原始图像，供重建贴图用
        albedoOptions: null,
        detail: null,              // { detailTexture, biomeTexture, tiles, warpAmount, coarseWeight, strength, scale }
        feature: null,             // { texture, width, height, shadingStrength } 编辑预览的特征场
        normalMap: null,           // { texture, relief } 地形法线图（地表起伏，卡2）
        mesh: null,
        meshKey: '',               // 几何缓存键，避免重复建网格
        meshTriangleCount: 0,      // 当前网格的三角形数（单次绘制口径）
        cloudCdf: null,           // 云场 CDF 常量表（场参数的函数，变了才重算）
        cloudCdfKey: '',          // 上面那张表的缓存键（场参数序列化）
        // ★ 纬向气候带：控制点表 + 归一化因子（与 CDF 同一次缓存）★
        cloudZoneProfile: null,
        cloudZoneNorm: 1,
        // 云影图（512×256 等距柱状，懒创建）。null = 还没烘焙过 ⇒ 地表不着影。
        cloudShadowTex: null,
        // 云的时间（秒）。由 render(dt) 累加；measurePlanet() 会**冻结到指定值**
        // —— 理由与 waveTime 完全相同（见那里的说明），但云多了一个能力：
        // 可以把时间冻结到**任意**值，而不只是 0，这样才能出"相隔 t 的两张图"的形变对照。
        cloudTime: 0,
        // ★ 气态巨星装配：常量表已上传的配方 id + 求解结果（切配方才重做）★
        //   键为空串表示"当前是普通天体、表已清掉"。
        gasGiantKey: '',
        gasGiantRecipe: null,
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        viewportExplicit: false,   // 是否由调用方显式指定过子矩形
        canvasWidth: 1,
        canvasHeight: 1,
        dpr: 1,
        targets: new Map(),        // 离屏目标缓存，key = name:widthxheight
        // 波浪相位的时间累加器（秒）。由 render(dt) 按 params.waveSpeed 累加。
        waveTime: 0,
        stats: { drawCalls: 0, triangles: 0, frames: 0, lastCpuMs: 0, lastDt: 0 },
    };

    // ---- 着色器程序 ----
    const planetProgram = createProgram(gl, {
        name: 'planet',
        vertex: PLANET_VERT,
        fragment: PLANET_FRAG,
        prefix: '#define USE_POSITION_ATTR',
    });
    const unprojectProgram = createProgram(gl, {
        name: 'unproject',
        vertex: UNPROJECT_VERT,
        fragment: UNPROJECT_FRAG,
    });
    const diffProgram = createProgram(gl, {
        name: 'diff',
        vertex: UNPROJECT_VERT,
        fragment: DIFF_FRAG,
    });
    // 铺屏程序：把离屏合成结果（SRGB8，线性域混合）铺到画布并编码一次。
    // 见 shaders/planetShaders.js 的 BLIT_FRAG 与下面 render() 的说明。
    const blitProgram = createProgram(gl, {
        name: 'blit',
        vertex: UNPROJECT_VERT,
        fragment: BLIT_FRAG,
    });

    // ★ 卡1（T7）：**透明模式的铺屏程序** —— 与 BLIT_FRAG 只差最后一项：
    //   alpha 取源纹理的 alpha（**透传**）而不是写死 1.0。
    //
    //   为什么在这里**局部**定义而不是改 shaders/planetShaders.js：
    //     · 那个文件不在本卡写作用域内（本卡唯二可写的源文件是本文件）；
    //     · 更重要的是**零回归**：默认路径继续用上面那个**同一个** blitProgram
    //       对象（连着色器源都没变），透明模式才用这个新程序 ⇒ 默认路径连
    //       "着色器被重新编译" 这件事都不会发生。
    //   这个程序**懒建**：只有真正用过透明模式才会编译（默认路径零额外开销）。
    //
    //   ⚠️ 语义：premultipliedAlpha:false ⇒ 画布里的内容是**直线 alpha**，
    //      RGB 未乘 alpha。合成方（Canvas2D drawImage）按直线 alpha 处理。
    const BLIT_ALPHA_FRAG = `#version 300 es
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
    vec4 s = texture(uSource, vec2(vUv.x, 1.0 - vUv.y));
    // 颜色：与 BLIT_FRAG 逐字相同的编码；alpha：**透传源**（不写死）
    outColor = vec4(mix(s.rgb, linearToSrgb(s.rgb), uSrgbOut), s.a);
}
`;
    let blitAlphaProgram = null;
    const blitAlphaProgramOf = () => {
        if (!blitAlphaProgram) {
            blitAlphaProgram = createProgram(gl, {
                name: 'blit-alpha',
                vertex: UNPROJECT_VERT,
                fragment: BLIT_ALPHA_FRAG,
            });
        }
        return blitAlphaProgram;
    };

    // 大气层（阶段 2）：球壳求交 + 24 步 ray marching 的单次散射。
    // 步数是编译期宏（见 atmosphereShaders.js），24 步是总监 2026-09-26 定的档位。
    const atmosphereLayer = createAtmosphereLayer(gl, { steps: 24 });

    // 云层（阶段 2）：球壳几何 —— 在 Rp · altitude 处再画一遍球面网格。
    // 几何与坐标约定**与本体一致**（见 cloudShaders.js 文件头的层间对齐说明）。
    // ⚠️ 分段数**故意不跟随本体的 segmentCount / ringCount**，是 cloudLayer.js 里的
    //    CLOUD_SHELL_SEGMENTS / CLOUD_SHELL_RINGS 具名常量（单一真源，理由与已知代价写在那边）。
    const cloudLayer = createCloudLayer(gl, { segments: CLOUD_SHELL_SEGMENTS, rings: CLOUD_SHELL_RINGS });

    // 全屏三角形（位置 + UV，两个属性，供所有全屏程序复用）
    const fullscreenData = buildFullscreenGeometry();
    const fullscreenMesh = createMesh(gl, {
        layout: fullscreenData.layout,
        vertices: fullscreenData.vertices,
        mode: gl.TRIANGLES,
        attributeLocations: {
            POSITION: unprojectProgram.attribs.aPosition,
            TEXCOORD: unprojectProgram.attribs.aTexCoord,
        },
    });

    // ★★ 第三卷：云影烘焙（总监 2026-10-23 只批了**这一个**新增 target）★★
    //   512×256 等距柱状小图，每帧一次（关闭时不创建、不绘制）。
    //   ⚠️ 网格必须为本程序单独建一份：createProgram 不固定 attribute location
    //      （与 cloudLayer.js 里那条注释同一个理由，§13.21 的静默依赖）。
    //   ⚠️ 该图是**数据**（shade 原值），必须 srgb:false，否则会被硬件再编一次 sRGB。
    const CLOUD_SHADOW_W = 512;
    const CLOUD_SHADOW_H = 256;
    const cloudShadowProgram = createProgram(gl, {
        name: 'cloudShadow',
        vertex: CLOUD_SHADOW_VERT,
        fragment: CLOUD_SHADOW_FRAG,
    });
    const cloudShadowMesh = createMesh(gl, {
        layout: fullscreenData.layout,
        vertices: fullscreenData.vertices,
        mode: gl.TRIANGLES,
        attributeLocations: {
            POSITION: cloudShadowProgram.attribs.aPosition,
            TEXCOORD: cloudShadowProgram.attribs.aTexCoord,
        },
    });

    /**
     * 取得（必要时创建）指定尺寸的离屏目标。
     *
     * ★ 色彩空间按用途分两类（2026-10-02）★
     *   · **场景类**（actual / ref / frame）：默认 SRGB8_ALPHA8 —— 着色器输出线性值，
     *     硬件编码；混合发生在线性域（物理正确），读回来是显示编码值。
     *   · **数据类**（unproject / diff）：必须 `srgb: false` —— 它们写入的数值
     *     本身就是最终要看的字节（albedo 往返比对、差异图配色），
     *     被硬件再编一次 sRGB 就全偏了。
     *
     * @param {string} name 用途名
     * @param {number} width
     * @param {number} height
     * @param {object} [options] 透传给 createRenderTarget（srgb / msaa / filter）
     * @returns {object}
     */
    function target(name, width, height, options) {
        const opts = options || {};
        const key = name + ':' + width + 'x' + height
            + (opts.srgb === false ? ':lin' : ':srgb')
            + (opts.msaa ? ':ms' + opts.msaa : '');
        let found = state.targets.get(key);
        if (!found) {
            found = createRenderTarget(gl, width, height, opts);
            state.targets.set(key, found);
        }
        return found;
    }

    /**
     * 调整离屏目标的采样过滤（取像素统计时必须 NEAREST，铺屏显示时可 LINEAR）。
     * @param {WebGL2RenderingContext} glCtx
     * @param {object} targetRef 渲染目标
     * @param {number} filter gl.NEAREST | gl.LINEAR
     */
    function setTargetFilter(glCtx, targetRef, filter) {
        if (targetRef.filter === filter) {
            return;
        }
        glCtx.bindTexture(glCtx.TEXTURE_2D, targetRef.texture);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, filter);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, filter);
        glCtx.bindTexture(glCtx.TEXTURE_2D, null);
        targetRef.filter = filter;
    }

    /**
     * 释放除 keep 之外的离屏目标（尺寸变化时避免泄漏）。
     * @param {object} keep
     */
    function releaseTargetsExcept(keep) {
        state.targets.forEach((value, key) => {
            if (value !== keep) {
                destroyRenderTarget(gl, value);
                state.targets.delete(key);
            }
        });
    }

    /**
     * 计算当前相机下的视图投影矩阵。
     * @param {number} viewWidth 视口宽（物理像素）
     * @param {number} viewHeight 视口高（物理像素）
     * @param {number} [zoomOverride] 覆盖 zoom（对比图各面板需要不同比例）
     * @returns {Float32Array}
     */
    function buildViewProj(viewWidth, viewHeight, zoomOverride) {
        const zoom = zoomOverride === undefined ? state.params.zoom : zoomOverride;
        const halfW = viewWidth / (2 * Math.max(1e-6, zoom));
        const halfH = viewHeight / (2 * Math.max(1e-6, zoom));
        const view = translation(-(state.params.cameraX || 0), -(state.params.cameraY || 0));
        const proj = orthographic(-halfW, halfW, -halfH, halfH, -8, 8);
        return multiply4(proj, view);
    }

    /**
     * 计算模型矩阵（先绕 Y 自转、再绕 X 轴倾角，然后等比缩放与平移）。
     * @param {number} [scaleOverride]
     * @param {number} [offsetXOverride]
     * @param {number} [offsetYOverride]
     * @param {number} [offsetZOverride]
     * @returns {Float32Array}
     */
    function buildModel(scaleOverride, offsetXOverride, offsetYOverride, offsetZOverride) {
        const p = state.params;
        const scale = scaleOverride === undefined ? 1 : scaleOverride;
        const offX = offsetXOverride === undefined ? 0 : offsetXOverride;
        const offY = offsetYOverride === undefined ? 0 : offsetYOverride;
        const offZ = offsetZOverride === undefined ? 0 : offsetZOverride;
        const spin = rotationY(p.spinDeg * Math.PI / 180);
        const tilt = rotationX(p.tiltDeg * Math.PI / 180);
        const rot = multiply4(tilt, spin);
        const scaled = multiply4(rot, scaling(scale));
        return multiply4(translation(offX, offY, offZ), scaled);
    }

    /**
     * 构建（或复用）球体网格。
     */
    function ensureMesh() {
        const p = state.params;
        const key = p.useIrregularGeometry
            ? 'irregular:' + p.segmentCount + 'x' + p.ringCount
            : 'sphere:' + p.segmentCount + 'x' + p.ringCount;
        if (state.mesh && state.meshKey === key) {
            return;
        }
        if (state.mesh) {
            destroyMesh(gl, state.mesh);
            state.mesh = null;
        }
        const geometry = p.useIrregularGeometry
            ? buildIrregularGeometry({ segments: p.segmentCount, rings: p.ringCount })
            : buildSphereGeometry({ segments: p.segmentCount, rings: p.ringCount });
        state.mesh = createMesh(gl, {
            layout: geometry.layout,
            vertices: geometry.vertices,
            indices: geometry.indices,
            vertexCount: geometry.vertexCount,
            mode: gl.TRIANGLES,
            attributeLocations: {
                POSITION: planetProgram.attribs.aPosition,
                TEXCOORD: planetProgram.attribs.aTexCoord,
                NORMAL: planetProgram.attribs.aNormal,
            },
        });
        state.mesh.triangleCount = geometry.triangleCount;
        state.meshTriangleCount = geometry.triangleCount;
        state.meshKey = key;
    }

    /**
     * 实际生效的太阳颜色 = sunColor × 受光系数（sunOcclusion）。
     *
     * 为什么只在这里乘、不去改着色器：大气散射源已经乘过了太阳透射率 sunT，
     * 所以受光系数一进太阳颜色，散射就自动全灭；星球本体的直射光同理。
     * 一个量同时管住两条路径，比在两处着色器里各加一个分支更不容易漂移。
     *
     * @returns {Array<number>} [r, g, b]
     */
    function effectiveSunColor() {
        const p = state.params;
        const occ = p.sunOcclusion === undefined ? 1 : p.sunOcclusion;
        const c = p.sunColor || [1, 1, 1];
        return [c[0] * occ, c[1] * occ, c[2] * occ];
    }

    /**
     * ★★ 大气层专用的太阳方向：z 分量取反（镜像）★★
     *
     * **为什么必须取反（2026-09-27 确诊，见交接文档 §13.47）**
     *   `src/geometry/sphereMesh.js` 生成三角形的**环绕方向实际是顺时针**，
     *   在 `frontFace(CCW) + cullFace(BACK)` 下正面半球被整体剔除 ——
     *   **屏幕上画出来的是"远半球"**。于是星球本体的光照活在一个
     *   **z 轴镜像的世界**里（盘心的有效法线是 (0,0,-1)，不是 +z）。
     *   而大气 raymarch 按**诚实几何**使用太阳方向 ⇒ 同一颗太阳，两层
     *   的"它在观察者这一侧 / 在星球背后"判断判反：
     *     · 偏出平面角 > 0（太阳偏向观察者）：本体亮面正确，但大气把太阳判到
     *       星球背后 ⇒ 盘面雾霭被遮挡判据挡掉，只剩边缘一圈环；
     *     · 偏出平面角 < 0（太阳偏向背侧）：本体夜面正确，但大气把太阳判到
     *       观察者这一侧 ⇒ 整盘蓝雾泛滥。
     *   把大气侧的太阳方向做 z → −z，两层就进入**同一个镜像世界**。
     *
     * **⚠️ el = 0（纯方位角、太阳在屏幕平面内）时 −Lz === Lz**，
     *   本函数是恒等变换 ⇒ **逐像素不变**，历史基线与 M5 口径安全。
     *
     * **为什么不改网格/本体而是改大气**：网格环绕方向与本体着色器已经自洽，
     *   动它们等于把全部历史验收图作废；只在大气侧镜像，代价是这一处显式的
     *   "层间坐标对齐"。⚠️ 将来若修正网格缠绕方向，**必须同时删掉这里的取反**。
     *
     * ⚠️ 这**不是**物理量，是**层间坐标对齐**的补偿 —— 只喂大气着色器，
     *    绝不参与太阳视觉（光晕/光斑那类屏幕空间效果）的定位。
     *
     * @returns {Array<number>} [Lx, Ly, -Lz]
     */
    function atmosphereSunDir() {
        const L = state.params.sunDir || [0, 0, -1];
        return [L[0], L[1], -L[2]];
    }

    /**
     * 绘制球体（假定当前 framebuffer / viewport 已设置好）。
     * @param {object} options
     * @param {number} options.viewWidth
     * @param {number} options.viewHeight
     * @param {number} options.planetRadius 世界单位半径（决定屏幕占比）
     * @param {number} options.zoom
     * @param {boolean} options.lit 是否启用光照项（false = 纯 albedo，用于参照）
     */
    function drawSphere(options) {
        ensureMesh();
        const p = state.params;
        const viewProj = buildViewProj(options.viewWidth, options.viewHeight, options.zoom);
        const model = buildModel(options.planetRadius);
        const useLight = options.lit !== false;
        const detail = state.detail;
        const feature = state.feature;
        // 大气对直射光的红化（日落红的地表部分）：与大气散射层共用同一份消光口径
        const atmo = p.atmosphereEnabled ? (p.atmosphere || null) : null;
        const extinction = atmo ? solveExtinction(atmo) : [0, 0, 0];
        // 垂直散射光深 —— 高光被大气抹开的角宽度由它驱动（见 shader 的 uAtmoScatterOd）
        const scatterOd = solveScatterOpticalDepth(atmo);
        // ★ 实验室专用的"材质调参"覆盖（迁移到主游戏时不带这个）★
        //   逐群系真值在 biome-styles.json；这里让面板能**实时**替换已声明材质群系的
        //   三个观感字段。只作用于 f0 > 0 的群系 —— 未声明材质的不许被"顺手打开"。
        //
        // ⚠️ 结果**缓存**：applyMaterialOverride 每次都 new 3 个 Float32Array，
        //    放在每帧的绘制路径里会一直抖 GC（本项目有 200 万像素的性能台）。
        //    键 = 覆盖值 + 细节层材质表的**身份** —— 任一变才重算。
        const srcMat = (detail && detail.material) ? detail.material : NO_MATERIAL_SOLVED;
        const ovr = p.waterMaterialOverride;
        const ovrKey = ovr ? (ovr.rough + '|' + ovr.waveDeg + '|' + ovr.waveScale) : 'off';
        if (srcMat !== matCacheSrc || ovrKey !== matCacheKey) {
            matCache = applyMaterialOverride(srcMat, ovr);
            matCacheSrc = srcMat;
            matCacheKey = ovrKey;
        }
        const mat = matCache;
        // ---- ★ 第三卷：云影的三项前置量（默认全关 ⇒ 不参与任何算式）----
        //   ① 开关：云影烤了图 + 云开着 + 参数打开，三者同时成立才算开
        //   ② 云壳半径（视差偏移量）：与云的 altitude 同源，缺省 1.004
        //   ③ 本地太阳方向：世界 → 网格本地（模型矩阵 3×3 = 旋转·等比缩放，
        //      等比缩放在归一化后消失 ⇒ 直接用 M3 的转置乘，再归一化）
        const cloudsP = p.clouds || {};
        const cloudShadowOn = !!cloudsP.shadowEnabled && !!state.cloudShadowTex && !!p.cloudEnabled;
        const cloudShadowStrength = Math.max(0, Math.min(1,
            cloudsP.shadowStrength === undefined ? 0.7 : cloudsP.shadowStrength));
        const cloudShadowAlt = cloudsP.altitude === undefined ? 1.004 : cloudsP.altitude;
        let sunDirLocal = p.sunDir || [0, 0, -1];
        {
            const v = p.sunDir || [0, 0, -1];
            const lx = model[0] * v[0] + model[1] * v[1] + model[2] * v[2];
            const ly = model[4] * v[0] + model[5] * v[1] + model[6] * v[2];
            const lz = model[8] * v[0] + model[9] * v[1] + model[10] * v[2];
            const n = Math.hypot(lx, ly, lz) || 1;
            sunDirLocal = [lx / n, ly / n, lz / n];
        }
        // 太阳视半径（弧度）。见 src/planet/sun.js。
        // ⚠️ 收的是**度**（面板口径），这里转弧度 —— 转换只此一处。
        const sunAngularRadius = solveSunAngularRadius(
            p.sunAngularRadiusDeg === undefined
                ? DEFAULT_SUN_ANGULAR_RADIUS_DEG : p.sunAngularRadiusDeg);
        // 晨昏线艺术软化的半角（弧度）。0 = 关闭 = 物理口径。
        const terminatorSoft = Math.max(0, Number(p.terminatorSoftDeg) || 0) * Math.PI / 180;
        // ★ 晨昏线陡化：漫反射坡道 N·L 的幂（1 = 物理口径 = 逐位不变）★
        //   ⚠️ 这是**艺术夸张**（把余弦压陡，视觉上收窄过渡带）—— 与 terminatorSoftDeg
        //      同一处理方式：实验室滑块给的是"看中的观感"（1.5），而渲染器自带的
        //      兜底是物理口径（1）。迁移到主游戏若要沿用观感，必须把实验室那个值
        //      一起带走，否则会"换了个样子"（见 §13.30 的 15 处预设漂移）。
        const terminatorPow = Math.max(1, Number(p.terminatorPow) || 1);

        setUniforms(gl, planetProgram, {
            uViewProj: viewProj,
            uModel: model,
            uNormalMatrix: normalMatrixFromModel(model),
            uAlbedo: { texture: 0 },
            uSunDir: useLight ? p.sunDir : [0, 0, 1],
            uSunColor: useLight ? effectiveSunColor() : [1, 1, 1],
            // ---- 大气对直射光的红化（日落红的地表部分）----
            //   与大气散射层共用 solveExtinction / scaleHeight / 太阳柱积分表 同一份口径。
            //   useLight = false（对比实验的纯 albedo 基准）时一并关掉，保持历史口径不变。
            uAtmoEnabled: (useLight && atmo) ? 1 : 0,
            uAtmoExt: extinction,
            // ⚠️ 传**无量纲**的标高比（scaleHeight = H/Rp），不是世界单位 ——
            //    指数里用的是 βExt[每星径] × (H/Rp) × 空气质量，两边都是无量纲的。
            //    曾经传 scaleHeight × Rp，等于给光深多乘了一个 Rp ⇒ 大气厚度随
            //    视口尺寸变，且本体与大气层差一个 Rp。见 planetShaders 的说明。
            uAtmoScaleHeight: atmo ? atmo.scaleHeight : 0,
            // ★ 地表空气质量查表 —— 与大气散射层**同一张表**的地表切片 ★
            //   两层共用 ⇒ 地表的日落红与空中的散射在晨昏线处必然对齐。
            //   表按（标高比, 壳厚比）缓存，烘焙只在参数变化时发生一次。
            uSunColumnSurface: getSunColumnTable(
                atmo ? atmo.scaleHeight : 0.013,
                atmo && atmo.atmoScale > 1 ? atmo.atmoScale : 1.02,
            ).surface,
            // 晨昏线艺术软化的半角（弧度）。0 = 物理口径（硬晨昏线，逐像素一致）。
            uTerminatorSoft: terminatorSoft,
            uTerminatorPow: terminatorPow,
            // 夜面边缘淡出：让夜面补光在掠射处归零，消除行星暗面的硬边剪影。
            // 0 = 关闭（逐位一致）。只在方向性光照下生效（shader 里用 uDiffuse 门控）。
            uNightLimbFade: p.nightLimbFade === undefined ? 1 : p.nightLimbFade,
            uNightLimbFadeWidth: p.nightLimbFadeWidth === undefined ? 0.55 : p.nightLimbFadeWidth,
            uAmbient: useLight ? p.ambient : 1,
            uDiffuse: useLight ? p.diffuse : 0,
            uEdgeDarkening: useLight ? p.edgeDarkening : 0,
            // ---- 细节层 ----
            uDetail: { texture: 1 },
            uBiome: { texture: 2 },
            uDetailTiles: detail ? detail.tiles : 1,
            uWarpAmount: detail ? detail.warpAmount : 0,
            uCoarseWeight: detail ? detail.coarseWeight : 0,
            uDetailEnabled: detail && detail.enabled ? 1 : 0,
            uDetailAtlas: detail ? detail.atlas : [1, 1],
            uBiomeDetailStrength: detail ? detail.strength : IDENTITY_STRENGTH,
            uBiomeDetailScale: detail ? detail.scale : IDENTITY_SCALE,
            // ---- 地表材质的光学层（逐群系，默认全 0 = 无镜面 ⇒ 纯 Lambert）----
            uBiomeF0: mat.f0,
            uBiomeRough: mat.rough,
            uBiomeWaveDeg: mat.waveDeg,
            uBiomeWaveScale: mat.waveScale,
            uWaveTime: state.waveTime,
            // 太阳视半径（弧度）。0 = 点光源 = 加这个特性之前的口径。
            uSunAngularRadius: sunAngularRadius,
            // ---- 大气对镜面高光的作用（散射把太阳的像抹开并摊成光晕）----
            // uAtmoScatterOd = 垂直散射光深 (β_R + β_M)·H，取三通道均值。
            // 不开大气时为 0 ⇒ 高光完全不受大气影响（与历史口径一致）。
            uAtmoScatterOd: scatterOd,
            uGlintBlurK: p.glintBlurK === undefined ? DEFAULT_GLINT_BLUR_K : p.glintBlurK,
            uGlintHaloWidth: p.glintHaloWidth === undefined
                ? DEFAULT_GLINT_HALO_WIDTH : p.glintHaloWidth,
            // ---- 编辑预览的特征场 ----
            uFeature: { texture: 3 },
            uFeatureEnabled: feature ? 1 : 0,
            uFeatureShading: feature ? feature.shadingStrength : 0,
            // 诊断开关。默认值 = **极地修复之前的行为**（见 planetShaders.js 的说明）：
            // 加了 cos(λ) 收窄或把 u 改成直接平铺，都会在 u=0.5 处引入一条可见分界线
            // （实测 c399 ×3.9 / ×2.32，且完全可复现）。要启用必须同时通过 seam 检查。
            uDetailLatStretch: p.detailLatStretch === 1 ? 1 : 0,
            uDetailUWrap: p.detailUWrap === 1 ? 1 : 0,
            uDetailPoleFade: p.detailPoleFade === undefined ? 0.20 : p.detailPoleFade,
            // 图集单格模式：默认 0（保持 2×2 逐群系纹理）。
            // 置 1 可消掉 u=0.5 处的分界线，代价是四格共用第 0 格纹理
            // （逐群系 detailStrength/detailScale 仍生效）。详见 planetShaders.js 注释。
            uDetailSingleCell: p.detailSingleCell === 1 ? 1 : 0,
            // 细节采样方式：0=硬件隐式导数（默认）1=textureGrad+符号补偿
            // 2=1+光滑折返 3=只光滑折返。机理见 shader 的 foldU / sampleDetailGrad。
            uDetailGrad: p.detailGrad === undefined ? 0 : p.detailGrad,
            // ---- 地表起伏（法线图，卡2）----
            // 强度 = 全局旋钮 × 逐群系比例；**没挂图时强制 0** —— 否则会去采样
            // 一个未绑定的采样器（WebGL 给回黑色 ⇒ 解包出 [-1,-1,-1]，画面被
            // 一个不存在的图污染，且不报任何错）。
            uNormalMap: { texture: 4 },
            uNormalStrength: state.normalMap ? p.normalStrength : 0,
            uBiomeRelief: state.normalMap ? state.normalMap.relief : IDENTITY_RELIEF,
            // ---- ★ 第三卷：云影（默认关 ⇒ uCloudShadowOn = 0，逐像素等于加它之前）----
            //   需要的三样：影图（上一帧烘的）、强度、云壳半径（决定视差偏移量）、
            //   以及**本地坐标系里的太阳方向**（用模型矩阵的旋转部分转置得到）。
            uCloudShadowOn: cloudShadowOn ? 1 : 0,
            uCloudShadowTex: { texture: 5 },
            uCloudShadowStrength: cloudShadowStrength,
            uCloudShadowAlt: cloudShadowAlt,
            uSunDirLocal: sunDirLocal,
            // 视差系数（1 = 真实；0 = 影子落在云正下方 —— 只用于量"错位幅度"的对照）
            uCloudShadowParallax: cloudsP.shadowParallax === undefined ? 1 : cloudsP.shadowParallax,
        });
        bindTexture(gl, state.albedo, 0);
        if (detail) {
            bindTexture(gl, detail.detailTexture, 1);
            bindTexture(gl, detail.biomeTexture, 2);
        }
        if (feature) {
            bindTexture(gl, feature.texture, 3);
        }
        if (state.normalMap) {
            bindTexture(gl, state.normalMap.texture, 4);
        }
        if (cloudShadowOn && state.cloudShadowTex) {
            bindTexture(gl, state.cloudShadowTex, 5);
        }
        drawMesh(gl, state.mesh);
        state.stats.drawCalls += 1;
        state.stats.triangles += state.mesh.triangleCount || 0;
    }

    /**
     * 画大气层（必须在球体之后调用）。
     *
     * 混合方程：gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
     *   片元输出 vec4(scatter, 1 - T) ⇒ final = scatter + background × T
     * 即「背景被大气衰减，再叠加散射光」—— 这是正确的合成式，不是普通 alpha 覆盖。
     * （若用 SRC_ALPHA 那套，大气会"糊"在星球上而不是"笼罩"它。）
     *
     * @param {object} options
     * @param {number} options.viewWidth
     * @param {number} options.viewHeight
     * @param {number} options.planetRadius 行星球半径（世界单位）
     * @param {number} [options.zoom]
     */
    function drawAtmosphere(options) {
        const p = state.params;
        if (!p.atmosphereEnabled) {
            return;
        }
        const atmo = p.atmosphere || ATMOSPHERE_PRESETS.none;
        if (!(atmo.atmoScale > 1) || !(atmo.intensity > 0)) {
            return;   // 无大气：连状态切换都省掉
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        atmosphereLayer.draw({
            viewWidth: options.viewWidth,
            viewHeight: options.viewHeight,
            zoom: options.zoom === undefined ? p.zoom : options.zoom,
            cameraX: p.cameraX || 0,
            cameraY: p.cameraY || 0,
            planetRadius: options.planetRadius,
            // ★ 大气侧镜像太阳 z 分量 —— 见 atmosphereSunDir() 的说明 ★
            //   全项目**只有这一处**给大气层上传太阳方向（drawAtmosphere 是唯一入口，
            //   主渲染与离屏量测两条路径都经过它），所以镜像只在这里算一次。
            sunDir: atmosphereSunDir(),
            sunColor: effectiveSunColor(),
            params: atmo,
        });
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        state.stats.drawCalls += 1;
    }

    /**
     * 画一层云（阶段 2）：球壳几何，在 Rp · altitude 处再画一遍球面网格。
     *
     * ★ 单一入口（与 drawAtmosphere 同一个纪律）★
     *   主渲染 render(dt) 与离屏量测 measurePlanet() **两条路径都必须经过这里**。
     *   §13.47 那轮"两层的太阳方向不一致、改一处只能好一半"就是因为同一个量有两处口径；
     *   云层若也开两个入口，同样的坑会再踩一次。而且漏掉离屏路径会得到本项目最难的
     *   那类不一致："实验室里看得见、落盘的验收图里没有"。
     *
     * ★ 混合与深度 ★
     *   普通 alpha 混合（SRC_ALPHA / ONE_MINUS_SRC_ALPHA）。
     *   深度测试**关闭**：在"画远半球"的既有约定下，云壳比星球本体更远，
     *   开深度测试会被整片挡掉（一片都看不到）。
     *   剔除状态**保持与本体一致**（frontFace CCW + cullFace BACK）——
     *   云必须落在与地表同一个镜像世界里，否则云的经纬会与地表特征错位。
     *
     * @param {object} options 同 drawAtmosphere，另加 options.spinAngle
     */
    function drawClouds(options) {
        const p = state.params;
        if (!p.cloudEnabled) {
            return;   // 未开启：连状态切换都省掉
        }
        // ★★ 云必须有大气才画得出来（2026-10-01 总监定）★★
        //   没有大气就没有"云"这件事成立的条件（也没有让它显形的介质与光路）。
        //   面板侧已经把它做成**不可表达**（toRenderParams 里 cloudEnabled 由
        //   atmosphereEnabled 门控），这里是渲染器的**兜底**：任何绕过面板的调用方
        //   （工具、主游戏、手写 params）都不可能画出"没大气的云"。
        //   两道一起上是有意的 —— 面板管"人不会调出矛盾状态"，渲染器管"矛盾状态也无效"。
        if (!p.atmosphereEnabled) {
            return;
        }
        const clouds = p.clouds || CLOUD_PRESETS.none;
        // coverage ↑ ⇒ 云量 ↑（判据 b <= coverage）；opacity 0 也直接跳过
        if (!(clouds.opacity > 0) || !(clouds.coverage > 0)) {
            return;
        }
        // ---- CDF 常量表：只在**场参数变化**时重算 ----
        //   它是场参数的纯函数（要跑三万次场采样，约 50 ms），
        //   放进每帧的绘制路径等于每帧白烧 50 ms。
        //   键 = 烘焙期字段序列化 —— 渲染期字段（覆盖率/不透明度/颜色…）不影响 CDF。
        const cdfKey = [
            clouds.scale, clouds.octaves, clouds.lacunarity, clouds.gain, clouds.cascade,
            clouds.warp, clouds.warpDetail, clouds.warpDetailScale, clouds.bandStretch,
            clouds.ridge, clouds.seed,
        ].join('|');
        if (state.cloudCdfKey !== cdfKey || !state.cloudCdf) {
            state.cloudCdf = buildCloudCdf(clouds);
            state.cloudCdfKey = cdfKey;
            // CDF 只存在 CPU 侧，着色器拿的是 Float32Array（uniform 数组）
            state.cloudCdf.lut = Float32Array.from(state.cloudCdf.lut);
            // ★ 纬向气候带：表 + 归一化因子（同一次缓存，理由同上）★
            //   zone 的球面均值恒为 1 ⇒ 全局云量仍精确等于 coverage
            const prof = clouds.zoneProfile && clouds.zoneProfile.length === ZONE_POINTS
                ? clouds.zoneProfile : DEFAULT_ZONE_PROFILE;
            state.cloudZoneProfile = Float32Array.from(prof);
            state.cloudZoneNorm = zoneNormalizer(prof,
                clouds.zoneStrength === undefined ? 0 : clouds.zoneStrength);
        }
        const altitude = clouds.altitude === undefined ? 1.010 : clouds.altitude;
        const model = buildModel(options.planetRadius * altitude);
        // ★ 第三卷：云影图（默认关 ⇒ 不创建 target、不绘制）★
        //   放在这里是因为它依赖 CDF 与气候带表（上面刚确保就绪），
        //   而地表（drawSphere）在本帧**之前**已经画过了 —— 所以影图晚一帧生效。
        //   ⚠️ 冻结时间的量测路径下这是稳定的（warmup 之后每帧同一张图）。
        if (clouds.shadowEnabled === true) {
            bakeCloudShadow(clouds, options);
        }
        // ---- ★ 气态巨星装配：判别字段 `model` 决定走哪条 α/颜色来源 ★ ----
        //   与 CDF 同一个模式：**配方变化时**才上传常量表（91×3），逐帧只写标量。
        //   ⚠️ 切回普通天体时必须显式清掉，否则上一帧的 uGgEnabled = 1 会留下来，
        //      把 Kerbin 的云画成"α ≡ 1 的一整块"（而画面看着仍然像行星）。
        const isGasGiant = clouds.model === 'gasGiant';
        const ggKey = isGasGiant ? String(clouds.id || '') : '';
        if (state.gasGiantKey !== ggKey) {
            state.gasGiantRecipe = isGasGiant ? solveGasGiantRecipe(clouds.id) : null;
            cloudLayer.setGasGiant(state.gasGiantRecipe);
            state.gasGiantKey = ggKey;
        }
        const ggDesc = isGasGiant ? {
            enabled: true,
            edgeAmount: p.gasGiantEdgeAmount,
            edgeScale: p.gasGiantEdgeScale,
            texAmp: p.gasGiantTexAmp,
            texEdge: p.gasGiantTexEdge,
            texLat: p.gasGiantTexLat,
            shearAmp: p.gasGiantShearAmp,
            shearCycles: p.gasGiantShearCycles,
            polarStart: p.gasGiantPolarStart,
            polarPeriod: p.gasGiantPolarPeriod,
            polarAmp: p.gasGiantPolarAmp,
            polarFade: p.gasGiantPolarFade,
            vortexAmp: p.gasGiantVortexAmp,
            vortexSpin: p.gasGiantVortexSpin,
            vortexEdge: p.gasGiantVortexEdge,
            vortexTexBoost: p.gasGiantVortexTexBoost,
            vortexRim: p.gasGiantVortexRim,
            vortexGate: p.gasGiantVortexGate,
            vortexStretch: p.gasGiantVortexStretch,
            jetAmp: p.gasGiantJetAmp,
            jetOmega: p.gasGiantJetOmega,
            jetKappa: p.gasGiantJetKappa,
            lodOn: p.gasGiantLodOn,
            lodPx: p.gasGiantLodPx,
            limbGlow: p.gasGiantLimbGlow,
            limbPow: p.gasGiantLimbPow,
            // ★ 第 1 步是**静帧**：带缘噪声的时间恒为 0 ★
            //   场自身的三个时间项（平流/切变/演化）在配方里已经是 0，
            //   但带缘噪声直接吃这个 uGgTime ⇒ 不钉成 0 的话静帧会随时间漂，
            //   所有"同参数同图"的比对（含 measurePlanet 的冻结口径）当场失效。
            time: 0,
            debug: Number(p.gasGiantDebug) || 0,
        } : null;
        // ★★ 与本体**同一份**光照口径（2026-10-01 修「背阴面云又明显又丑」）★★
        //   改之前：云只吃 uSunColor × ndl，**完全不吃大气消光**；
        //   而本体吃 sunTint（日落红化 + 变暗）⇒ 地表暗下去时云还是中性亮灰。
        //   下面这几项必须与 drawSphere 用**同一个来源**取，不能各算一份：
        //     extinction     ← solveExtinction（与大气散射层同一份系数）
        //     scaleHeight    ← atmo.scaleHeight（标高比 H/Rp）
        //     sunColumnSurface ← airMass.js 的太阳柱积分**地表切片**（唯一真源）
        //     terminatorSoft/Pow ← 面板值，本体与云必须同值，否则两层晨昏线错开
        const atmo = p.atmosphereEnabled ? (p.atmosphere || null) : null;
        const terminatorSoft = Math.max(0, Number(p.terminatorSoftDeg) || 0) * Math.PI / 180;
        const terminatorPow = Math.max(1, Number(p.terminatorPow) || 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        cloudLayer.draw({
            viewProj: buildViewProj(
                options.viewWidth,
                options.viewHeight,
                options.zoom === undefined ? p.zoom : options.zoom,
            ),
            model: model,
            normalMatrix: normalMatrixFromModel(model),
            // ★ 太阳方向**不取反**（与本体一致）★
            //   只有大气层那一处特例要 z 取反，因为它是按诚实几何 raymarch 的。
            //   云与本体重网格约定 ⇒ 跟着本体走。理由见 cloudShaders.js 文件头。
            sunDir: p.sunDir || [0, 0, -1],
            sunColor: effectiveSunColor(),
            ambient: p.ambient || 0,
            spinAngle: 0,
            // ---- 程序化云场（无贴图）----
            field: clouds,
            cdf: state.cloudCdf,
            // ★ 云的时间（秒）★ 由 render(dt) 累加；量测路径冻结到指定值（默认 0）。
            //   "自转"已退役：它与纬向风都是经度平移，风只是更一般的那一个
            //   （风随纬度变 ⇒ 顺带给出切变）。留两个旋钮干同一件事只会让人调错。
            cloudTime: options.cloudTime === undefined ? state.cloudTime : options.cloudTime,
            // ★ 急流位移用的时间（秒）—— 与 cloudTime **分开** ★
            //   总监 2026-10-04 选「限幅」：warp 后 dt 变大，位移那一路被夹住 ⇒
            //   图案仍在演化（走 cloudTime），但位移不会闪成一团。
            //   量测路径同样可冻结（默认 0 ⇒ 急流项恒为 0 ⇒ 静帧口径不变）。
            windTime: options.windTime === undefined ? (state.cloudWindTime || 0) : options.windTime,
            // ★ 生消的球面平均（每帧一次；见 cloudRecipe.cloudBirthMean 的说明）★
            //   不减掉它，整颗星球会同时进入"晴"相位 ⇒ 云量摆幅实测达 ±50%。
            birthMean: cloudBirthMean(clouds,
                options.cloudTime === undefined ? state.cloudTime : options.cloudTime),
            // ★ 纬向气候带 ★ 表以 Float32Array 传（uniform 数组）；归一化因子在这里算一次
            zoneProfile: state.cloudZoneProfile,
            zoneNorm: state.cloudZoneNorm,
            debugField: options.debugField || 0,
            // ---- 与本体共用的晨昏线 / 大气消光口径 ----
            terminatorSoft: terminatorSoft,
            terminatorPow: terminatorPow,
            atmoEnabled: !!atmo,
            atmoExt: atmo ? solveExtinction(atmo) : [0, 0, 0],
            atmoScaleHeight: atmo ? atmo.scaleHeight : 0,
            sunColumnSurface: getSunColumnTable(
                atmo ? atmo.scaleHeight : 0.013,
                atmo && atmo.atmoScale > 1 ? atmo.atmoScale : 1.02,
            ).surface,
            // 直射强度与夜面淡出也必须与本体同值（否则平光模式下云会凭空长出晨昏线）
            diffuse: p.diffuse,
            nightLimbFade: p.nightLimbFade,
            nightLimbFadeWidth: p.nightLimbFadeWidth,
            params: clouds,
            gasGiant: ggDesc,
        });
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        state.stats.drawCalls += 1;
    }

    /**
     * ★ 第三卷：烘焙云影图（512×256 等距柱状）★
     *
     * 口径：**每个 texel = 一个经纬格**，算"竖直穿过各层云壳的光学厚度之和 τ"，
     *       输出 shade = 1 − exp(−τ)。这张图**与太阳方向无关** —— 太阳方向在地表
     *       采样时才进入（地表点沿太阳方向穿到云壳上的交点去查它），"影与云错位"
     *       就是那个视差造成的。
     *
     * ⚠️ 只在 `cloudShadowEnabled` 打开时调用（默认关 ⇒ 连 target 都不创建）。
     * ⚠️ 用**独立网格**（cloudShadowMesh），不能借 fullscreenMesh ——
     *    那份 VAO 绑定的是 unprojectProgram 的属性位置。
     *
     * @param {object} clouds 云参数（与 drawClouds 同一个对象）
     * @param {object} options { cloudTime }
     */
    function bakeCloudShadow(clouds, options) {
        const t = target('cloudShadow', CLOUD_SHADOW_W, CLOUD_SHADOW_H, { srgb: false, filter: gl.LINEAR });
        state.cloudShadowTex = t;
        // ⚠️⚠️ 必须保存/恢复 **framebuffer 与 viewport** ⚠️⚠️
        //   调用方（measurePlanet / render）在**离屏 target** 上画，且不会在每层之前重设
        //   framebuffer —— 所以烘焙完若把它绑回 null，**后面的云层与大气会画到画布上**，
        //   离屏图里只剩球体（症状：落盘图是"一颗没有云、没有大气、颜色发生的球"，
        //   而且开关差异图看起来像"整个半球被压暗"）。viewport 不恢复的后果同理（云画进角落）。
        const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevViewport = gl.getParameter(gl.VIEWPORT);
        // 覆盖率口径与云层一致：多壳时用"每层覆盖率"（并集守恒），单壳时用原 coverage
        const nShells = clouds.shells === undefined ? 1 : clouds.shells;
        const covComp = clouds.shellCoverageComp === undefined ? 0 : clouds.shellCoverageComp;
        const covUnion = nShells > 1 ? 1 - Math.pow(1 - clouds.coverage, 1 / nShells) : clouds.coverage;
        const covPerShell = clouds.coverage + (covUnion - clouds.coverage) * Math.max(0, Math.min(1, covComp));
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
        gl.viewport(0, 0, CLOUD_SHADOW_W, CLOUD_SHADOW_H);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        setUniforms(gl, cloudShadowProgram, {
            uMapSize: [CLOUD_SHADOW_W, CLOUD_SHADOW_H],
            uFieldP0: [clouds.scale, clouds.lacunarity, clouds.gain, clouds.cascade],
            uFieldP1: [clouds.warp, clouds.warpDetail, clouds.warpDetailScale, clouds.bandStretch],
            uFieldP2: [
                clouds.ridge,
                clouds.octaves,
                clouds.birthScale === undefined ? 2 : clouds.birthScale,
                clouds.windShearMax === undefined ? 0 : clouds.windShearMax,
            ],
            uFieldP3: [
                clouds.windSpeed || 0,
                clouds.windShear || 0,
                clouds.evolveRate || 0,
                clouds.birthAmount || 0,
            ],
            uFieldSeed: clouds.seed,
            uCloudTime: options.cloudTime === undefined ? state.cloudTime : options.cloudTime,
            uCoverage: clouds.coverage,
            uShellCoverage: covPerShell,
            uSoftness: clouds.softness === undefined ? 0.001 : clouds.softness,
            uShells: nShells,
            uShellShift: clouds.shellShift === undefined ? 0 : clouds.shellShift,
            uInnerOctaves: clouds.innerOctaves === undefined ? 3 : clouds.innerOctaves,
            uBirthMean: cloudBirthMean(clouds, options.cloudTime === undefined ? state.cloudTime : options.cloudTime),
            uCloudCdf: state.cloudCdf.lut,
            uCloudLogMin: state.cloudCdf.logMin,
            uCloudLogSpan: Math.max(1e-9, state.cloudCdf.logMax - state.cloudCdf.logMin),
            uZoneProfile: state.cloudZoneProfile,
            uZoneStrength: clouds.zoneStrength === undefined ? 0 : clouds.zoneStrength,
            uZoneNorm: state.cloudZoneNorm === undefined ? 1 : state.cloudZoneNorm,
        });
        drawMesh(gl, cloudShadowMesh);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
        state.stats.drawCalls += 1;
    }

    /**
     * 用全屏三角形跑一个「每像素算 uv + 采样」的程序。
     * @param {object} program createProgram 的返回值
     * @param {object} uniforms 额外 uniform
     * @param {object} sourceTextures [{ unit, tex }]
     */
    function drawFullscreen(program, uniforms, sourceTextures) {
        setUniforms(gl, program, uniforms);
        sourceTextures.forEach((entry) => {
            bindTexture(gl, entry.tex, entry.unit);
        });
        drawMesh(gl, fullscreenMesh);
        state.stats.drawCalls += 1;
    }

    return {
        /**
         * 切换**透明背景模式**（卡1 / 决策 D-9）。
         *
         * 语义：离屏目标背景清成 alpha=0，铺屏时 alpha **透传**到画布 ⇒
         * 画布可与主游戏 Canvas2D 底图（`drawImage`）叠加。
         *
         * ⚠️ 需要**带 alpha 的上下文**（`createGLContext(canvas, { alpha: true })`）。
         * ⚠️ 画布内容是**直线 alpha**（上下文用 `premultipliedAlpha: false`）
         *    ⇒ 合成方必须按直线 alpha 处理，不得当成已预乘的源。
         * ⚠️ 默认 `false`；不传/传 false 时**渲染路径逐像素不变**。
         *
         * @param {boolean} flag
         * @returns {boolean} 生效后的值（便于调用方断言）
         */
        setTransparent(flag) {
            transparentMode = flag === true;
            return transparentMode;
        },

        /** 当前是否透明背景模式 */
        isTransparent() {
            return transparentMode;
        },

        /**
         * 直接读写参数（实验室面板用；迁移时由调用方改走 setPlanet）
         */
        params: state.params,

        /**
         * 换天体：贴图 / 几何 / 光照一次配齐。
         *
         * ★ B2-fix（总监 2026-10-16 批准）：白名单校验，根治「无校验 key 覆盖」★
         *   只接受 PARAM_WHITELIST 内的字段；不认的字段**显式报错**（信息含字段名
         *   与可用字段清单），不再静默塞进 params 而不生效。接入主游戏时
         *   displayRadius / radius / atmosphereHeight / hasAtmosphere 等必须由接入方
         *   先换算成渲染参数。空对象 / null / undefined 仍是合法空操作
         *   （comparison.js 与 checkCloudRender.js 的 saved 恢复模式依赖此行为）。
         *
         * @param {object} bodyParams 部分参数覆盖
         */
        setPlanet(bodyParams) {
            const incoming = bodyParams || {};
            const unknownKeys = Object.keys(incoming).filter((key) => !PARAM_WHITELIST.has(key));
            if (unknownKeys.length > 0) {
                // 报错文案由 unknownParamKeysError 单点生成（B2-fix-2 后与构造入口共用）
                throw unknownParamKeysError(unknownKeys, 'setPlanet');
            }
            Object.keys(incoming).forEach((key) => {
                state.params[key] = incoming[key];
            });
        },

        /**
         * 俯视正交相机。
         * @param {object} camera { cx, cy, zoom }
         */
        setCamera(camera) {
            const cam = camera || {};
            if (cam.cx !== undefined) {
                state.params.cameraX = cam.cx;
            }
            if (cam.cy !== undefined) {
                state.params.cameraY = cam.cy;
            }
            if (cam.zoom !== undefined) {
                state.params.zoom = cam.zoom;
            }
        },

        /**
         * 设置画面中的子矩形（同一 canvas 分屏时用）。
         * @param {object} rect { x, y, width, height }，单位物理像素，原点左下图（GL 坐标系）
         */
        setViewport(rect) {
            state.viewport = {
                x: rect.x | 0,
                y: rect.y | 0,
                width: Math.max(1, rect.width | 0),
                height: Math.max(1, rect.height | 0),
            };
            state.viewportExplicit = true;
        },

        /**
         * 尺寸变化。
         * @param {number} width 绘制缓冲宽（物理像素）
         * @param {number} height 绘制缓冲高（物理像素）
         * @param {number} [dpr=1]
         */
        resize(width, height, dpr) {
            state.canvasWidth = width;
            state.canvasHeight = height;
            state.dpr = dpr === undefined ? 1 : dpr;
            if (!state.viewportExplicit) {
                state.viewport = { x: 0, y: 0, width, height };
            }
        },

        /**
         * 上传贴图。
         * @param {TexImageSource} source 已解码图像
         * @param {object} [textureOptions]
         */
        setAlbedo(source, textureOptions) {
            if (state.albedo) {
                destroyTexture(gl, state.albedo);
            }
            const texOpts = Object.assign({
                mipmap: state.params.mipmap,
                filter: state.params.filter,
                repeatX: true,
                repeatY: false,
                // 不翻转上传：网格 UV 用 v = 1 - row/height，与文件空间自洽
                // （详见 glCore/texture.js 与 geometry/sphereMesh.js 的约定说明）
                flipY: false,
                anisotropy: state.params.anisotropy,
            }, textureOptions || {});
            state.albedo = createTextureFromImage(gl, source, texOpts);
            state.albedoOptions = texOpts;
            state.albedoSource = source;
        },

        /**
         * 用当前参数重建贴图（切换过滤 / mipmap 等选项时调用）。
         */
        refreshAlbedo() {
            if (state.albedoSource) {
                this.setAlbedo(state.albedoSource);
            }
        },

        /**
         * 设置细节层（抗平铺）。
         *
         * @param {object|null} desc
         *   detailImage  细节纹理（R 细颗粒 / G 粗颗粒 / B 扭曲场），必须无缝可平铺
         *   biomeImage   群系索引图（R 通道 = 群系下标，**必须用 NEAREST 采样**）
         *   tiles        细节纹理横跨整颗星球几次
         *   warpAmount   域扭曲强度（纹理周期数，0 = 关闭扭曲）
         *   coarseWeight 粗颗粒权重
         *   biomeStyles  逐群系 [{ detailStrength, detailScale }]，顺序 = 群系下标
         */
        setDetail(desc) {
            if (state.detail) {
                destroyTexture(gl, state.detail.detailTexture);
                destroyTexture(gl, state.detail.biomeTexture);
                state.detail = null;
            }
            if (!desc || !desc.detailImage) {
                return;
            }
            // 细节层必须 REPEAT 环绕（要平铺）；mipmap 打开避免远处闪烁
            const detailTexture = createTextureFromImage(gl, desc.detailImage, {
                mipmap: true,
                filter: 'linear',
                repeatX: true,
                repeatY: true,
                flipY: false,
                anisotropy: state.params.anisotropy,
            });
            // 群系索引图：**NEAREST** —— 线性插值会产生不存在的群系编号
            const biomeTexture = desc.biomeImage
                ? createTextureFromImage(gl, desc.biomeImage, {
                    mipmap: false,
                    filter: 'nearest',
                    repeatX: true,
                    repeatY: false,
                    flipY: false,
                })
                : null;

            const strength = new Float32Array(MAX_BIOMES);
            const scale = new Float32Array(MAX_BIOMES);
            strength.fill(1);
            scale.fill(1);
            (desc.biomeStyles || []).forEach((style, i) => {
                if (i >= MAX_BIOMES) {
                    return;
                }
                strength[i] = style.detailStrength === undefined ? 1 : style.detailStrength;
                scale[i] = style.detailScale === undefined ? 1 : style.detailScale;
            });

            // 地表材质的光学层：逐群系求解成定长数组（缺字段补默认、超范围钳制）。
            // ⚠️ 未声明 material 的群系得到 f0=0 ⇒ 着色器跳过镜面分支 ⇒ 纯 Lambert。
            //    所以这一步对既有天体是**零行为变化**的。
            const material = solveBiomeMaterials(desc.biomeStyles, MAX_BIOMES);

            state.detail = {
                detailTexture,
                biomeTexture,
                tiles: desc.tiles === undefined ? state.params.detailTiles : desc.tiles,
                warpAmount: desc.warpAmount === undefined ? state.params.detailWarpAmount : desc.warpAmount,
                coarseWeight: desc.coarseWeight === undefined ? state.params.detailCoarseWeight : desc.coarseWeight,
                atlas: desc.atlas === undefined ? [1, 1] : desc.atlas,
                strength,
                scale,
                material,
                enabled: true,
            };
        },

        /** 开关细节层（对比实验里需要关掉它测纯净的 albedo） */
        setDetailEnabled(enabled) {
            if (state.detail) {
                state.detail.enabled = enabled !== false;
            }
        },

        /**
         * 挂载**地形法线图**（地表起伏，卡2）。传 null 卸载。
         *
         * 法线图是切空间单位法线（`data/out/bake/<bodyId>-normal.png`，与 albedo
         * 同投影同尺寸，row 0 = 北极），由 tools/makeNormalMap.mjs 烘出。
         * 光照侧的用法见 planetShaders.js 的「地表起伏」段。
         *
         * @param {TexImageSource|null} source 已解码图像
         * @param {object} [options]
         *   relief  Float32Array | number[]，逐群系强度（长度 = MAX_BIOMES）。
         *           缺省 = 全 1；实际生效强度还要乘 params.normalStrength。
         *   textureOptions 覆盖纹理上传选项
         */
        setNormalMap(source, options) {
            const opts = options || {};
            if (state.normalMap) {
                destroyTexture(gl, state.normalMap.texture);
                state.normalMap = null;
            }
            if (!source) {
                return;
            }
            // ★ repeatX = true 是硬要求 ★：经度方向是环绕的，用 CLAMP 采样会在
            //   u=0/1 接缝处把法线插到一条"错误的邻列"上 ⇒ 球面出现一条竖缝。
            //   纵向（纬向）不环绕：极点行之外没有内容，CLAMP 才是对的。
            const texOpts = Object.assign({
                mipmap: true,
                filter: 'linear',
                repeatX: true,
                repeatY: false,
                // 不翻转上传：与 albedo 完全同一套约定（见 glCore/texture.js 的说明）
                flipY: false,
                anisotropy: state.params.anisotropy,
            }, opts.textureOptions || {});
            const relief = new Float32Array(MAX_BIOMES);
            relief.fill(1);
            if (opts.relief) {
                for (let i = 0; i < MAX_BIOMES && i < opts.relief.length; i++) {
                    relief[i] = opts.relief[i];
                }
            }
            state.normalMap = {
                texture: createTextureFromImage(gl, source, texOpts),
                relief,
            };
        },

        /**
         * 设置编辑预览的特征场。
         *
         * 特征场是一张 RG 纹理：
         *   R = albedo 增量（0.5 中性）  G = 高度增量（0.5 中性）
         * 由 CPU 用 tools/shapeOps.mjs 烘焙 —— 与离线烘焙器**同一套形状函数**，
         * 这样编辑器所见即烘焙所得（任务书最高优先级的约束）。
         *
         * @param {object|null} desc
         *   rgba        Uint8Array，长度 = width*height*4
         *   width/height
         *   shadingStrength 特征高度对明暗的贡献
         */
        setFeatureField(desc) {
            if (state.feature) {
                // ⚠️ createTextureFromData 返回的是**描述符** { texture, width, height, mipmapped }，
                //    不是裸 WebGLTexture。这里曾经直接把它交给 destroyTexture，于是
                //    deleteTexture 收到一个普通对象抛 TypeError，每次重烘特征场都中断，
                //    而 state.feature 已经被赋成新描述符 —— 结果渲染器一直采样一个**已删除的纹理**，
                //    球面整片变黑。教训：本项目的纹理句柄一律是描述符，取裸句柄必须走 .texture。
                destroyTexture(gl, state.feature.texture);
                state.feature = null;
            }
            if (!desc || !desc.rgba) {
                return;
            }
            const tex = createTextureFromData(gl, desc.rgba, desc.width, desc.height, {
                mipmap: false,
                filter: 'linear',
                repeatX: true,
                repeatY: false,
            });
            state.feature = {
                texture: tex,
                width: desc.width,
                height: desc.height,
                shadingStrength: desc.shadingStrength === undefined ? 0.012 : desc.shadingStrength,
            };
        },

        /** 相机对准某个行星坐标（编辑预览用） */
        focusOn(u, v) {
            // 反推：世界 xz 平面上，球面点 (u, v) 对应方向
            //   theta = (u - 0.5)·2π，纬度 lat = (v - 0.5)·π
            //   方向 = (cos(lat)sin(theta), sin(lat), cos(lat)cos(theta))
            // 相机对准它 → 该点转到 +Z。做法是让渲染器按这个角度旋转模型。
            const theta = (u - 0.5) * 2 * Math.PI;
            const lat = (v - 0.5) * Math.PI;
            state.params.spinDeg = theta * 180 / Math.PI;
            state.params.tiltDeg = -lat * 180 / Math.PI;
        },

        /**
         * 画一帧。
         * @param {number} [dt] 距上一帧的秒数（当前未使用，保留接口形状）
         */
        render(dt) {
            const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            // ★ 波浪的时间累加器 ★
            //   放在 render 里自己累加，而不是让调用方传"绝对时刻"：
            //   调用方（实验室 / 主游戏）的帧长是变的，用绝对时刻会让
            //   暂停后恢复时波浪"跳一下"。自累加 = 天然可控（速率置 0 即冻结，
            //   且不会再累进 —— 所以恢复时从冻结点继续，不会突然前跳）。
            const waveSpeed = Number(state.params.waveSpeed);
            if (Number.isFinite(waveSpeed) && waveSpeed !== 0) {
                state.waveTime += dt * waveSpeed;
            }
            // ★ 云的时间累加：与波浪**同一套机制、同一个理由** ★
            //   自累加而不是用绝对时刻 —— 调用方帧长可变，绝对时刻会让暂停恢复时"跳一下"；
            //   速率置 0 即冻结且不再累进。
            //   ⚠️ 时间常量是**游戏时间**：主游戏 warp 之后传进来的 dt 是加速过的，
            //      云的漂移会跟着一起快 —— 这是要的行为，但高速下会频闪。
            //   ★★ 总监 2026-10-04 拍板：**限幅** ★★
            //      位移那一路（急流）单独累加，且每帧的 dt 先夹到 WIND_DT_MAX ⇒
            //      正常帧（dt ≈ 1/60）完全不受影响；warp 时位移仍平滑推进但不会闪成一团。
            //      图案演化仍走 cloudTime（跟随游戏时间），所以"云在变"这件事照样加速。
            state.cloudTime += dt;
            state.cloudWindTime = (state.cloudWindTime || 0) + Math.min(dt, CLOUD_WIND_DT_MAX);
            const vp = state.viewport;
            // ★★ 场景先渲到**离屏 SRGB8 目标**，再整屏铺到画布（2026-10-02）★★
            //
            // 为什么不能直接往画布上合成：
            //   · 画布按 sRGB 解释缓冲 ⇒ 直接往画布画，着色器必须先编码，
            //     于是 `scatter + background × T` 变成"在伽马域相加" —— 暗处的
            //     散射被系统性放大（实测同一像素差可达 24/255）；
            //   · 而离屏量测走 SRGB8（硬件解码 ⇒ **线性域**混合），两条路径
            //     算的不是同一件事 ⇒ "量着没问题、看着不对"。
            // 做法：统一先写离屏 SRGB8（线性域混合，物理正确），最后一步铺屏编码。
            // 于是**画布上看到的 = 离屏量到的**（除 MSAA 边缘像素外逐像素一致）。
            //
            // ⚠️ MSAA：离屏目标默认没有多重采样，直接用会让球体边缘重新出现锯齿，
            //    所以这个目标开 4×MSAA（颜色附件换成多重采样 renderbuffer），
            //    采样/读像素前由 resolveRenderTarget 解析进纹理。
            const frame = target('frame', vp.width, vp.height, { msaa: 4 });
            gl.bindFramebuffer(gl.FRAMEBUFFER, frame.framebuffer);
            gl.viewport(0, 0, vp.width, vp.height);
            gl.disable(gl.SCISSOR_TEST);
            // ★ 卡1：clear 颜色**总是显式设置**（不变量本地化）★
            //   ⚠️ 组长 2026-10-17 复核抓到的**状态泄漏**：早先版本"只在透明模式才调 clearColor"，
            //      于是 `setTransparent(true)` 跑一帧后再 `setTransparent(false)`，
            //      紧接的第一帧不透明会**沿用残留的 (0,0,0,0)** ⇒ 背景变透明（与改动前行为不同）；
            //      而"全程 false"的回归用例**测不到**这条路径（`setTransparent` 是公开方法，
            //      模式切换是被支持的用法）。
            //   现在总是写：不透明写 1（= 上下文默认值，见 glCore/context.js:56 ⇒ 行为不变），
            //   透明写 0 ⇒ 帧清屏颜色**不依赖上下文默认值、也不依赖任何残留状态**。
            gl.clearColor(0, 0, 0, transparentMode ? 0 : 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            // ★ 半径几何解析：默认路径与显式半径通道（标定层 T1）在此分叉 ★
            //
            //   默认路径（screenRadiusPx === undefined，表达式逐字不动）：
            //     球半径 = 视口高度的一半（世界单位），保证直径恰好铺满视口高度
            //   显式通道（screenRadiusPx 给定，标定口径）：
            //     zoom_world = viewHeight / 2     ⇒ 投影半高恒为 1，不越 ±8 裁剪体，
            //                                       世界单位恒 O(1)（深度精度安全）
            //     R_world    = 2·R_px / viewHeight ⇒ 屏幕半径 = R_world × zoom_world = R_px
            //     此时 params.zoom 不参与几何；游戏口径的 displayRadius × zoom → R_px
            //     换算属于标定工具层，渲染器只收像素（B1「半径被钉死」由此解锁）。
            let planetRadius;
            let zoomUsed;
            const screenRadiusPx = state.params.screenRadiusPx;
            if (screenRadiusPx === undefined) {
                const worldPerPixel = 1 / Math.max(1e-6, state.params.zoom);
                planetRadius = (vp.height * worldPerPixel) / 2;
                zoomUsed = state.params.zoom;
            } else {
                if (typeof screenRadiusPx !== 'number' || !Number.isFinite(screenRadiusPx) || screenRadiusPx <= 0) {
                    throw new Error('screenRadiusPx 非法（必须为有限正数，收到 ' + screenRadiusPx + '）—— 显式报错，不静默通过');
                }
                zoomUsed = vp.height / 2;
                planetRadius = (2 * screenRadiusPx) / vp.height;
            }
            drawSphere({
                viewWidth: vp.width,
                viewHeight: vp.height,
                planetRadius,
                zoom: zoomUsed,
                lit: true,
            });
            // 大气层在球体之上（阶段 2）。开关关掉时 drawAtmosphere 直接返回。
            //
            // ★ 云的合成顺序（总监 2026-10-01 定：默认在大气**之下**，并保留开关出 A/B）★
            //   below：先画云 → 再画大气 ⇒ 云被大气衰减、并吃到日落红（物理更正确）
            //   above：先画大气 → 再画云 ⇒ 云更白更锐，但不吃日落红
            //   两种都留着，是为了能出对照图让人**看图**决定，而不是靠论证。
            const cloudsBelow = state.params.cloudOrder !== 'above';
            if (cloudsBelow) {
                drawClouds({
                    viewWidth: vp.width,
                    viewHeight: vp.height,
                    planetRadius,
                    zoom: zoomUsed,
                });
            }
            drawAtmosphere({
                viewWidth: vp.width,
                viewHeight: vp.height,
                planetRadius,
                zoom: zoomUsed,
            });
            if (!cloudsBelow) {
                drawClouds({
                    viewWidth: vp.width,
                    viewHeight: vp.height,
                    planetRadius,
                    zoom: zoomUsed,
                });
            }

            // ---- 铺屏：解析 → 写回画布对应的子视口（letterbox 时只覆盖那一片）----
            resolveRenderTarget(gl, frame);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(vp.x, vp.y, vp.width, vp.height);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(vp.x, vp.y, vp.width, vp.height);
            setTargetFilter(gl, frame, gl.LINEAR);
            // ★ 卡1：透明模式用"alpha 透传"版铺屏程序，并关掉混合 ★
            //   为什么要关 BLEND：上面的大气块用的是 (ONE, ONE_MINUS_SRC_ALPHA) 这类方程，
            //   若它没被复位，铺屏写 alpha 时目标 alpha 会被**再混合一次**（dstA=0 时
            //   结果是 srcA² 而不是 srcA）⇒ 半透明区域会算错。不透明模式无需处理
            //   （srcA 恒 1，混合与不混合结果相同），所以只在透明分支动状态。
            if (transparentMode) {
                gl.disable(gl.BLEND);
            }
            drawFullscreen(transparentMode ? blitAlphaProgramOf() : blitProgram, {
                uSource: { texture: 0 },
                // 源是 SRGB8（采样时硬件已解码成线性）⇒ 画布这一侧必须编码
                uSrgbOut: 1,
            }, [{ unit: 0, tex: frame }]);
            gl.disable(gl.SCISSOR_TEST);

            state.stats.frames += 1;
            state.stats.lastCpuMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - started;
            state.stats.lastDt = dt;
        },

        /**
         * 把当前贴图按经纬度重投影成一张等距圆柱图（不经过球体）。
         * 用途：对比实验里的「源图重构」基准，验证 UV 解析式与栅格化结果一致。
         * @param {object} desc { width, height }
         * @returns {object} 渲染目标
         */
        unprojectToTexture(desc) {
            const width = Math.max(1, desc.width | 0);
            const height = Math.max(1, desc.height | 0);
            // ⚠️ 数据类目标：写入的字节本身就是最终要看的图（与源贴图逐字节比对），
            //    不能走 SRGB8（硬件会再编一次）—— 见 target() 的说明。
            const t = target('unproject', width, height, { srgb: false });
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
            gl.viewport(0, 0, width, height);
            gl.disable(gl.SCISSOR_TEST);
            // ★ 卡1：随模式给背景 alpha（不透明模式仍写 1 ⇒ 与改动前逐字相同）★
            gl.clearColor(0, 0, 0, transparentMode ? 0 : 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            drawFullscreen(unprojectProgram, { uAlbedo: { texture: 0 } }, [{ unit: 0, tex: state.albedo }]);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return t;
        },

        /**
         * 离屏渲染球体并取回像素（对比实验用）。
         * @param {object} desc { width, height, lit, filter,
         *   screenRadiusPx?, planetRadius?, zoom? }
         *   可选几何字段（标定层 T1，默认 undefined = 原行为，见函数体注释）：
         *   screenRadiusPx = 显式屏幕像素半径；planetRadius+zoom = 显式世界几何透传；
         *   两组互斥，同给抛错。
         * @returns {{width:number, height:number, pixels:Uint8Array, target:object}}
         */
        measurePlanet(desc) {
            const width = Math.max(1, desc.width | 0);
            const height = Math.max(1, desc.height | 0);
            // ★ 量测几何解析（标定层 T1）：三个可选字段，全部默认 undefined = 原行为 ★
            //   · screenRadiusPx：显式屏幕半径（像素）→ zoom_world = height/2、
            //     R_world = 2·R_px/height —— 与 render(dt) 的通道同一套换算
            //   · planetRadius + zoom：显式世界几何透传（J2 层 A 用：固定 R_world、
            //     变 zoom_world。通道口径把 zoom_world 钉死为 height/2，表达不了层 A；
            //     内部 drawSphere 本就接受任意 (planetRadius, zoom)，这里只是透出）
            //   · screenRadiusPx 与 planetRadius/zoom 同给 ⇒ 显式报错（口径歧义，不静默取舍）
            const hasScreenR = desc.screenRadiusPx !== undefined;
            const hasExplicitWorld = desc.planetRadius !== undefined || desc.zoom !== undefined;
            if (hasScreenR && hasExplicitWorld) {
                throw new Error('measurePlanet 不能同时给 screenRadiusPx 与 planetRadius/zoom（口径歧义）—— 显式报错');
            }
            let planetRadius = 0.5;
            let zoomUsed = height;
            if (hasScreenR) {
                const sr = desc.screenRadiusPx;
                if (typeof sr !== 'number' || !Number.isFinite(sr) || sr <= 0) {
                    throw new Error('screenRadiusPx 非法（必须为有限正数，收到 ' + sr + '）—— 显式报错，不静默通过');
                }
                zoomUsed = height / 2;
                planetRadius = (2 * sr) / height;
            } else if (hasExplicitWorld) {
                planetRadius = desc.planetRadius === undefined ? 0.5 : desc.planetRadius;
                zoomUsed = desc.zoom === undefined ? height : desc.zoom;
                if (typeof planetRadius !== 'number' || !Number.isFinite(planetRadius) || planetRadius <= 0) {
                    throw new Error('planetRadius 非法（必须为有限正数，收到 ' + planetRadius + '）—— 显式报错，不静默通过');
                }
                if (typeof zoomUsed !== 'number' || !Number.isFinite(zoomUsed) || zoomUsed <= 0) {
                    throw new Error('zoom 非法（必须为有限正数，收到 ' + zoomUsed + '）—— 显式报错，不静默通过');
                }
            }
            const t = target(desc.lit === false ? 'ref' : 'actual', width, height);
            // ★ 离屏量测：把波浪相位**冻结**在 0 ★
            //
            //   为什么必须冻结（2026-09-27）：波浪动画速度默认 0.1（总监在实验室调定的），
            //   而 `state.waveTime` 是**随时间累加**的 —— 于是同一个 renderer 在两次
            //   不同的时刻调用 measurePlanet，会渲出两张不同的图。
            //   而 checkM5 / checkComparison / makeOursDisc / 各种 diff 工具**全部**走
            //   这条路径，它们的前提是"同一组参数渲染出同一张图"。不冻结的话，
            //   质检会因为"波浪转了一点点"而报出**假的质感漂移**，而且完全不可复现。
            //   （实测踩到的近亲：圆盘用另一颗天体的细节层渲出来，mtime 全新鲜 ——
            //     都是"检查通过了/没通过，但没在检查真正的东西"。）
            //
            //   冻结而不是"要求调用方先把 waveSpeed 置 0"：后者是**约定**，
            //   约定拦不住人；这里是**机制**。交互路径 render(dt) 不受影响。
            const savedWaveTime = state.waveTime;
            state.waveTime = 0;
            // ★ 云的自转相位一并冻结（同一理由、同一处）★
            //   量测路径必须与交互路径**解耦**：否则"云转了一点点"就会让质检报出
            //   假的质感漂移，而且完全不可复现。冻结而不是"请调用方自己把 spinSpeed 置 0"：
            //   后者是**约定**，约定拦不住人；这里是**机制**。
            // ★ 云的时间一并冻结（同一理由、同一处）★
            //   ⚠️ 与波浪不同：云的时间可以冻结到**任意**值（desc.cloudTime），
            //      默认 0 —— 这样才能出"相隔 t 的两张图"做形变对照。
            //   冻结而不是"请调用方自己把风速置 0"：后者是**约定**，约定拦不住人；
            //   这里是**机制**。
            const savedCloudTime = state.cloudTime;
            state.cloudTime = desc.cloudTime === undefined ? 0 : desc.cloudTime;
            // ★ 急流位移的时间**在同一处冻结**（同一理由）★
            //   默认 0 ⇒ 位移项恒为 0 ⇒ **静帧口径与加急流之前逐位相同**
            //   （这条是整个"零变化"承诺的机制保障，不是靠调用方自觉）。
            //   传 windTime 就能出"相隔 t 的两张图"做流动对照。
            const savedWindTime = state.cloudWindTime;
            state.cloudWindTime = desc.windTime === undefined ? 0 : desc.windTime;
            if (desc.filter !== undefined) {
                setTargetFilter(gl, t, desc.filter);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
            gl.viewport(0, 0, width, height);
            gl.disable(gl.SCISSOR_TEST);
            // ★ 卡1：随模式给背景 alpha（不透明模式仍写 1 ⇒ 与改动前逐字相同）★
            gl.clearColor(0, 0, 0, transparentMode ? 0 : 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            drawSphere({
                viewWidth: width,
                viewHeight: height,
                planetRadius,
                zoom: zoomUsed,
                lit: desc.lit !== false,
            });
            // 离屏渲染也要画大气 —— 否则验收图/对比图上看不到大气层，
            // 会出现"实验室里看得见、落盘的图里没有"这种最难查的不一致。
            // 云同理，而且顺序必须与 render(dt) **逐字一致**（below/above 用同一个开关），
            // 否则对照图与现场看到的不是同一个东西。
            const cloudsBelow = state.params.cloudOrder !== 'above';
            if (cloudsBelow) {
                drawClouds({ viewWidth: width, viewHeight: height, planetRadius, zoom: zoomUsed });
            }
            drawAtmosphere({
                viewWidth: width,
                viewHeight: height,
                planetRadius,
                zoom: zoomUsed,
            });
            if (!cloudsBelow) {
                drawClouds({ viewWidth: width, viewHeight: height, planetRadius, zoom: zoomUsed });
            }
            // 读像素前先解析（MSAA 目标上是必须的；单采样时是空操作），
            // 并且**从纹理侧 framebuffer** 读 —— 多重采样附件不可 readPixels。
            resolveRenderTarget(gl, t);
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.resolveFramebuffer);
            const pixels = readPixelsTopDown(gl, width, height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            state.waveTime = savedWaveTime;   // 复原相位（交互路径继续走它的时间轴）
            state.cloudTime = savedCloudTime;  // 云时间一并复原
            state.cloudWindTime = savedWindTime;   // 急流时间同理
            return { width, height, pixels, target: t };
        },

        /**
         * 绘制差异图（两个等尺寸目标逐像素相减）。
         * @param {object} desc { reference, actual, gain }
         * @returns {object} 渲染目标
         */
        drawDiff(desc) {
            const width = desc.reference.width;
            const height = desc.reference.height;
            // ⚠️ 数据类目标：差异图写入的就是最终显示配色，不走 SRGB8。
            const t = target('diff', width, height, { srgb: false });
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
            gl.viewport(0, 0, width, height);
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            drawFullscreen(diffProgram, {
                uReference: { texture: 0 },
                uActual: { texture: 1 },
                uGain: desc.gain === undefined ? state.params.diffGain : desc.gain,
            }, [
                { unit: 0, tex: { texture: desc.reference.texture } },
                { unit: 1, tex: { texture: desc.actual.texture } },
            ]);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return t;
        },

        /**
         * 直接把某个离屏目标铺到当前视口（对比图合成用）。
         *
         * ⚠️ 用**铺屏程序**（恒等拷贝）而不是经纬度反投影程序：这里要的是"把这张图
         *    原样摆上去"，不是"把球面重投影成等距圆柱图"。历史实现误用了反投影程序，
         *    在源是 SRGB8 目标时还会因为解码/编码不对称而整体偏亮。
         *    uSrgbOut = 1：源是 SRGB8（采样已解码成线性）⇒ 画布这一侧要编码。
         *
         * @param {object} targetRef 渲染目标
         * @param {number} [filter] 铺屏过滤，默认 LINEAR（平滑放大）
         */
        blitTarget(targetRef, filter) {
            resolveRenderTarget(gl, targetRef);
            setTargetFilter(gl, targetRef, filter === undefined ? gl.LINEAR : filter);
            const vp = state.viewport;
            gl.viewport(vp.x, vp.y, vp.width, vp.height);
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            drawFullscreen(blitProgram, {
                uSource: { texture: 0 },
                uSrgbOut: targetRef.srgb ? 1 : 0,
            }, [{ unit: 0, tex: { texture: targetRef.texture } }]);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
        },

        /** 读取某个离屏目标为像素（自上而下行序） */
        readTarget(targetRef) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, targetRef.framebuffer);
            const pixels = readPixelsTopDown(gl, targetRef.width, targetRef.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return pixels;
        },

        /** 释放全部离屏目标（对比实验结束后回收显存） */
        releaseTargets() {
            state.targets.forEach((value) => destroyRenderTarget(gl, value));
            state.targets.clear();
        },

        /** 取运行时统计（性能观测用）
         *  口径说明：triangles 是**上次 resetFrameStats 以来**的累加值；
         *  meshTriangleCount 是当前网格单次绘制的三角形数；drawCalls 同 triangles 的累加口径。 */
        getStats() {
            return Object.assign({}, state.stats, {
                meshTriangleCount: state.meshTriangleCount,
                segmentCount: state.params.segmentCount,
                ringCount: state.params.ringCount,
            });
        },

        /** 重置每帧统计 */
        resetFrameStats() {
            state.stats.drawCalls = 0;
            state.stats.triangles = 0;
        },

        /** 保留接口形状：读取内部状态用于诊断 */
        getState() {
            return state;
        },

        /** 诊断用：当前是否挂载了细节层 */
        hasDetail() {
            return !!(state.detail && state.detail.enabled);
        },

        /**
         * ★ 第三卷诊断：把云影图（512×256 等距柱状）读回来 ★
         *
         * 用途：验收时"影从哪来"必须能回到这张图上核对（shade = 1 − exp(−τ)），
         * 而不是只看地表的亮度差。未烘焙（云影关闭）时返回 null。
         * @returns {{width:number, height:number, pixels:Uint8Array}|null}
         */
        readCloudShadow() {
            if (!state.cloudShadowTex) {
                return null;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.cloudShadowTex.framebuffer);
            const pixels = readPixelsTopDown(gl, CLOUD_SHADOW_W, CLOUD_SHADOW_H);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return { width: CLOUD_SHADOW_W, height: CLOUD_SHADOW_H, pixels };
        },

        /** 释放全部 GPU 资源 */
        dispose() {
            state.targets.forEach((value) => destroyRenderTarget(gl, value));
            state.targets.clear();
            if (state.mesh) {
                destroyMesh(gl, state.mesh);
            }
            if (state.albedo) {
                destroyTexture(gl, state.albedo);
            }
            if (state.detail) {
                destroyTexture(gl, state.detail.detailTexture);
                destroyTexture(gl, state.detail.biomeTexture);
            }
            if (state.normalMap) {
                destroyTexture(gl, state.normalMap.texture);
            }
            destroyMesh(gl, fullscreenMesh);
            atmosphereLayer.dispose();
            cloudLayer.dispose();
            destroyProgram(gl, planetProgram);
            destroyProgram(gl, unprojectProgram);
            destroyProgram(gl, blitProgram);
            destroyProgram(gl, diffProgram);
            // 透明模式的铺屏程序是**懒建**的：没用过就不存在，别对 null 调销毁
            if (blitAlphaProgram) {
                destroyProgram(gl, blitAlphaProgram);
                blitAlphaProgram = null;
            }
        },
    };
}
