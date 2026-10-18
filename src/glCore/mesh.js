'use strict';

// 网格封装：交错顶点缓冲 + 可选索引缓冲。
//
// 设计说明（为什么不用 VAO 缓存）：
//   本项目同一个几何会被多个着色器程序绘制（球体走 planet 程序、全屏三角形走
//   unproject / diff 程序），而属性位置由各程序自由分配。若用 VAO，
//   每次换程序都得重建或切换 VAO；而交错缓冲本身很小（每顶点 ≤32 字节），
//   直接重绑属性的成本更低、状态也更直观。顶点数组对象仍被创建但仅在需要时绑定，
//   迁移到主游戏时可平滑替换为「每程序一套 VAO」的优化实现。

/**
 * 由属性描述列表算出顶点步长（stride）与每个属性的字节偏移。
 * @param {Array<{name:string, size:number, type?:string, normalized?:boolean}>} layout
 * @returns {{stride:number, entries:Array<object>}}
 */
function normalizeLayout(layout) {
    let stride = 0;
    const entries = layout.map((attr) => {
        const type = attr.type === undefined ? 'float32' : attr.type;
        const bytesPerComponent = type === 'int16' || type === 'uint16' ? 2
            : type === 'uint8' || type === 'int8' ? 1 : 4;
        const entry = {
            name: attr.name,
            size: attr.size,
            type,
            normalized: attr.normalized === true,
            offset: stride,
        };
        stride += attr.size * bytesPerComponent;
        return entry;
    });
    return { stride, entries };
}

/**
 * 把类型名映射为 GL 常量。
 * @param {WebGL2RenderingContext} gl
 * @param {string} type
 * @returns {number}
 */
function glType(gl, type) {
    switch (type) {
        case 'int16': return gl.SHORT;
        case 'uint16': return gl.UNSIGNED_SHORT;
        case 'uint8': return gl.UNSIGNED_BYTE;
        case 'int8': return gl.BYTE;
        default: return gl.FLOAT;
    }
}

/**
 * 构造网格。
 * @param {WebGL2RenderingContext} gl
 * @param {object} desc 描述对象
 * @param {Array<object>} desc.layout 属性布局，顺序即交错顺序
 * @param {ArrayBufferView} desc.vertices 交错顶点数据
 * @param {Uint16Array|Uint32Array} [desc.indices] 索引数据
 * @param {number} [desc.vertexCount] 顶点数（缺省按数据长度推算）
 * @param {number} [desc.mode] 图元类型，默认 gl.TRIANGLES
 * @param {object} desc.attributeLocations 属性名 → 着色器 attribute 位置
 * @returns {object} mesh 句柄
 */
export function createMesh(gl, desc) {
    const { stride, entries } = normalizeLayout(desc.layout);
    const locations = desc.attributeLocations || {};

    const attributes = entries.map((entry) => Object.assign({}, entry, {
        location: locations[entry.name],
    }));

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, desc.vertices, gl.STATIC_DRAW);

    let ibo = null;
    let indexCount = 0;
    let indexType = 0;
    if (desc.indices) {
        ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, desc.indices, gl.STATIC_DRAW);
        indexCount = desc.indices.length;
        indexType = desc.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const vertexCount = desc.vertexCount !== undefined
        ? desc.vertexCount
        : Math.floor(desc.vertices.byteLength / stride);

    return {
        vao,
        vbo,
        ibo,
        indexCount,
        indexType,
        vertexCount,
        stride,
        mode: desc.mode === undefined ? gl.TRIANGLES : desc.mode,
        attributes,
    };
}

/**
 * 绘制网格（需先 gl.useProgram 并绑定好 uniform / 纹理）。
 * @param {WebGL2RenderingContext} gl
 * @param {object} mesh createMesh 的返回值
 */
export function drawMesh(gl, mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    mesh.attributes.forEach((attr) => {
        if (attr.location === undefined || attr.location < 0) {
            return;
        }
        gl.enableVertexAttribArray(attr.location);
        gl.vertexAttribPointer(
            attr.location,
            attr.size,
            glType(gl, attr.type),
            attr.normalized,
            mesh.stride,
            attr.offset,
        );
    });
    if (mesh.ibo) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        gl.drawElements(mesh.mode, mesh.indexCount, mesh.indexType, 0);
    } else {
        gl.drawArrays(mesh.mode, 0, mesh.vertexCount);
    }
}

/**
 * 释放网格占用的 GPU 资源。
 * @param {WebGL2RenderingContext} gl
 * @param {object} mesh
 */
export function destroyMesh(gl, mesh) {
    if (!mesh) {
        return;
    }
    gl.deleteVertexArray(mesh.vao);
    gl.deleteBuffer(mesh.vbo);
    if (mesh.ibo) {
        gl.deleteBuffer(mesh.ibo);
    }
}
