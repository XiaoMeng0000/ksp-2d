'use strict';

// 大气层（阶段 2 实现）：球壳求交 + 沿视线 ray marching 的单次散射。
//
// ★ 物理模型与"已知近似"的边界，见 shaders/atmosphereShaders.js 的文件头 ★
//
// ★ 与阶段 0 占位接口的差异（重要）★
//   占位版假设"层自己持有 GL 状态与渲染循环"（setPlanet / setCamera / render），
//   但本项目实际渲染都发生在 meshRenderer 内 —— 共享离屏 target、viewProj、
//   全屏三角形与状态机。让一个层自己开渲染循环，等于把状态机复制一份。
//   所以改为**可被 meshRenderer 驱动的层**：
//     createAtmosphereLayer(gl) → { program, mesh, draw(desc), dispose() }
//   meshRenderer 在画完球体之后调用 draw()，用
//     gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
//   叠加（片元输出 vec4(scatter, 1 - T) → final = scatter + background · T）。
//
// ★ 渲染顺序 ★
//   星球本体 → **大气层** → 将来的云层（在大气之下或之上，按观感定）
//   对应交接文档 §5「WebGL 分三阶段插入」里的阶段 ①（天体之前/同时）。

import { createProgram, setUniforms, destroyProgram } from '../glCore/shader.js';
import { createMesh, drawMesh, destroyMesh } from '../glCore/mesh.js';
import { buildFullscreenGeometry } from '../geometry/sphereMesh.js';
import { ATMOSPHERE_VERT, ATMOSPHERE_FRAG } from './shaders/atmosphereShaders.js';
import { MIXTURES, solveMixture } from './atmosphereSpecies.js';
import { getSunColumnTable } from './airMass.js';

/**
 * 大气预设 = **配方求解结果**。
 *
 * ⚠️ 唯一真源是 atmosphereSpecies.js 的 `MIXTURES`（成分表）——
 *    本表由它算出来，不另存一份数值。改配方请改那边。
 *
 * 每个预设包含：
 *   atmoScale / scaleHeight  几何与密度尺度（来自配方）
 *   rayleigh / absorb / mie  由成分算出的散射与吸收系数（来自配方）
 *   tint                     色调乘子（艺术指定色，来自配方）
 *   mieG / multiScatter / selfAbsorb / intensity
 *                            渲染侧观感参数（**同样来自配方** —— 一颗天体一整套，
 *                            切配方即切全套）
 */
export const ATMOSPHERE_PRESETS = (function buildPresets() {
    const out = {
        // 无大气：全零 + 强度 0（draw 里会直接跳过绘制）
        none: {
            atmoScale: 1,
            scaleHeight: 0.0125,
            rayleigh: [0, 0, 0],
            absorb: [0, 0, 0],
            mie: 0,
            mieG: 0.76,
            tint: [1, 1, 1],
            multiScatter: 0,
            selfAbsorb: 1,
            intensity: 0,
        },
    };
    Object.keys(MIXTURES).forEach((id) => {
        const s = solveMixture(id);
        out[id] = {
            atmoScale: s.atmoScale,
            scaleHeight: s.scaleHeight,
            rayleigh: s.rayleigh,
            absorb: s.absorb,
            mie: s.mie,
            // ★ 渲染侧观感参数：从配方取（2026-09-26 修正）★
            //   这四个原本是全局默认值，后来提升为 MIXTURES 的**配方字段**
            //   （见 atmosphereSpecies.js："一颗天体就带一整套完整观感，切配方即切全套"），
            //   但这里一直写着旧的字面量，造成 15 处漂移 ——
            //   例如 kerbin 的 mieG 配方是 0.59、预设却给 0.76。
            //   后果：DEFAULT_RENDER_PARAMS.atmosphere（渲染器自带的默认大气）
            //   与实验室里逐项调定的观感对不上，迁移到游戏会"换了个样子"。
            mieG: s.mieG,
            tint: s.tint,
            // 多次散射强度：单次散射在掠射路径上会被自吸收压死（CPU 实测擦边只有
            // 10/255，系数放大 100 倍也只到 12），真实天空亮度主要来自多次散射。
            multiScatter: s.multiScatter,
            // 自吸收松弛：1 = 严格单次散射；0.5 = 承认约一半的光会再散射回来
            selfAbsorb: s.selfAbsorb,
            intensity: s.intensity,
        };
    });
    return out;
})();

/**
 * 创建大气层。
 *
 * @param {WebGL2RenderingContext} gl
 * @param {object} [options]
 * @param {number} [options.steps=24] 积分步数（编译期常量，注入为宏）
 * @returns {object} 层实例
 */
