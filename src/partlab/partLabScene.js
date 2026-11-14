'use strict';

// KSP 原版 VAB 风格 3D 部件装配车间场景主模块（v3.1）
// 核心升级：
//   1. KSP 原版「单击拿起 — 自由移动/转视角/切对称 — 单击安装」两步交互（同时兼容拖拽）
//   2. 3D 视口内右键单击部件弹出 KSP 部件属性检视窗（PAW：实时调节燃料、货仓配重、推力限制与分级）
//   3. 三心空间叠加渲染：质心（CoM 黄黑球）、推力中心与推力矢量轴线（CoT 品红球+箭头）、几何中心与节点（CoL 青球）
//   4. 工作区管理（新建 / 保存 / 打开列表）与发射前工程师适航检验

import { sceneManager } from '../sceneManager.js';
import { gameState } from '../gameState.js';
import { t } from '../config/ui/strings.js';
import { eventBus, Events } from '../eventBus.js';
import { cssToCanvas } from '../camera.js';
import { PART_TYPES, getPartType } from '../config/entities/partTypes.js';
import { PART_LAB_CONFIG } from '../config/gameplay/partLabConfig.js';
import { projectToScreen } from '../ship/shipMath3D.js';
import { buildPartGeometry, assertOutward } from '../ship/partPrimitives.js';
import {
    cloneDesign,
    createDefaultDesign,
    createBlankDesign,
    getFreeAttachNodes,
    computeNodeSnapPlacement,
    computeSurfaceAttachPlacement,
    collectExpandedPartIds,
    nudgePartSubtreeY,
    rotatePartSubtreeY,
    updatePartInspectorProperty,
    validateAndNormalizeDesign,
    getSavedWorkspaces,
    saveWorkspaceDesign,
    deleteSavedWorkspace
} from '../ship/partAssembly.js';
import { computeShipPhysics } from '../ship/partPhysics.js';
import {
    createEditorSession, beginCatalog, beginMove, getPlacementDesign,
    getDisplayDesign, previewPlacement, commitPlacement, cancelOperation,
    deleteSelection, applyEdit, beginPropertyEdit, updatePropertyEdit,
    commitPropertyEdit, undoEdit, redoEdit
} from './editorTransactions.js';
import { ShipRenderer3D } from '../ship/shipRenderer3D.js';
import { PartLabCamera } from './partLabCamera.js';
import { pickInstalledPart, resolveDragPlacement } from './partLabPicking.js';
import {
    initPartLabUI,
    destroyPartLabUI,
    setPartLabHint,
    closePartInspector,
    updatePartTileThumbnail,
    updateCursorGhost,
    hideCursorGhost,
    getPartLabViewportCenterRatio
} from './partLabUI.js';

let _canvas = null;
let _renderer3D = null;
let _camera = null;

let _currentPresetId = 'preset_k2_standard';
let _design = null;
let _physics = null;

let _gizmoMode = 'place'; // 'place' | 'offset' | 'rotate'
let _symmetryCount = 1;
let _angleSnap = true;
let _centersState = { com: true, cot: true, col: true };

let _selectedPartId = null;
let _selectedExpandedIds = new Set();
let _hoveredPartId = null;

// KSP 两步拿起态：非 null 时表示鼠标上正拎着一个待安装的零件
let _heldPartTypeId = null;
let _dragState = null;

let _bgCss = '#151b26';

// 相机拖拽状态：'IDLE' | 'ORBIT' | 'PAN'
let _camDragMode = 'IDLE';
let _pointerDownPos = { x: 0, y: 0 };
let _pointerDownButton = 0;
let _pointerMoved = false;
// 本帧指针是否真正转动/平移过相机（与「手持组件被拖动」区分开）。
let _cameraDragged = false;
// 本次按下后是否移动过（用于避免「点一下就被判为放歪」的噪音提示）。
let _movedSincePress = false;

// 鼠标悬停在 DOM 面板上时，3D 幽灵预览不绘制（避免零件飘在飞船旁造成误导）
let _ghostHiddenByUI = false;

let _boundHandlers = null;

// 本次 pointerdown 是否起始于左侧零件栏（用于区分「拖拽安装」与「单击安装」两种手势）
let _gestureFromPanel = false;
let _lastPointer = null;
let _canvasGesture = false;

function editorSession() {
    return gameState.getPartLabSession();
}

function notify(msg, type = 'info') {
    if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
        window.showNotification(msg, type, 2400);
    }
}

function clearHeldPreview() {
    _heldPartTypeId = null;
    _dragState = null;
    _ghostHiddenByUI = false;
    _gestureFromPanel = false;
    hideCursorGhost();
}

function finishForWorkspace() {
    const session = editorSession();
    if (!session) return;
    commitPropertyEdit(session);
    cancelOperation(session);
    clearHeldPreview();
    refreshDesignState();
}

function replaceWorkspace(design, resetHistory = false) {
    finishForWorkspace();
    if (resetHistory) {
        gameState.setPartLabSession(createEditorSession(design, PART_LAB_CONFIG.editor.historyLimit));
    } else {
        applyEdit(editorSession(), (draft) => {
            for (const key of Object.keys(draft)) delete draft[key];
            Object.assign(draft, cloneDesign(design));
        });
    }
    refreshDesignState(true);
    setSelection(null);
    closePartInspector();
}

function setSelection(partId, openInspector = false, screenX = 480, screenY = 240) {
    _selectedPartId = partId || null;
    _selectedExpandedIds = _selectedPartId
        ? collectExpandedPartIds(_design, _selectedPartId)
        : new Set();

    const part = (_design && _selectedPartId)
        ? _design.parts.find(p => p.id === _selectedPartId) || null
        : null;
    const partType = part ? getPartType(part.typeId) : null;

    eventBus.emit(Events.PARTLAB_SELECTION_CHANGED, {
        partId: _selectedPartId,
        part,
        partType,
        openInspector,
        screenX,
        screenY
    });
}

