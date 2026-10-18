'use strict';

// 着色器编译与程序链接的最小封装。
// 顶点/片元着色器源码以 GLSL ES 3.00（#version 300 es）书写。

/**
 * 包一层带定位信息的编译错误，便于在控制台直接看到出错的着色器名。
 * @param {string} label 着色器名字（如 'sphere.vert'）
 * @param {string} info 驱动返回的日志
 * @param {string} source 原始源码
 * @returns {Error}
 */
function buildShaderError(label, info, source) {
    const lines = String(source).split('\n');
    const numbered = lines.map((line, i) => String(i + 1).padStart(4, ' ') + ' | ' + line).join('\n');
    const err = new Error('着色器编译失败 [' + label + ']:\n' + info + '\n--- 源码 ---\n' + numbered);
    err.shaderLabel = label;
    return err;
}

/**
 * 编译单个着色器。
 * @param {WebGL2RenderingContext} gl
 * @param {number} type gl.VERTEX_SHADER | gl.FRAGMENT_SHADER
 * @param {string} source GLSL 源码
 * @param {string} label 用于报错的名字
 * @returns {WebGLShader}
 */
export function compileShader(gl, type, source, label) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw buildShaderError(label || 'shader', info, source);
    }
    return shader;
}

/**
 * 创建一个着色器程序。
 * @param {WebGL2RenderingContext} gl
 * @param {object} desc 描述对象
 * @param {string} desc.vertex 顶点着色器源码
 * @param {string} desc.fragment 片元着色器源码
 * @param {string} [desc.name='program'] 程序名（报错用）
 * @param {string} [desc.prefix=''] 注入到两个着色器 `#version` 之后的宏前缀
 * @returns {{program: WebGLProgram, uniforms: object, attribs: object}}
 */
export function createProgram(gl, desc) {
    const name = desc.name || 'program';
    const prefix = desc.prefix || '';
    const vsSource = injectPrefix(desc.vertex, prefix);
    const fsSource = injectPrefix(desc.fragment, prefix);
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, name + '.vert');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, name + '.frag');
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error('着色器程序链接失败 [' + name + ']: ' + info);
    }
    return {
        program,
        uniforms: collectUniforms(gl, program),
        attribs: collectAttribs(gl, program),
    };
}

/**
 * 把宏前缀插入到 `#version` 行之后（GLSL 要求 #version 必须是第一行有效语句）。
 * @param {string} source
 * @param {string} prefix
 * @returns {string}
 */
function injectPrefix(source, prefix) {
    if (!prefix) {
        return source;
    }
    const match = source.match(/^\s*#version[^\n]*\n/);
    if (!match) {
        return prefix + '\n' + source;
    }
    return match[0] + prefix + '\n' + source.slice(match[0].length);
}

/**
 * 预取所有 uniform / attribute 位置，避免每帧调用 getUniformLocation。
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @returns {object}
 */
function collectUniforms(gl, program) {
    const out = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        if (!info) {
            continue;
        }
        // 数组 uniform 的名字形如 'foo[0]'，统一按基名索引
        const key = info.name.replace(/\[0\]$/, '');
        out[key] = gl.getUniformLocation(program, info.name);
    }
    return out;
}

/**
 * 预取所有顶点属性位置。
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @returns {object}
 */
function collectAttribs(gl, program) {
    const out = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < count; i++) {
        const info = gl.getActiveAttrib(program, i);
        if (!info) {
            continue;
        }
        out[info.name] = gl.getAttribLocation(program, info.name);
    }
    return out;
}

