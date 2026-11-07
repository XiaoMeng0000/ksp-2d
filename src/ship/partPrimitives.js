'use strict';

// 部件系统 - 复合程序化 3D 几何体生成器（v3.1 高质感机械细节版）
// 支持子图元：cylinder（实心圆柱）、frustum（实心圆台）、hollowFrustum（双层薄壁镂空钟形喷管）、sphere（UV球）、box（长方体）。
// 顶点布局（11 floats）：POSITION(3f) + NORMAL(3f) + COLOR(3f) + MATERIAL(2f: [matId, param])
// 其中 matId 编码材质类型（供片元着色器生成蒙皮接缝、铆钉、波纹绝热层、拉丝金属、喷管烤蓝、褶皱金箔、防热瓦等程序化细节）。

export const PART_VERTEX_LAYOUT = [
    { name: 'POSITION', size: 3, type: 'float32' },
    { name: 'NORMAL',   size: 3, type: 'float32' },
    { name: 'COLOR',    size: 3, type: 'float32' },
    { name: 'MATERIAL', size: 2, type: 'float32' } // [matId, emissiveOrRoughness]
];

export const FLOATS_PER_VERTEX = 11;

// 材质类型枚举（与 shipShaders.js 一一对应）
export const MAT_TYPES = {
    HULL_PAINTED: 0.0,     // 航天漆面蒙皮（带环/纵拼缝、铆钉与微颗粒）
    HEAT_SHIELD:  1.0,     // 防热底盾 / 炭黑结构件（带蜂窝防热瓦网格与哑光炭化层）
    CRYO_FOAM:    2.0,     // 低温波纹绝热泡沫（带纵向凹凸加强筋波纹）
    METAL_RING:   3.0,     // 拉丝钛合金 / 钢箍法兰（高金属度 GGX + 环向车削纹 + 螺栓暗点）
    NOZZLE_BELL:  4.0,     // 发动机再生冷却喷管（密排冷却管凸棱 + 轴向高温回火烤蓝渐变）
    KAPTON_FOIL:  5.0,     // 多层褶皱金箔隔热膜（高频交叉折痕法线扰动）
    EMISSIVE_GLOW: 6.0     // 发光舷窗 / 等离子电离栅极 / 导航灯
};

// 端盖向体内微缩 2mm，彻底消除相邻部件端面共面时的 Z-fighting 闪烁
const CAP_EPS = 0.002;

const _metricsCache = new Map();

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * 校验几何网格的所有三角形绕序是否与顶点法线同向（CCW-outward 自检）。
 */
export function assertOutward(geometry) {
    if (!geometry || !geometry.vertices || !geometry.indices) return false;
    const v = geometry.vertices;
    const idx = geometry.indices;
    const fl = FLOATS_PER_VERTEX;
    for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * fl;
        const b = idx[i + 1] * fl;
        const d = idx[i + 2] * fl;
        const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
        const e2 = [v[d] - v[a], v[d + 1] - v[a + 1], v[d + 2] - v[a + 2]];
        const fn = cross3(e1, e2);
        if (dot3(fn, fn) < 1e-12) continue;
        const vn = [
            v[a + 3] + v[b + 3] + v[d + 3],
            v[a + 4] + v[b + 4] + v[d + 4],
            v[a + 5] + v[b + 5] + v[d + 5]
        ];
        if (dot3(fn, vn) <= 0) {
            return false;
        }
    }
    return true;
}

function resolveMatId(prim) {
    if (typeof prim.mat === 'number') return prim.mat;
    if (typeof prim.mat === 'string' && MAT_TYPES[prim.mat] !== undefined) {
        return MAT_TYPES[prim.mat];
    }
    if ((prim.emissive || 0) > 0.25) return MAT_TYPES.EMISSIVE_GLOW;
    if ((prim.specular || 0) >= 0.82) return MAT_TYPES.NOZZLE_BELL;
    if ((prim.specular || 0) >= 0.55) return MAT_TYPES.METAL_RING;
    return MAT_TYPES.HULL_PAINTED;
}

function pushVertex(verts, px, py, pz, nx, ny, nz, color, matId, emis) {
    verts.push(
        px, py, pz,
        nx, ny, nz,
        color[0], color[1], color[2],
        matId, emis
    );
}

