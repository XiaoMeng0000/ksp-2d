'use strict';

// 恒星 WebGL 层（场景层单例）—— 接入侧，渲染层无业务逻辑：
//   · 渲染器（src/star/**，vendored）只吃参数吐像素；本层负责「画在哪、画多大、用哪套预设、
//     失败了怎么办」，不读 GameState / eventBus / sceneManager；
//   · 局部画布：画布 = 恒星包围盒 ∩ 屏幕（按 canvasBucketPx 向上取整），每颗星一次 drawImage；
//     不做全屏恒星层（无逐帧固定全屏开销）；
//   · 失效路径非静默：WebGL2 不可用 / 预设缺失 / 上下文丢失 / 渲染失败 ⇒ 告警一次（带 reason），
//     draw() 返回 false，调用方回落原有 Canvas2D 恒星。
//
// 用法（renderer.js 的恒星分支，唯一合成调用点）：
//   if (starLayer.draw(ctx, presetId, screenX, screenY, screenRadiusPx, frameDt)) { 已画 } else { Canvas2D 回落 }

import { createGLContext } from '../glCore/context.js';
import { createStarRenderer } from '../star/starRenderer.js';
import { STAR_RENDER_PRESETS } from '../config/starRenderPresets.js';
import { STAR_LAYER_CONFIG } from '../config/gameplay/starLayerConfig.js';

const LOG_TAG = '[StarLayer]';

let _glCanvas = null;
let _renderer = null;
let _failed = false;          // 初始化失败：不再重试，整局走 Canvas2D
let _contextLost = false;
let _presetId = null;         // 当前已装入渲染器的预设
const _warned = new Set();

// 同一原因只告警一次，避免逐帧刷屏
function _warnOnce(reason) {
    if (_warned.has(reason)) return;
    _warned.add(reason);
    console.warn(LOG_TAG + ' ' + reason + '，恒星回落 Canvas2D');
}

function _errorText(e) {
    return (e && e.message) ? e.message : String(e);
}

function _markContextLost() {
    if (_contextLost) return;
    _contextLost = true;
    _presetId = null;
    _warnOnce('WebGL 上下文丢失（reason=context-lost）');
}

function _ensureRenderer() {
    if (_renderer) return true;
    if (_failed) return false;
    _glCanvas = document.createElement('canvas');
    _glCanvas.width = STAR_LAYER_CONFIG.canvasBucketPx;
    _glCanvas.height = STAR_LAYER_CONFIG.canvasBucketPx;
    try {
        const gl = createGLContext(_glCanvas, { alpha: true, antialias: false });
        _renderer = createStarRenderer(gl, { transparent: true, onContextLost: _markContextLost });
    } catch (e) {
        _failed = true;
        _renderer = null;
        _warnOnce('WebGL2 不可用或恒星渲染器创建失败（reason=' + _errorText(e) + '）');
        return false;
    }
    return true;
}

function _bucket(px) {
    const step = STAR_LAYER_CONFIG.canvasBucketPx;
    return Math.max(step, Math.ceil(px / step) * step);
}

export const starLayer = {
    /**
     * 画一颗恒星（屏幕量一律为主画布设备像素）。
     * @param {CanvasRenderingContext2D} ctx 主画布
     * @param {string} presetId STAR_RENDER_PRESETS 的键
     * @param {number} sx 星心屏幕 x
     * @param {number} sy 星心屏幕 y
     * @param {number} screenRadiusPx 盘面屏幕半径（displayRadius × zoom）
     * @param {number} frameDt 真实帧间隔（秒，不乘时间加速）
     * @returns {boolean} true = 已由 WebGL 处理（含整颗在屏外）；false = 调用方走 Canvas2D 回落
     */
    draw(ctx, presetId, sx, sy, screenRadiusPx, frameDt) {
        if (_failed || _contextLost || !_ensureRenderer()) return false;
        const preset = STAR_RENDER_PRESETS[presetId];
        if (!preset) {
            _warnOnce('缺恒星预设（presetId=' + presetId + '）');
            return false;
        }
        if (!(screenRadiusPx > 0) || !Number.isFinite(screenRadiusPx)) return false;
        let dt = frameDt;
        if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
            _warnOnce('帧间隔非法（dt=' + dt + '），按 0 推进');
            dt = 0;
        }
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        try {
            _renderer.resize(_glCanvas.width, _glCanvas.height, dpr);
            if (_presetId !== presetId) {
                _renderer.setStar(Object.assign({ screenRadiusPx }, preset));
                _presetId = presetId;
            } else {
                _renderer.setStar({ screenRadiusPx });
            }
            const e = _renderer.getExtentPx();
            // 包围盒 ∩ 屏幕：近距离时恒星比屏幕大得多，只画看得见的那一块
            const x0 = Math.max(0, Math.floor(sx - e));
            const y0 = Math.max(0, Math.floor(sy - e));
            const x1 = Math.min(canvas.width, Math.ceil(sx + e));
            const y1 = Math.min(canvas.height, Math.ceil(sy + e));
            if (x1 <= x0 || y1 <= y0) return true;   // 整颗在屏外：无需绘制，也不回落
            const w = _bucket(x1 - x0);
            const h = _bucket(y1 - y0);
            if (_glCanvas.width !== w || _glCanvas.height !== h) {
                _glCanvas.width = w;
                _glCanvas.height = h;
            }
            _renderer.resize(w, h, dpr);
            // 星心相对局部画布中心的偏移（设备像素，y 向下）
            _renderer.setCamera({ cx: sx - x0 - w / 2, cy: sy - y0 - h / 2 });
            const status = _renderer.render(dt);
            if (!status.ok) {
                if (status.reason === 'context-lost') _markContextLost();
                else _warnOnce('恒星渲染未完成（reason=' + status.reason + '）');
                return false;
            }
            ctx.drawImage(_glCanvas, x0, y0);
            return true;
        } catch (err) {
            _failed = true;
            _warnOnce('恒星渲染异常（reason=' + _errorText(err) + '）');
            return false;
        }
    }
};
