"use strict";

import assert from 'node:assert/strict';
import {
    applyEdit, beginCatalog, beginMove, beginPropertyEdit, cancelOperation,
    commitPlacement, commitPropertyEdit, createEditorSession, deleteSelection,
    getDisplayDesign, getPlacementDesign, previewPlacement, redoEdit, undoEdit,
    updatePropertyEdit
} from '../../src/partlab/editorTransactions.js';
import { createBlankDesign, updatePartInspectorProperty } from '../../src/ship/partAssembly.js';

let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log('PASS ' + name);
}

function part(id, parentId, position, rotationY, extra = {}) {
    return {
        id, typeId: 'tank_xenon_x200', parentId, position, rotationY,
        attachMode: 'surface', parentNodeId: null, selfNodeId: null,
        symmetryGroupId: null, symmetryCount: 1, stage: 3,
        resourceAmounts: { xenon: 200 }, cargoMass: 12,
        custom: { label: id, flags: [1, 2] }, ...extra
    };
}

function fixture(symmetry = false) {
    const design = createBlankDesign();
    design.nextSeq = 10;
    design.parts.push(
        part('p2', 'p1', [2, 0, 0], 0.3, symmetry ? { symmetryGroupId: 'pair', symmetryCount: 2 } : {}),
        part('p3', 'p2', [3, -1, 0], 0.7, {
            typeId: 'engine_lv909', attachMode: 'node', parentNodeId: 'bottom', selfNodeId: 'top',
            thrustLimit: 0.42, stage: 5
        }),
        part('p4', 'p3', [3, -2, 1], -0.1, {
            attachMode: 'node', parentNodeId: 'bottom', selfNodeId: 'top'
        })
    );
    if (symmetry) {
        design.parts.push(
            part('p5', 'p1', [-2, 0, 0], 0.3 + Math.PI, { symmetryGroupId: 'pair', symmetryCount: 2 }),
            part('p6', 'p5', [-3, -1, 0], 0.7 + Math.PI, {
                typeId: 'engine_lv909', attachMode: 'node', parentNodeId: 'bottom', selfNodeId: 'top',
                thrustLimit: 0.28, stage: 6
            })
        );
    }
    return design;
}

function surface(placements) {
    return { valid: true, parentId: 'p1', attachMode: 'surface', parentNodeId: null, selfNodeId: null, placements };
}

function node(parentId = 'p1', parentNodeId = 'bottom', selfNodeId = 'top') {
    return {
        valid: true, parentId, attachMode: 'node', parentNodeId, selfNodeId,
        placements: [{ position: [0, -2, 0], rotationY: 0 }]
    };
}

function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

test('move ordinary subtree preserves IDs, half fuel, thrust, stage and internal connections', () => {
    const original = fixture();
    const session = createEditorSession(original);
    assert.equal(beginMove(session, 'p2').ok, true);
    assert.deepEqual(session.held.rootIds, ['p2']);
    assert.equal(session.held.parts.length, 3);
    assert.notEqual(session.held.parts[0].custom, session.design.parts[1].custom);
    const spec = surface([{ position: [5, 4, 2], rotationY: 0.3 + Math.PI / 2 }]);
    assert.equal(commitPlacement(session, spec).selectedId, 'p2');
    const [root, child, grandchild] = session.design.parts.slice(1);
    assert.deepEqual(root.position, [5, 4, 2]);
    near(child.position[0], 5);
    near(child.position[1], 3);
    near(child.position[2], 1);
    near(grandchild.position[0], 6);
    near(grandchild.position[2], 1);
    for (let i = 1; i < original.parts.length; i++) {
        const { position, rotationY, ...before } = original.parts[i];
        const { position: newPosition, rotationY: newRotation, ...after } = session.design.parts[i];
        assert.deepEqual(after, before);
        near(newRotation - rotationY, Math.PI / 2);
    }
    assert.equal(session.design.nextSeq, original.nextSeq);
    assert.equal(session.undo.length, 1);
    assert.equal(session.held, null);
    const committed = structuredClone(session.design);
    assert.equal(undoEdit(session).ok, true);
    assert.deepEqual(session.design, original);
    assert.equal(redoEdit(session).ok, true);
    assert.deepEqual(session.design, committed);
});