export function createAtmosphereLayer(gl, options) {
    const opts = options || {};
    const steps = Math.max(4, Math.round(opts.steps === undefined ? 24 : opts.steps));
    const program = createProgram(gl, {
        name: 'atmosphere',
        vertex: ATMOSPHERE_VERT,
        fragment: ATMOSPHERE_FRAG,
        prefix: '#define ATMO_STEPS ' + steps,
    });
    // ⚠️ 全屏三角形必须**为本程序单独建一份** ——
    //    createProgram 不固定 attribute location（没有 bindAttribLocation），
    //    复用别的程序的 VAO 等于依赖"位置恰好一致"，那是脆的隐式依赖。
    //    本项目为此类静默依赖付过代价（见交接文档 §13.21）。
    const quad = buildFullscreenGeometry();
    const mesh = createMesh(gl, {
        layout: quad.layout,
        vertices: quad.vertices,
        mode: gl.TRIANGLES,
        attributeLocations: {
            POSITION: program.attribs.aPosition,
            TEXCOORD: program.attribs.aTexCoord,
        },
    });

    return {
        steps,
        program,

        /**
         * 画一层大气（调用前 framebuffer / viewport 已由调用方设好）。
         *
         * 混合状态由**调用方**设置（与本项目 drawFullscreen 的约定一致）：
         *   gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
         *
         * @param {object} desc
         * @param {number} desc.viewWidth 视口宽（物理像素）
         * @param {number} desc.viewHeight
         * @param {number} desc.zoom 世界单位 → 物理像素
         * @param {number} [desc.cameraX]
         * @param {number} [desc.cameraY]
         * @param {number} desc.planetRadius 行星球半径（世界单位）
         * @param {Array<number>} desc.sunDir 指向太阳（世界空间）
         * @param {Array<number>} desc.sunColor
         * @param {object} desc.params 大气参数（ATMOSPHERE_PRESETS 之一）
         */
        draw(desc) {
            const p = desc.params || ATMOSPHERE_PRESETS.none;
            const zoom = Math.max(1e-6, desc.zoom);
            const Rp = desc.planetRadius;
            const atmoScale = p.atmoScale === undefined ? 1 : p.atmoScale;
            if (atmoScale <= 1 || !(p.intensity > 0)) {
                return;   // 无大气：连绘制都省掉
            }
            const Ra = Rp * atmoScale;
            setUniforms(gl, program, {
                uHalfExtent: [desc.viewWidth / (2 * zoom), desc.viewHeight / (2 * zoom)],
                uCameraXY: [desc.cameraX || 0, desc.cameraY || 0],
                uPlanetRadius: Rp,
                uAtmoScale: atmoScale,
                uSunDir: desc.sunDir,
                uSunColor: desc.sunColor,
                uRayleighCoeff: p.rayleigh,
                uAbsorbCoeff: p.absorb || [0, 0, 0],
                uScatterTint: p.tint || [1, 1, 1],
                uMieCoeff: p.mie,
                uMieG: p.mieG,
                uScaleHeight: p.scaleHeight,
                uIntensity: p.intensity,
                // 多次散射强度与自吸收松弛：两者都可退回纯单次散射做对照
                // （multiScatter = 0 且 selfAbsorb = 1 时即为严格单次散射）
                uMultiScatter: p.multiScatter === undefined ? 0 : p.multiScatter,
                uSelfAbsorb: p.selfAbsorb === undefined ? 1 : p.selfAbsorb,
                // ★ 临边高光软压缩的膝点（0 = 关闭 = 历史口径）★
                //   见 atmosphereShaders.js 里 softKnee 的说明。
                uSoftKnee: p.softKnee === undefined ? 0 : p.softKnee,
                // （影侧补光 / 暮光收窄的 uniform 都曾在此处，已删除；
                //   完整记录见 atmosphereShaders.js 文件头 2026-10-02 那段）
                // ★ 二维太阳柱积分查表（高度 × 太阳高度余弦）★
                //   唯一真源是 src/planet/airMass.js 的数值积分烘焙；
                //   本体着色器用的是**同一张表的地表切片** ⇒ 两层的日落红/晨昏线
                //   口径不可能漂移（旧版是两处各自硬编码的经验式）。
                //   ⚠️ 必须用 atmoScale（大气外径）来烘焙：柱积分积到壳顶为止，
                //      壳越厚地平线光程越大。
                //   getSunColumnTable 内部按 (标高比, 壳厚比) 缓存，烘焙只发生一次。
                uSunColumnTable: getSunColumnTable(p.scaleHeight, atmoScale).data,
                // 射线起点要在整个大气壳之外：正交视锥的 z 半程是 8，
                // 但极端 zoom 下 Rp 可能更大，取两者较大值再留 4 倍余量
                uRayStart: Math.max(8, Ra * 4),
            });
            drawMesh(gl, mesh);
        },

        dispose() {
            destroyMesh(gl, mesh);
            destroyProgram(gl, program);
        },
    };
}