/**
 * 追加「旋转成型（Lathe）」子图元：把 (半径, 高度) 二维剖面绕 Y 轴旋转成曲面。
 *
 * 这是硬表面部件最重要的原语 —— 有了它才能画出平滑的钟形喷管、穹顶封头、
 * 带倒角的法兰，而不是只能用直锥近似。
 *
 * 约定：
 *   - 开放剖面（options.closed = false）：必须**从上到下**排列（y 递减），法线朝外；
 *     端点半径 > 0 时可自动补平盖。
 *   - 闭合剖面（options.closed = true）：表示一圈薄壳（外壁→唇口→内壁→回到起点），
 *     自动统一为顺时针（(r,y) 平面上），使法线在内外壁都朝向正确一侧。
 *
 * @param {number[]} verts 顶点缓冲
 * @param {number[]} indices 索引缓冲
 * @param {Array<[number, number]>} profile 剖面点 [半径, 高度]
 * @param {number} segs 旋转分段数
 * @param {number[]} offset 平移 [x,y,z]
 * @param {number[]} color 基础色
 * @param {number} matId 材质 id
 * @param {number} emis 自发光强度
 * @param {object} [options] { closed, capTop, capBottom, normalSmooth }
 */
function appendLathe(verts, indices, profile, segs, offset, color, matId, emis, options = {}) {
    const ox = offset[0] || 0;
    const oy = offset[1] || 0;
    const oz = offset[2] || 0;
    const closed = options.closed === true;
    const pts = profile.map((p) => [Math.max(0, p[0]), p[1]]);

    if (pts.length < 2) return;

    // 闭合剖面统一成顺时针（(r,y) 平面）
    if (closed) {
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            area += a[0] * b[1] - b[0] * a[1];
        }
        if (area > 0) pts.reverse();
    }

    // 每个剖面点的平滑法线（在 (r,y) 平面内）
    // 拓扑顺序约定为「上→下」时外法线 = (-dy, dx)；
    // 闭合剖面已统一为顺时针，内外壁都能得到朝外一侧的法线。
    const n2d = [];
    for (let i = 0; i < pts.length; i++) {
        let dr;
        let dy;
        if (closed) {
            const prev = pts[(i - 1 + pts.length) % pts.length];
            const next = pts[(i + 1) % pts.length];
            dr = next[0] - prev[0];
            dy = next[1] - prev[1];
        } else if (i === 0) {
            dr = pts[1][0] - pts[0][0];
            dy = pts[1][1] - pts[0][1];
        } else if (i === pts.length - 1) {
            dr = pts[i][0] - pts[i - 1][0];
            dy = pts[i][1] - pts[i - 1][1];
        } else {
            dr = pts[i + 1][0] - pts[i - 1][0];
            dy = pts[i + 1][1] - pts[i - 1][1];
        }
        let nr = -dy;
        let ny = dr;
        const len = Math.hypot(nr, ny) || 1;
        n2d.push([nr / len, ny / len]);
    }

    // 生成环
    const ringCount = closed ? pts.length : pts.length;
    const base = Math.floor(verts.length / FLOATS_PER_VERTEX);
    for (let i = 0; i < ringCount; i++) {
        const r = pts[i][0];
        const y = pts[i][1];
        const nr = n2d[i][0];
        const ny = n2d[i][1];
        for (let j = 0; j <= segs; j++) {
            const theta = (j / segs) * Math.PI * 2;
            const cx = Math.cos(theta);
            const cz = Math.sin(theta);
            pushVertex(
                verts,
                ox + r * cx,
                oy + y,
                oz + r * cz,
                nr * cx,
                ny,
                nr * cz,
                color, matId, emis
            );
        }
    }

    // 连接相邻环（闭合剖面时最后一环连回第一环）
    const stride = segs + 1;
    const ringPairs = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < ringPairs; i++) {
        const i0 = base + i * stride;
        const i1 = base + ((i + 1) % pts.length) * stride;
        for (let j = 0; j < segs; j++) {
            const a = i0 + j;
            const b = i0 + j + 1;
            const c = i1 + j;
            const d = i1 + j + 1;
            indices.push(a, b, c);
            indices.push(c, b, d);
        }
    }

    // 开放剖面的端盖
    if (!closed) {
        const capTop = options.capTop !== false;
        const capBottom = options.capBottom !== false;
        if (capTop && pts[0][0] > 1e-4) {
            const yCap = pts[0][1] - CAP_EPS;
            const center = Math.floor(verts.length / FLOATS_PER_VERTEX);
            pushVertex(verts, ox, oy + yCap, oz, 0, 1, 0, color, matId, emis);
            for (let j = 0; j <= segs; j++) {
                const theta = (j / segs) * Math.PI * 2;
                pushVertex(
                    verts,
                    ox + pts[0][0] * Math.cos(theta),
                    oy + yCap,
                    oz + pts[0][0] * Math.sin(theta),
                    0, 1, 0,
                    color, matId, emis
                );
            }
            for (let j = 0; j < segs; j++) {
                indices.push(center, center + 1 + j + 1, center + 1 + j);
            }
        }
        const last = pts[pts.length - 1];
        if (capBottom && last[0] > 1e-4) {
            const yCap = last[1] + CAP_EPS;
            const center = Math.floor(verts.length / FLOATS_PER_VERTEX);
            pushVertex(verts, ox, oy + yCap, oz, 0, -1, 0, color, matId, emis);
            for (let j = 0; j <= segs; j++) {
                const theta = (j / segs) * Math.PI * 2;
                pushVertex(
                    verts,
                    ox + last[0] * Math.cos(theta),
                    oy + yCap,
                    oz + last[0] * Math.sin(theta),
                    0, -1, 0,
                    color, matId, emis
                );
            }
            for (let j = 0; j < segs; j++) {
                indices.push(center, center + 1 + j, center + 1 + j + 1);
            }
        }
    }
}