test('symmetry roots and descendants rotate about their own roots; selected peer is first', () => {
    const original = fixture(true);
    const session = createEditorSession(original);
    beginMove(session, 'p5');
    assert.deepEqual(session.held.rootIds, ['p5', 'p2']);
    assert.equal(session.held.parts.length, 5);
    const angle = original.parts.find(item => item.id === 'p5').rotationY + Math.PI / 2;
    const spec = surface([
        { position: [-5, 1, 0], rotationY: angle },
        { position: [5, 1, 0], rotationY: angle + Math.PI }
    ]);
    assert.equal(commitPlacement(session, spec).ok, true);
    for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) {
        const before = original.parts.find(item => item.id === id);
        const after = session.design.parts.find(item => item.id === id);
        near(after.rotationY - before.rotationY, Math.PI / 2);
        assert.deepEqual(after.custom, before.custom);
        assert.deepEqual(after.resourceAmounts, before.resourceAmounts);
        assert.equal(after.thrustLimit, before.thrustLimit);
        assert.equal(after.stage, before.stage);
        assert.equal(after.parentId, before.parentId);
    }
    const child = session.design.parts.find(item => item.id === 'p6');
    near(child.position[0], -5);
    near(child.position[1], 0);
    near(child.position[2], 1);
    assert.equal(session.undo.length, 1);
});

test('putting symmetry group back in place preserves original orientation and makes no history', () => {
    const original = fixture(true);
    const session = createEditorSession(original);
    beginMove(session, 'p2');
    const spec = surface(session.held.rootIds.map(id => {
        const root = session.design.parts.find(item => item.id === id);
        return { position: [...root.position], rotationY: root.rotationY };
    }));
    assert.equal(commitPlacement(session, spec).changed, false);
    assert.deepEqual(session.design, original);
    assert.equal(session.undo.length, 0);
});

test('preview, placement filtering and cancel isolate the formal design and held copies', () => {
    const session = createEditorSession(fixture(true));
    const original = structuredClone(session.design);
    beginMove(session, 'p2');
    const before = structuredClone(session);
    const filtered = getPlacementDesign(session);
    assert.deepEqual(filtered.parts.map(item => item.id), ['p1']);
    filtered.parts[0].position[0] = 999;
    const spec = surface([
        { position: [5, 0, 0], rotationY: 1 },
        { position: [-5, 0, 0], rotationY: 1 + Math.PI }
    ]);
    const preview = previewPlacement(session, spec);
    assert.equal(preview.ok, true);
    assert.equal(preview.parts.length, 5);
    preview.parts[0].custom.flags.push(3);
    assert.deepEqual(session, before);
    assert.equal(cancelOperation(session), true);
    assert.deepEqual(session.design, original);
    assert.equal(cancelOperation(session), false);
    assert.equal(session.undo.length, 0);
});

test('catalog preview is deterministic, initializes resources and consumes sequence only on commit', () => {
    const session = createEditorSession(createBlankDesign());
    beginCatalog(session, 'tank_xenon_x200');
    const before = structuredClone(session);
    const spec = surface([
        { position: [1, 0, 0], rotationY: 0 },
        { position: [-1, 0, 0], rotationY: Math.PI }
    ]);
    const preview = previewPlacement(session, spec);
    assert.equal(preview.ok, true);
    assert.deepEqual(preview.parts, previewPlacement(session, spec).parts);
    assert.deepEqual(session, before);
    assert.equal(preview.parts[0].resourceAmounts.xenon, 400);
    assert.equal(preview.parts[0].symmetryCount, 2);
    assert.equal(preview.parts[0].symmetryGroupId, preview.parts[1].symmetryGroupId);
    assert.equal(commitPlacement(session, spec).ok, true);
    assert.equal(session.design.nextSeq, 4);
    assert.equal(session.undo.length, 1);
    assert.deepEqual(session.design.parts.slice(1), preview.parts);
});

test('invalid placements are atomic and never clear redo', () => {
    const session = createEditorSession(fixture(true));
    applyEdit(session, draft => { draft.name = 'changed'; });
    undoEdit(session);
    beginMove(session, 'p2');
    const valid = surface([
        { position: [2, 0, 0], rotationY: 0.3 },
        { position: [-2, 0, 0], rotationY: 0.3 + Math.PI }
    ]);
    const invalid = [null, { ...valid, placements: [] }, { ...valid, valid: false },
        { ...valid, placements: [valid.placements[0]] },
        { ...valid, parentId: 'missing' }, { ...valid, parentId: 'p4' },
        { ...valid, placements: [{ position: [NaN, 0, 0], rotationY: 0 }, valid.placements[1]] },
        { ...valid, placements: [{ position: [0, 0, 0], rotationY: Infinity }, valid.placements[1]] },
        { ...valid, placements: [{ position: [0, 0, 0] }, valid.placements[1]] },
        { ...valid, attachMode: 'node', parentNodeId: 'top', selfNodeId: 'top' }];
    const before = structuredClone(session);
    for (const spec of invalid) {
        const preview = previewPlacement(session, spec);
        assert.equal(preview.ok, false);
        assert.deepEqual(preview.parts, []);
        assert.equal(commitPlacement(session, spec).ok, false);
        assert.deepEqual(session, before);
    }
    cancelOperation(session);
    assert.equal(redoEdit(session).ok, true);
    assert.equal(session.design.name, 'changed');
});

