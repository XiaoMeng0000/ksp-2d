'use strict';

// 云层（阶段 2）：球壳几何 —— 在 Rp · altitude 处再画一遍球面网格，采样云场图。
//
// ★ 与阶段 0 占位接口的差异（**同 atmosphereLayer 的理由，务必先读**）★
//
//   占位版假设"层自己持有 GL 状态与渲染循环"（setPlanet / setCamera / render）——
//   那个形状在本项目被否决过：所有渲染都发生在 meshRenderer 内（共享离屏 target、
//   viewProj、状态机），让一个层自己开渲染循环等于把状态机复制一份。
//   所以这里同样是**可被 meshRenderer 驱动的层**：
//       createCloudLayer(gl) → { program, mesh, draw(desc), dispose() }
//
//   ⚠️ 矩阵由**调用方**算好传进来（viewProj / model / normalMatrix），
//      层里不出现 buildViewProj / buildModel —— 相机与模型的换算只有一处真源，
//      层里再算一遍就是第二处（§13.47 的层间坐标不一致正是这么来的）。
//
// ★ 3D 球壳而不是"把云贴在星球本体上"★
//   贴壳省一次绘制，但云会**完全跟随地表旋转**、也做不出"云壳比星球轮廓大一圈"的
//   临边效果。球壳多花一次 draw call（约 16k 三角形），换来的是云可以独立自转、
//   以及轮廓外那圈环带 —— 与大气壳的表现同构。
//
// ★ 自转与可复现性 ★
//   `spinAngle` 由调用方给。`measurePlanet()` 会把相位**冻结为 0**：
//   本项目所有比对工具（checkM5 / 各类 diff / 落盘验收图）的前提都是
//   "同一组参数渲染出同一张图"。这与波浪相位冻结（state.waveTime = 0）是同一个机制、
//   同一个理由 —— 不冻结就会报出**假的质感漂移**，而且完全不可复现。

import { createProgram, setUniforms, destroyProgram, createUniformBlock, uploadUniformBlock } from '../glCore/shader.js';
import { createMesh, drawMesh, destroyMesh } from '../glCore/mesh.js';
import { buildSphereGeometry } from '../geometry/sphereMesh.js';
import { CLOUD_VERT, CLOUD_FRAG } from './shaders/cloudShaders.js';
import { GG_GLSL_VORTEX_MAX } from './shaders/gasGiantCloudGLSL.js';
import { CLOUD_RECIPES } from './cloudRecipe.js';

/**
 * 云壳球面网格的分段数 —— **不跟随星球本体**（`segmentCount` / `ringCount`）。
 *
 * ★ 为什么故意独立 ★
 *   云壳的几何只决定"云场图采样到哪"，不决定云的形状；云场本身不需要与地表同密度，
 *   而且云层是**可选绘制**（关掉云时这一份网格也白建）。把它绑到本体分段上，
 *   会得到"为了一张低频纹理，跟着最高密度地表一起付顶点代价"的坏取舍。
 *
 * ⚠️ 已知代价（是取舍，不是缺陷）：`meshRenderer` 把本体分段调低（如 < 32）时，
 *   云壳轮廓与地表轮廓**不再重合**，能看到一圈偏移。真要同轮廓，需另加"跟随本体分段"
 *   的开关，而不是在原地悄悄同步两个数。
 *
 * ⚠️ 改这两个数会改变云壳网格 → **像素输出会变**，需重跑落盘验收图。
 *    交接文档 §2.1 的层间坐标约定与 cloudShaders.js 文件头的对齐说明不受影响（都是 0..1 UV）。
 */
export const CLOUD_SHELL_SEGMENTS = 128;
export const CLOUD_SHELL_RINGS = 64;

/**
 * 云层预设 = **配方求解结果**。
 *
 * ⚠️ 唯一真源是 cloudRecipe.js 的 `CLOUD_RECIPES` —— 本表由它展开，不另存一份数值。
 *    这里保留导出只是为了与 ATMOSPHERE_PRESETS 的形状对齐（调用方按 id 取用）。
 */
