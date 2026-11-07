'use strict';

// KSP2 部件 OBJ/MTL 资产加载器
// 与 objLoader.js 的区别：
//   objLoader.js  —— 单材质、导出为「程序化材质」顶点（pos+normal+color+material），用于占位与简单模型
//   本模块        —— 完整解析 OBJ 的 v/vt/vn + o/g/usemtl 分组，输出「多子网格 + 材质引用」，
//                    配合 kspPartShaders.js 走真实 PBR 贴图管线（漫反射/法线/金属粗糙度/自发光/AO）。
//
// 资产来源：KSP2 官方部件导出（OBJ + MTL + PNG），坐标约定 Y 轴向上、直径 1.25m 为标准级。

export const KSP_PART_FLOATS_PER_VERTEX = 8; // position(3) + normal(3) + uv(2)

export const KSP_PART_VERTEX_LAYOUT = [
    { name: 'POSITION', size: 3, type: 'float32' },
    { name: 'NORMAL',   size: 3, type: 'float32' },
    { name: 'UV',       size: 2, type: 'float32' }
];

const _cache = new Map();

/**
 * 解析 MTL 文本，返回 { 材质名: { diffuse, normal, emissive, metallic, ao } }（值为贴图 URL，可为 null）。
 * @param {string} mtlText
 * @param {string} baseDir 部件目录（用于解析 ../_textures/xxx.png 相对路径）
 * @returns {object}
 */