/**
 * 创建一个 uniform block（UBO）并绑定到指定的 binding point。
 *
 * ★ 为什么需要它（2026-10-04）★
 *   `MAX_FRAGMENT_UNIFORM_VECTORS` 的 **WebGL2 规格保证下限只有 224**，
 *   而云着色器的三张 181 点色表就占了 136 个 ⇒ 实测已用到 **218/224 = 97%**。
 *   再往上加东西（例如气态巨星的涡旋表）就会在只满足规格下限的 GPU 上
 *   **链不上程序** —— 症状是"云凭空消失"，而且本机（1024）完全复现不出来。
 *
 *   UBO 的数据**不占** `MAX_FRAGMENT_UNIFORM_VECTORS`，另有
 *   `MAX_UNIFORM_BLOCK_SIZE`（规格保证 ≥ 16384 字节）与
 *   `MAX_FRAGMENT_UNIFORM_BLOCKS`（≥ 12）两条独立限制。
 *   我们三张表只要 2208 字节 ⇒ 宽裕。
 *
 * ⚠️ 另一个考虑：把色表做成**纹理**同样能腾出预算，但那会给云着色器加上
 *   第一个 sampler，与「云场完全程序化、**不采样任何贴图**」这条既定决策相抵触。
 *   UBO 是"同样腾出预算、但不破规矩"的那条路。
 *
 * ⚠️ std140 布局规则：`vec4[N]` 的数组步长恰好是 16 字节 ⇒ 三张表**紧密排列**，
 *   偏移分别是 0 / 16·v4 / 32·v4。**不要**改成 `float[N]` —— 那样步长是 16 字节，
 *   每个 float 独占一个 vec4 槽，反而更费。
 *
 * @param {WebGL2RenderingContext} gl
 * @param {object} shader createProgram 的返回值
 * @param {string} blockName GLSL 里 uniform block 的名字
 * @param {number} bindingPoint 绑定槽位（同一程序内不要重复）
 * @returns {object|null} 句柄；块被优化掉时返回 null（调用方要能容忍）
 */
export function createUniformBlock(gl, shader, blockName, bindingPoint) {
    const index = gl.getUniformBlockIndex(shader.program, blockName);
    if (index === gl.INVALID_INDEX || index === undefined) {
        return null;
    }
    gl.uniformBlockBinding(shader.program, index, bindingPoint);
    return {
        name: blockName,
        index,
        bindingPoint,
        buffer: gl.createBuffer(),
        byteLength: 0,
    };
}

/**
 * 上传 UBO 数据并绑定到它的 binding point。
 * @param {WebGL2RenderingContext} gl
 * @param {object} block createUniformBlock 的返回值
 * @param {Float32Array} data 按 std140 布局排好的数据
 */
export function uploadUniformBlock(gl, block, data) {
    if (!block) {
        return;
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, block.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, data, gl.DYNAMIC_DRAW);
    // bindBufferBase 设的是**带下标的绑定点**，与上面的通用绑定互不影响
    gl.bindBufferBase(gl.UNIFORM_BUFFER, block.bindingPoint, block.buffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    block.byteLength = data.byteLength;
}

/**
 * 绑定程序并一次性写 uniform（按值的形状自动选择 setter）。
 * @param {WebGL2RenderingContext} gl
 * @param {object} shader createProgram 的返回值
 * @param {object} values { 名字: 值 }
 */
export function setUniforms(gl, shader, values) {
    gl.useProgram(shader.program);
    const uniforms = shader.uniforms;
    Object.keys(values).forEach((key) => {
        const loc = uniforms[key];
        if (loc === undefined || loc === null) {
            return;
        }
        const value = values[key];
        if (typeof value === 'number') {
            gl.uniform1f(loc, value);
        } else if (typeof value === 'boolean') {
            gl.uniform1i(loc, value ? 1 : 0);
        } else if (value instanceof Float32Array) {
            // 显式传 Float32Array 时按 uniform 数组写入（长度即数组大小）
            if (value.length === 1) {
                gl.uniform1fv(loc, value);
            } else if (value.length === 2) {
                gl.uniform2fv(loc, value);
            } else if (value.length === 3) {
                gl.uniform3fv(loc, value);
            } else if (value.length === 4) {
                gl.uniform4fv(loc, value);
            } else if (value.length === 9) {
                gl.uniformMatrix3fv(loc, false, value);
            } else if (value.length === 16) {
                gl.uniformMatrix4fv(loc, false, value);
            } else {
                // 其余一律按一维数组写入（本项目用于逐群系参数表）
                gl.uniform1fv(loc, value);
            }
        } else if (Array.isArray(value)) {
            if (value.length === 2) {
                gl.uniform2fv(loc, value);
            } else if (value.length === 3) {
                gl.uniform3fv(loc, value);
            } else if (value.length === 4) {
                gl.uniform4fv(loc, value);
            } else if (value.length === 9) {
                gl.uniformMatrix3fv(loc, false, value);
            } else if (value.length === 16) {
                gl.uniformMatrix4fv(loc, false, value);
            } else {
                gl.uniform1fv(loc, value);
            }
        } else if (value && typeof value === 'object' && value.texture) {
            gl.uniform1i(loc, value.texture);
        }
    });
}

/**
 * 删除程序。
 * @param {WebGL2RenderingContext} gl
 * @param {object} shader createProgram 的返回值
 */
export function destroyProgram(gl, shader) {
    if (shader && shader.program) {
        gl.deleteProgram(shader.program);
    }
}