/**
 * 追加实心圆台/圆柱子图元（含顶底盖）。
 */
function appendFrustum(verts, indices, rTop, rBottom, height, segs, offset, color, matId, emis) {
    const ox = offset[0] || 0;
    const oy = offset[1] || 0;
    const oz = offset[2] || 0;
    const yTop = oy + height / 2;
    const yBot = oy - height / 2;

    const slopeLen = Math.hypot(height, rBottom - rTop) || 1;
    const ny = (rBottom - rTop) / slopeLen;
    const nr = height / slopeLen;

    const baseSide = Math.floor(verts.length / FLOATS_PER_VERTEX);
    for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        const cx = Math.cos(theta);
        const cz = Math.sin(theta);
        const nx = nr * cx;
        const nz = nr * cz;
        pushVertex(verts, ox + rTop * cx, yTop, oz + rTop * cz, nx, ny, nz, color, matId, emis);
        pushVertex(verts, ox + rBottom * cx, yBot, oz + rBottom * cz, nx, ny, nz, color, matId, emis);
    }

    for (let i = 0; i < segs; i++) {
        const t0 = baseSide + 2 * i;
        const b0 = baseSide + 2 * i + 1;
        const t1 = baseSide + 2 * i + 2;
        const b1 = baseSide + 2 * i + 3;
        indices.push(t0, t1, b0);
        indices.push(b0, t1, b1);
    }

    // 顶盖 (+Y)
    if (rTop > 1e-4) {
        const yCapTop = yTop - Math.min(CAP_EPS, height * 0.1);
        const centerTop = Math.floor(verts.length / FLOATS_PER_VERTEX);
        pushVertex(verts, ox, yCapTop, oz, 0, 1, 0, color, matId, emis);
        for (let i = 0; i <= segs; i++) {
            const theta = (i / segs) * Math.PI * 2;
            pushVertex(
                verts,
                ox + rTop * Math.cos(theta),
                yCapTop,
                oz + rTop * Math.sin(theta),
                0, 1, 0,
                color, matId, emis
            );
        }
        for (let i = 0; i < segs; i++) {
            indices.push(centerTop, centerTop + 1 + i + 1, centerTop + 1 + i);
        }
    }

    // 底盖 (-Y)
    if (rBottom > 1e-4) {
        const yCapBot = yBot + Math.min(CAP_EPS, height * 0.1);
        const centerBot = Math.floor(verts.length / FLOATS_PER_VERTEX);
        pushVertex(verts, ox, yCapBot, oz, 0, -1, 0, color, matId, emis);
        for (let i = 0; i <= segs; i++) {
            const theta = (i / segs) * Math.PI * 2;
            pushVertex(
                verts,
                ox + rBottom * Math.cos(theta),
                yCapBot,
                oz + rBottom * Math.sin(theta),
                0, -1, 0,
                color, matId, emis
            );
        }
        for (let i = 0; i < segs; i++) {
            indices.push(centerBot, centerBot + 1 + i, centerBot + 1 + i + 1);
        }
    }
}