test('catalog batch preserves default stages and accepts distinct per-placement nodes', () => {
    const session = createEditorSession(createBlankDesign());
    beginCatalog(session, 'struct_decoupler');
    const spec = node();
    spec.placements.push({ position: [0, 2, 0], rotationY: 0, parentNodeId: 'top', selfNodeId: 'bottom' });
    assert.equal(commitPlacement(session, spec).ok, true);
    assert.equal(session.design.parts[1].stage, session.design.parts[2].stage);
    assert.equal(session.design.parts[2].parentNodeId, 'top');
    assert.equal(session.design.parts[2].selfNodeId, 'bottom');
});

test('catalog empty, sparse, nonfinite and occupied placements preserve nextSeq and redo', () => {
    const session = createEditorSession(createBlankDesign());
    applyEdit(session, draft => { draft.name = 'next'; });
    undoEdit(session);
    beginCatalog(session, 'tank_fl_t200');
    const before = structuredClone(session);
    for (const spec of [
        { ...node(), placements: [] },
        { ...node(), placements: [{ position: new Array(3), rotationY: 0 }] },
        { ...node(), placements: [{ position: [Infinity, 0, 0], rotationY: 0 }] },
        { ...node(), placements: [node().placements[0], node().placements[0]] },
        node('missing')
    ]) {
        assert.equal(previewPlacement(session, spec).ok, false);
        assert.equal(commitPlacement(session, spec).ok, false);
        assert.deepEqual(session, before);
    }
});

test('node occupancy includes parent self-node and held internal nodes', () => {
    const session = createEditorSession(fixture());
    beginCatalog(session, 'tank_fl_t200');
    assert.equal(commitPlacement(session, node('p2', 'bottom')).reason, 'nodeUnavailable');
    assert.equal(commitPlacement(session, node('p3', 'top')).reason, 'nodeUnavailable');
    assert.equal(commitPlacement(session, node('p1', 'missing')).ok, false);
    assert.equal(commitPlacement(session, node('p1', 'top', 'missing')).reason, 'selfNodeNotFound');
    beginMove(session, 'p2');
    assert.equal(commitPlacement(session, node('p1', 'top', 'bottom')).reason, 'selfNodeOccupied');
    assert.equal(commitPlacement(session, node()).ok, true);
    assert.equal(session.design.parts[1].attachMode, 'node');
    assert.equal(session.design.parts[2].parentId, 'p2');
});

test('multiple roots use per-placement parent/node and reject the same target node', () => {
    const session = createEditorSession(fixture(true));
    // 第二枝的 bottom 必须空闲，才能与主船 top 面对面连接。
    session.design.parts = session.design.parts.filter(item => item.id !== 'p6');
    beginMove(session, 'p2');
    const spec = node();
    spec.placements.push({ position: [0, 2, 0], rotationY: Math.PI });
    assert.equal(commitPlacement(session, spec).reason, 'nodeUnavailable');
    spec.placements[1].parentId = 'p1';
    spec.placements[1].parentNodeId = 'top';
    spec.placements[1].selfNodeId = 'bottom';
    assert.equal(commitPlacement(session, spec).ok, true);
    assert.equal(session.design.parts.find(item => item.id === 'p5').parentNodeId, 'top');
    assert.equal(session.design.parts.find(item => item.id === 'p2').parentNodeId, 'bottom');
});

test('applyEdit failures, throws and no-ops preserve redo and discard candidate mutations', () => {
    const session = createEditorSession(fixture());
    applyEdit(session, draft => { draft.name = 'next'; });
    undoEdit(session);
    const before = structuredClone(session);
    for (const result of [false, { ok: false, reason: 'rejected' }]) {
        assert.equal(applyEdit(session, draft => {
            draft.parts[1].custom.flags.push(9);
            return result;
        }).ok, false);
        assert.deepEqual(session, before);
    }
    assert.equal(applyEdit(session, draft => {
        draft.name = 'discard';
        throw new Error('test');
    }).ok, false);
    assert.deepEqual(session, before);
    assert.equal(applyEdit(session, () => true).changed, false);
    assert.deepEqual(session, before);
    applyEdit(session, draft => { draft.name = 'replacement'; });
    assert.equal(session.redo.length, 0);
    assert.equal(session.undo.length, 1);
});

