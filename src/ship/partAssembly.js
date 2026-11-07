'use strict';

// 部件系统 - 3D 积木拼装、径向对称、子树编辑、分级与工作区管理核心逻辑（纯逻辑层）

import { getPartType } from '../config/entities/partTypes.js';
import { getShipPreset } from '../config/entities/shipPresets.js';

const WORKSPACE_STORAGE_KEY = 'ksp2d_vab_workspaces';

/**
 * 深拷贝飞船设计对象。
 */
export function cloneDesign(design) {
    return JSON.parse(JSON.stringify(design));
}

/**
 * 创建预设飞船设计副本。
 */
export function createDefaultDesign(presetId = 'preset_k2_standard') {
    const preset = getShipPreset(presetId);
    return cloneDesign(preset.design);
}

/**
 * 新建空白工作区（仅含 1 个根指挥舱，类似 KSP 新建工作区）。
 */
export function createBlankDesign(rootTypeId = 'pod_mk1', name = '未命名飞行器') {
    const type = getPartType(rootTypeId) || getPartType('pod_mk1');
    return {
        name: name || '未命名飞行器',
        nextSeq: 2,
        parts: [
            {
                id: 'p1',
                typeId: type ? type.id : 'pod_mk1',
                parentId: null,
                attachMode: 'root',
                parentNodeId: null,
                selfNodeId: null,
                symmetryGroupId: null,
                symmetryCount: 1,
                stage: 0,
                position: [0, 0, 0],
                rotationY: 0
            }
        ]
    };
}

/**
 * 枚举当前设计中所有空闲可连接的轴向节点（世界坐标）。
 */
export function getFreeAttachNodes(design) {
    if (!design || !Array.isArray(design.parts)) return [];

    const occupied = new Set();
    for (const p of design.parts) {
        if (p.attachMode === 'node' && p.parentId && p.parentNodeId) {
            occupied.add(p.parentId + ':' + p.parentNodeId);
        }
    }

    const freeNodes = [];
    for (const part of design.parts) {
        const type = getPartType(part.typeId);
        if (!type || !Array.isArray(type.attachNodes)) continue;

        for (const node of type.attachNodes) {
            if (part.attachMode === 'node' && part.selfNodeId === node.id) {
                continue;
            }
            if (occupied.has(part.id + ':' + node.id)) {
                continue;
            }

            const c = Math.cos(part.rotationY || 0);
            const s = Math.sin(part.rotationY || 0);
            const lx = node.position[0] || 0;
            const ly = node.position[1] || 0;
            const lz = node.position[2] || 0;
            const wx = part.position[0] + c * lx + s * lz;
            const wy = part.position[1] + ly;
            const wz = part.position[2] - s * lx + c * lz;

            freeNodes.push({
                partId: part.id,
                partName: type.name,
                nodeId: node.id,
                worldPos: [wx, wy, wz],
                direction: [node.direction[0], node.direction[1], node.direction[2]],
                size: node.size || 1
            });
        }
    }
    return freeNodes;
}

/**
 * 计算新部件与目标空闲节点的轴向对接变换。
 */
export function computeNodeSnapPlacement(targetNode, newPartTypeId) {
    const newType = getPartType(newPartTypeId);
    if (!newType || !Array.isArray(newType.attachNodes) || !targetNode) return null;

    let matchedSelfNode = null;
    for (const sn of newType.attachNodes) {
        const dot =
            sn.direction[0] * targetNode.direction[0] +
            sn.direction[1] * targetNode.direction[1] +
            sn.direction[2] * targetNode.direction[2];
        if (dot < -0.95 && (sn.size || 1) === (targetNode.size || 1)) {
            matchedSelfNode = sn;
            break;
        }
    }
    if (!matchedSelfNode) return null;

    const pos = [
        targetNode.worldPos[0] - matchedSelfNode.position[0],
        targetNode.worldPos[1] - matchedSelfNode.position[1],
        targetNode.worldPos[2] - matchedSelfNode.position[2]
    ];

    return {
        valid: true,
        attachMode: 'node',
        parentId: targetNode.partId,
        parentName: targetNode.partName,
        parentNodeId: targetNode.nodeId,
        selfNodeId: matchedSelfNode.id,
        symmetryCount: 1,
        placements: [
            { position: pos, rotationY: 0 }
        ]
    };
}

