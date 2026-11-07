'use strict';

// 原生 Wavefront .obj 模型解析器（零依赖，输出与 partPrimitives 同构的交错顶点网格）

import { PART_VERTEX_LAYOUT, FLOATS_PER_VERTEX, MAT_TYPES } from './partPrimitives.js';

/**
 * 将 .obj 文本解析为 createMesh 可直接消费的几何描述对象。
 */
export function parseObjToGeometry(objText, options = {}) {
    const baseColor = options.color || [0.92, 0.74, 0.24];
    const baseMat = options.matId !== undefined ? options.matId : MAT_TYPES.KAPTON_FOIL;
    const baseEmis = options.emissive !== undefined ? options.emissive : 0.0;

    const positions = [];
    const normals = [];
    const verts = [];
    const indices = [];

    const lines = String(objText || '').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === 'v' && parts.length >= 4) {
            positions.push([
                parseFloat(parts[1]) || 0,
                parseFloat(parts[2]) || 0,
                parseFloat(parts[3]) || 0
            ]);
        } else if (tag === 'vn' && parts.length >= 4) {
            normals.push([
                parseFloat(parts[1]) || 0,
                parseFloat(parts[2]) || 0,
                parseFloat(parts[3]) || 0
            ]);
        } else if (tag === 'f' && parts.length >= 4) {
            const faceSpecs = parts.slice(1).map((token) => {
                const sub = token.split('/');
                const vi = parseInt(sub[0], 10);
                const ni = sub.length >= 3 && sub[2] ? parseInt(sub[2], 10) : 0;
                return {
                    vIdx: vi < 0 ? positions.length + vi : vi - 1,
                    nIdx: ni < 0 ? normals.length + ni : ni - 1
                };
            });

            for (let i = 1; i < faceSpecs.length - 1; i++) {
                const tri = [faceSpecs[0], faceSpecs[i], faceSpecs[i + 1]];
                const p0 = positions[tri[0].vIdx] || [0, 0, 0];
                const p1 = positions[tri[1].vIdx] || [0, 0, 0];
                const p2 = positions[tri[2].vIdx] || [0, 0, 0];

                const e1x = p1[0] - p0[0];
                const e1y = p1[1] - p0[1];
                const e1z = p1[2] - p0[2];
                const e2x = p2[0] - p0[0];
                const e2y = p2[1] - p0[1];
                const e2z = p2[2] - p0[2];
                let fnx = e1y * e2z - e1z * e2y;
                let fny = e1z * e2x - e1x * e2z;
                let fnz = e1x * e2y - e1y * e2x;
                const flen = Math.hypot(fnx, fny, fnz) || 1;
                fnx /= flen;
                fny /= flen;
                fnz /= flen;

                const avgY = (p0[1] + p1[1] + p2[1]) / 3;
                let triColor = baseColor;
                let triMat = baseMat;
                let triEmis = baseEmis;
                if (avgY < 0.01) {
                    triColor = [0.30, 0.34, 0.40];
                    triMat = MAT_TYPES.METAL_RING;
                    triEmis = 0.0;
                } else if (avgY > 0.24) {
                    triColor = [0.32, 0.90, 0.98];
                    triMat = MAT_TYPES.EMISSIVE_GLOW;
                    triEmis = 0.75;
                }

                const baseVertIdx = Math.floor(verts.length / FLOATS_PER_VERTEX);
                for (let k = 0; k < 3; k++) {
                    const pos = positions[tri[k].vIdx] || [0, 0, 0];
                    const nrm = (tri[k].nIdx >= 0 && normals[tri[k].nIdx])
                        ? normals[tri[k].nIdx]
                        : [fnx, fny, fnz];
                    verts.push(
                        pos[0], pos[1], pos[2],
                        nrm[0], nrm[1], nrm[2],
                        triColor[0], triColor[1], triColor[2],
                        triMat, triEmis
                    );
                }
                indices.push(baseVertIdx, baseVertIdx + 1, baseVertIdx + 2);
            }
        }
    }

    const vertexArray = new Float32Array(verts);
    const indexArray = new Uint16Array(indices);
    return {
        layout: PART_VERTEX_LAYOUT,
        vertices: vertexArray,
        indices: indexArray,
        vertexCount: vertexArray.length / FLOATS_PER_VERTEX
    };
}

const _objPromiseCache = new Map();

export function fetchObjGeometry(url, options = {}) {
    if (!url) return Promise.resolve(null);
    if (_objPromiseCache.has(url)) {
        return _objPromiseCache.get(url);
    }
    const p = fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        })
        .then((text) => parseObjToGeometry(text, options))
        .catch((err) => {
            console.warn('[objLoader] 加载 .obj 模型失败 (' + url + ')，回退内置复合几何:', err.message);
            return null;
        });
    _objPromiseCache.set(url, p);
    return p;
}