/**
 * 追加双层薄壁镂空钟形喷管（Hollow Nozzle Bell）：
 * 外壁朝外（CCW），底部为环形薄壁唇口（无实心底盖），内壁朝向喷管轴心（法线朝内且从内腔看为 CCW），
 * 顶部喉道处封黑底，彻底消除发动机喷口“实心塑料桶”观感。
 */
function appendHollowFrustum(verts, indices, rTop, rBottom, height, segs, offset, color, matId, emis) {
    const ox = offset[0] || 0;
    const oy = offset[1] || 0;
    const oz = offset[2] || 0;
    const yTop = oy + height / 2;
    const yBot = oy - height / 2;
    const wallThick = Math.max(0.025, rBottom * 0.07);
    const rTopIn = Math.max(0.08, rTop - wallThick);
    const rBotIn = Math.max(0.12, rBottom - wallThick);

    const slopeLen = Math.hypot(height, rBottom - rTop) || 1;
    const nyOut = (rBottom - rTop) / slopeLen;
    const nrOut = height / slopeLen;

    // 1. 外壁（法线朝外）
    const baseOut = Math.floor(verts.length / FLOATS_PER_VERTEX);
    for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        const cx = Math.cos(theta);
        const cz = Math.sin(theta);
        pushVertex(verts, ox + rTop * cx, yTop, oz + rTop * cz, nrOut * cx, nyOut, nrOut * cz, color, matId, emis);
        pushVertex(verts, ox + rBottom * cx, yBot, oz + rBottom * cz, nrOut * cx, nyOut, nrOut * cz, color, matId, emis);
    }
    for (let i = 0; i < segs; i++) {
        const t0 = baseOut + 2 * i;
        const b0 = baseOut + 2 * i + 1;
        const t1 = baseOut + 2 * i + 2;
        const b1 = baseOut + 2 * i + 3;
        indices.push(t0, t1, b0);
        indices.push(b0, t1, b1);
    }

    // 2. 内腔壁（法线指向轴线内侧，颜色压暗模拟燃烧室烟炱与铜衬里）
    const innerColor = [color[0] * 0.42 + 0.06, color[1] * 0.35 + 0.04, color[2] * 0.30 + 0.02];
    const baseIn = Math.floor(verts.length / FLOATS_PER_VERTEX);
    for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        const cx = Math.cos(theta);
        const cz = Math.sin(theta);
        const nxIn = -nrOut * cx;
        const nyIn = -nyOut;
        const nzIn = -nrOut * cz;
        pushVertex(verts, ox + rTopIn * cx, yTop - 0.04, oz + rTopIn * cz, nxIn, nyIn, nzIn, innerColor, matId, emis);
        pushVertex(verts, ox + rBotIn * cx, yBot, oz + rBotIn * cz, nxIn, nyIn, nzIn, innerColor, matId, emis);
    }
    for (let i = 0; i < segs; i++) {
        const t0 = baseIn + 2 * i;
        const b0 = baseIn + 2 * i + 1;
        const t1 = baseIn + 2 * i + 2;
        const b1 = baseIn + 2 * i + 3;
        // 反向缠绕，使内壁在开启背面剔除时对相机可见
        indices.push(t0, b0, t1);
        indices.push(b0, b1, t1);
    }

    // 3. 底部喷口环形唇缘（连接外底环 rBottom 与内底环 rBotIn，法线 -Y）
    const baseRim = Math.floor(verts.length / FLOATS_PER_VERTEX);
    for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        const cx = Math.cos(theta);
        const cz = Math.sin(theta);
        pushVertex(verts, ox + rBottom * cx, yBot, oz + rBottom * cz, 0, -1, 0, color, MAT_TYPES.METAL_RING, 0);
        pushVertex(verts, ox + rBotIn * cx, yBot, oz + rBotIn * cz, 0, -1, 0, innerColor, MAT_TYPES.METAL_RING, 0);
    }
    for (let i = 0; i < segs; i++) {
        const o0 = baseRim + 2 * i;
        const i0 = baseRim + 2 * i + 1;
        const o1 = baseRim + 2 * i + 2;
        const i1 = baseRim + 2 * i + 3;
        // 从下方 (-Y) 看为逆时针 CCW
        indices.push(o0, i0, o1);
        indices.push(i0, i1, o1);
    }

    // 4. 喷管喉道深处挡板（位于 yTop - 0.04，法线 -Y，深炭黑）
    const throatCenter = Math.floor(verts.length / FLOATS_PER_VERTEX);
    const throatColor = [0.06, 0.05, 0.05];
    pushVertex(verts, ox, yTop - 0.04, oz, 0, -1, 0, throatColor, MAT_TYPES.HEAT_SHIELD, 0);
    for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        pushVertex(
            verts,
            ox + rTopIn * Math.cos(theta),
            yTop - 0.04,
            oz + rTopIn * Math.sin(theta),
            0, -1, 0,
            throatColor, MAT_TYPES.HEAT_SHIELD, 0
        );
    }
    for (let i = 0; i < segs; i++) {
        indices.push(throatCenter, throatCenter + 1 + i, throatCenter + 1 + i + 1);
    }
}

