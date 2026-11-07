'use strict';

// 部件装配车间 - 3D 拾取与拖拽吸附解算器
// 支持：1) 已安装部件射线+屏幕线段混合命中；2) 轴向空闲节点屏幕吸附；3) 圆柱表面径向对称贴合。

import { getPartType } from '../config/entities/partTypes.js';
import { PART_LAB_CONFIG } from '../config/gameplay/partLabConfig.js';
import {
    projectToScreen,
    buildCameraRay,
    intersectRayCylinderY
} from '../ship/shipMath3D.js';
import {
    getFreeAttachNodes,
    computeNodeSnapPlacement,
    computeSurfaceAttachPlacement
} from '../ship/partAssembly.js';
import { getPartTypeMetrics } from '../ship/partPrimitives.js';

/**
 * 点到 2D 线段的最近距离。
 */
function distPointToSeg2D(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    let t = 0;
    if (lenSq > 1e-6) {
        t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    }
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    return { dist: Math.hypot(px - cx, py - cy), t };
}

/**
 * 拾取鼠标下的已安装 3D 部件（优先精确圆柱射线求交，辅以屏幕空间轴线段兜底）。
 * @param {object} design
 * @param {object} camera
 * @param {number} canvasX 画布物理像素 X
 * @param {number} canvasY 画布物理像素 Y
 * @param {number} canvasW 画布物理像素宽
 * @param {number} canvasH 画布物理像素高
 * @returns {object|null} 命中的 part 实例或 null
 */
export function pickInstalledPart(design, camera, canvasX, canvasY, canvasW, canvasH) {
    if (!design || !Array.isArray(design.parts) || design.parts.length === 0) return null;

    const ray = buildCameraRay(camera, canvasX, canvasY, canvasW, canvasH);
    let bestPart = null;
    let bestT = Infinity;

    for (const part of design.parts) {
        const type = getPartType(part.typeId);
        if (!type) continue;
        const metrics = getPartTypeMetrics(type);
        const hit = intersectRayCylinderY(
            ray.origin,
            ray.dir,
            part.position,
            Math.max(0.22, metrics.radius * 1.05),
            Math.max(0.18, metrics.halfHeight * 1.04)
        );
        if (hit && hit.t < bestT) {
            bestT = hit.t;
            bestPart = part;
        }
    }

    if (bestPart) return bestPart;

    // 屏幕空间轴线段兜底（防小部件点选困难）
    const viewProj = camera.getViewProjMatrix(canvasW, canvasH);
    const fovY = camera.getFovYRad();
    const minPx = (PART_LAB_CONFIG.picking && PART_LAB_CONFIG.picking.partRadiusMinPx) || 10;
    let bestDepth = Infinity;

    for (const part of design.parts) {
        const type = getPartType(part.typeId);
        if (!type) continue;
        const metrics = getPartTypeMetrics(type);
        const p = part.position;
        const hh = metrics.halfHeight;
        const a = projectToScreen(viewProj, [p[0], p[1] + hh, p[2]], canvasW, canvasH);
        const b = projectToScreen(viewProj, [p[0], p[1] - hh, p[2]], canvasW, canvasH);
        if (!a || !b) continue;

        const rPx = (metrics.radius / Math.max(0.5, a.depth)) * (canvasH / 2) / Math.tan(fovY / 2);
        const threshold = Math.max(rPx + 6, minPx);
        const segRes = distPointToSeg2D(canvasX, canvasY, a.x, a.y, b.x, b.y);
        const depth = a.depth + segRes.t * (b.depth - a.depth);
        if (segRes.dist <= threshold && depth < bestDepth) {
            bestDepth = depth;
            bestPart = part;
        }
    }

    return bestPart;
}

/**
 * 解算拖拽新部件时的吸附结果与 3D 预览坐标（轴向节点优先 → 圆柱表面径向对称次之 → 悬空跟随兜底）。
 * @param {object} design
 * @param {object} camera
 * @param {number} canvasX 画布物理像素 X
 * @param {number} canvasY 画布物理像素 Y
 * @param {number} canvasW 画布物理像素宽
 * @param {number} canvasH 画布物理像素高
 * @param {string} newPartTypeId 待安装部件类型 ID
 * @param {number} symmetryCount 当前对称模式 (1 | 2 | 4)
 * @returns {object}
 */