test('slider updates use draft only and commit as one undo entry', () => {
    const session = createEditorSession(fixture());
    const original = structuredClone(session.design);
    assert.equal(beginPropertyEdit(session).ok, true);
    for (const value of [0.5, 0.6, 0.7]) {
        assert.equal(updatePropertyEdit(session, draft =>
            updatePartInspectorProperty(draft, 'p3', 'thrustLimit', value)).ok, true);
        assert.deepEqual(session.design, original);
        assert.equal(getDisplayDesign(session).parts[2].thrustLimit, value);
        assert.equal(session.undo.length, 0);
    }
    const beforeFailure = structuredClone(session);
    assert.equal(updatePropertyEdit(session, draft => {
        draft.parts[2].thrustLimit = 0;
        return false;
    }).ok, false);
    assert.deepEqual(session, beforeFailure);
    assert.equal(commitPropertyEdit(session).changed, true);
    assert.equal(session.undo.length, 1);
    assert.equal(getDisplayDesign(session), session.design);
    undoEdit(session);
    assert.deepEqual(session.design, original);
    redoEdit(session);
    assert.equal(session.design.parts[2].thrustLimit, 0.7);
});

test('property cancel and no-op keep redo; undo/redo first cancel active operations', () => {
    const session = createEditorSession(fixture());
    applyEdit(session, draft => { draft.name = 'next'; });
    undoEdit(session);
    beginPropertyEdit(session);
    assert.equal(commitPropertyEdit(session).changed, false);
    assert.equal(session.redo.length, 1);
    beginPropertyEdit(session);
    updatePropertyEdit(session, draft => { draft.name = 'discard'; });
    assert.equal(redoEdit(session).cancelled, true);
    assert.equal(session.redo.length, 1);
    assert.notEqual(session.design.name, 'discard');
    beginCatalog(session, 'tank_fl_t200');
    assert.equal(redoEdit(session).cancelled, true);
    assert.equal(session.redo.length, 1);
    redoEdit(session);
    beginMove(session, 'p2');
    assert.equal(undoEdit(session).cancelled, true);
    assert.equal(session.design.name, 'next');
    assert.equal(session.undo.length, 1);
    undoEdit(session);
    assert.notEqual(session.design.name, 'next');
});

test('deleting held move removes the whole group, catalog delete only cancels', () => {
    const original = fixture(true);
    const session = createEditorSession(original);
    beginMove(session, 'p2');
    const result = deleteSelection(session, 'p1');
    assert.equal(result.removedCount, 5);
    assert.deepEqual(session.design.parts.map(item => item.id), ['p1']);
    assert.equal(session.undo.length, 1);
    assert.equal(session.held, null);
    undoEdit(session);
    assert.deepEqual(session.design, original);
    beginCatalog(session, 'tank_fl_t200');
    assert.equal(deleteSelection(session, 'p2').changed, false);
    assert.deepEqual(session.design, original);
    assert.equal(session.redo.length, 1);
    assert.equal(deleteSelection(session, 'p2').removedCount, 5);
    assert.equal(session.redo.length, 0);
});

test('root protection, missing parts, history limit and isolated input', () => {
    const original = fixture();
    const session = createEditorSession(original, 2);
    assert.equal(beginMove(session, 'p1').reason, 'rootProtected');
    assert.equal(deleteSelection(session, 'p1').reason, 'rootProtected');
    assert.equal(beginMove(session, 'missing').ok, false);
    assert.equal(beginCatalog(session, 'missing').ok, false);
    for (const name of ['one', 'two', 'three']) applyEdit(session, draft => { draft.name = name; });
    assert.equal(session.undo.length, 2);
    undoEdit(session);
    undoEdit(session);
    assert.equal(session.design.name, 'one');
    assert.equal(undoEdit(session).ok, false);
    redoEdit(session);
    redoEdit(session);
    assert.equal(session.design.name, 'three');
    assert.equal(session.undo.length, 2);
    assert.deepEqual(original, fixture());
    const noHistory = createEditorSession(original, 0);
    applyEdit(noHistory, draft => { draft.name = 'zero'; });
    assert.equal(noHistory.undo.length, 0);
});

console.log(`\n${passed} transaction tests passed.`);
