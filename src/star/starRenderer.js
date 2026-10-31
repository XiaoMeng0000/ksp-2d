'use strict';

// 恒星渲染器：WebGL2 资源、透明输出、时间推进、上下文丢失检测。
//
// 与星球渲染器（planet/meshRenderer.js）**完全独立**：独立工厂、独立程序，不改星球的
// 五项契约，也不进 setPlanet 白名单（约束 A1：只做加法）。
//
// 用法（接入方）：
//   const gl = createGLContext(canvas, { alpha: true, antialias: false });
//   const star = createStarRenderer(gl, { transparent: true, onContextLost });
//   star.setStar(Object.assign({ screenRadiusPx }, STAR_RENDER_PRESETS.kerbol));
//   const e = star.getExtentPx();            // 局部画布半边长（设备像素）
//   canvas.width = canvas.height = 2 * e;  star.resize(2 * e, 2 * e, dpr);
//   const status = star.render(dt);          // dt = 真实帧间隔（秒）
//   if (status.ok) ctx.drawImage(canvas, sx - e, sy - e);
//
// 渲染层**不**做的事（约束 B2/B3）：不读 GameState / eventBus / DOM；不判断该不该画；
// 不算位置、尺寸、遮挡；不自定 LOD 阈值 —— 全部由接入方经参数传入。

import { createProgram, setUniforms, destroyProgram } from '../glCore/shader.js';
import { STAR_VERT, STAR_FRAG } from './shaders/starShaders.js';
import {
    mergeStarState,
    advanceVisualTime,
    computeStarExtentPx,
    buildStarUniforms,
} from './starModel.js';

/**
 * 创建恒星渲染器。
 * @param {WebGL2RenderingContext} gl 透明模式需要 alpha:true 的上下文
 * @param {object} [options]
 * @param {boolean} [options.transparent=false] 透明背景（直线 alpha，供 drawImage 合成）
 * @param {function} [options.onContextLost] 上下文丢失时回调 `({ reason })`
 * @returns {object} 渲染器实例
 */
