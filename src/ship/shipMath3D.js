'use strict';

// 3D 数学与几何求交工具（基于 glCore/matrix.js 扩展，严守不改动 vendored 镜像原则）

import {
    multiply4,
    identity4,
    orthographic,
    rotationX,
    rotationY,
    translation,
    scaling,
    normalMatrixFromModel
} from '../glCore/matrix.js';

export {
    multiply4,
    identity4,
    orthographic,
    rotationX,
    rotationY,
    translation,
    scaling,
    normalMatrixFromModel
};

/**
 * 绕 Z 轴旋转矩阵（列主序）。
 * @param {number} angle 弧度
 * @returns {Float32Array}
 */
export function rotationZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = identity4();
    out[0] = c;
    out[1] = s;
    out[4] = -s;
    out[5] = c;
    return out;
}

/**
 * 由位置 [x,y,z] 与绕 Y 轴旋转角 rotY 构造 4x4 模型矩阵：M = T(x,y,z) * Ry(rotY)。
 * @param {Array<number>} pos [x, y, z]
 * @param {number} [rotY=0] 弧度
 * @returns {Float32Array}
 */
export function modelMatrixFromPosRotY(pos, rotY = 0) {
    const c = Math.cos(rotY || 0);
    const s = Math.sin(rotY || 0);
    const out = new Float32Array(16);
    out[0] = c;
    out[2] = -s;
    out[5] = 1;
    out[8] = s;
    out[10] = c;
    out[12] = pos[0] || 0;
    out[13] = pos[1] || 0;
    out[14] = pos[2] || 0;
    out[15] = 1;
    return out;
}

/**
 * 透视投影矩阵（右手系，看向 -Z，深度 [-1, 1]），支持 NDC 横向偏移以避让两侧 UI 面板。
 * @param {number} fovYRad 垂直视场角（弧度）
 * @param {number} aspect 宽高比 (width / height)
 * @param {number} near 近裁剪面
 * @param {number} far 远裁剪面
 * @param {number} [centerXRatio=0.5] 视觉中心所在的水平屏幕比例 (0~1)
 * @returns {Float32Array}
 */
export function perspective(fovYRad, aspect, near, far, centerXRatio = 0.5) {
    const t = Math.tan(fovYRad / 2);
    const out = new Float32Array(16);
    const safeAspect = Math.max(1e-4, aspect || 1);
    const ratio = centerXRatio === undefined ? 0.5 : centerXRatio;
    out[0] = 1 / (safeAspect * t);
    out[5] = 1 / t;
    out[8] = -(ratio * 2 - 1);
    out[10] = -(far + near) / (far - near);
    out[11] = -1;
    out[14] = -(2 * far * near) / (far - near);
    return out;
}

/**
 * 视图矩阵（右手系，列主序）。
 * @param {Array<number>} eye 相机世界位置 [x, y, z]
 * @param {Array<number>} target 观察目标点 [x, y, z]
 * @param {Array<number>} [up=[0,1,0]] 上方向
 * @returns {Float32Array}
 */
export function lookAt(eye, target, up = [0, 1, 0]) {
    let fx = target[0] - eye[0];
    let fy = target[1] - eye[1];
    let fz = target[2] - eye[2];
    let len = Math.hypot(fx, fy, fz) || 1;
    fx /= len;
    fy /= len;
    fz /= len;

    let sx = fy * up[2] - fz * up[1];
    let sy = fz * up[0] - fx * up[2];
    let sz = fx * up[1] - fy * up[0];
    len = Math.hypot(sx, sy, sz) || 1;
    sx /= len;
    sy /= len;
    sz /= len;

    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;

    const out = new Float32Array(16);
    out[0] = sx;
    out[4] = sy;
    out[8] = sz;
    out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);

    out[1] = ux;
    out[5] = uy;
    out[9] = uz;
    out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);

    out[2] = -fx;
    out[6] = -fy;
    out[10] = -fz;
    out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];

    out[15] = 1;
    return out;
}

/**
 * 世界坐标点投影到画布物理像素坐标。
 * @param {Float32Array} viewProj 4x4 视图投影矩阵
 * @param {Array<number>} p 世界坐标 [x, y, z]
 * @param {number} canvasW 画布物理像素宽
 * @param {number} canvasH 画布物理像素高
 * @returns {{x:number, y:number, depth:number, ndcX:number, ndcY:number}|null}
 */
export function projectToScreen(viewProj, p, canvasW, canvasH) {
    const x = viewProj[0] * p[0] + viewProj[4] * p[1] + viewProj[8] * p[2] + viewProj[12];
    const y = viewProj[1] * p[0] + viewProj[5] * p[1] + viewProj[9] * p[2] + viewProj[13];
    const w = viewProj[3] * p[0] + viewProj[7] * p[1] + viewProj[11] * p[2] + viewProj[15];
    if (w <= 1e-5) return null;
    const ndcX = x / w;
    const ndcY = y / w;
    return {
        x: (ndcX * 0.5 + 0.5) * canvasW,
        y: (1 - (ndcY * 0.5 + 0.5)) * canvasH,
        depth: w,
        ndcX,
        ndcY
    };
}