function refreshDesignState(autoFit = false, refreshInspector = false) {
    const session = editorSession();
    if (!session) return;
    _design = getDisplayDesign(session);
    _heldPartTypeId = session.held ? session.held.typeId : null;
    if (!_design) return;
    _physics = computeShipPhysics(_design);

    if (_selectedPartId && !_design.parts.some(p => p.id === _selectedPartId)) {
        _selectedPartId = null;
        _selectedExpandedIds = new Set();
    } else if (_selectedPartId) {
        _selectedExpandedIds = collectExpandedPartIds(_design, _selectedPartId);
    }

    if (autoFit && _camera && _physics.bounds) {
        _camera.fitToBounds(_physics.bounds, false);
    }

    eventBus.emit(Events.PARTLAB_DESIGN_CHANGED, {
        design: _design,
        physics: _physics,
        canUndo: !!session.held || !!session.edit || session.undo.length > 0,
        canRedo: !!session.held || !!session.edit || session.redo.length > 0,
        heldSource: session.held ? session.held.source : null,
        refreshInspector,
        symmetryCount: _symmetryCount,
        angleSnap: _angleSnap,
        heldPartTypeId: _heldPartTypeId,
        gizmoMode: _gizmoMode,
        presetId: _currentPresetId
    });
}

/**
 * KSP 原版交互：从左侧零件库单击拿起零件（或切换手上拿的零件）。
 */
function handlePickCatalogPart(typeId, pointerEvent) {
    const partType = getPartType(typeId);
    if (!partType || !_canvas || !_camera) return;

    commitPropertyEdit(editorSession());
    if (!beginCatalog(editorSession(), typeId).ok) return;
    closePartInspector();
    _heldPartTypeId = typeId;
    _gizmoMode = 'place';
    _pointerDownButton = 0;
    _canvasGesture = false;
    _pointerMoved = false;
    _camDragMode = 'IDLE';
    // 标记本次手势起始于零件栏：松手落在面板上时保持手持，不当作「丢弃」
    _gestureFromPanel = true;

    if (pointerEvent && typeof pointerEvent.clientX === 'number') {
        _lastPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY };
        updateHeldPreview();
    }

    refreshDesignState(false);
    updateCursorGhost(
        typeId,
        pointerEvent ? pointerEvent.clientX : window.innerWidth / 2,
        pointerEvent ? pointerEvent.clientY : window.innerHeight / 2,
        !!(_dragState && _dragState.valid)
    );
    setPartLabHint(
        `已拿起「${partType.name}」—— 移至飞船绿色节点或罐体侧面左键单击安装 · 按 X 切换对称 (${_symmetryCount}x) · 右键或 Esc 放下`,
        'info'
    );
}

function handleDiscardHeldPart() {
    if (!cancelOperation(editorSession())) return;
    clearHeldPreview();
    refreshDesignState(false, true);
    setSelection(_selectedPartId);
    setPartLabHint(t('partlab.editCanceled'), 'info');
}

/**
 * 将已安装在飞船上的非根部件整枝拆下并直接拿在鼠标上（KSP 拎起改装手感）。
 */
function handlePickupSelectedSubtree() {
    if (!_selectedPartId || !_design) return;
    const target = _design.parts.find(p => p.id === _selectedPartId);
    if (!target || !target.parentId || target.attachMode === 'root') {
        notify('根部件不可拆下移动', 'warning');
        return;
    }

    commitPropertyEdit(editorSession());
    const res = beginMove(editorSession(), _selectedPartId);
    if (res.ok) {
        closePartInspector();
        _heldPartTypeId = editorSession().held.typeId;
        _symmetryCount = editorSession().held.rootIds.length;
        refreshDesignState(false);
        updateHeldPreview();
        setPartLabHint(t('partlab.moveAssembly', { n: editorSession().held.parts.length }), 'info');
    }
}

/**
 * 一键智能安装部件（供测试脚本与快捷命令调用）。
 */
function handleQuickAttach(typeId) {
    const newType = getPartType(typeId);
    if (!newType || !_design) return;

    let placement = null;
    if (Array.isArray(newType.attachNodes) && newType.attachNodes.length > 0) {
        const freeNodes = getFreeAttachNodes(_design);
        const preferTop = newType.id === 'science_scanner_m700';
        freeNodes.sort((a, b) => preferTop
            ? (b.worldPos[1] - a.worldPos[1])
            : (a.worldPos[1] - b.worldPos[1]));

        for (const node of freeNodes) {
            const cand = computeNodeSnapPlacement(node, typeId);
            if (cand && cand.valid) {
                placement = cand;
                break;
            }
        }
    }

    if (!placement && newType.collider && newType.collider.allowSurfaceAttach) {
        for (const parentPart of _design.parts) {
            const srf = computeSurfaceAttachPlacement(parentPart, 0, 0, typeId, _symmetryCount, _angleSnap);
            if (srf && srf.valid) {
                placement = srf;
                break;
            }
        }
    }

    if (!placement || !placement.valid) {
        setPartLabHint('未找到匹配的连接节点或可挂载表面', 'danger');
        return;
    }

    commitPropertyEdit(editorSession());
    beginCatalog(editorSession(), typeId);
    const res = commitPlacement(editorSession(), placement);
    if (res.ok) {
        clearHeldPreview();
        refreshDesignState(true);
        setSelection(null);
        setPartLabHint(`已安装 ${newType.name}${placement.symmetryCount > 1 ? ' ×' + placement.symmetryCount : ''}`, 'ok');
    }
}

