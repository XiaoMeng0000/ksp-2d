'use strict';

// 4x4 / 3x3 矩阵工具（列主序，与 GLSL 的 mat4/mat3 内存布局一致）。
// 只实现渲染管线真正需要的那几个：正交投影、模型变换、法线矩阵。

/**
 * 4x4 矩阵相乘：out = a * b。
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {Float32Array} 新的 16 元素列主序矩阵
 */
export function multiply4(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        }
    }
    return out;
}

/**
 * 单位矩阵。
 * @returns {Float32Array}
 */
export function identity4() {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
}

/**
 * 正交投影矩阵（右手坐标系，看向 -Z，深度范围 [-1, 1]）。
 * @param {number} left
 * @param {number} right
 * @param {number} bottom
 * @param {number} top
 * @param {number} near
 * @param {number} far
 * @returns {Float32Array}
 */
export function orthographic(left, right, bottom, top, near, far) {
    const out = new Float32Array(16);
    out[0] = 2 / (right - left);
    out[5] = 2 / (top - bottom);
    out[10] = -2 / (far - near);
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near);
    out[15] = 1;
    return out;
}

/**
 * 绕 Y 轴旋转。
 * @param {number} angle 弧度
 * @returns {Float32Array}
 */
export function rotationY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = identity4();
    out[0] = c;
    out[2] = -s;
    out[8] = s;
    out[10] = c;
    return out;
}

/**
 * 绕 X 轴旋转。
 * @param {number} angle 弧度
 * @returns {Float32Array}
 */
export function rotationX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = identity4();
    out[5] = c;
    out[6] = s;
    out[9] = -s;
    out[10] = c;
    return out;
}

/**
 * 平移矩阵。
 * @param {number} x
 * @param {number} y
 * @param {number} [z=0]
 * @returns {Float32Array}
 */
export function translation(x, y, z) {
    const out = identity4();
    out[12] = x;
    out[13] = y;
    out[14] = z === undefined ? 0 : z;
    return out;
}

/**
 * 等比缩放矩阵。
 * @param {number} s
 * @returns {Float32Array}
 */
export function scaling(s) {
    const out = identity4();
    out[0] = s;
    out[5] = s;
    out[10] = s;
    return out;
}

/**
 * 取 4x4 矩阵的左上 3x3（模型矩阵为「旋转 + 等比缩放」时，
 * 归一化后即为正确的法线矩阵，无需求逆转置）。
 * @param {Float32Array} m
 * @returns {Float32Array} 9 元素列主序矩阵
 */
export function normalMatrixFromModel(m) {
    const out = new Float32Array(9);
    out[0] = m[0];
    out[1] = m[1];
    out[2] = m[2];
    out[3] = m[4];
    out[4] = m[5];
    out[5] = m[6];
    out[6] = m[8];
    out[7] = m[9];
    out[8] = m[10];
    return out;
}