/**
 * 计算新部件在父部件圆柱侧面的径向挂载变换（支持 1x/2x/3x/4x/6x/8x 环向对称 + 角度吸附开关）。
 */
export function computeSurfaceAttachPlacement(
    parentPart,
    localY,
    baseAngle,
    newPartTypeId,
    symmetryCount = 1,
    angleSnap = true
) {
    if (!parentPart) return null;
    const parentType = getPartType(parentPart.typeId);
    const newType = getPartType(newPartTypeId);
    if (!parentType || !newType) return null;

    const pCol = parentType.collider || {};
    const nCol = newType.collider || {};
    if (!pCol.allowSurfaceChildren || !nCol.allowSurfaceAttach) {
        return null;
    }

    const halfH = pCol.halfHeight || 0.5;
    const margin = Math.min(0.12, halfH * 0.25);
    let clampedY = Math.max(-halfH + margin, Math.min(halfH - margin, localY));
    if (angleSnap) {
        clampedY = Math.round(clampedY * 20) / 20; // 5cm 高度步进吸附
    }

    const parentR = pCol.radius || 0.5;
    const selfOffsetR = (nCol.srfAttachOffset && nCol.srfAttachOffset[0]) || nCol.radius || 0.3;
    const radialDist = parentR + selfOffsetR;

    const validSyms = [1, 2, 3, 4, 6, 8];
    const sym = validSyms.includes(symmetryCount) ? symmetryCount : 1;

    const snapStep = Math.PI / 12; // 15° 角度步进吸附
    const finalBaseAngle = angleSnap
        ? Math.round(baseAngle / snapStep) * snapStep
        : baseAngle;

    const placements = [];
    for (let k = 0; k < sym; k++) {
        const theta = finalBaseAngle + (k * Math.PI * 2) / sym;
        const wx = parentPart.position[0] + radialDist * Math.cos(theta);
        const wy = parentPart.position[1] + clampedY;
        const wz = parentPart.position[2] + radialDist * Math.sin(theta);
        placements.push({
            position: [
                Number(wx.toFixed(4)),
                Number(wy.toFixed(4)),
                Number(wz.toFixed(4))
            ],
            rotationY: -theta
        });
    }

    return {
        valid: true,
        attachMode: 'surface',
        parentId: parentPart.id,
        parentName: parentType.name,
        parentNodeId: null,
        selfNodeId: null,
        symmetryCount: sym,
        placements
    };
}

/**
 * 自动推算新部件的默认分级 Stage 编号。
 */
function inferDefaultStage(design, type) {
    if (!design || !Array.isArray(design.parts)) return 0;
    // 统计已有分离环数量决定当前级数
    let decouplerCount = 0;
    for (const p of design.parts) {
        if (p.typeId === 'struct_decoupler') decouplerCount++;
    }
    if (type && type.id === 'struct_decoupler') {
        return decouplerCount;
    }
    return decouplerCount;
}

/**
 * 将计算好的挂载方案正式写入飞船设计。
 */
export function attachPartToDesign(design, placementSpec, typeId) {
    if (!design || !placementSpec || !placementSpec.valid || !Array.isArray(placementSpec.placements)) {
        return { ok: false, addedPartIds: [] };
    }
    const type = getPartType(typeId);
    if (!type) return { ok: false, addedPartIds: [] };

    if (typeof design.nextSeq !== 'number' || design.nextSeq < 1) {
        design.nextSeq = design.parts.length + 1;
    }

    const symCount = placementSpec.placements.length;
    const symGroupId = symCount > 1 ? 'sym_' + design.nextSeq + '_' + Date.now().toString(36).slice(-4) : null;
    const defaultStage = inferDefaultStage(design, type);
    const addedPartIds = [];

    for (const pl of placementSpec.placements) {
        const partId = 'p' + (design.nextSeq++);
        const partInstance = {
            id: partId,
            typeId: type.id,
            parentId: placementSpec.parentId,
            attachMode: placementSpec.attachMode,
            parentNodeId: placementSpec.parentNodeId || null,
            selfNodeId: placementSpec.selfNodeId || null,
            symmetryGroupId: symGroupId,
            symmetryCount: symCount,
            stage: defaultStage,
            position: [pl.position[0], pl.position[1], pl.position[2]],
            rotationY: pl.rotationY || 0
        };

        // 初始化独立资源存量（供右键属性窗口调节液氢/液氧/氙气比例）
        if (type.resources) {
            partInstance.resourceAmounts = {};
            for (const [resId, slot] of Object.entries(type.resources)) {
                partInstance.resourceAmounts[resId] = Number(slot.amount) || 0;
            }
        }
        if (type.cargoCapacity > 0) {
            partInstance.cargoMass = 0;
        }
        if (type.engine) {
            partInstance.thrustLimit = 1.0;
        }

        design.parts.push(partInstance);
        addedPartIds.push(partId);
    }

    return { ok: true, addedPartIds };
}