export function parseMtl(mtlText, baseDir) {
    const materials = {};
    let current = null;

    const resolve = (p) => {
        if (!p) return null;
        // MTL 里的路径形如 ../_textures/xxx.png，相对**部件目录的父级**解析。
        // 若直接对相对路径逐段处理，'..' 会在空前缀上被吞掉，
        // 必须先把 baseDir 拼进来再做整体归一化。
        const parts = (baseDir + '/' + String(p).replace(/\\/g, '/')).split('/');
        const stack = [];
        for (const seg of parts) {
            if (seg === '..') stack.pop();
            else if (seg && seg !== '.') stack.push(seg);
        }
        return stack.join('/');
    };

    for (const rawLine of String(mtlText || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === 'newmtl') {
            current = { name: parts.slice(1).join(' '), diffuse: null, normal: null, emissive: null, metallic: null, ao: null };
            materials[current.name] = current;
            continue;
        }
        if (!current) continue;

        if (tag === 'map_Kd') {
            current.diffuse = resolve(parts.slice(1).join(' '));
        } else if (tag === 'map_Bump' || tag === 'bump' || tag === 'map_bump') {
            current.normal = resolve(parts.slice(1).join(' '));
        } else if (tag === 'map_Ke') {
            current.emissive = resolve(parts.slice(1).join(' '));
        }
    }

    // KSP2 MTL 用注释记录 Unity 的额外贴图槽（_MetallicGlossMap / _OcclusionMap），按材质名回填
    // 例： # map _MetallicGlossMap -> SwivelReliant_M (Texture2D)
    let pendingMat = null;
    for (const rawLine of String(mtlText || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        const mtlMatch = line.match(/^newmtl\s+(.+)$/);
        if (mtlMatch) { pendingMat = materials[mtlMatch[1]] || null; continue; }
        if (!pendingMat) continue;
        const mapMatch = line.match(/^#\s*map\s+_(\w+)\s*->\s*(.+?)\s*\(/);
        if (!mapMatch) continue;
        const slot = mapMatch[1];
        const texBase = mapMatch[2].trim();
        if (slot === 'MetallicGlossMap') {
            pendingMat.metallic = resolve('../_textures/' + texBase + '.png');
        } else if (slot === 'OcclusionMap') {
            pendingMat.ao = resolve('../_textures/' + texBase + '.png');
        }
    }

    return materials;
}

/**
 * 解析 OBJ 文本为多子网格。按 usemtl 切分，每个子网格共享一套顶点布局。
 * @param {string} objText
 * @returns {{submeshes: Array, bounds: object}}
 */
export function parseObjSubmeshes(objText) {
    const positions = [];
    const normals = [];
    const uvs = [];

    const submeshes = [];
    let current = null;
    let currentMaterial = null;

    // 每个子网格独立的 (v/vt/vn → 本地索引) 映射
    let vertexMap = null;
    let verts = null;
    let indices = null;

    function beginSubmesh(materialName) {
        current = {
            material: materialName || 'default',
            vertices: [],
            indices: []
        };
        submeshes.push(current);
        vertexMap = new Map();
        verts = current.vertices;
        indices = current.indices;
    }

    function endSubmesh() {
        current = null;
        vertexMap = null;
        verts = null;
        indices = null;
    }

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (const rawLine of String(objText || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === 'v' && parts.length >= 4) {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            positions.push([x, y, z]);
            if (x < min[0]) min[0] = x;
            if (y < min[1]) min[1] = y;
            if (z < min[2]) min[2] = z;
            if (x > max[0]) max[0] = x;
            if (y > max[1]) max[1] = y;
            if (z > max[2]) max[2] = z;
        } else if (tag === 'vn' && parts.length >= 4) {
            normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (tag === 'vt' && parts.length >= 3) {
            uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
        } else if (tag === 'usemtl') {
            currentMaterial = parts.slice(1).join(' ');
            // 材质变化即切分子网格（KSP2 导出按材质组织，符合预期）
            endSubmesh();
            beginSubmesh(currentMaterial);
        } else if ((tag === 'o' || tag === 'g') && !current) {
            // 未声明材质前出现对象分组时，先建一个默认子网格
            beginSubmesh(currentMaterial);
        } else if (tag === 'f' && parts.length >= 4) {
            if (!current) beginSubmesh(currentMaterial);

            const idxList = [];
            for (let i = 1; i < parts.length; i++) {
                const token = parts[i];
                const sub = token.split('/');
                const vRaw = parseInt(sub[0], 10);
                const tRaw = sub.length >= 2 && sub[1] ? parseInt(sub[1], 10) : 0;
                const nRaw = sub.length >= 3 && sub[2] ? parseInt(sub[2], 10) : 0;

                const vIdx = vRaw < 0 ? positions.length + vRaw : vRaw - 1;
                const tIdx = tRaw === 0 ? -1 : (tRaw < 0 ? uvs.length + tRaw : tRaw - 1);
                const nIdx = nRaw === 0 ? -1 : (nRaw < 0 ? normals.length + nRaw : nRaw - 1);

                const key = vIdx + '/' + tIdx + '/' + nIdx;
                let local = vertexMap.get(key);
                if (local === undefined) {
                    local = Math.floor(verts.length / KSP_PART_FLOATS_PER_VERTEX);
                    vertexMap.set(key, local);

                    const p = positions[vIdx] || [0, 0, 0];
                    const n = nIdx >= 0 ? (normals[nIdx] || [0, 1, 0]) : [0, 1, 0];
                    const t = tIdx >= 0 ? (uvs[tIdx] || [0, 0]) : [0, 0];
                    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], t[0], 1 - t[1]);
                }
                idxList.push(local);
            }

            // 多边形扇形剖分
            for (let i = 1; i < idxList.length - 1; i++) {
                indices.push(idxList[0], idxList[i], idxList[i + 1]);
            }
        }
    }

    const output = [];
    for (const sm of submeshes) {
        if (!sm.indices.length) continue;
        const vertexCount = sm.vertices.length / KSP_PART_FLOATS_PER_VERTEX;
        output.push({
            material: sm.material,
            vertices: new Float32Array(sm.vertices),
            indices: vertexCount > 65535 ? new Uint32Array(sm.indices) : new Uint16Array(sm.indices),
            vertexCount,
            indexCount: sm.indices.length
        });
    }

    const bounds = {
        minX: min[0], minY: min[1], minZ: min[2],
        maxX: max[0], maxY: max[1], maxZ: max[2],
        radius: Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2])),
        height: max[1] - min[1],
        centerY: (min[1] + max[1]) / 2
    };

    // 1) 垂直居中：把模型 Y 平移到「几何中心 = 原点」，与程序化部件的对称约定保持一致
    const dy = -bounds.centerY;
    if (Math.abs(dy) > 1e-6) {
        for (const sm of output) {
            const v = sm.vertices;
            for (let i = 1; i < v.length; i += KSP_PART_FLOATS_PER_VERTEX) {
                v[i] += dy;
            }
        }
    }
    bounds.minY += dy;
    bounds.maxY += dy;
    bounds.centerY = 0;

    // 2) 绕序自检：Unity 左手系导出的网格在 OpenGL 右手系下可能整体反绕。
    //    用有向体积判定（正值 = 外法线 CCW），为负则整体翻转三角形索引。
    const vol = signedVolume(output);
    if (vol < 0) {
        for (const sm of output) {
            const idx = sm.indices;
            for (let i = 0; i + 2 < idx.length; i += 3) {
                const t = idx[i + 1];
                idx[i + 1] = idx[i + 2];
                idx[i + 2] = t;
            }
        }
        bounds.windingFlipped = true;
    }

    return { submeshes: output, bounds };
}