export function resolveDragPlacement(
    design,
    camera,
    canvasX,
    canvasY,
    canvasW,
    canvasH,
    newPartTypeId,
    symmetryCount = 1,
    angleSnap = true
) {
    const newType = getPartType(newPartTypeId);
    if (!newType) {
        return { valid: false, ghostParts: [], snapNodeScreen: null, placementSpec: null };
    }

    const viewProj = camera.getViewProjMatrix(canvasW, canvasH);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const snapRadiusPx = ((PART_LAB_CONFIG.picking && PART_LAB_CONFIG.picking.nodeSnapPx) || 42) * dpr;

    // 1. 优先检测空闲轴向连接点吸附
    const freeNodes = getFreeAttachNodes(design);
    let bestNode = null;
    let bestNodePlacement = null;
    let bestNodeScreen = null;
    let bestNodeDist = snapRadiusPx;

    for (const node of freeNodes) {
        const placement = computeNodeSnapPlacement(node, newPartTypeId);
        if (!placement || !placement.valid) continue;

        const scr = projectToScreen(viewProj, node.worldPos, canvasW, canvasH);
        if (!scr) continue;
        const dist = Math.hypot(canvasX - scr.x, canvasY - scr.y);
        if (dist <= bestNodeDist) {
            bestNodeDist = dist;
            bestNode = node;
            bestNodePlacement = placement;
            bestNodeScreen = scr;
        }
    }

    if (bestNode && bestNodePlacement) {
        return {
            valid: true,
            mode: 'node',
            targetName: bestNode.partName,
            nodeId: bestNode.nodeId,
            symmetryCount: 1,
            snapNodeScreen: bestNodeScreen,
            placementSpec: bestNodePlacement,
            ghostParts: bestNodePlacement.placements.map(pl => ({
                typeId: newPartTypeId,
                position: pl.position,
                rotationY: pl.rotationY,
                valid: true
            }))
        };
    }

    // 2. 若该部件支持径向表面挂载（allowSurfaceAttach），检测鼠标射线是否命中可挂载父部件侧面
    const ray = buildCameraRay(camera, canvasX, canvasY, canvasW, canvasH);
    if (newType.collider && newType.collider.allowSurfaceAttach) {
        let bestSrfPart = null;
        let bestSrfHit = null;
        let bestSrfT = Infinity;

        for (const part of design.parts) {
            const pType = getPartType(part.typeId);
            if (!pType || !pType.collider || !pType.collider.allowSurfaceChildren) continue;

            const hit = intersectRayCylinderY(
                ray.origin,
                ray.dir,
                part.position,
                pType.collider.radius || 0.625,
                pType.collider.halfHeight || 0.5
            );
            if (hit && !hit.hitCap && hit.t < bestSrfT) {
                bestSrfT = hit.t;
                bestSrfPart = part;
                bestSrfHit = hit;
            }
        }

        if (bestSrfPart && bestSrfHit) {
            const srfPlacement = computeSurfaceAttachPlacement(
                bestSrfPart,
                bestSrfHit.localY,
                bestSrfHit.angle,
                newPartTypeId,
                symmetryCount,
                angleSnap
            );
            if (srfPlacement && srfPlacement.valid) {
                return {
                    valid: true,
                    mode: 'surface',
                    targetName: srfPlacement.parentName,
                    nodeId: null,
                    symmetryCount: srfPlacement.symmetryCount,
                    snapNodeScreen: projectToScreen(viewProj, bestSrfHit.point, canvasW, canvasH),
                    placementSpec: srfPlacement,
                    ghostParts: srfPlacement.placements.map(pl => ({
                        typeId: newPartTypeId,
                        position: pl.position,
                        rotationY: pl.rotationY,
                        valid: true
                    }))
                };
            }
        }
    }

    // 3. 未命中有效连接点或表面：将红色半透明预览体投影到过相机焦点、垂直于视线的平面上
    const eye = camera.getPosition();
    const target = camera.getTarget();
    const distToTarget = Math.hypot(
        target[0] - eye[0],
        target[1] - eye[1],
        target[2] - eye[2]
    );
    const floatPos = [
        ray.origin[0] + ray.dir[0] * distToTarget,
        ray.origin[1] + ray.dir[1] * distToTarget,
        ray.origin[2] + ray.dir[2] * distToTarget
    ];

    return {
        valid: false,
        mode: 'none',
        targetName: null,
        nodeId: null,
        symmetryCount: 1,
        snapNodeScreen: null,
        placementSpec: null,
        ghostParts: [
            {
                typeId: newPartTypeId,
                position: floatPos,
                rotationY: 0,
                valid: false
            }
        ]
    };
}