export function createStarRenderer(gl, options) {
    const opts = options || {};
    if (!gl || typeof gl.createProgram !== 'function') {
        throw new Error('createStarRenderer: 需要 WebGL2 上下文（WebGL2 不可用时由接入方走 Canvas2D 降级并上报 reason）');
    }
    const optionKeys = ['transparent', 'onContextLost'];
    const unknownOptions = Object.keys(opts).filter((key) => optionKeys.indexOf(key) < 0);
    if (unknownOptions.length > 0) {
        throw new Error('createStarRenderer 收到不认的选项: ' + unknownOptions.join(', '));
    }

    let transparentMode = opts.transparent === true;
    let program = createProgram(gl, { name: 'star', vertex: STAR_VERT, fragment: STAR_FRAG });
    const vao = gl.createVertexArray();

    const state = {
        star: null,                 // mergeStarState 的结果
        visualTime: 0,
        cx: 0,
        cy: 0,
        width: 1,
        height: 1,
        dpr: 1,
        lost: false,
        disposed: false,
        status: { ok: false, reason: 'no-star' },
        stats: { frames: 0, lastDt: 0, lastVisualDt: 0 },
    };

    function forgetGpuState(reason) {
        // 上下文已丢：GL 对象全部失效，只做记账、不再调用 GL（F2：状态同步遗忘）
        state.lost = true;
        program = null;
        state.status = { ok: false, reason };
    }

    const canvas = gl.canvas;
    const onLost = (event) => {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        const already = state.lost;
        forgetGpuState('context-lost');
        if (!already && typeof opts.onContextLost === 'function') {
            opts.onContextLost({ reason: 'context-lost' });
        }
    };
    if (canvas && typeof canvas.addEventListener === 'function') {
        canvas.addEventListener('webglcontextlost', onLost, false);
    }

    function ensureUsable(method) {
        if (state.disposed) {
            throw new Error('starRenderer.' + method + ': 渲染器已 dispose');
        }
    }

    return {
        /**
         * 设置 / 更新恒星（合并语义：只更新给出的顶层字段）。
         * 首次调用必须给齐 surface / halo / spikes / animation / display；子块整块替换。
         * 不认的字段、缺字段、非法值一律显式报错。
         * @param {object} starParams { screenRadiusPx, occlusion, surface, halo, spikes, animation, display }
         */
        setStar(starParams) {
            ensureUsable('setStar');
            state.star = mergeStarState(state.star, starParams);
        },

        /**
         * 星心相对画布中心的偏移（设备像素，y 向下）。默认 (0, 0) = 画在画布中心。
         * 恒星没有"世界相机"概念：尺寸走 screenRadiusPx，因此不接受 zoom。
         * @param {object} camera { cx, cy }
         */
        setCamera(camera) {
            ensureUsable('setCamera');
            const cam = camera || {};
            const unknown = Object.keys(cam).filter((key) => key !== 'cx' && key !== 'cy');
            if (unknown.length > 0) {
                throw new Error('starRenderer.setCamera 只接受 cx / cy（设备像素偏移），收到: ' + unknown.join(', ')
                    + ' —— 恒星尺寸请走 setStar({ screenRadiusPx })');
            }
            ['cx', 'cy'].forEach((key) => {
                if (key in cam) {
                    if (typeof cam[key] !== 'number' || !Number.isFinite(cam[key])) {
                        throw new Error('starRenderer.setCamera: ' + key + ' 必须是有限数，收到 ' + JSON.stringify(cam[key]));
                    }
                    state[key] = cam[key];
                }
            });
        },

        /**
         * 画布尺寸变化（只记账，不改画布 —— 画布尺寸由接入方决定）。
         * @param {number} width 绘制缓冲宽（设备像素）
         * @param {number} height 绘制缓冲高（设备像素）
         * @param {number} [dpr=1]
         */
        resize(width, height, dpr) {
            ensureUsable('resize');
            const d = dpr === undefined ? 1 : dpr;
            [['width', width], ['height', height], ['dpr', d]].forEach((pair) => {
                if (typeof pair[1] !== 'number' || !Number.isFinite(pair[1]) || pair[1] <= 0) {
                    throw new Error('starRenderer.resize: ' + pair[0] + ' 必须是有限正数，收到 ' + JSON.stringify(pair[1]));
                }
            });
            state.width = width;
            state.height = height;
            state.dpr = d;
        },

        /**
         * 局部画布需要的半边长（设备像素）：盘面 + 光晕截止 + 星芒。
         * 接入方用 2 × 返回值作为局部画布边长，恒星画在中心，就不会被裁切。
         * @returns {number}
         */
        getExtentPx() {
            ensureUsable('getExtentPx');
            if (!state.star || state.star.screenRadiusPx === null) {
                throw new Error('starRenderer.getExtentPx: 先 setStar（含 screenRadiusPx）');
            }
            return computeStarExtentPx(state.star, state.dpr);
        },

        /**
         * 画一帧。
         * @param {number} dt 真实帧间隔（秒）；NaN / 负数 ⇒ 显式报错
         * @returns {{ok:boolean, reason:string}} ok=false 时 reason 说明为何没画（如 'context-lost'）
         */
        render(dt) {
            ensureUsable('render');
            if (state.lost || gl.isContextLost()) {
                if (!state.lost) {
                    onLost(null);
                }
                return state.status;
            }
            if (!state.star || state.star.screenRadiusPx === null) {
                throw new Error('starRenderer.render: 先 setStar（含 screenRadiusPx 与全部外观子块）');
            }
            const before = state.visualTime;
            state.visualTime = advanceVisualTime(state.visualTime, dt, state.star.animation);
            const uniforms = buildStarUniforms(state.star, {
                width: state.width,
                height: state.height,
                dpr: state.dpr,
                cx: state.cx,
                cy: state.cy,
                visualTime: state.visualTime,
                transparent: transparentMode,
            });

            // 显式设置本渲染器依赖的全部 GL 状态，不依赖上下文默认值（反例库 #5）
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, Math.round(state.width), Math.round(state.height));
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            gl.disable(gl.BLEND);
            gl.disable(gl.SCISSOR_TEST);
            gl.colorMask(true, true, true, true);
            gl.clearColor(0, 0, 0, transparentMode ? 0 : 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            setUniforms(gl, program, uniforms);
            gl.bindVertexArray(vao);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindVertexArray(null);

            state.stats.frames += 1;
            state.stats.lastDt = dt;
            state.stats.lastVisualDt = state.visualTime - before;
            state.status = { ok: true, reason: '' };
            return state.status;
        },

        /**
         * 切换透明背景模式（直线 alpha，需要 alpha:true 的上下文）。
         * @param {boolean} flag
         * @returns {boolean} 生效后的值
         */
        setTransparent(flag) {
            ensureUsable('setTransparent');
            transparentMode = flag === true;
            return transparentMode;
        },

        /** 当前是否透明背景模式 */
        isTransparent() {
            return transparentMode;
        },

        /** 最近一次 render 的状态（ok / reason） */
        getStatus() {
            return state.status;
        },

        /** 诊断信息（只读快照） */
        getDiagnostics() {
            return {
                visualTime: state.visualTime,
                lost: state.lost,
                transparent: transparentMode,
                width: state.width,
                height: state.height,
                dpr: state.dpr,
                frames: state.stats.frames,
                lastDt: state.stats.lastDt,
                lastVisualDt: state.stats.lastVisualDt,
            };
        },

        /** 释放 GL 资源与事件监听；之后任何调用都会报错 */
        dispose() {
            if (state.disposed) {
                return;
            }
            if (canvas && typeof canvas.removeEventListener === 'function') {
                canvas.removeEventListener('webglcontextlost', onLost, false);
            }
            if (!state.lost && !gl.isContextLost()) {
                destroyProgram(gl, program);
                gl.deleteVertexArray(vao);
            }
            program = null;
            state.disposed = true;
            state.status = { ok: false, reason: 'disposed' };
        },
    };
}
