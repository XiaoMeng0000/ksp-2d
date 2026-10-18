'use strict';

// WebGL2 上下文创建：把一个 canvas 变成一个可用的 GL2RenderingContext。
// 仅负责「拿到 context + 基础状态」，不持有任何资源。

/**
 * 创建 WebGL2 上下文并应用默认状态。
 * @param {HTMLCanvasElement} canvas 目标画布
 * @param {object} [options] 可选配置
 * @param {boolean} [options.antialias=true] 是否开启 MSAA（默认 framebuffer）
 * @param {boolean} [options.preserveDrawingBuffer=false] 是否需要 readPixels / toDataURL 可靠取图
 * @param {boolean} [options.alpha=false] 画布是否带 alpha 通道
 * @returns {WebGL2RenderingContext}
 */
export function createGLContext(canvas, options) {
    const opts = options || {};
    const gl = canvas.getContext('webgl2', {
        alpha: opts.alpha === true,
        antialias: opts.antialias !== false,
        depth: true,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: opts.preserveDrawingBuffer === true,
        powerPreference: 'high-performance',
    });
    if (!gl) {
        throw new Error('WebGL2 不可用：当前浏览器或显卡驱动不支持 webgl2 上下文');
    }
    // ★ 画布的色彩空间显式声明为 sRGB ★
    //   它决定合成器**如何解释**绘制缓冲里的数值：'srgb' ⇒ 缓冲里应当是
    //   sRGB 编码值。本渲染器内部一律用线性光计算，所以**写画布前必须编码**。
    //   实现方式：场景先渲到离屏的 SRGB8 目标（线性域混合，见 createRenderTarget），
    //   再由「铺屏」那一步做一次编码（见 meshRenderer 的 render()）。
    //   ⚠️ 该属性在旧浏览器上不存在，取不到就静默跳过。
    if ('drawingBufferColorSpace' in gl) {
        try {
            gl.drawingBufferColorSpace = 'srgb';
        } catch (e) {
            // 浏览器不接受 'srgb' 时忽略 —— Chrome/Firefox 默认即以 sRGB 合成。
        }
    }
    applyDefaultState(gl);
    return gl;
}

/**
 * 应用渲染器的默认 GL 状态（深度测试 + 背面剔除）。
 * @param {WebGL2RenderingContext} gl
 */
export function applyDefaultState(gl) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
}

/**
 * 调整画布的绘制缓冲尺寸（只改缓冲，不动 CSS 尺寸 —— 显示尺寸由调用方决定）。
 * @param {HTMLCanvasElement} canvas
 * @param {number} cssWidth 期望的 CSS 像素宽
 * @param {number} cssHeight 期望的 CSS 像素高
 * @param {number} dpr 设备像素比
 * @returns {{width:number, height:number, dpr:number}} 实际缓冲尺寸
 */
export function resizeCanvasBuffer(canvas, cssWidth, cssHeight, dpr) {
    const ratio = Math.max(0.5, Math.min(4, dpr || 1));
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    return { width, height, dpr: ratio };
}

/**
 * 查询 WebGL 扩展是否可用（缺失不视为致命错误，调用方自行降级）。
 * @param {WebGL2RenderingContext} gl
 * @param {string} name 扩展名
 * @returns {object|null}
 */
export function getGLExtension(gl, name) {
    return gl.getExtension(name) || null;
}

/**
 * 创建离屏渲染目标。
 *
 * ★★ 色彩空间（2026-10-02 起默认 sRGB）★★
 *   默认用 **SRGB8_ALPHA8**：着色器输出**线性值**，硬件在写入时自动做
 *   linear → sRGB 编码，采样时自动做 sRGB → linear 解码。于是
 *     · 8 位缓冲在**暗部**的精度大幅提升（线性 8 位在暗部只有约 5 个可用码值，
 *       这正是"夜面/暮光带全是一块平色、渐变分层很硬"的放大器）；
 *     · 混合（大气层 ONE / ONE_MINUS_SRC_ALPHA）在**线性空间**里做，物理正确；
 *     · 读回来的像素是**显示编码**值，与美术原图 / 参照图同口径。
 *
 *   ⚠️ 若某个目标需要**原样字节**（例如把 albedo 贴图搬到离屏做像素比对、
 *      或差异图这类"写入的数值本身就是最终显示色"的可视化），传
 *      `{ srgb: false }` 退回线性 RGBA8 —— 否则会被硬件多编一次 sRGB。
 *
 * ★★ MSAA（2026-10-02 新增，默认关闭）★★
 *   `msaa > 0` 时颜色附件换成**多重采样 renderbuffer**，纹理只作为解析目标：
 *   渲染进 `framebuffer`（多重采样），需要采样/读像素前先调 `resolveRenderTarget`。
 *   为什么要它：主渲染路径必须自己开离屏目标才能在线性域混合（否则画布路径
 *   与量测路径的合成式不一致），而离屏默认没有 MSAA ⇒ 球体边缘会重新出现锯齿。
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {number} [options.filter] 采样过滤，默认 gl.NEAREST
 * @param {boolean} [options.srgb=true] 是否用 sRGB 附件
 * @param {number} [options.msaa=0] 多重采样数（0 = 关闭）
 * @returns {{framebuffer:WebGLFramebuffer, resolveFramebuffer:WebGLFramebuffer, texture:WebGLTexture, width:number, height:number, srgb:boolean, samples:number}}
 */