/**
 * 计算多子网格合计的有向体积（>0 表示外法线逆时针）。
 */
function signedVolume(submeshes) {
    let total = 0;
    for (const sm of submeshes) {
        const v = sm.vertices;
        const idx = sm.indices;
        const stride = KSP_PART_FLOATS_PER_VERTEX;
        for (let i = 0; i + 2 < idx.length; i += 3) {
            const a = idx[i] * stride;
            const b = idx[i + 1] * stride;
            const c = idx[i + 2] * stride;
            const ax = v[a], ay = v[a + 1], az = v[a + 2];
            const bx = v[b], by = v[b + 1], bz = v[b + 2];
            const cx = v[c], cy = v[c + 1], cz = v[c + 2];
            total += (
                ax * (by * cz - bz * cy) -
                ay * (bx * cz - bz * cx) +
                az * (bx * cy - by * cx)
            ) / 6;
        }
    }
    return total;
}

/**
 * 加载一个 KSP2 部件（OBJ + MTL）。返回带材质贴图 URL 的多子网格描述。
 * @param {string} dir 部件目录，如 'assets/models/ksp2/engine_1v_methalox_terrier'
 * @param {string} objName OBJ 文件名
 * @param {string} mtlName MTL 文件名
 * @returns {Promise<object|null>}
 */
export function loadKspPart(dir, objName, mtlName) {
    const key = dir + '/' + objName;
    if (_cache.has(key)) return _cache.get(key);

    const objUrl = dir + '/' + objName;
    const mtlUrl = mtlName ? (dir + '/' + mtlName) : null;

    const promise = Promise.all([
        fetch(objUrl).then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        }),
        mtlUrl
            ? fetch(mtlUrl).then((r) => (r.ok ? r.text() : '')).catch(() => '')
            : Promise.resolve('')
    ])
        .then(([objText, mtlText]) => {
            const materials = mtlText ? parseMtl(mtlText, dir) : {};
            const parsed = parseObjSubmeshes(objText);
            for (const sm of parsed.submeshes) {
                sm.materialInfo = materials[sm.material] || null;
            }
            console.log(
                '[KspPartLoader] ' + objName + ' → ' +
                parsed.submeshes.length + ' 子网格 / ' +
                parsed.submeshes.reduce((s, m) => s + m.vertexCount, 0) + ' 顶点 / ' +
                parsed.submeshes.reduce((s, m) => s + m.indexCount / 3, 0) + ' 三角形'
            );
            return parsed;
        })
        .catch((err) => {
            console.warn('[KspPartLoader] 加载失败 ' + objUrl + ': ' + err.message);
            return null;
        });

    _cache.set(key, promise);
    return promise;
}
