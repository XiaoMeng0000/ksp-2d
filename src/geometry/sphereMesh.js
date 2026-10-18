'use strict';

// 球体网格生成：矩形等距圆柱贴图 → 经纬度 UV → 三角面。
//
// UV 约定（全项目统一，务必与离线烘焙工具保持一致）：
//   u = 经度，0 → 1 环绕一圈；u = 0.5 对应 **+Z 方向**
//   ⚠️ 但 +Z 那条经线**并不**是屏幕上正对相机的经线：本文件的缠绕是顺时针，
//      frontFace(CCW) + cullFace(BACK) 会剔掉 +Z 的正面半球，画出来的是远半球
//      ⇒ 屏幕上正对相机的是 u ≈ 0 / 1 接缝（见下方 indices 处的完整说明与 §13.47）。
//   v = 纬度，v = 0 为南极、v = 1 为北极
//   → 等距圆柱贴图文件第 0 行是北极。上传时**不翻转**（flipY = false），
//     于是纹理坐标 t 与文件空间的 v 一致：北极（v = 1）落在文件第 0 行。
//     顶点着色器直接用网格的 v 作为 vTexCoord.t，不做任何转换。
//   ⚠️ 解析式路径（shaders/planetShaders.js 的 UNPROJECT_FRAG）必须用
//      uv.y = asin(y)/PI + 0.5，即同一口径；若在那里再翻一次会南北对调。
//
// 顶点属性布局：POSITION(0) / TEXCOORD(1) / NORMAL(2)，交错存放。

/**
 * 生成球体网格的 CPU 侧数据（不含任何 GL 调用，便于离线测试与复用）。
 * @param {object} [config]
 * @param {number} [config.segments=128] 经度方向分段数（≥3）
 * @param {number} [config.rings=64] 纬度方向分段数（≥2）
 * @param {number} [config.radius=1] 半径
 * @returns {{layout:Array<object>, vertices:Float32Array, indices:Uint16Array|Uint32Array, vertexCount:number, triangleCount:number, segments:number, rings:number}}
 */
export function buildSphereGeometry(config) {
    const cfg = config || {};
    const segments = Math.max(3, Math.round(cfg.segments === undefined ? 128 : cfg.segments));
    const rings = Math.max(2, Math.round(cfg.rings === undefined ? 64 : cfg.rings));
    const radius = cfg.radius === undefined ? 1 : cfg.radius;

    const rowCount = rings + 1;
    const colCount = segments + 1;
    const floatsPerVertex = 8; // pos(3) + uv(2) + normal(3)
    const vertices = new Float32Array(rowCount * colCount * floatsPerVertex);

    let p = 0;
    for (let iy = 0; iy <= rings; iy++) {
        const v = iy / rings;
        const lat = (v - 0.5) * Math.PI;
        const cosLat = Math.cos(lat);
        const sinLat = Math.sin(lat);
        for (let ix = 0; ix <= segments; ix++) {
            const u = ix / segments;
            const theta = (u - 0.5) * Math.PI * 2;
            const nx = cosLat * Math.sin(theta);
            const ny = sinLat;
            const nz = cosLat * Math.cos(theta);

            vertices[p] = nx * radius;
            vertices[p + 1] = ny * radius;
            vertices[p + 2] = nz * radius;
            vertices[p + 3] = u;
            vertices[p + 4] = v;
            vertices[p + 5] = nx;
            vertices[p + 6] = ny;
            vertices[p + 7] = nz;
            p += floatsPerVertex;
        }
    }

    const vertexCount = rowCount * colCount;
    const useUint32 = vertexCount > 65535;
    const indices = useUint32
        ? new Uint32Array(rings * segments * 6)
        : new Uint16Array(rings * segments * 6);

    let q = 0;
    for (let iy = 0; iy < rings; iy++) {
        for (let ix = 0; ix < segments; ix++) {
            const a = iy * colCount + ix;         // 当前行，当前列
            const b = a + 1;                      // 当前行，下一列
            const c = a + colCount;               // 下一行，当前列
            const d = c + 1;                      // 下一行，下一列
            // ★ 缠绕方向实际是**顺时针（外部观察）**，不是逆时针 —— 2026-09-27 实测（§13.47）：
            //   全网格 16384 个三角形中 CCW=0、CW=16128（余下 256 个是极点退化三角形），
            //   cos(几何法线, 顶点外法线) ≈ −0.9994~−0.9997 ⇒ 面法线一律朝**内**。
            //   → 在 gl.frontFace(CCW) + cullFace(BACK) 下**正面半球被整体剔除**，
            //     屏幕上画出来的是**远半球**，本体光照因此活在 z 轴镜像世界里
            //     （盘心有效法线 (0,0,−1)）。这里**不修正方向**，补偿做在大气侧：
            //     `meshRenderer.js` 的 `atmosphereSunDir()` 把太阳方向做 L → [Lx, Ly, −Lz]，
            //     让两层进入同一个镜像世界。
            //   ⚠️ **将来若修正本文件的缠绕方向，必须同时删掉 `meshRenderer.js` 里
            //     `atmosphereSunDir()` 的 z 取反**（或改用 frontFace(CW)），
            //     否则两层太阳方向会再次反号（§13.47）；而且会作废全部历史验收图与 M5 基线。
            indices[q] = a;
            indices[q + 1] = c;
            indices[q + 2] = b;
            indices[q + 3] = b;
            indices[q + 4] = c;
            indices[q + 5] = d;
            q += 6;
        }
    }

    return {
        layout: [
            { name: 'POSITION', size: 3, type: 'float32' },
            { name: 'TEXCOORD', size: 2, type: 'float32' },
            { name: 'NORMAL', size: 3, type: 'float32' },
        ],
        vertices,
        indices,
        vertexCount,
        triangleCount: rings * segments * 2,
        segments,
        rings,
    };
}

/**
 * 生成覆盖整个视口的全屏三角形/四边形（用于离屏解算与后处理）。
 * 使用单个三角形（比四边形少一次光栅化接缝），顶点位置直接给 NDC。
 * @returns {{layout:Array<object>, vertices:Float32Array, vertexCount:number}}
 */
export function buildFullscreenGeometry() {
    // 单个覆盖 [-1,1]² 的三角形：(-1,-1) (3,-1) (-1,3)，uv 线性映射到 [0,1]
    const vertices = new Float32Array([
        -1, -1, 0, 1,
        3, -1, 2, 1,
        -1, 3, 0, -1,
    ]);
    return {
        layout: [
            { name: 'POSITION', size: 2, type: 'float32' },
            { name: 'TEXCOORD', size: 2, type: 'float32' },
        ],
        vertices,
        vertexCount: 3,
    };
}