function handleDeleteSelected() {
    if (!editorSession()) return;
    commitPropertyEdit(editorSession());
    const before = editorSession().design.parts.length;
    const res = deleteSelection(editorSession(), _selectedPartId);
    if (res.ok) {
        clearHeldPreview();
        refreshDesignState(false, true);
        setSelection(null);
        setPartLabHint(t('partlab.hintDeleted', { count: before - _design.parts.length }), 'ok');
    }
}

function handleUndo() {
    undoEdit(editorSession());
    clearHeldPreview();
    refreshDesignState(false, true);
    setSelection(_selectedPartId);
}

function handleRedo() {
    redoEdit(editorSession());
    clearHeldPreview();
    refreshDesignState(false, true);
    setSelection(_selectedPartId);
}

function handleLoadPreset(presetId) {
    _currentPresetId = presetId || 'preset_k2_standard';
    replaceWorkspace(createDefaultDesign(_currentPresetId), true);
    if (_camera && _physics) {
        _camera.fitToBounds(_physics.bounds, true);
    }
    setPartLabHint(`已加载预设工作区：「${_design.name}」`, 'ok');
}

function handleNewWorkspace() {
    replaceWorkspace(createBlankDesign('pod_mk1', '未命名飞行器'));
    if (_camera && _physics) {
        _camera.fitToBounds(_physics.bounds, true);
    }
    setPartLabHint('已新建空白工作区（点击左侧燃料罐与引擎开始拼装）', 'ok');
    notify('已新建空白工作区', 'info');
}

function handleSaveWorkspace() {
    if (!_design) return;
    finishForWorkspace();
    const res = saveWorkspaceDesign(editorSession().design);
    if (res.ok) {
        setPartLabHint(`工作区「${res.entry.name}」已保存！可在右上角「📂 打开」中随时调出`, 'ok');
        notify(`已保存工作区：${res.entry.name}`, 'success');
    } else {
        notify('保存工作区失败', 'error');
    }
}

function handleLoadSavedWorkspace(wsId) {
    const list = getSavedWorkspaces();
    const found = list.find(w => w.id === wsId);
    if (!found || !found.design) return;
    replaceWorkspace(found.design);
    if (_camera && _physics) {
        _camera.fitToBounds(_physics.bounds, true);
    }
    setPartLabHint(`已加载保存的工作区：「${_design.name}」`, 'ok');
    notify(`已加载：${_design.name}`, 'success');
}

function handleDeleteSavedWorkspace(wsId) {
    deleteSavedWorkspace(wsId);
    notify('已删除工作区存档', 'info');
}

function handleLaunchVessel() {
    finishForWorkspace();
    if (!_physics || !_physics.engineerReport) return;
    const rep = _physics.engineerReport;
    if (!rep.canLaunch) {
        setPartLabHint('✕ 发射中止：飞行器未通过工程师适航校验，请查看右下角「工程师报告」修复红字故障', 'danger');
        notify('发射校验未通过：请检查右下角工程师报告！', 'error');
        return;
    }
    const msg = `🚀「${_design.name}」通过全部适航检验！总重 ${Math.round(_physics.wetMass)} kg · 真实 ΔV ${Math.round(_physics.deltaV)} m/s · TWR ${_physics.twr.toFixed(2)}（已自动保存到工作区）`;
    saveWorkspaceDesign(_design);
    setPartLabHint(msg, 'ok');
    notify(msg, 'success');
}

function handleGizmoStep(dir) {
    if (editorSession().held) return;
    commitPropertyEdit(editorSession());
    if (!_selectedPartId || !_design) {
        setPartLabHint('请先在 3D 飞船上左键点击选中一个非根部件，再执行平移或旋转微调', 'warn');
        return;
    }
    if (_gizmoMode === 'offset') {
        const result = applyEdit(editorSession(), draft => nudgePartSubtreeY(draft, _selectedPartId, dir * 0.10));
        if (result.ok) {
            refreshDesignState(false);
            setPartLabHint(`已沿轴向平移选中部件 ${dir > 0 ? '+0.10m' : '-0.10m'}`, 'ok');
        } else {
            setPartLabHint('根部件不可平移', 'warn');
        }
    } else if (_gizmoMode === 'rotate') {
        const stepRad = (dir * 15 * Math.PI) / 180;
        const result = applyEdit(editorSession(), draft => rotatePartSubtreeY(draft, _selectedPartId, stepRad));
        if (result.ok) {
            refreshDesignState(false);
            setPartLabHint(`已绕主轴旋转选中部件 ${dir > 0 ? '+15°' : '-15°'}`, 'ok');
        }
    }
}

function cycleSymmetry(step = 1) {
    if (editorSession().held?.source === 'move') {
        setPartLabHint(t('partlab.moveSymmetryFixed'), 'info');
        return;
    }
    const modes = PART_LAB_CONFIG.symmetryModes || [1, 2, 3, 4, 6, 8];
    const idx = modes.indexOf(_symmetryCount);
    const nextIdx = (idx + step + modes.length) % modes.length;
    _symmetryCount = modes[nextIdx];
    refreshDesignState(false);
    updateHeldPreview();
    setPartLabHint(`径向对称模式已切换为 ${_symmetryCount}x`, 'info');
}

function toggleAngleSnap() {
    _angleSnap = !_angleSnap;
    refreshDesignState(false);
    updateHeldPreview();
    setPartLabHint(_angleSnap ? '已开启 15° 角度与 5cm 高度步进吸附' : '已切换为自由连续无极挂载', 'info');
}