/**
 * 根据选中的 partId 收集联动集合（含其对称组伙伴及所有后代子部件）。
 */
export function collectExpandedPartIds(design, partId) {
    const result = new Set();
    if (!design || !Array.isArray(design.parts) || !partId) return result;

    const target = design.parts.find(p => p.id === partId);
    if (!target) return result;

    if (!target.parentId || target.attachMode === 'root') {
        result.add(target.id);
        return result;
    }

    const queue = [];
    if (target.symmetryGroupId) {
        for (const p of design.parts) {
            if (p.symmetryGroupId === target.symmetryGroupId) {
                result.add(p.id);
                queue.push(p.id);
            }
        }
    } else {
        result.add(target.id);
        queue.push(target.id);
    }

    while (queue.length > 0) {
        const curId = queue.shift();
        for (const p of design.parts) {
            if (p.parentId === curId && !result.has(p.id)) {
                result.add(p.id);
                queue.push(p.id);
            }
        }
    }

    return result;
}

/**
 * 拆除指定部件（及其对称组伙伴与后代子树）。根部件受保护不可拆除。
 */
export function removePartSubtree(design, partId) {
    if (!design || !Array.isArray(design.parts) || !partId) {
        return { ok: false, removedCount: 0, reason: 'notFound' };
    }
    const target = design.parts.find(p => p.id === partId);
    if (!target) {
        return { ok: false, removedCount: 0, reason: 'notFound' };
    }
    if (!target.parentId || target.attachMode === 'root') {
        return { ok: false, removedCount: 0, reason: 'rootProtected' };
    }

    const toRemove = collectExpandedPartIds(design, partId);
    const before = design.parts.length;
    design.parts = design.parts.filter(p => !toRemove.has(p.id));
    const removedCount = before - design.parts.length;

    return { ok: removedCount > 0, removedCount, removedTypeId: target.typeId };
}

/**
 * 在平移微调模式（Offset Gizmo）下沿 Y 轴上下微调选中部件及其子树。
 */
export function nudgePartSubtreeY(design, partId, deltaY) {
    if (!design || !partId || !deltaY) return false;
    const target = design.parts.find(p => p.id === partId);
    if (!target || !target.parentId || target.attachMode === 'root') return false;

    const expanded = collectExpandedPartIds(design, partId);
    for (const p of design.parts) {
        if (expanded.has(p.id)) {
            p.position[1] = Number((p.position[1] + deltaY).toFixed(4));
        }
    }
    return true;
}

/**
 * 在旋转模式（Rotate Gizmo）下绕 Y 轴步进旋转选中部件（及其对称伙伴）。
 */
export function rotatePartSubtreeY(design, partId, deltaRad) {
    if (!design || !partId || !deltaRad) return false;
    const target = design.parts.find(p => p.id === partId);
    if (!target) return false;

    const ids = target.symmetryGroupId
        ? design.parts.filter(p => p.symmetryGroupId === target.symmetryGroupId).map(p => p.id)
        : [target.id];

    for (const p of design.parts) {
        if (ids.includes(p.id)) {
            p.rotationY = ((p.rotationY || 0) + deltaRad) % (Math.PI * 2);
        }
    }
    return true;
}

/**
 * 修改部件（及同对称组伙伴）的燃料存量、模拟货仓载荷、推力限制或分级。
 */