export const CLOUD_PRESETS = (function buildPresets() {
    const out = {};
    Object.keys(CLOUD_RECIPES).forEach((id) => {
        const r = CLOUD_RECIPES[id];
        out[id] = Object.assign({}, r.field, r.render);
    });
    return out;
})();

/**
 * 创建云层。
 *
 * @param {WebGL2RenderingContext} gl
 * @param {object} [options]
 * @param {number} [options.segments=CLOUD_SHELL_SEGMENTS] 球壳经度分段（**默认独立于本体**，理由见常量处的注释）
 * @param {number} [options.rings=CLOUD_SHELL_RINGS] 球壳纬度分段（同上）
 * @returns {object} 层实例
 */
export function createCloudLayer(gl, options) {
    const opts = options || {};
    const program = createProgram(gl, {
        name: 'clouds',
        vertex: CLOUD_VERT,
        fragment: CLOUD_FRAG,
    });

    // ★ 气态巨星的色表走 UBO（见 shader.js 的 createUniformBlock 注释）★
    //   为什么不能留在 `uniform float[N]`：三张 181 点表要占 136 个 vec4，
    //   而 `MAX_FRAGMENT_UNIFORM_VECTORS` 的规格保证下限只有 224 —— 实测已用到 97%。
    //   binding point 取 0（色表）与 1（涡旋表）。
    const GG_BAND_BINDING = 0;
    const ggBandBlock = createUniformBlock(gl, program, 'GgBandTable', GG_BAND_BINDING);
    // ★ 涡旋表同样走 UBO ★ ⇒ 条数不受 `MAX_FRAGMENT_UNIFORM_VECTORS` 约束
    //   （容量由 GLSL 的 GG_GLSL_VORTEX_MAX 定；将来加条数只改那个常量 + 配方表长度）。
    const GG_VORTEX_BINDING = 1;
    const ggVortexBlock = createUniformBlock(gl, program, 'GgVortices', GG_VORTEX_BINDING);

    // ⚠️ 网格必须**为本程序单独建一份**：createProgram 不固定 attribute location
    //    （没有 bindAttribLocation），复用别的程序的 VAO 等于依赖"位置恰好一致"。
    //    本项目为这类静默依赖付过代价（见交接文档 §13.21）。
    const geo = buildSphereGeometry({
        segments: opts.segments === undefined ? CLOUD_SHELL_SEGMENTS : opts.segments,
        rings: opts.rings === undefined ? CLOUD_SHELL_RINGS : opts.rings,
        radius: 1,
    });
    const mesh = createMesh(gl, {
        layout: geo.layout,
        vertices: geo.vertices,
        indices: geo.indices,
        mode: gl.TRIANGLES,
        attributeLocations: {
            POSITION: program.attribs.aPosition,
            TEXCOORD: program.attribs.aTexCoord,
            NORMAL: program.attribs.aNormal,
        },
    });

    // ★ 气态巨星的常量表：**上传时转一次**，逐帧只写 uniform ★
    //   181×3 = 543 个数（181 = gasGiantBandTables.js 的 GG_TABLE_POINTS），
    //   逐帧 Float32Array.from 是纯粹的浪费；
    //   而且它是"配方参数"，不是"每帧状态" —— 归属上就该在层里。
    let ggTables = null;
    // ★ 幅度重分配的归一化因子缓存 ★
    //   它只依赖两个旋钮（texEdge / texLat），而那两个是"拖一下看画面"的实验室参数
    //   ⇒ 逐帧算也只要 181 次乘法，但用键缓存一下更干净，且让"何时重算"可读。
    let ggTexNormKey = '';
    let ggTexNorm = 1;

    /**
     * 幅度重分配的归一化因子 = 1 / 面积加权 RMS(调制函数)。
     *
     * ★ 它保证 **全局纹理 σ 守恒** ★ —— 这一轮动的是"纹理长在哪"，不是"有多少纹理"。
     *   没有它，调 texEdge / texLat 会顺带把总量改掉，判据就会在总量与分布之间来回打架。
     *
     * @param {number} edge 带界（陡度）权重
     * @param {number} lat 纬度权重
     * @returns {number}
     */
    function gasGiantTexNorm(edge, lat) {
        const key = edge + '|' + lat;
        if (key === ggTexNormKey) {
            return ggTexNorm;
        }
        const sMean = ggTables.slopeMean;
        const eMean = ggTables.envMean;
        const nPts = ggTables.r.length;
        const stepDeg = 180 / (nPts - 1);
        let wSum = 0;
        let sq = 0;
        for (let i = 0; i < nPts; i++) {
            const latDeg = -90 + stepDeg * i;
            const w = Math.cos(latDeg * Math.PI / 180);
            // ★ 与着色器**同一个式子**：陡度由线性亮度中心差分现算并归一化 ★
            const ia = Math.max(i - 1, 0);
            const ib = Math.min(i + 1, nPts - 1);
            const la = 0.299 * ggTables.r[ia] + 0.587 * ggTables.g[ia] + 0.114 * ggTables.b[ia];
            const lb = 0.299 * ggTables.r[ib] + 0.587 * ggTables.g[ib] + 0.114 * ggTables.b[ib];
            const slope = ggTables.slopeMax > 0 ? (Math.abs(lb - la) / 2) / ggTables.slopeMax : 0;
            const env = 1 - Math.abs(latDeg) / 90;
            const m = 1 + edge * (slope - sMean) + lat * (env - eMean);
            wSum += w;
            sq += w * m * m;
        }
        ggTexNorm = sq > 0 ? 1 / Math.sqrt(sq / wSum) : 1;
        ggTexNormKey = key;
        return ggTexNorm;
    }

    return {
        program,
        mesh,

        /** 三角形数（诊断用） */
        get triangleCount() {
            return geo.triangleCount;
        },

        /**
         * 设置/清除气态巨星装配。
         *
         * ⚠️ 只上传**表**（分量最大的常量）；带缘与纹理那几个标量是**观感旋钮**，
         *    每帧从 desc 里来，好在面板上实时拖。
         *
         * @param {object|null} recipe solveGasGiantRecipe 的结果；null = 恢复 Kerbin 路径
         */
        setGasGiant(recipe) {
            if (!recipe) {
                ggTables = null;
                return;
            }
            if (!recipe.tables || !recipe.tables.r) {
                throw new Error('气态巨星配方缺少 tables —— 应由 solveGasGiantRecipe 产出');
            }            // ★ 带纹增益在这里施加（不是生成表时）★
            //   表本身是**实测剖面**，不该被标定系数污染 —— 那样"表 = 测量"这条
            //   可追溯性就断了。gain 是"补偿渲染管线衰减"的标定值，属于装配。
            //   做法：按**线性亮度**缩放偏差 ⇒ c' = mean + (c − mean)·gain。
            //   （Rec.601 亮度是线性的 ⇒ 亮度偏差严格按 gain 缩放，可解析验证。）
            const gain = recipe.band && recipe.band.gain !== undefined ? recipe.band.gain : 1;
            const src = [recipe.tables.r, recipe.tables.g, recipe.tables.b];
            const out = [];
            for (let ci = 0; ci < 3; ci++) {
                const arr = Float32Array.from(src[ci]);
                if (gain !== 1) {
                    // 面积加权（cos 纬度）均值 —— 与判据口径一致
                    // ⚠️⚠️ 步长**必须由长度推**，不能写死 2°（2026-10-04 踩过）★
                    //   写死 2° 而表有 181 点时，`lat` 会从 −90 一路跑到 **+270°**，
                    //   `cos` 变负、权重和趋零 ⇒ `mean = NaN` ⇒ **整张表变 NaN** ⇒
                    //   写进 RGBA8 帧缓冲就是纯白 —— 症状看着像"过曝"，实际是 NaN。
                    const nPts = arr.length;
                    const stepDeg = 180 / (nPts - 1);
                    let wSum = 0;
                    let s = 0;
                    for (let i = 0; i < nPts; i++) {
                        const lat = (-90 + stepDeg * i) * Math.PI / 180;
                        const w = Math.cos(lat);
                        wSum += w;
                        s += w * arr[i];
                    }
                    const mean = s / wSum;
                    for (let i = 0; i < arr.length; i++) {
                        arr[i] = mean + (arr[i] - mean) * gain;
                    }
                }
                out.push(arr);
            }
            ggTables = { r: out[0], g: out[1], b: out[2] };
            // ★ 打包装进 UBO ★
            //   std140 里 `vec4[N]` 的步长恰为 16 字节 ⇒ 三张表**紧密排列**，
            //   每张占 ceil(n/4) 个 vec4，尾部补零（多出来的分量着色器不会读）。
            {
                const nPts = out[0].length;
                const v4 = Math.ceil(nPts / 4);
                // ★ 4 张表：R / G / B / **急流廓线** ★
                //   廓线零新增数据 —— 它就是色表的**带符号陡度**（急流住在带界）。
                const packed = new Float32Array(v4 * 4 * 4);
                for (let ci = 0; ci < 3; ci++) {
                    packed.set(out[ci], ci * v4 * 4);
                }
                const jet = recipe.tables.jet;
                if (!jet || jet.length !== nPts) {
                    throw new Error('气态巨星配方缺少 tables.jet（急流廓线应由 solveGasGiantRecipe 产出）');
                }
                packed.set(Float32Array.from(jet), 3 * v4 * 4);
                uploadUniformBlock(gl, ggBandBlock, packed);
                ggTables.bandByteLength = packed.byteLength;
            }
            // ★ 涡旋表打包 ★
            //   每条 2 个 vec4：A = (lat, lon, a, aspect)、B = (amp, spin, 0, 0)。
            //   容量 = GLSL 的 GG_GLSL_VORTEX_MAX；**超出容量一律抛错**，不静默截断
            //   （"少画了几条"在画面上看不出来，但判据会对不上）。
            {
                const V = GG_GLSL_VORTEX_MAX;
                const list = Array.isArray(recipe.vortices) ? recipe.vortices : [];
                if (list.length > V) {
                    throw new Error('涡旋表有 ' + list.length + ' 条，超出 GLSL 容量 ' + V
                        + '（改 gasGiantCloudGLSL.js 的 GG_GLSL_VORTEX_MAX 后要重载页面）');
                }
                const va = new Float32Array(V * 4);
                const vb = new Float32Array(V * 4);
                for (let i = 0; i < list.length; i++) {
                    const v = list[i];
                    va[i * 4] = v.lat;
                    va[i * 4 + 1] = v.lon;
                    va[i * 4 + 2] = v.a;
                    va[i * 4 + 3] = v.aspect === undefined ? 0.55 : v.aspect;
                    vb[i * 4] = v.amp === undefined ? 0 : v.amp;
                    vb[i * 4 + 1] = v.spin === undefined ? 0 : v.spin;
                }
                const packed2 = new Float32Array(V * 4 * 2);
                packed2.set(va, 0);
                packed2.set(vb, V * 4);
                uploadUniformBlock(gl, ggVortexBlock, packed2);
                ggTables.vortexCount = list.length;
                ggTables.vortexByteLength = packed2.byteLength;
            }
            // ★ 陡度**不再是一张表**：181 点 ×4 会超出 WebGL2 保证的 uniform 下限
            //   ⇒ 改在着色器里由亮度中心差分现算，这里只传两个标量（最大值/均值）。
            ggTables.slopeMax = recipe.tables.slopeMax;
            ggTables.slopeMean = recipe.tables.slopeMean;
            ggTables.envMean = recipe.tables.envMean;
            ggTexNormKey = '';
        },

        /** 当前是否已挂上气态巨星装配（诊断用） */
        get gasGiantReady() {
            return !!ggTables;
        },

        /**
         * 画一层云。**调用前 framebuffer / viewport 已由调用方设好。**
         *
         * 混合状态由**调用方**设置（与本项目 drawFullscreen 的约定一致）：
         *   gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
         *   gl.disable(gl.DEPTH_TEST);
         * 剔除状态**必须与星球本体一致**（frontFace CCW + cullFace BACK）——
         * 云要落在与地表同一个"远半球"镜像世界里才对齐，见 cloudShaders.js 文件头。
         *
         * ★ 云场是**程序化**的（2026-10-01 起不采样任何贴图）★
         *   场参数与 CDF 常量表都由调用方传入 —— 层里不自己算 CDF：
         *   CDF 是**场参数**的函数（要跑三万个采样点），必须在参数变化时算一次并缓存，
         *   放进每帧的绘制路径会白白烧掉几十毫秒。
         *
         * @param {object} desc
         * @param {Array<number>} desc.viewProj mat4（列主序 16 个数）
         * @param {Array<number>} desc.model mat4，缩放到 Rp · altitude
         * @param {Array<number>} desc.normalMatrix mat3（列主序 9 个数）
         * @param {Array<number>} desc.sunDir 指向太阳（世界空间，**不做大气那处 z 取反**）
         * @param {Array<number>} desc.sunColor
         * @param {number} desc.ambient
         * @param {number} desc.spinAngle 自转相位（弧度）；量测路径传 0
         * @param {number} [desc.cloudTime] 场的第 4 维（时间）；量测路径冻结为 0
         * @param {object} desc.params 云参数（solveCloudRecipe 的结果）
         * @param {object} desc.field 场参数（scale/octaves/gain/cascade/warp/…/ridge/seed）
         * @param {object} desc.cdf { lut: Float32Array, logMin, logMax }
         * @param {number} [desc.debugField] >0.5 时直接输出 b（对拍用）；0 = 正常渲染
         * @param {number} [desc.terminatorSoft] 晨昏线软化半角（弧度）—— **必须与本体同值**
         * @param {number} [desc.terminatorPow] 漫反射坡道幂 —— **必须与本体同值**
         * @param {boolean} [desc.atmoEnabled] 是否启用大气消光（false ⇒ sunTint 恒为 1）
         * @param {Array<number>} [desc.atmoExt] 消光系数（每星径）
         * @param {number} [desc.atmoScaleHeight] 标高比 H/Rp
         * @param {Float32Array} [desc.sunColumnSurface] 太阳柱积分**地表切片**（与本体同一张表）
         */
        draw(desc) {
            const p = desc.params;
            if (!(p.opacity > 0) || !desc.cdf) {
                return;   // 无云或没有 CDF：连状态切换都省掉
            }
            const field = desc.field || {};
            // ★ 气态巨星装配：只在表已上传 + 调用方要求时才开 ★
            //   两者缺一就静默降级成 Kerbin 路径是不行的（那会得到一张
            //   "覆盖率阈值 + 白云"的图，看着仍然像行星）⇒ 这里显式报错。
            const gg = desc.gasGiant;
            const ggOn = !!(gg && gg.enabled);
            if (ggOn && !ggTables) {
                throw new Error('要求气态巨星装配，但常量表没上传 —— '
                    + '请先调 cloudLayer.setGasGiant(solveGasGiantRecipe(...))。'
                    + '（不静默降级：降级后的画面仍然像行星，肉眼分辨不出来）');
            }
            const uniforms = {
                uViewProj: desc.viewProj,
                uModel: desc.model,
                uNormalMatrix: desc.normalMatrix,
                uCoverage: p.coverage,
                uSoftness: p.softness === undefined ? 0.001 : p.softness,
                uEdgePx: p.edgePx === undefined ? 4 : p.edgePx,
                uSelfShadow: p.selfShadow === undefined ? 0 : p.selfShadow,
                uHeightShade: p.heightShade === undefined ? 0 : p.heightShade,
                uOpacity: p.opacity,
                uSunDir: desc.sunDir,
                uSunColor: desc.sunColor,
                uAmbient: desc.ambient === undefined ? 0 : desc.ambient,
                uSpinAngle: desc.spinAngle || 0,
                // ---- 与本体共用的晨昏线 / 大气消光口径（**必须与 drawSphere 传的一致**）----
                //   这几项由调用方从**同一个来源**取，层里不自己算 —— 一旦层里
                //   各算一份，两层就会在晨昏线处错开（§13.47 的层间口径事故）。
                uTerminatorSoft: desc.terminatorSoft || 0,
                uTerminatorPow: desc.terminatorPow === undefined ? 1 : desc.terminatorPow,
                uAtmoEnabled: desc.atmoEnabled ? 1 : 0,
                uAtmoExt: desc.atmoExt || [0, 0, 0],
                uAtmoScaleHeight: desc.atmoScaleHeight || 0,
                uSunColumnSurface: desc.sunColumnSurface,
                // 直射强度与夜面淡出：平光模式（diffuse=0）下云不该有晨昏线
                uDiffuse: desc.diffuse === undefined ? 1 : desc.diffuse,
                uNightLimbFade: desc.nightLimbFade || 0,
                uNightLimbFadeWidth: desc.nightLimbFadeWidth === undefined ? 0.4 : desc.nightLimbFadeWidth,
                // 云体反照率的艺术指定色（[1,1,1] = 白）
                uCloudColor: p.color || [1, 1, 1],
                // ---- 程序化云场：参数 + CDF 常量表（**不是贴图**）----
                uFieldP0: [field.scale, field.lacunarity, field.gain, field.cascade],
                uFieldP1: [field.warp, field.warpDetail, field.warpDetailScale, field.bandStretch],
                uFieldP2: [
                    field.ridge,
                    field.octaves,
                    field.birthScale === undefined ? 2 : field.birthScale,
                    field.windShearMax === undefined ? 0 : field.windShearMax,
                ],
                uFieldP3: [
                    field.windSpeed || 0,
                    field.windShear || 0,
                    field.evolveRate || 0,
                    field.birthAmount || 0,
                ],
                uFieldSeed: field.seed,
                uCloudCdf: desc.cdf.lut,
                uCloudLogMin: desc.cdf.logMin,
                uCloudLogSpan: Math.max(1e-9, desc.cdf.logMax - desc.cdf.logMin),
                uCloudTime: desc.cloudTime || 0,
                uBirthPhase: field.birthPhase === undefined ? 0 : field.birthPhase,
                uBirthMean: desc.birthMean || 0,
                // ★ 纬向气候带（表 + 强度 + 归一化因子；后两者由调用方算好）★
                uZoneProfile: desc.zoneProfile,
                uZoneStrength: field.zoneStrength === undefined ? 0 : field.zoneStrength,
                uZoneNorm: desc.zoneNorm === undefined ? 1 : desc.zoneNorm,
                uDebugField: desc.debugField || 0,
            };
            if (ggOn) {
                uniforms.uGgEnabled = 1;
                // ⚠️ 色表**不在这里**：它走 UBO（GgBandTable），由 setGasGiant 上传。
                //    往这里写 uGgBandR/G/B 是无效的 —— 它们不在 shader.uniforms 里，
                //    setUniforms 会静默跳过（"改了没反应"的经典来源）。
                uniforms.uGgEdgeAmount = gg.edgeAmount === undefined ? 0 : gg.edgeAmount;
                uniforms.uGgEdgeScale = gg.edgeScale === undefined ? 6 : gg.edgeScale;
                uniforms.uGgTexAmp = gg.texAmp === undefined ? 0 : gg.texAmp;
                uniforms.uGgTexEdge = gg.texEdge === undefined ? 0 : gg.texEdge;
                uniforms.uGgTexLat = gg.texLat === undefined ? 0 : gg.texLat;
                uniforms.uGgTexNorm = gasGiantTexNorm(
                    gg.texEdge === undefined ? 0 : gg.texEdge,
                    gg.texLat === undefined ? 0 : gg.texLat);
                uniforms.uGgSlopeMean = ggTables.slopeMean;
                uniforms.uGgSlopeMax = ggTables.slopeMax;
                uniforms.uGgPolarStart = gg.polarStart === undefined ? 45 : gg.polarStart;
                uniforms.uGgPolarPeriod = gg.polarPeriod === undefined ? 9 : gg.polarPeriod;
                uniforms.uGgPolarAmp = gg.polarAmp === undefined ? 0 : gg.polarAmp;
                uniforms.uGgPolarFade = gg.polarFade === undefined ? 10 : gg.polarFade;
                uniforms.uGgVortexCountF = ggTables.vortexCount || 0;
                // ⚠️ vortexAmp 的**语义在本轮变了**：从"颜色乘子"改成 **b（云场）的偏移倍率**
                //    —— 因为总监指出旧做法像"硬贴上去的"（色差是几何量、与云无关）。
                uniforms.uGgVortexAmp = gg.vortexAmp === undefined ? 0 : gg.vortexAmp;
                uniforms.uGgVortexSpin = gg.vortexSpin === undefined ? 0 : gg.vortexSpin;
                uniforms.uGgVortexEdge = gg.vortexEdge === undefined ? 0 : gg.vortexEdge;
                // ★ "眼"结构：外环反号强度（0 = 退回纯凸包）
                uniforms.uGgVortexRim = gg.vortexRim === undefined ? 0 : gg.vortexRim;
                // ★ 色差路的**云门控**强度（0 = 不门控 ⇒ 会退回"贴纸"）
                uniforms.uGgVortexGate = gg.vortexGate === undefined ? 0 : gg.vortexGate;
                uniforms.uGgVortexTexBoost = gg.vortexTexBoost === undefined ? 0 : gg.vortexTexBoost;
                // ★ 切向拉伸（< 1 ⇒ 把云丝拉成方位向 ⇒ 才卷得出螺旋臂；1 = 关）
                uniforms.uGgVortexStretch = gg.vortexStretch === undefined ? 1 : gg.vortexStretch;
                // ★ 纬向急流（不同纬度流向不同）★
                uniforms.uGgJetAmp = gg.jetAmp === undefined ? 0 : gg.jetAmp;
                uniforms.uGgJetOmega = gg.jetOmega === undefined ? 0.25 : gg.jetOmega;
                uniforms.uGgJetKappa = gg.jetKappa === undefined ? 0 : gg.jetKappa;
                // ⚠️ 时间取自**云描述符**的 windTime（限幅后的那一份），不是 gg 段
                uniforms.uGgJetTime = desc.windTime || 0;
                // ★ 抗走样（LOD）：见 gasGiantCloudRecipe 的 lodOn / lodPx ★
                uniforms.uGgLodOn = gg.lodOn === undefined ? 0 : gg.lodOn;
                uniforms.uGgLodPx = gg.lodPx === undefined ? 2 : gg.lodPx;
                uniforms.uGgEnvMean = ggTables.envMean;
                uniforms.uGgShearAmp = gg.shearAmp === undefined ? 0 : gg.shearAmp;
                uniforms.uGgShearCycles = gg.shearCycles === undefined ? 0 : gg.shearCycles;
                uniforms.uGgLimbGlow = gg.limbGlow === undefined ? 0 : gg.limbGlow;
                uniforms.uGgLimbPow = gg.limbPow === undefined ? 4 : gg.limbPow;
                uniforms.uGgTime = gg.time || 0;
                uniforms.uGgDebug = gg.debug || 0;
            } else {
                // uGgEnabled 必须显式写 0：程序编译后 uniform 初值虽是 0，
                // 但**上一帧**若开过气态巨星，这里不写就会带着 1 画下一帧。
                uniforms.uGgEnabled = 0;
            }
            setUniforms(gl, program, uniforms);
            drawMesh(gl, mesh);
        },

        dispose() {
            destroyMesh(gl, mesh);
            destroyProgram(gl, program);
        },
    };
}