function handleExportJson() {
    if (!_design) return;
    finishForWorkspace();
    const text = JSON.stringify(editorSession().design, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            notify('飞船蓝图 JSON 已复制到剪贴板', 'success');
            setPartLabHint('飞船蓝图 JSON 已复制到剪贴板', 'ok');
        }).catch(() => {
            window.prompt('复制以下飞船蓝图 JSON：', text);
        });
    } else if (typeof window !== 'undefined') {
        window.prompt('复制以下飞船蓝图 JSON：', text);
    }
}

function handleImportJson() {
    if (typeof window === 'undefined') return;
    const raw = window.prompt('请粘贴飞船蓝图 JSON：', '');
    if (!raw || !raw.trim()) return;
    const res = validateAndNormalizeDesign(raw);
    if (!res.ok || !res.design) {
        notify('蓝图 JSON 格式无效', 'error');
        setPartLabHint('蓝图 JSON 格式无效，导入失败', 'danger');
        return;
    }
    replaceWorkspace(res.design);
    notify('飞船蓝图导入成功！', 'success');
    setPartLabHint(`已导入蓝图：「${_design.name}」`, 'ok');
}

/**
 * 把主船上的一枝直接拎在手上（供「按住拖动」与 Shift+单击快捷方式共用）。
 * @param {string} partId
 * @returns {boolean} 是否成功进入手持态
 */
function startMovePart(partId) {
    commitPropertyEdit(editorSession());
    const res = beginMove(editorSession(), partId);
    if (!res.ok) return false;
    closePartInspector();
    _heldPartTypeId = editorSession().held.typeId;
    _symmetryCount = editorSession().held.rootIds.length;
    refreshDesignState(false);
    updateHeldPreview();
    setPartLabHint(t('partlab.moveAssembly', { n: editorSession().held.parts.length }), 'info');
    return true;
}

function updateHeldPreview() {    const session = editorSession();
    if (!session?.held || !_camera || !_canvas) return;
    if (!_lastPointer) _lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = _canvas.getBoundingClientRect();
    const pt = cssToCanvas(_lastPointer.x - rect.left, _lastPointer.y - rect.top, _canvas);
    const held = session.held;
    _dragState = resolveDragPlacement(
        getPlacementDesign(session), _camera, pt.x, pt.y, _canvas.width, _canvas.height,
        held.typeId, held.source === 'move' ? held.rootIds.length : _symmetryCount, _angleSnap
    );
    if (held.source === 'move' && _dragState.mode === 'node') {
        // 当前轴向挂点均为±Y，轴向重挂不应抹掉用户绕Y的已有朝向。
        const anchor = held.parts.find(part => part.id === held.anchorId);
        _dragState.placementSpec.placements[0].rotationY = anchor.rotationY || 0;
    }
    const preview = _dragState.valid ? previewPlacement(session, _dragState.placementSpec) : null;
    if (preview?.ok) {
        _dragState.ghostParts = preview.parts.map(part => ({ ...part, valid: true }));
    } else {
        _dragState.valid = false;
        _dragState.reason = preview?.reason;
        // 无有效挂点也显示完整手持组件，而非仅显示根件。
        if (held.source === 'move') {
            const anchor = held.parts.find(part => part.id === held.anchorId);
            const target = _dragState.ghostParts[0]?.position || anchor.position;
            _dragState.ghostParts = held.parts.map(part => ({
                ...part,
                position: part.position.map((v, axis) => v + target[axis] - anchor.position[axis]),
                valid: false
            }));
        }
    }
    _ghostHiddenByUI = document.elementFromPoint(_lastPointer.x, _lastPointer.y) !== _canvas;
    if (_ghostHiddenByUI) updateCursorGhost(held.typeId, _lastPointer.x, _lastPointer.y, false);
    else hideCursorGhost();
}

