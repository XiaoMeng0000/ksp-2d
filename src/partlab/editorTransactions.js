"use strict";

import { getPartType } from '../config/entities/partTypes.js';
import { PART_LAB_CONFIG } from '../config/gameplay/partLabConfig.js';
import {
    attachPartToDesign,
    cloneDesign,
    collectExpandedPartIds,
    getFreeAttachNodes,
    removePartSubtree
} from '../ship/partAssembly.js';

export function createEditorSession(design, historyLimit = PART_LAB_CONFIG.editor.historyLimit) {
    return {
        design: cloneDesign(design),
        held: null,
        edit: null,
        undo: [],
        redo: [],
        historyLimit: Number.isFinite(historyLimit) ? Math.max(0, Math.floor(historyLimit)) : PART_LAB_CONFIG.editor.historyLimit
    };
}

function failure(reason) {
    return { ok: false, reason };
}

function sameDesign(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function acceptDesign(session, candidate) {
    if (sameDesign(session.design, candidate)) return { ok: true, changed: false };
    session.undo.push(cloneDesign(session.design));
    if (session.undo.length > session.historyLimit) {
        session.undo.splice(0, session.undo.length - session.historyLimit);
    }
    session.design = cloneDesign(candidate);
    session.redo.length = 0;
    return { ok: true, changed: true };
}

export function cancelOperation(session) {
    const cancelled = Boolean(session.held || session.edit);
    session.held = null;
    session.edit = null;
    return cancelled;
}

export function beginCatalog(session, typeId) {
    if (!getPartType(typeId)) return failure('unknownPartType');
    cancelOperation(session);
    session.held = {
        source: 'catalog', typeId, anchorId: null, parts: [], rootIds: [],
        excludedIds: [], pivot: [0, 0, 0]
    };
    return { ok: true };
}

export function beginMove(session, partId) {
    const anchor = session.design.parts.find(part => part.id === partId);
    if (!anchor) return failure('notFound');
    const ids = collectExpandedPartIds(session.design, partId);
    const parts = session.design.parts.filter(part => ids.has(part.id));
    if (parts.some(part => !part.parentId || part.attachMode === 'root')) {
        return failure('rootProtected');
    }
    const roots = parts.filter(part => !ids.has(part.parentId));
    // 首个 placement 对应所选根，其余根保持设计中的顺序。
    roots.sort((a, b) => Number(b.id === partId) - Number(a.id === partId));
    cancelOperation(session);
    session.held = {
        source: 'move', typeId: anchor.typeId, anchorId: partId,
        parts: cloneDesign(parts), rootIds: roots.map(part => part.id),
        excludedIds: [...ids], pivot: [...anchor.position]
    };
    return { ok: true, selectedId: partId };
}

export function getDisplayDesign(session) {
    return session.edit ? session.edit.draft : session.design;
}

export function getPlacementDesign(session) {
    const design = cloneDesign(session.design);
    const excluded = new Set(session.held ? session.held.excludedIds : []);
    design.parts = design.parts.filter(part => !excluded.has(part.id));
    return design;
}

function placementConnection(spec, placement) {
    return {
        parentId: placement.parentId === undefined ? spec.parentId : placement.parentId,
        attachMode: placement.attachMode === undefined ? spec.attachMode : placement.attachMode,
        parentNodeId: placement.parentNodeId === undefined ? spec.parentNodeId : placement.parentNodeId,
        selfNodeId: placement.selfNodeId === undefined ? spec.selfNodeId : placement.selfNodeId
    };
}

function validatePlacement(session, spec, design) {
    const held = session.held;
    if (!held) return failure('nothingHeld');
    if (!spec || spec.valid === false || !Array.isArray(spec.placements) || !spec.placements.length) {
        return failure('invalidPlacement');
    }
    if (held.source === 'move' && spec.placements.length !== held.rootIds.length) {
        return failure('rootCountMismatch');
    }
    const freeNodes = new Set(getFreeAttachNodes(design).map(node => JSON.stringify([node.partId, node.nodeId])));
    for (let index = 0; index < spec.placements.length; index++) {
        const placement = spec.placements[index];
        if (!placement || !Array.isArray(placement.position) || placement.position.length !== 3
            || ![0, 1, 2].every(axis => Number.isFinite(placement.position[axis]))
            || !Number.isFinite(placement.rotationY)) {
            return failure('invalidPose');
        }
        const connection = placementConnection(spec, placement);
        if (held.excludedIds.includes(connection.parentId)) return failure('selfAttachment');
        const parent = design.parts.find(part => part.id === connection.parentId);
        if (!parent) return failure('parentNotFound');
        const root = held.parts.find(part => part.id === held.rootIds[index]);
        const type = getPartType(root ? root.typeId : held.typeId);
        if (!type) return failure('unknownPartType');
        if (connection.attachMode === 'node') {
            const key = JSON.stringify([parent.id, connection.parentNodeId]);
            if (!freeNodes.has(key)) return failure('nodeUnavailable');
            const selfNode = type.attachNodes?.find(node => node.id === connection.selfNodeId);
            const parentNode = getPartType(parent.typeId)?.attachNodes?.find(node => node.id === connection.parentNodeId);
            if (!selfNode) {
                return failure('selfNodeNotFound');
            }
            if (!parentNode || selfNode.size !== parentNode.size) return failure('nodeSizeMismatch');
            const dot = selfNode.direction.reduce((sum, v, axis) => sum + v * parentNode.direction[axis], 0);
            if (dot > -0.95) return failure('nodeDirectionMismatch');
            if (root && held.parts.some(part => part.parentId === root.id
                && part.attachMode === 'node' && part.parentNodeId === connection.selfNodeId)) {
                return failure('selfNodeOccupied');
            }
            freeNodes.delete(key);
        } else if (connection.attachMode === 'surface') {
            if (!getPartType(parent.typeId)?.collider?.allowSurfaceChildren || !type.collider?.allowSurfaceAttach) {
                return failure('surfaceUnavailable');
            }
        } else {
            return failure('invalidAttachMode');
        }
    }
    return { ok: true };
}

function buildPlacement(session, spec) {
    const candidate = getPlacementDesign(session);
    const validation = validatePlacement(session, spec, candidate);
    if (!validation.ok) return validation;
    const held = session.held;
    let placedParts;
    if (held.source === 'catalog') {
        // 整批初始化，保留原 API 的资源、分级和对称组默认值。
        const firstSeq = candidate.nextSeq;
        const result = attachPartToDesign(candidate, { ...spec, valid: true }, held.typeId);
        if (!result.ok) return failure('attachFailed');
        placedParts = candidate.parts.filter(part => result.addedPartIds.includes(part.id));
        for (let index = 0; index < placedParts.length; index++) {
            const part = placedParts[index];
            const connection = placementConnection(spec, spec.placements[index]);
            Object.assign(part, connection, {
                parentNodeId: connection.parentNodeId || null,
                selfNodeId: connection.selfNodeId || null
            });
            // 不依赖时间，使相同输入的预览稳定且不消耗正式 nextSeq。
            part.symmetryGroupId = placedParts.length > 1 ? 'sym_editor_' + firstSeq : null;
            part.symmetryCount = placedParts.length;
        }
        if (new Set(candidate.parts.map(part => part.id)).size !== candidate.parts.length) {
            return failure('duplicatePartId');
        }
    } else {
        placedParts = cloneDesign(held.parts);
        const original = new Map(held.parts.map(part => [part.id, part]));
        const anchor = original.get(held.anchorId);
        // placement[0] 的角度是 anchor 的目标角度；整组共享角差，保留各枝原有朝向差。
        const delta = spec.placements[0].rotationY - (anchor.rotationY ?? 0);
        const cosine = Math.cos(delta);
        const sine = Math.sin(delta);
        const rootIndices = new Map(held.rootIds.map((id, index) => [id, index]));
        for (const part of placedParts) {
            let root = original.get(part.id);
            const visited = new Set();
            while (!rootIndices.has(root.id)) {
                if (visited.has(root.id) || !original.has(root.parentId)) return failure('invalidSubtree');
                visited.add(root.id);
                root = original.get(root.parentId);
            }
            const placement = spec.placements[rootIndices.get(root.id)];
            const dx = part.position[0] - root.position[0];
            const dy = part.position[1] - root.position[1];
            const dz = part.position[2] - root.position[2];
            // 零角差路径避免原位放回产生浮点扰动。
            part.position = delta === 0 && placement.position.every((value, axis) => value === root.position[axis])
                ? [...part.position]
                : [placement.position[0] + cosine * dx + sine * dz,
                    placement.position[1] + dy,
                    placement.position[2] - sine * dx + cosine * dz];
            part.rotationY = (part.rotationY ?? 0) + delta;
            if (part.id === root.id) {
                const connection = placementConnection(spec, placement);
                Object.assign(part, connection, {
                    parentNodeId: connection.parentNodeId || null,
                    selfNodeId: connection.selfNodeId || null
                });
            }
            if (!part.position.every(Number.isFinite) || !Number.isFinite(part.rotationY)) {
                return failure('invalidPose');
            }
        }
        // 保持原数组顺序，原位放回不制造虚假的历史记录。
        const replacements = new Map(placedParts.map(part => [part.id, part]));
        candidate.parts = session.design.parts.map(part => replacements.get(part.id) || cloneDesign(part));
    }
    return { ok: true, candidate, parts: placedParts, selectedId: held.anchorId || placedParts[0].id };
}

export function previewPlacement(session, spec) {
    const result = buildPlacement(session, spec);
    return result.ok ? { ok: true, parts: result.parts } : { ...result, parts: [] };
}

export function commitPlacement(session, spec) {
    const result = buildPlacement(session, spec);
    if (!result.ok) return result;
    const accepted = acceptDesign(session, result.candidate);
    cancelOperation(session);
    return { ...accepted, selectedId: result.selectedId };
}

function mutateCandidate(design, mutator) {
    const candidate = cloneDesign(design);
    try {
        const result = mutator(candidate);
        if (result === false || result?.ok === false) return failure(result?.reason || 'editRejected');
        return { ok: true, candidate };
    } catch (error) {
        return failure('editFailed');
    }
}

export function applyEdit(session, mutator) {
    if (session.held || session.edit) return failure('operationActive');
    const result = mutateCandidate(session.design, mutator);
    return result.ok ? acceptDesign(session, result.candidate) : result;
}

export function deleteSelection(session, partId) {
    if (session.held?.source === 'catalog') {
        cancelOperation(session);
        return { ok: true, changed: false, removedCount: 0 };
    }
    if (session.held?.source === 'move') {
        const candidate = getPlacementDesign(session);
        const removedCount = session.design.parts.length - candidate.parts.length;
        const result = acceptDesign(session, candidate);
        cancelOperation(session);
        return { ...result, removedCount };
    }
    if (session.edit) return failure('operationActive');
    let removal;
    const result = applyEdit(session, candidate => {
        removal = removePartSubtree(candidate, partId);
        return removal;
    });
    return { ...removal, ...result };
}

export function beginPropertyEdit(session) {
    if (session.held) return failure('operationActive');
    if (!session.edit) session.edit = { draft: cloneDesign(session.design) };
    return { ok: true };
}

export function updatePropertyEdit(session, mutator) {
    if (!session.edit) return failure('noPropertyEdit');
    const result = mutateCandidate(session.edit.draft, mutator);
    if (!result.ok) return result;
    const changed = !sameDesign(session.edit.draft, result.candidate);
    session.edit.draft = cloneDesign(result.candidate);
    return { ok: true, changed };
}

export function commitPropertyEdit(session) {
    if (!session.edit) return failure('noPropertyEdit');
    const result = acceptDesign(session, session.edit.draft);
    session.edit = null;
    return result;
}

export function undoEdit(session) {
    if (cancelOperation(session)) return { ok: true, changed: false, cancelled: true };
    if (!session.undo.length) return failure('nothingToUndo');
    session.redo.push(cloneDesign(session.design));
    session.design = session.undo.pop();
    return { ok: true, changed: true };
}

export function redoEdit(session) {
    if (cancelOperation(session)) return { ok: true, changed: false, cancelled: true };
    if (!session.redo.length) return failure('nothingToRedo');
    session.undo.push(cloneDesign(session.design));
    session.design = session.redo.pop();
    return { ok: true, changed: true };
}