/**
 * 追加 UV 球体子图元（严格 CCW-outward）。
 */
function appendSphere(verts, indices, radius, segs, rings, offset, color, matId, emis) {
    const ox = offset[0] || 0;
    const oy = offset[1] || 0;
    const oz = offset[2] || 0;
    const base = Math.floor(verts.length / FLOATS_PER_VERTEX);

    for (let r = 0; r <= rings; r++) {
        const phi = (r / rings) * Math.PI;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        for (let s = 0; s <= segs; s++) {
            const theta = (s / segs) * Math.PI * 2;
            const nx = sinPhi * Math.cos(theta);
            const ny = cosPhi;
            const nz = sinPhi * Math.sin(theta);
            pushVertex(
                verts,
                ox + radius * nx,
                oy + radius * ny,
                oz + radius * nz,
                nx, ny, nz,
                color, matId, emis
            );
        }
    }

    const rowStride = segs + 1;
    for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segs; s++) {
            const p00 = base + r * rowStride + s;
            const p01 = p00 + 1;
            const p10 = base + (r + 1) * rowStride + s;
            const p11 = p10 + 1;
            if (r > 0) {
                indices.push(p00, p01, p10);
            }
            if (r < rings - 1) {
                indices.push(p10, p01, p11);
            }
        }
    }
}

/**
 * 追加长方体子图元。
 */