export function createRenderTarget(gl, width, height, options) {
    const opts = options || {};
    const srgb = opts.srgb === undefined ? true : !!opts.srgb;
    const wanted = Math.max(0, Math.round(opts.msaa || 0));
    const internal = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const filter = opts.filter === undefined ? gl.NEAREST : opts.filter;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 纹理侧 framebuffer（解析目标；非 MSAA 时它就是渲染目标）
    const resolveFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const okResolve = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    let samples = 0;
    let renderbuffer = null;
    let framebuffer = resolveFramebuffer;
    if (wanted > 0 && okResolve) {
        const maxSamples = Math.max(1, gl.getParameter(gl.MAX_SAMPLES) || 1);
        const n = Math.min(wanted, maxSamples);
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, internal, width, height);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
            samples = n;
            renderbuffer = rb;
            framebuffer = fb;
        } else {
            // 该格式不支持多重采样 ⇒ 静默退回单采样，不影响功能
            gl.deleteFramebuffer(fb);
            gl.deleteRenderbuffer(rb);
        }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (!okResolve) {
        gl.deleteFramebuffer(resolveFramebuffer);
        gl.deleteTexture(texture);
        throw new Error('离屏渲染目标创建失败（纹理侧不完整）');
    }
    return {
        framebuffer,
        resolveFramebuffer,
        renderbuffer,
        texture,
        width,
        height,
        srgb,
        samples,
    };
}

/**
 * 把多重采样的颜色附件解析进纹理。非 MSAA 目标上是空操作。
 *
 * ⚠️ 任何"采样这张纹理 / 读像素"的动作之前都必须先调它，否则拿到的是
 *    **上一次解析的旧内容**（MSAA 目标创建时纹理是未初始化的）。
 *
 * @param {WebGL2RenderingContext} gl
 * @param {object} target createRenderTarget 的返回值
 * @returns {boolean} 是否真的做了一次解析
 */
export function resolveRenderTarget(gl, target) {
    if (!target || !target.samples) {
        return false;
    }
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolveFramebuffer);
    gl.blitFramebuffer(
        0, 0, target.width, target.height,
        0, 0, target.width, target.height,
        gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prev);
    return true;
}

/**
 * 绑定 / 解绑渲染目标（绑定时自动设置视口）。
 * @param {WebGL2RenderingContext} gl
 * @param {object|null} target createRenderTarget 的返回值，null 表示默认 framebuffer
 */
export function bindRenderTarget(gl, target) {
    if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}

/**
 * 从当前绑定的 framebuffer 读回像素（返回自上而下的行序，与图像语义一致）。
 *
 * ⚠️ MSAA 目标要先 resolveRenderTarget + 绑定 resolveFramebuffer 再读。
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} 长度 = width*height*4
 */
export function readPixelsTopDown(gl, width, height) {
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8Array(raw.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
        // framebuffer 以左下为原点，图像以左上为原点
        out.set(raw.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    }
    return out;
}

/**
 * 释放渲染目标。
 * @param {WebGL2RenderingContext} gl
 * @param {object} target
 */
export function destroyRenderTarget(gl, target) {
    if (!target) {
        return;
    }
    gl.deleteFramebuffer(target.resolveFramebuffer);
    if (target.framebuffer && target.framebuffer !== target.resolveFramebuffer) {
        gl.deleteFramebuffer(target.framebuffer);
    }
    if (target.renderbuffer) {
        gl.deleteRenderbuffer(target.renderbuffer);
    }
    gl.deleteTexture(target.texture);
}