/**
 * 从屏幕物理像素坐标与相机参数生成 3D 世界空间拾取射线（兼容 perspective 的 centerXRatio 横向偏移）。
 * @param {object} camera 轨道球相机实例
 * @param {number} screenX 画布物理像素 X
 * @param {number} screenY 画布物理像素 Y
 * @param {number} canvasW 画布物理像素宽
 * @param {number} canvasH 画布物理像素高
 * @returns {{origin: Array<number>, dir: Array<number>}}
 */
export function buildCameraRay(camera, screenX, screenY, canvasW, canvasH) {
    const eye = camera.getPosition();
    const target = camera.getTarget();
    const aspect = Math.max(1e-4, canvasW / Math.max(1, canvasH));
    const fovY = camera.getFovYRad();
    const tanHalfFov = Math.tan(fovY / 2);
    const centerXRatio = camera.getCenterXRatio ? camera.getCenterXRatio() : 0.5;
    const ndcOffsetX = ratioToNdcOffset(centerXRatio);

    const ndcX = (screenX / Math.max(1, canvasW)) * 2 - 1;
    const ndcY = 1 - (screenY / Math.max(1, canvasH)) * 2;

    // 由 clip.x = m[0]*x_e + m[8]*z_e 且 clip.w = -z_e 推得：ndcX = -m[0]*(x_e/z_e) - m[8]
    // 当 z_e = -1 时，x_e = (ndcX + m[8]) / m[0]，其中 m[8] = -ndcOffsetX
    const viewX = (ndcX - ndcOffsetX) * aspect * tanHalfFov;
    const viewY = ndcY * tanHalfFov;
    const viewZ = -1;

    // 相机正交基 (s, u, -f)
    let fx = target[0] - eye[0];
    let fy = target[1] - eye[1];
    let fz = target[2] - eye[2];
    let len = Math.hypot(fx, fy, fz) || 1;
    fx /= len;
    fy /= len;
    fz /= len;

    // up = [0, 1, 0]
    let sx = -fz;
    let sy = 0;
    let sz = fx;
    len = Math.hypot(sx, sy, sz) || 1;
    sx /= len;
    sy /= len;
    sz /= len;

    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;

    // 视空间 z_e = -1 对应世界空间前向 +f，故方向向量为 s*viewX + u*viewY + f
    let dx = sx * viewX + ux * viewY + fx;
    let dy = sy * viewX + uy * viewY + fy;
    let dz = sz * viewX + uz * viewY + fz;
    const dLen = Math.hypot(dx, dy, dz) || 1;
    return {
        origin: [eye[0], eye[1], eye[2]],
        dir: [dx / dLen, dy / dLen, dz / dLen]
    };
}

function ratioToNdcOffset(ratio) {
    return (ratio === undefined ? 0.5 : ratio) * 2 - 1;
}

/**
 * 射线与轴向对齐（Y 轴）有限圆柱体（含顶底圆盖）求交。
 * 用于：1) 3D 部件精确点选；2) 径向表面挂载的贴合点与方位角计算。
 * @param {Array<number>} ro 射线起点 [x,y,z]
 * @param {Array<number>} rd 射线单位方向 [dx,dy,dz]
 * @param {Array<number>} center 圆柱中心 [cx,cy,cz]
 * @param {number} radius 圆柱半径
 * @param {number} halfHeight 圆柱半高
 * @returns {{t:number, point:Array<number>, normal:Array<number>, localY:number, angle:number, hitCap:boolean}|null}
 */
export function intersectRayCylinderY(ro, rd, center, radius, halfHeight) {
    const ox = ro[0] - center[0];
    const oy = ro[1] - center[1];
    const oz = ro[2] - center[2];
    const dx = rd[0];
    const dy = rd[1];
    const dz = rd[2];

    let bestT = Infinity;
    let bestHit = null;

    // 1. 圆柱侧壁求交：x^2 + z^2 = R^2
    const a = dx * dx + dz * dz;
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - radius * radius;

    if (a > 1e-8) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const sqrtD = Math.sqrt(disc);
            const tCandidates = [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)];
            for (const t of tCandidates) {
                if (t > 1e-4 && t < bestT) {
                    const y = oy + t * dy;
                    if (y >= -halfHeight && y <= halfHeight) {
                        const hx = ox + t * dx;
                        const hz = oz + t * dz;
                        const angle = Math.atan2(hz, hx);
                        bestT = t;
                        bestHit = {
                            t,
                            point: [center[0] + hx, center[1] + y, center[2] + hz],
                            normal: [hx / radius, 0, hz / radius],
                            localY: y,
                            angle,
                            hitCap: false
                        };
                    }
                }
            }
        }
    }

    // 2. 顶底端盖求交
    if (Math.abs(dy) > 1e-8) {
        const caps = [
            { yCap: halfHeight, ny: 1 },
            { yCap: -halfHeight, ny: -1 }
        ];
        for (const cap of caps) {
            const t = (cap.yCap - oy) / dy;
            if (t > 1e-4 && t < bestT) {
                const hx = ox + t * dx;
                const hz = oz + t * dz;
                if (hx * hx + hz * hz <= radius * radius) {
                    bestT = t;
                    bestHit = {
                        t,
                        point: [center[0] + hx, center[1] + cap.yCap, center[2] + hz],
                        normal: [0, cap.ny, 0],
                        localY: cap.yCap,
                        angle: Math.atan2(hz, hx),
                        hitCap: true
                    };
                }
            }
        }
    }

    return bestHit;
}