function appendBox(verts, indices, width, height, depth, offset, color, matId, emis) {
    const ox = offset[0] || 0;
    const oy = offset[1] || 0;
    const oz = offset[2] || 0;
    const hx = width / 2;
    const hy = height / 2;
    const hz = depth / 2;

    const faces = [
        { n: [0, 0, 1],  c: [[-hx, -hy,  hz], [ hx, -hy,  hz], [ hx,  hy,  hz], [-hx,  hy,  hz]] },
        { n: [0, 0, -1], c: [[ hx, -hy, -hz], [-hx, -hy, -hz], [-hx,  hy, -hz], [ hx,  hy, -hz]] },
        { n: [1, 0, 0],  c: [[ hx, -hy,  hz], [ hx, -hy, -hz], [ hx,  hy, -hz], [ hx,  hy,  hz]] },
        { n: [-1, 0, 0], c: [[-hx, -hy, -hz], [-hx, -hy,  hz], [-hx,  hy,  hz], [-hx,  hy, -hz]] },
        { n: [0, 1, 0],  c: [[-hx,  hy,  hz], [ hx,  hy,  hz], [ hx,  hy, -hz], [-hx,  hy, -hz]] },
        { n: [0, -1, 0], c: [[-hx, -hy, -hz], [ hx, -hy, -hz], [ hx, -hy,  hz], [-hx, -hy,  hz]] }
    ];

    for (const face of faces) {
        const base = Math.floor(verts.length / FLOATS_PER_VERTEX);
        for (const pt of face.c) {
            pushVertex(
                verts,
                ox + pt[0], oy + pt[1], oz + pt[2],
                face.n[0], face.n[1], face.n[2],
                color, matId, emis
            );
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
}

function computePrimitiveMassMetrics(prim) {
    const offset = prim.offset || [0, 0, 0];
    const type = prim.type || 'cylinder';
    if (type === 'cylinder') {
        const r = prim.radius || 0.5;
        const h = prim.height || 1.0;
        const vol = Math.PI * r * r * h;
        const unitMoi = (3 * r * r + h * h) / 12;
        return { vol, centroid: [offset[0], offset[1], offset[2]], unitMoi };
    }
    if (type === 'frustum' || type === 'hollowFrustum') {
        const r = prim.radiusTop !== undefined ? prim.radiusTop : 0.4;
        const R = prim.radiusBottom !== undefined ? prim.radiusBottom : 0.6;
        const h = prim.height || 1.0;
        const denom = Math.max(1e-6, R * R + R * r + r * r);
        const vol = (Math.PI * h / 3) * denom;
        const yBarFromBot = (h * (R * R + 2 * R * r + 3 * r * r)) / (4 * denom);
        const cy = offset[1] - h / 2 + yBarFromBot;
        const rMean = 0.5 * (R + r);
        const unitMoi = (3 * rMean * rMean + h * h) / 12;
        return { vol, centroid: [offset[0], cy, offset[2]], unitMoi };
    }
    if (type === 'sphere') {
        const r = prim.radius || 0.4;
        const vol = (4 / 3) * Math.PI * r * r * r;
        const unitMoi = (2 / 5) * r * r;
        return { vol, centroid: [offset[0], offset[1], offset[2]], unitMoi };
    }
    if (type === 'box') {
        const w = prim.width || 0.5;
        const h = prim.height || 0.5;
        const d = prim.depth || 0.5;
        const vol = w * h * d;
        const unitMoi = (w * w + h * h) / 12;
        return { vol, centroid: [offset[0], offset[1], offset[2]], unitMoi };
    }
    if (type === 'lathe') {
        // 旋转体：按剖面做圆盘积分求体积与形心（比包围盒准确得多）
        const pts = prim.profile || [[0.5, 0.5], [0.5, -0.5]];
        let vol = 0;
        let moment = 0;
        let rMax = 0;
        let yMin = Infinity;
        let yMax = -Infinity;
        const n = pts.length;
        const segs = prim.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            const r0 = a[0];
            const r1 = b[0];
            const y0 = a[1];
            const y1 = b[1];
            // 圆台微元体积 V = πh(r0² + r0·r1 + r1²)/3，形心在 y0 + h(r0²+2r0r1+3r1²)/(4(...))
            const denom = Math.max(1e-9, r0 * r0 + r0 * r1 + r1 * r1);
            const v = Math.PI * Math.abs(y1 - y0) * denom / 3;
            const yc = y0 + (y1 - y0) * ((r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1) / (4 * denom));
            vol += v;
            moment += v * yc;
            rMax = Math.max(rMax, r0, r1);
            yMin = Math.min(yMin, y0, y1);
            yMax = Math.max(yMax, y0, y1);
        }
        const cy = vol > 1e-9 ? (offset[1] + moment / vol) : offset[1];
        const rMean = rMax * 0.5;
        const h = (yMax - yMin) || 0.1;
        const unitMoi = (3 * rMean * rMean + h * h) / 12;
        return { vol: Math.max(vol, 1e-6), centroid: [offset[0], cy, offset[2]], unitMoi };
    }
    return { vol: 1, centroid: [offset[0], offset[1], offset[2]], unitMoi: 0.2 };
}

export function getPartTypeMetrics(partType) {
    if (!partType) {
        return { halfHeight: 0.5, radius: 0.5, centroid: [0, 0, 0], unitMoiZ: 0.2 };
    }
    if (_metricsCache.has(partType.id)) {
        return _metricsCache.get(partType.id);
    }

    // KSP2 贴图部件没有程序化图元，几何指标由配置显式给出（来自 OBJ 实测包围盒）
    if (partType.metrics) {
        const declared = {
            halfHeight: partType.metrics.halfHeight,
            radius: partType.metrics.radius,
            centroid: partType.metrics.centroid || [0, 0, 0],
            unitMoiZ: partType.metrics.unitMoiZ !== undefined ? partType.metrics.unitMoiZ : 0.25
        };
        _metricsCache.set(partType.id, declared);
        return declared;
    }

    const prims = (partType.visual && partType.visual.primitives) || [];
    let totalVol = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const subMetrics = [];

    for (const p of prims) {
        const m = computePrimitiveMassMetrics(p);
        subMetrics.push(m);
        totalVol += m.vol;
        cx += m.vol * m.centroid[0];
        cy += m.vol * m.centroid[1];
        cz += m.vol * m.centroid[2];
    }

    const centroid = totalVol > 1e-8 ? [cx / totalVol, cy / totalVol, cz / totalVol] : [0, 0, 0];

    let unitMoiZ = 0;
    if (totalVol > 1e-8) {
        for (const m of subMetrics) {
            const weight = m.vol / totalVol;
            const dx = m.centroid[0] - centroid[0];
            const dy = m.centroid[1] - centroid[1];
            unitMoiZ += weight * (m.unitMoi + dx * dx + dy * dy);
        }
    } else {
        unitMoiZ = 0.25;
    }

    const col = partType.collider || {};
    const metrics = {
        halfHeight: col.halfHeight || 0.5,
        radius: col.radius || 0.5,
        centroid,
        unitMoiZ
    };
    _metricsCache.set(partType.id, metrics);
    return metrics;
}

export function buildPartGeometry(partType, meshOptions) {
    const segs = (meshOptions && meshOptions.segments) || 32;
    const rings = (meshOptions && meshOptions.sphereRings) || 16;
    const prims = (partType && partType.visual && partType.visual.primitives) || [
        { type: 'cylinder', radius: 0.5, height: 1.0, offset: [0, 0, 0], color: [0.75, 0.78, 0.82], mat: 'HULL_PAINTED', emissive: 0.0 }
    ];

    const verts = [];
    const indices = [];

    for (const prim of prims) {
        const offset = prim.offset || [0, 0, 0];
        const color = prim.color || [0.75, 0.78, 0.82];
        const matId = resolveMatId(prim);
        const emis = prim.emissive !== undefined ? prim.emissive : 0.0;

        switch (prim.type) {
            case 'lathe':
                appendLathe(
                    verts, indices,
                    prim.profile || [[0.5, 0.5], [0.5, -0.5]],
                    segs, offset, color, matId, emis,
                    { closed: prim.closed === true, capTop: prim.capTop, capBottom: prim.capBottom }
                );
                break;
            case 'cylinder':
                appendFrustum(
                    verts, indices,
                    prim.radius || 0.5,
                    prim.radius || 0.5,
                    prim.height || 1.0,
                    segs, offset, color, matId, emis
                );
                break;
            case 'frustum':
                appendFrustum(
                    verts, indices,
                    prim.radiusTop !== undefined ? prim.radiusTop : 0.4,
                    prim.radiusBottom !== undefined ? prim.radiusBottom : 0.6,
                    prim.height || 1.0,
                    segs, offset, color, matId, emis
                );
                break;
            case 'hollowFrustum':
                appendHollowFrustum(
                    verts, indices,
                    prim.radiusTop !== undefined ? prim.radiusTop : 0.28,
                    prim.radiusBottom !== undefined ? prim.radiusBottom : 0.58,
                    prim.height || 0.75,
                    segs, offset, color, matId, emis
                );
                break;
            case 'sphere':
                appendSphere(
                    verts, indices,
                    prim.radius || 0.4,
                    segs, rings, offset, color, matId, emis
                );
                break;
            case 'box':
                appendBox(
                    verts, indices,
                    prim.width || 0.5,
                    prim.height || 0.5,
                    prim.depth || 0.5,
                    offset, color, matId, emis
                );
                break;
            default:
                appendFrustum(verts, indices, 0.5, 0.5, 1.0, segs, offset, color, matId, emis);
                break;
        }
    }

    const metrics = getPartTypeMetrics(partType);
    const vertexArray = new Float32Array(verts);
    const indexArray = verts.length / FLOATS_PER_VERTEX > 65535
        ? new Uint32Array(indices)
        : new Uint16Array(indices);

    return {
        layout: PART_VERTEX_LAYOUT,
        vertices: vertexArray,
        indices: indexArray,
        vertexCount: vertexArray.length / FLOATS_PER_VERTEX,
        halfHeight: metrics.halfHeight,
        radius: metrics.radius,
        centroid: metrics.centroid
    };
}