function bindSceneInputs() {
    unbindSceneInputs();
    if (!_canvas) return;

    const onCanvasPointerDown = (e) => {
        _pointerDownPos = { x: e.clientX, y: e.clientY };
        _pointerDownButton = e.button;
        _pointerMoved = false;
        _cameraDragged = false;
        _movedSincePress = false;
        _gestureFromPanel = false;

        _canvasGesture = true;
        _lastPointer = { x: e.clientX, y: e.clientY };

        // 左键按下部件 = 立刻拎起（KSP 原版手感）；松手不放下，继续跟着光标。
        if (e.button === 0 && !_heldPartTypeId) {
            const rect = _canvas.getBoundingClientRect();
            const pt = cssToCanvas(e.clientX - rect.left, e.clientY - rect.top, _canvas);
            const hit = pickInstalledPart(_design, _camera, pt.x, pt.y, _canvas.width, _canvas.height);
            if (hit && hit.parentId && hit.attachMode !== 'root') {
                _canvasGesture = true;
                _camDragMode = 'IDLE';
                if (!startMovePart(hit.id)) {
                    _camDragMode = 'ORBIT';
                }
                return;
            }
        }

        // 左键拖拽或右键拖拽均可旋转相机；中键或 Shift+右键垂直平移相机焦点
        if (e.button === 1 || (e.button === 2 && e.shiftKey)) {
            _camDragMode = 'PAN';
        } else if (e.button === 0 || e.button === 2) {
            _camDragMode = 'ORBIT';
        }
    };

    const onWindowPointerMove = (e) => {
        if (!_canvas || !_camera) return;
        _lastPointer = { x: e.clientX, y: e.clientY };
        const rect = _canvas.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        const canvasPt = cssToCanvas(cssX, cssY, _canvas);

        if (!_movedSincePress) {
            const dx0 = e.clientX - _pointerDownPos.x;
            const dy0 = e.clientY - _pointerDownPos.y;
            if (Math.hypot(dx0, dy0) > PART_LAB_CONFIG.editor.dragThresholdPx) _movedSincePress = true;
        }

        if (_camDragMode === 'ORBIT') {
            const dx = e.clientX - _pointerDownPos.x;
            const dy = e.clientY - _pointerDownPos.y;
            if (Math.hypot(dx, dy) > PART_LAB_CONFIG.editor.dragThresholdPx) {
                _pointerMoved = true;
                _cameraDragged = true;
            }
            if (_pointerMoved) {
                _camera.rotate(dx, dy);
                _pointerDownPos = { x: e.clientX, y: e.clientY };
            }
        } else if (_camDragMode === 'PAN') {
            const dy = e.clientY - _pointerDownPos.y;
            if (Math.abs(dy) > 2) {
                _pointerMoved = true;
                _cameraDragged = true;
            }
            if (_pointerMoved) {
                _camera.panY(dy);
                _pointerDownPos = { x: e.clientX, y: e.clientY };
            }
        }

        // 若手上有拎着的零件，无论是否在转视角，实时解算 3D 吸附预览并同步鼠标幽灵徽标
        if (_heldPartTypeId) {
            updateHeldPreview();
            if (_dragState.valid) {
                if (_dragState.mode === 'node') {
                    setPartLabHint(
                        `✓ 轴向节点吸附：${_dragState.targetName} · ${_dragState.nodeId} —— 左键单击完成安装`,
                        'ok'
                    );
                } else {
                    setPartLabHint(
                        `✓ 径向表面挂载：${_dragState.targetName} (${_dragState.symmetryCount}x 环向对称) —— 左键单击完成安装`,
                        'ok'
                    );
                }
            } else {
                const pt = getPartType(_heldPartTypeId);
                setPartLabHint(
                    `正在放置「${pt ? pt.name : _heldPartTypeId}」—— 移至飞船绿圈节点或罐体侧面吸附（右键放下）`,
                    'warn'
                );
            }
            return;
        }

        // 未拿零件时更新 3D 部件悬停高亮
        if (e.target === _canvas && _camDragMode === 'IDLE') {
            const hit = pickInstalledPart(
                _design,
                _camera,
                canvasPt.x,
                canvasPt.y,
                _canvas.width,
                _canvas.height
            );
            _hoveredPartId = hit ? hit.id : null;
        } else if (e.target !== _canvas) {
            _hoveredPartId = null;
        }
    };

    const onWindowPointerUp = (e) => {
        const fromPanel = _gestureFromPanel;
        _gestureFromPanel = false;
        const fromCanvas = _canvasGesture;
        _canvasGesture = false;
        if (!_canvas || !_camera) {
            _camDragMode = 'IDLE';
            return;
        }

        const btn = _pointerDownButton;
        // 只有真正转动/平移过相机才算「拖了相机」；
        // 按住部件拖动改名的是手持组件，松手必须继续走放置流程。
        const cameraDragged = fromCanvas && _cameraDragged;
        _camDragMode = 'IDLE';

        if (cameraDragged || (!fromPanel && !fromCanvas)) return;
        _lastPointer = { x: e.clientX, y: e.clientY };

        const rect = _canvas.getBoundingClientRect();
        const pt = cssToCanvas(e.clientX - rect.left, e.clientY - rect.top, _canvas);

        // 1. 手上拎着零件时的松手行为
        //    支持两种 KSP 手感：
        //      a) 从零件栏按住直接拖到 3D 视口松手 → 立即安装
        //      b) 单击零件栏拿起 → 移动鼠标 → 在 3D 视口单击 → 安装
        if (_heldPartTypeId) {
            const hitUI = document.elementFromPoint(e.clientX, e.clientY) !== _canvas;

            if (btn === 2) {
                // 右键单击放下手上的零件
                handleDiscardHeldPart();
                return;
            }
            if (btn === 0) {
                if (hitUI) {
                    // 面板与工具栏交互不隐式取消或删除组件。
                    return;
                }
                // 松手落在 3D 视口：用最新指针位置重新解算一次后尝试安装
                updateHeldPreview();
                if (_dragState && _dragState.valid && _dragState.placementSpec) {
                    const partType = getPartType(_heldPartTypeId);
                    const res = commitPlacement(editorSession(), _dragState.placementSpec);
                    if (res.ok) {
                        const attachedSym = _dragState.symmetryCount || 1;
                        clearHeldPreview();
                        refreshDesignState(false);
                        // 放置完成后不自动选中：按 KSP 习惯，落件即结束本次操作，
                        // 想调整属性时再右键该部件（避免还要额外点一下空白处取消高亮）。
                        setSelection(null);
                        setPartLabHint(
                            `✓ 已安装 ${partType ? partType.name : ''}${attachedSym > 1 ? ' ×' + attachedSym : ''}（右键点击部件可调燃料/配重）`,
                            'ok'
                        );
                    }
                } else if (_movedSincePress) {
                    // 只有真的拖过鼠标才提示「放歪了」；点一下不该刷红字。
                    setPartLabHint('当前位置无法安装：请对准飞船绿色连接点或允许侧面挂载的舱段（右键取消）', 'danger');
                }
            }
            return;
        }

        // 2. 手上未拎零件时：仅在画布上点选/右键部件
        if (e.target !== _canvas) return;
        if (_pointerMoved) return;

        const hitPart = pickInstalledPart(
            _design,
            _camera,
            pt.x,
            pt.y,
            _canvas.width,
            _canvas.height
        );

        if (btn === 0) {
            // Shift + 左键单击非根部件：直接拆下并拎在手上改装（KSP 快捷手感）
            if (hitPart && e.shiftKey && hitPart.parentId && hitPart.attachMode !== 'root') {
                setSelection(hitPart.id, false);
                handlePickupSelectedSubtree();
                return;
            }
            closePartInspector();
            setSelection(hitPart ? hitPart.id : null, false);
            if (hitPart) {
                const pType = getPartType(hitPart.typeId);
                setPartLabHint(
                    `已选中「${pType ? pType.name : hitPart.id}」—— 右键点击打开属性滑块 · Shift+左键直接拎起改装 · Del 拆除`,
                    'ok'
                );
            }
        } else if (btn === 2) {
            // 右键单击已安装部件：打开 KSP 右键属性检视窗 (PAW)
            if (hitPart) {
                setSelection(hitPart.id, true, e.clientX, e.clientY);
            } else {
                closePartInspector();
            }
        }
    };

    const onCanvasWheel = (e) => {
        e.preventDefault();
        if (_camera) {
            _camera.zoomByWheel(e);
            updateHeldPreview();
        }
    };

    const onCanvasContextMenu = (e) => {
        e.preventDefault();
    };

    const onWindowKeyDown = (e) => {
        if (e.key === 'Escape' && (editorSession().held || editorSession().edit)) {
            e.preventDefault();
            handleDiscardHeldPart();
            return;
        }
        // 输入框聚焦时不拦截键盘快捷键
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            return;
        }
        if (e.key === 'Escape') {
            if (_heldPartTypeId) {
                handleDiscardHeldPart();
                return;
            }
            closePartInspector();
            sceneManager.switchToAsync('menu');
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            closePartInspector();
            handleDeleteSelected();
            return;
        }
        if (e.code === 'KeyX' && !e.ctrlKey && !e.metaKey) {
            cycleSymmetry(e.shiftKey ? -1 : 1);
            return;
        }
        if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
            toggleAngleSnap();
            return;
        }
        if (e.code === 'Digit1') {
            _gizmoMode = 'place';
            refreshDesignState(false);
            return;
        }
        if (e.code === 'Digit2') {
            _gizmoMode = 'offset';
            refreshDesignState(false);
            return;
        }
        if (e.code === 'Digit3') {
            _gizmoMode = 'rotate';
            refreshDesignState(false);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
            e.preventDefault();
            if (e.shiftKey) handleRedo();
            else handleUndo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
            e.preventDefault();
            handleRedo();
        }
    };

    const onCancelGesture = () => {
        _canvasGesture = false;
        _gestureFromPanel = false;
        _camDragMode = 'IDLE';
        if (editorSession()?.held || editorSession()?.edit) handleDiscardHeldPart();
    };

    _canvas.addEventListener('pointerdown', onCanvasPointerDown);
    _canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    _canvas.addEventListener('contextmenu', onCanvasContextMenu);
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('pointercancel', onCancelGesture);
    window.addEventListener('blur', onCancelGesture);

    _boundHandlers = {
        onCanvasPointerDown,
        onCanvasWheel,
        onCanvasContextMenu,
        onWindowPointerMove,
        onWindowPointerUp,
        onWindowKeyDown,
        onCancelGesture
    };
}