export function updatePartInspectorProperty(design, partId, propKey, value) {
    if (!design || !partId) return false;
    const target = design.parts.find(p => p.id === partId);
    if (!target) return false;
    const type = getPartType(target.typeId);
    if (!type) return false;

    const peers = target.symmetryGroupId
        ? design.parts.filter(p => p.symmetryGroupId === target.symmetryGroupId)
        : [target];

    for (const p of peers) {
        if (propKey.startsWith('res:')) {
            const resId = propKey.slice(4);
            const cap = (type.resources && type.resources[resId] && type.resources[resId].capacity) || 0;
            if (!p.resourceAmounts) p.resourceAmounts = {};
            p.resourceAmounts[resId] = Math.max(0, Math.min(cap, Number(value) || 0));
        } else if (propKey === 'cargoMass') {
            const cap = type.cargoCapacity || 0;
            p.cargoMass = Math.max(0, Math.min(cap, Number(value) || 0));
        } else if (propKey === 'thrustLimit') {
            p.thrustLimit = Math.max(0.05, Math.min(1.0, Number(value) || 1.0));
        } else if (propKey === 'stage') {
            p.stage = Math.max(0, Math.min(9, Math.round(Number(value) || 0)));
        }
    }
    return true;
}

/**
 * 校验并规范化外部导入的飞船设计 JSON。
 */
export function validateAndNormalizeDesign(input) {
    try {
        const raw = typeof input === 'string' ? JSON.parse(input) : input;
        const designObj = raw && raw.design ? raw.design : raw;
        if (!designObj || !Array.isArray(designObj.parts) || designObj.parts.length === 0) {
            return { ok: false, reason: 'emptyParts' };
        }

        const normalizedParts = [];
        let maxSeq = 1;
        for (let i = 0; i < designObj.parts.length; i++) {
            const p = designObj.parts[i];
            if (!p || !getPartType(p.typeId)) {
                return { ok: false, reason: 'unknownPartType' };
            }
            const pos = Array.isArray(p.position) && p.position.length === 3
                ? [Number(p.position[0]) || 0, Number(p.position[1]) || 0, Number(p.position[2]) || 0]
                : [0, 0, 0];
            const idStr = String(p.id || ('p' + (i + 1)));
            const m = idStr.match(/^p(\d+)$/);
            if (m) {
                maxSeq = Math.max(maxSeq, parseInt(m[1], 10) + 1);
            }
            const item = {
                id: idStr,
                typeId: p.typeId,
                parentId: i === 0 ? null : (p.parentId || normalizedParts[0].id),
                attachMode: i === 0 ? 'root' : (p.attachMode || 'node'),
                parentNodeId: p.parentNodeId || null,
                selfNodeId: p.selfNodeId || null,
                symmetryGroupId: p.symmetryGroupId || null,
                symmetryCount: Number(p.symmetryCount) || 1,
                stage: Number(p.stage) || 0,
                position: pos,
                rotationY: Number(p.rotationY) || 0
            };
            if (p.resourceAmounts && typeof p.resourceAmounts === 'object') {
                item.resourceAmounts = { ...p.resourceAmounts };
            }
            if (typeof p.cargoMass === 'number') {
                item.cargoMass = p.cargoMass;
            }
            if (typeof p.thrustLimit === 'number') {
                item.thrustLimit = p.thrustLimit;
            }
            normalizedParts.push(item);
        }

        return {
            ok: true,
            design: {
                name: String(designObj.name || '自定义飞行器'),
                nextSeq: Math.max(maxSeq, normalizedParts.length + 1),
                parts: normalizedParts
            }
        };
    } catch (e) {
        return { ok: false, reason: 'parseError' };
    }
}

// ==================== VAB 本地工作区存档管理 ====================

export function getSavedWorkspaces() {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

export function saveWorkspaceDesign(design) {
    if (!design || !Array.isArray(design.parts) || typeof localStorage === 'undefined') {
        return { ok: false };
    }
    try {
        const list = getSavedWorkspaces();
        const name = (design.name && design.name.trim()) ? design.name.trim() : '未命名飞行器';
        const copy = cloneDesign(design);
        copy.name = name;

        const existingIdx = list.findIndex(w => w.name === name);
        const entry = {
            id: existingIdx >= 0 ? list[existingIdx].id : ('ws_' + Date.now()),
            name,
            partCount: copy.parts.length,
            savedAt: Date.now(),
            design: copy
        };

        if (existingIdx >= 0) {
            list[existingIdx] = entry;
        } else {
            list.unshift(entry);
        }
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(list));
        return { ok: true, entry };
    } catch (e) {
        return { ok: false };
    }
}

export function deleteSavedWorkspace(workspaceId) {
    if (typeof localStorage === 'undefined') return false;
    try {
        const list = getSavedWorkspaces().filter(w => w.id !== workspaceId);
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(list));
        return true;
    } catch (e) {
        return false;
    }
}
