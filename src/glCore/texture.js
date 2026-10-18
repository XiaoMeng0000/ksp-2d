'use strict';

// 纹理封装：Image / ImageBitmap / TypedArray → GL 纹理。
// 约定：等距圆柱星球贴图使用 REPEAT 横向环绕 + CLAMP 纵向，线性过滤 + mipmap。

/**
 * 上传一张已解码图像为 2D 纹理。
 * @param {WebGL2RenderingContext} gl
 * @param {TexImageSource} source HTMLImageElement / ImageBitmap / HTMLCanvasElement
 * @param {object} [options] 可选配置
 * @param {boolean} [options.mipmap=true] 是否生成 mipmap
 * @param {boolean} [options.repeatX=true] 横向是否环绕（经度方向）
 * @param {boolean} [options.repeatY=false] 纵向是否环绕（纬度方向通常不环绕）
 * @param {boolean} [options.flipY=false] 是否垂直翻转上传。
 *        默认 **false**。等距圆柱贴图在「文件空间」里第 0 行就是北极，而本项目的
 *        网格 UV 约定是 v = 1 - row/height（v = 1 为北极），两者恰好互为反向，
 *        因此**不需要**再做一次翻转：不翻转时纹理坐标 t 与文件空间 v 一致，
 *        北极（v = 1）自动落在文件第 0 行。实测依据：加一次翻转会把南北对调。
 * @param {number} [options.anisotropy=0] 目标各向异性倍数，0 = 不启用
 * @returns {object} texture 句柄 { texture, width, height, mipmapped }
 */
export function createTextureFromImage(gl, source, options) {
    const opts = options || {};
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY === true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const width = source.width;
    const height = source.height;
    const mipmapped = opts.mipmap !== false;
    if (mipmapped) {
        gl.generateMipmap(gl.TEXTURE_2D);
    }
    applyFiltering(gl, opts, mipmapped);

    // 各向异性过滤（扩展可选，缺失则跳过）
    const ext = gl.getExtension('EXT_texture_filter_anisotropic')
        || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (ext && opts.anisotropy) {
        const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(opts.anisotropy, max));
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, width, height, mipmapped };
}

/**
 * 上传一份原始 RGBA8 数据为纹理（供程序化生成的贴图使用）。
 * @param {WebGL2RenderingContext} gl
 * @param {Uint8Array} rgba 长度 = width*height*4
 * @param {number} width
 * @param {number} height
 * @param {object} [options] 同 createTextureFromImage
 * @returns {object} texture 句柄
 */
export function createTextureFromData(gl, rgba, width, height, options) {
    const opts = options || {};
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    const mipmapped = opts.mipmap !== false;
    if (mipmapped) {
        gl.generateMipmap(gl.TEXTURE_2D);
    }
    applyFiltering(gl, opts, mipmapped);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, width, height, mipmapped };
}

/**
 * 按 mipmap 开关与过滤模式设置过滤与环绕模式。
 * @param {WebGL2RenderingContext} gl
 * @param {object} opts
 * @param {boolean} mipmapped
 */
function applyFiltering(gl, opts, mipmapped) {
    const linear = opts.filter !== 'nearest';
    let min;
    if (mipmapped) {
        min = linear ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST;
    } else {
        min = linear ? gl.LINEAR : gl.NEAREST;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.repeatX === false ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.repeatY === true ? gl.REPEAT : gl.CLAMP_TO_EDGE);
}

/**
 * 绑定纹理到指定纹理单元。
 * @param {WebGL2RenderingContext} gl
 * @param {object} tex createTextureFromImage / createTextureFromData 的返回值
 * @param {number} unit 纹理单元序号（0..15）
 */
export function bindTexture(gl, tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex ? tex.texture : null);
}

/**
 * 从 URL 加载图片（跨源安全，供离线工具与实验室共用）。
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败: ' + url));
        img.src = url;
    });
}

/**
 * 释放纹理。
 * @param {WebGL2RenderingContext} gl
 * @param {object} tex
 */
export function destroyTexture(gl, tex) {
    if (tex && tex.texture) {
        gl.deleteTexture(tex.texture);
    }
}