function unbindSceneInputs() {
    if (!_boundHandlers) return;
    if (_canvas) {
        _canvas.removeEventListener('pointerdown', _boundHandlers.onCanvasPointerDown);
        _canvas.removeEventListener('wheel', _boundHandlers.onCanvasWheel);
        _canvas.removeEventListener('contextmenu', _boundHandlers.onCanvasContextMenu);
    }
    window.removeEventListener('pointermove', _boundHandlers.onWindowPointerMove);
    window.removeEventListener('pointerup', _boundHandlers.onWindowPointerUp);
    window.removeEventListener('keydown', _boundHandlers.onWindowKeyDown);
    window.removeEventListener('pointercancel', _boundHandlers.onCancelGesture);
    window.removeEventListener('blur', _boundHandlers.onCancelGesture);
    _boundHandlers = null;
}
/**
 * 绘制 KSP 经典三心（质心 CoM / 推力中心与推力轴线 CoT / 几何中心与空闲连接点 CoL）空间叠加层。
 */
function drawWorldOverlays(ctx) {
    if (!_canvas || !_camera || !_design) return;

    const W = _canvas.width;
    const H = _canvas.height;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const viewProj = _camera.getViewProjMatrix(W, H);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. 几何中心（CoL 青球）与空闲轴向连接节点绿圈
    if (_centersState.col) {
        const freeNodes = getFreeAttachNodes(editorSession().held ? getPlacementDesign(editorSession()) : _design);
        for (const node of freeNodes) {
            const scr = projectToScreen(viewProj, node.worldPos, W, H);
            if (!scr) continue;
            ctx.beginPath();
            ctx.arc(scr.x, scr.y, 5.5 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(60, 240, 130, 0.28)';
            ctx.fill();
            ctx.lineWidth = 1.6 * dpr;
            ctx.strokeStyle = 'rgba(90, 255, 155, 0.88)';
            ctx.stroke();
        }

        if (_physics && _physics.col) {
            const colScr = projectToScreen(viewProj, _physics.col, W, H);
            if (colScr) {
                const r = 6.5 * dpr;
                ctx.beginPath();
                ctx.arc(colScr.x, colScr.y, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(56, 232, 255, 0.26)';
                ctx.fill();
                ctx.lineWidth = 1.8 * dpr;
                ctx.strokeStyle = '#38e8ff';
                ctx.stroke();
            }
        }
    }

    // 2. 拖拽/拿起零件吸附命中脉冲圈
    if (_heldPartTypeId && _dragState && _dragState.snapNodeScreen) {
        const s = _dragState.snapNodeScreen;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 13.5 * dpr, 0, Math.PI * 2);
        ctx.lineWidth = 2.4 * dpr;
        ctx.strokeStyle = 'rgba(60, 255, 120, 0.98)';
        ctx.stroke();
    }

    // 3. 推力中心（CoT 品红球 + 推力轴线箭头）
    if (_centersState.cot && _physics && _physics.cot && _physics.cot.hasThrust) {
        const p0 = _physics.cot.pos;
        const p1 = [p0[0], p0[1] - 1.65, p0[2]]; // 喷气方向朝下 (-Y)，推力轴线清晰延伸
        const s0 = projectToScreen(viewProj, p0, W, H);
        const s1 = projectToScreen(viewProj, p1, W, H);
        if (s0 && s1) {
            ctx.beginPath();
            ctx.moveTo(s0.x, s0.y);
            ctx.lineTo(s1.x, s1.y);
            ctx.strokeStyle = '#ff44aa';
            ctx.lineWidth = 2.2 * dpr;
            ctx.stroke();

            // 推力矢量箭头
            const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
            const headLen = 9 * dpr;
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s1.x - headLen * Math.cos(ang - 0.45), s1.y - headLen * Math.sin(ang - 0.45));
            ctx.lineTo(s1.x - headLen * Math.cos(ang + 0.45), s1.y - headLen * Math.sin(ang + 0.45));
            ctx.closePath();
            ctx.fillStyle = '#ff44aa';
            ctx.fill();

            // CoT 球体锚点
            const r = 7.5 * dpr;
            ctx.beginPath();
            ctx.arc(s0.x, s0.y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 68, 170, 0.35)';
            ctx.fill();
            ctx.lineWidth = 2 * dpr;
            ctx.strokeStyle = '#ff44aa';
            ctx.stroke();
        }
    }

    // 4. 三维质心（CoM KSP 黄黑象限靶标）
    if (_centersState.com && _physics && _physics.com) {
        const comScr = projectToScreen(viewProj, _physics.com, W, H);
        if (comScr) {
            const r = 8.5 * dpr;
            // 黄黑四象限圆盘
            for (let q = 0; q < 4; q++) {
                ctx.beginPath();
                ctx.moveTo(comScr.x, comScr.y);
                ctx.arc(comScr.x, comScr.y, r, (q * Math.PI) / 2, ((q + 1) * Math.PI) / 2);
                ctx.closePath();
                ctx.fillStyle = (q % 2 === 0) ? '#ffd23f' : '#181a20';
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(comScr.x, comScr.y, r, 0, Math.PI * 2);
            ctx.lineWidth = 1.8 * dpr;
            ctx.strokeStyle = '#ffd23f';
            ctx.stroke();
        }
    }

    ctx.restore();
}

function runSelfCheck() {
    let allOutward = true;
    const failedTypes = [];
    for (const pt of PART_TYPES) {
        const geom = buildPartGeometry(pt, PART_LAB_CONFIG.mesh);
        // 含双层镂空喷管（hollowFrustum）的引擎包含朝向喷管轴心的内腔壁，跳过纯外法线单向断言或仅测非镂空件
        const hasHollow = pt.visual && pt.visual.primitives && pt.visual.primitives.some(p => p.type === 'hollowFrustum');
        if (!hasHollow && !assertOutward(geom)) {
            allOutward = false;
            failedTypes.push(pt.id);
        }
    }

    const k2Design = createDefaultDesign('preset_k2_standard');
    const k2Phys = computeShipPhysics(k2Design);
    const topologyOk = Array.isArray(k2Design.parts) && k2Design.parts.length === 3
        && k2Design.parts[0].position[1] === 0
        && Math.abs(k2Design.parts[1].position[1] - (-1.85)) < 1e-4
        && Math.abs(k2Design.parts[2].position[1] - (-3.35)) < 1e-4;

    return {
        outward: allOutward,
        failedTypes,
        topology: topologyOk,
        k2Physics: {
            partCount: k2Phys.partCount,
            dryMass: k2Phys.dryMass,
            wetMass: k2Phys.wetMass,
            comY: Number(k2Phys.com[1].toFixed(3)),
            moiZ: Math.round(k2Phys.moi),
            deltaV: Math.round(k2Phys.deltaV),
            twr: Number(k2Phys.twr.toFixed(2)),
            canLaunch: k2Phys.engineerReport.canLaunch
        }
    };
}

export function registerPartLabScene(opts = {}) {
    _canvas = opts.canvas || document.getElementById('canvas');

    sceneManager.registerScene('partlab', {
        name: '部件装配车间',
        enter() {
            if (!_canvas) {
                _canvas = document.getElementById('canvas');
            }
            if (!_renderer3D) {
                _renderer3D = new ShipRenderer3D(_canvas);
            }
            if (!_camera) {
                _camera = new PartLabCamera();
            }

            _renderer3D.setOnThumbnailUpdated((typeId, url) => {
                updatePartTileThumbnail(typeId, url);
            });

            _currentPresetId = 'preset_k2_standard';
            _gizmoMode = 'place';
            _symmetryCount = 1;
            _angleSnap = true;
            _centersState = { com: true, cot: true, col: true };
            _selectedPartId = null;
            _selectedExpandedIds = new Set();
            _hoveredPartId = null;
            _heldPartTypeId = null;
            _dragState = null;
            _camDragMode = 'IDLE';
            _canvasGesture = false;
            _gestureFromPanel = false;
            _lastPointer = null;

            const bgs = PART_LAB_CONFIG.backgrounds || [];
            _bgCss = bgs[0] ? bgs[0].css : '#151b26';

            _design = createDefaultDesign(_currentPresetId);
            gameState.setPartLabSession(createEditorSession(_design, PART_LAB_CONFIG.editor.historyLimit));
            _design = editorSession().design;
            _physics = computeShipPhysics(_design);

            _camera.setCenterXRatio(getPartLabViewportCenterRatio(window.innerWidth));
            _camera.fitToBounds(_physics.bounds, true);

            initPartLabUI({
                getThumbnail: (typeId) => (_renderer3D ? _renderer3D.getPartThumbnail(typeId) : null),
                onPickCatalogPart: (typeId, ev) => handlePickCatalogPart(typeId, ev),
                onDiscardHeldPart: () => handleDiscardHeldPart(),
                onPickupSelectedSubtree: () => handlePickupSelectedSubtree(),
                onSelectPartById: (partId, openPaw, sx, sy) => setSelection(partId, openPaw, sx, sy),
                onBeginPropertyEdit: () => beginPropertyEdit(editorSession()),
                onCommitPropertyEdit: () => {
                    commitPropertyEdit(editorSession());
                    refreshDesignState();
                },
                onUpdatePartProperty: (propKey, val) => {
                    if (!_selectedPartId || !_design) return;
                    const mutate = draft => updatePartInspectorProperty(draft, _selectedPartId, propKey, val);
                    if (editorSession().edit) updatePropertyEdit(editorSession(), mutate);
                    else applyEdit(editorSession(), mutate);
                    refreshDesignState(false);
                },
                onRenameVessel: (newName) => {
                    if (_design) {
                        applyEdit(editorSession(), draft => { draft.name = newName; });
                        refreshDesignState(false);
                    }
                },
                onNewWorkspace: () => handleNewWorkspace(),
                onSaveWorkspace: () => handleSaveWorkspace(),
                onLoadSavedWorkspace: (wsId) => handleLoadSavedWorkspace(wsId),
                onDeleteSavedWorkspace: (wsId) => handleDeleteSavedWorkspace(wsId),
                onLoadPreset: (presetId) => handleLoadPreset(presetId),
                onLaunchVessel: () => handleLaunchVessel(),
                onSetGizmoMode: (mode) => {
                    _gizmoMode = mode;
                    refreshDesignState(false);
                },
                onGizmoStep: (dir) => handleGizmoStep(dir),
                onCycleSymmetry: (step) => cycleSymmetry(step),
                onToggleAngleSnap: () => toggleAngleSnap(),
                onToggleCenters: (st) => {
                    _centersState = st;
                },
                onCameraFit: () => {
                    if (_camera && _physics) {
                        _camera.fitToBounds(_physics.bounds, true);
                        updateHeldPreview();
                    }
                },
                onUndo: () => handleUndo(),
                onRedo: () => handleRedo(),
                onDeleteSelected: () => handleDeleteSelected(),
                onExportJson: () => handleExportJson(),
                onImportJson: () => handleImportJson(),
                onExit: () => sceneManager.switchToAsync('menu'),
                onSetLighting: (on) => {
                    if (_renderer3D) _renderer3D.setLightingEnabled(on);
                },
                onSetSunAngle: (deg) => {
                    if (_renderer3D) _renderer3D.setSunAzimuthDeg(deg);
                },
                onSetEclipseVisibility: (vis) => {
                    if (_renderer3D) _renderer3D.setSunVisibility(vis);
                },
                onSetBackground: (bgId) => {
                    const found = (PART_LAB_CONFIG.backgrounds || []).find(b => b.id === bgId);
                    if (found) _bgCss = found.css;
                }
            });

            bindSceneInputs();
            refreshDesignState(false);

            if (typeof window !== 'undefined') {
                window.__partLab = {
                    // TEMP: 只读事务诊断，不向生产模块暴露可写状态。
                    get editor() { return editorSession() ? cloneDesign(editorSession()) : null; },
                    get preview() { return _dragState ? cloneDesign(_dragState) : null; },
                    get design() { return _design; },
                    get physics() { return _physics; },
                    get renderer() { return _renderer3D; },
                    get camera() { return _camera; },
                    loadPreset: handleLoadPreset,
                    quickAttach: handleQuickAttach,
                    pickPart: handlePickCatalogPart,
                    selfCheck: runSelfCheck
                };
            }
        },

        update() {
            if (_camera) {
                _camera.setCenterXRatio(getPartLabViewportCenterRatio(window.innerWidth));
                if (_heldPartTypeId) updateHeldPreview();
            }
        },

        render(ctx) {
            if (!_canvas || !ctx) return;

            // 1. 绘制 VAB 车间背景与工程坐标网格线
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = _bgCss;
            ctx.fillRect(0, 0, _canvas.width, _canvas.height);

            const step = Math.round(48 * (window.devicePixelRatio || 1));
            ctx.strokeStyle = 'rgba(136, 204, 255, 0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x < _canvas.width; x += step) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, _canvas.height);
            }
            for (let y = 0; y < _canvas.height; y += step) {
                ctx.moveTo(0, y);
                ctx.lineTo(_canvas.width, y);
            }
            ctx.stroke();

            // 2. 渲染离屏 WebGL2 3D 飞船并 1:1 合成到主画布
            if (_renderer3D && _renderer3D.isReady()) {
                const ghostParts = (_heldPartTypeId && _dragState && !_ghostHiddenByUI) ? _dragState.ghostParts : null;
                const renderedDesign = editorSession().held ? getPlacementDesign(editorSession()) : _design;
                const ok = _renderer3D.render(renderedDesign, _camera, {
                    selectedPartIds: _selectedExpandedIds,
                    hoveredPartId: _hoveredPartId,
                    ghostParts
                });
                if (ok) {
                    ctx.drawImage(_renderer3D.glCanvas, 0, 0);
                }
            }
            ctx.restore();

            // 3. 绘制 KSP 三心（CoM / CoT / CoL）与连接点叠加层
            drawWorldOverlays(ctx);
        },

        exit() {
            finishForWorkspace();
            unbindSceneInputs();
            destroyPartLabUI();
            _heldPartTypeId = null;
            _dragState = null;
            _camDragMode = 'IDLE';
            gameState.clearPartLabSession();
        }
    });
}

export function getPartLabDesign() {
    return _design;
}
