'use strict';

// KSP 原版 VAB 风格 DOM 界面模块（v3.1）
// 布局分区：
//   1. 左侧零件选择器（最左分类竖栏 + 右侧 3 列 WebGL 3D 缩略图网格 + 悬停详情浮窗 Tooltip）
//   2. 顶部飞船名称与右上角工作区三图标（新建 / 保存 / 打开工作区列表）+ 绿色「发射」按钮
//   3. 右侧分级树栏目（Staging Stack：Stage 0, Stage 1...）
//   4. 下侧工具栏（左：放置/平移/旋转/撤销 + 对称圆盘/吸附圆盘 + 三心开关 CoM/CoT/CoL；右：工程师报告/光照环境小工具栏）
//   5. 3D 视口内右键「部件检视窗（PAW）」：实时拖动滑块调节燃料装填量、货仓模拟配重、引擎推力限制与所属分级

import { uiManager } from '../ui/uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { PART_CATEGORIES, getPartCategory } from '../config/entities/partCategories.js';
import { PART_TYPES, getPartType } from '../config/entities/partTypes.js';
import { getAllShipPresets } from '../config/entities/shipPresets.js';
import { PART_LAB_CONFIG } from '../config/gameplay/partLabConfig.js';
import { getSavedWorkspaces } from '../ship/partAssembly.js';

const CAT_ICONS = {
    all:       { icon: '❖', short: '全部' },
    command:   { icon: '🛰', short: '指挥' },
    tank:      { icon: '🛢', short: '燃料' },
    engine:    { icon: '🔥', short: '引擎' },
    structure: { icon: '⚙', short: '结构' },
    utility:   { icon: '🔭', short: '工程' },
    cargo:     { icon: '📦', short: '货仓' }
};

const RES_LABELS = {
    hydrogen: '液氢 (LH2)',
    oxygen:   '液氧 (LOX)',
    methane:  '液态甲烷 (CH4)',
    xenon:    '高压氙气 (Xe)'
};

let _container = null;
let _callbacks = {};
let _getThumbnail = null;
let _panelsRegistered = false;

let _activeCategory = 'all';
let _searchQuery = '';
let _heldPartTypeId = null;
let _gizmoMode = 'place'; // 'place' | 'offset' | 'rotate'
let _symmetryCount = 1;
let _angleSnap = true;
let _centersState = { com: true, cot: true, col: true };
let _currentBgId = 'hangar';

let _engineerOpen = false;
let _lightingOpen = false;
let _workspaceOpen = false;

let _lastDesign = null;
let _lastPhysics = null;
let _selectedPartId = null;
let _lastClientX = 0;
let _lastClientY = 0;

let _designChangedHandler = null;
let _selectionChangedHandler = null;

function formatMass(kg) {
    const val = Number(kg) || 0;
    if (val >= 10000) return (val / 1000).toFixed(2) + ' t';
    return Math.round(val) + ' kg';
}

export function initPartLabUI(callbacks = {}) {
    destroyPartLabUI();
    _callbacks = callbacks;
    _getThumbnail = callbacks.getThumbnail || (() => null);

    const container = document.createElement('div');
    container.id = 'partLabContainer';

    const bgs = PART_LAB_CONFIG.backgrounds || [];

    container.innerHTML = `
        <!-- 1. 顶部中央船名栏 + 右上角工作区管理与发射台 -->
        <header id="vabTopBar" class="vab-topbar">
            <div class="vab-vessel-box">
                <input type="text" id="vabVesselNameInput" class="vab-vessel-input"
                    value="坎星K2号·标准型" placeholder="输入飞行器名称..." maxlength="32">
                <div class="vab-quick-pills">
                    <span class="vab-pill vab-pill-gold">耗材: <strong id="vabTopCost">0 套</strong></span>
                    <span class="vab-pill">总重: <strong id="vabTopMass">0 kg</strong></span>
                    <span class="vab-pill vab-pill-accent">ΔV: <strong id="vabTopDv">0 m/s</strong></span>
                    <span class="vab-pill">TWR: <strong id="vabTopTwr">0.00</strong></span>
                </div>
            </div>

            <div class="vab-topright-actions">
                <button type="button" class="vab-ws-btn" data-action="ws-new" title="新建空白工作区">
                    <span>📄</span><span>新建</span>
                </button>
                <button type="button" class="vab-ws-btn" data-action="ws-save" title="保存当前飞行器到工作区">
                    <span>💾</span><span>保存</span>
                </button>
                <button type="button" id="vabWsOpenBtn" class="vab-ws-btn" data-action="ws-open" title="打开工作区列表（含官方预设与存档）">
                    <span>📂</span><span>打开</span>
                </button>
                <button type="button" class="vab-launch-btn" data-action="vab-launch" title="执行出厂适航检验并发射飞行器">
                    <span>🚀</span><span>发射</span>
                </button>
                <button type="button" class="vab-ws-btn" data-action="exit-partlab" title="返回主菜单 (Esc)">
                    <span>↩</span><span>退出</span>
                </button>
            </div>
        </header>

        <!-- 2. 左侧零件选择器（左分类竖栏 + 右侧 3 列零件图标网格） -->
        <aside id="vabPartsDock" class="vab-parts-dock">
            <nav id="vabCatRail" class="vab-cat-rail"></nav>

            <div class="vab-parts-drawer">
                <div class="vab-parts-header">
                    <div class="vab-parts-cat-title">
                        <span id="vabCatTitleText">全部零件</span>
                        <span id="vabCatCountText" style="font-size:10px;color:var(--text-dim);">12 种</span>
                    </div>
                    <input type="text" id="vabPartSearch" class="vab-search-input" placeholder="搜索零件名称/功能...">
                </div>

                <div id="vabPartsGridScroll" class="vab-parts-grid-scroll">
                    <div id="vabPartsGrid" class="vab-parts-grid"></div>
                </div>

                <div id="vabDropTrashHint" class="vab-drop-trash-hint">
                    🗑 点击零件库区域即可丢弃手上的零件
                </div>
            </div>
        </aside>

        <!-- 3. 零件鼠标悬停详情浮窗（Part Tooltip） -->
        <div id="vabPartTooltip" class="vab-part-tooltip"></div>

        <!-- 3b. 跟随鼠标的「手持零件」幽灵徽标（KSP 原版拿起零件手感） -->
        <div id="vabCursorGhost">
            <img id="vabCursorGhostImg" src="" alt="">
            <span id="vabCursorGhostLabel" class="vab-cg-label"></span>
        </div>

        <!-- 4. 右侧分级树栏目（Staging Stack） -->
        <aside id="vabStagingDock" class="vab-staging-dock">
            <div class="vab-staging-header">
                <span>分级序列 (STAGING)</span>
                <span id="vabStageCountBadge" style="font-size:10px;color:var(--text-mid);">1 级</span>
            </div>
            <div id="vabStagingList" style="display:flex;flex-direction:column;gap:6px;"></div>
        </aside>

        <!-- 5. 视野中央下方实时状态提示条 -->
        <div class="vab-status-banner">
            <div id="vabStatusPill" class="vab-status-pill">
                点击左侧零件图标拿起零件 → 移至飞船绿色节点或罐体侧面单击安装 · 右键点击船上部件打开属性滑块
            </div>
        </div>

        <!-- 6. 下侧主工具栏（平移/旋转/对称/吸附/三心 + 右下小工具栏） -->
        <footer id="vabBottomBar" class="vab-bottombar">
            <!-- 左区：建造操控模式（放置 / 平移微调 / 旋转）+ 撤销重做 -->
            <div class="vab-tools-left">
                <button type="button" class="vab-tool-btn active" data-action="set-gizmo" data-gizmo="place" title="放置与拎起模式 (快捷键 1)">
                    <span>✥</span><span>放置</span>
                </button>
                <button type="button" class="vab-tool-btn" data-action="set-gizmo" data-gizmo="offset" title="上下平移微调模式 (快捷键 2)">
                    <span>↕</span><span>平移</span>
                </button>
                <button type="button" class="vab-tool-btn" data-action="set-gizmo" data-gizmo="rotate" title="旋转部件模式 (快捷键 3)">
                    <span>↻</span><span>旋转</span>
                </button>

                <!-- 当处于平移或旋转模式时显示的快捷步进按钮组 -->
                <div id="vabGizmoStepGroup" style="display:none;align-items:center;gap:4px;">
                    <button type="button" class="vab-tool-btn" data-action="gizmo-step-neg" id="vabStepNegBtn">↓ -0.1m</button>
                    <button type="button" class="vab-tool-btn" data-action="gizmo-step-pos" id="vabStepPosBtn">↑ +0.1m</button>
                </div>

                <div class="vab-tool-divider"></div>

                <button type="button" id="vabUndoBtn" class="vab-tool-btn disabled" data-action="undo" title="撤销 (Ctrl+Z)">
                    <span>↶</span><span>撤销</span>
                </button>
                <button type="button" id="vabRedoBtn" class="vab-tool-btn disabled" data-action="redo" title="重做 (Ctrl+Y)">
                    <span>↷</span><span>重做</span>
                </button>
                <button type="button" id="vabDeleteBtn" class="vab-tool-btn disabled" data-action="delete-selected" title="拆除选中部件 (Delete)">
                    <span>🗑</span><span>拆除</span>
                </button>
            </div>

            <!-- 中区：KSP 对称圆盘、角度吸附圆盘与三心显示开关（CoM / CoT / CoL） -->
            <div class="vab-tools-center">
                <button type="button" id="vabSymDisc" class="vab-disc-btn" data-action="cycle-symmetry"
                    title="径向对称模式（左键升档 / 右键降档 / 快捷键 X）">
                    1x
                </button>
                <button type="button" id="vabSnapDisc" class="vab-disc-btn" data-action="toggle-snap"
                    title="角度与高度步进吸附开关（快捷键 C）">
                    ⬡15°
                </button>

                <div class="vab-tool-divider"></div>

                <button type="button" id="vabBtnCoM" class="vab-center-btn active-com" data-action="toggle-center" data-center="com"
                    title="显示/隐藏三维质心球标 (Center of Mass)">
                    <span>🟡</span><span>质心 CoM</span>
                </button>
                <button type="button" id="vabBtnCoT" class="vab-center-btn active-cot" data-action="toggle-center" data-center="cot"
                    title="显示/隐藏推力中心与推力矢量轴线 (Center of Thrust)">
                    <span>🟣</span><span>推力 CoT</span>
                </button>
                <button type="button" id="vabBtnCoL" class="vab-center-btn active-col" data-action="toggle-center" data-center="col"
                    title="显示/隐藏几何中心与空闲连接点 (Center of Geometry & Nodes)">
                    <span>🔵</span><span>几何/节点</span>
                </button>
            </div>

            <!-- 右区：小工具栏（工程师报告 & 飞船功能校验 / 光照与日食 / 视角复位） -->
            <div class="vab-tools-right">
                <button type="button" class="vab-tool-btn" data-action="camera-fit" title="重置相机视角并居中飞行器">
                    <span>📐</span><span>居中</span>
                </button>
                <button type="button" id="vabLightLauncherBtn" class="vab-tool-btn" data-action="toggle-lighting-popover"
                    title="车间动态光照与行星日食本影测试">
                    <span>☀</span><span>光照/日食</span>
                </button>
                <button type="button" id="vabEngLauncherBtn" class="vab-tool-btn" data-action="toggle-engineer-popover"
                    title="打开工程师报告（飞船功能罗列、适航校验与完整物理参数）">
                    <span>📋</span><span id="vabEngBtnLabel">工程师报告</span>
                </button>
            </div>
        </footer>

        <!-- ==================== 弹出浮窗 1：工程师报告 & 飞船功能校验 ==================== -->
        <section id="vabEngineerPopover" class="vab-popover">
            <div class="ui-panel-header">
                <h3 class="ui-panel-title">📋 工程师报告 & 飞船功能校验</h3>
                <button type="button" class="ui-btn-sm" data-action="toggle-engineer-popover">关闭</button>
            </div>
            <div id="vabEngineerBody" style="overflow-y:auto;padding-right:4px;"></div>
        </section>

        <!-- ==================== 弹出浮窗 2：光照与行星日食测试 ==================== -->
        <section id="vabLightingPopover" class="vab-popover">
            <div class="ui-panel-header">
                <h3 class="ui-panel-title">☀ 车间动态光照与环境</h3>
                <button type="button" class="ui-btn-sm" data-action="toggle-lighting-popover">关闭</button>
            </div>
            <div class="pl-ctrl-row" style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;">
                <span>启用航天 PBR 动态光照</span>
                <input type="checkbox" id="vabLightToggle" checked>
            </div>
            <div class="pl-ctrl-row" style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;">
                <span>恒星光照旋转角 (<span id="vabSunAngleVal">37°</span>)</span>
                <input type="range" id="vabSunAngleSlider" style="width:120px;accent-color:var(--accent);" min="-180" max="180" value="37">
            </div>
            <div class="pl-ctrl-row" style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;">
                <span>行星日食本影可见度 (<span id="vabEclipseVal">100%</span>)</span>
                <input type="range" id="vabEclipseSlider" style="width:120px;accent-color:var(--accent);" min="0" max="100" value="100">
            </div>
            <div class="pl-ctrl-row" style="display:flex;justify-content:space-between;padding:6px 0 2px 0;font-size:11px;">
                <span>背景切换</span>
                <div style="display:flex;gap:4px;">
                    ${bgs.map(bg => `
                        <button type="button" class="ui-btn-sm ${bg.id === _currentBgId ? 'pl-btn-active' : ''}"
                            data-action="set-bg" data-bg-id="${bg.id}">
                            ${bg.label}
                        </button>
                    `).join('')}
                </div>
            </div>
        </section>

        <!-- ==================== 弹出浮窗 3：右上角「打开工作区列表」抽屉 ==================== -->
        <section id="vabWorkspaceModal" class="vab-popover">
            <div class="ui-panel-header">
                <h3 class="ui-panel-title">📂 工作区与预设蓝图列表</h3>
                <button type="button" class="ui-btn-sm" data-action="ws-open">关闭</button>
            </div>
            <div id="vabWorkspaceListBody" class="vab-ws-list"></div>
            <div style="display:flex;justify-content:space-between;gap:6px;padding-top:6px;border-top:1px solid var(--border-dark);">
                <button type="button" class="ui-btn-sm" style="flex:1;" data-action="export-json">📋 导出 JSON</button>
                <button type="button" class="ui-btn-sm" style="flex:1;" data-action="import-json">📥 导入 JSON</button>
            </div>
        </section>

        <!-- ==================== 弹出浮窗 4：3D 视口内右键「部件检视窗 (PAW)」 ==================== -->
        <section id="vabPartInspector" class="vab-popover"></section>
    `;

    document.body.appendChild(container);
    _container = container;

    renderCategoryRail();
    renderPartsGrid();
    bindUIEvents();

    const partsDockEl = container.querySelector('#vabPartsDock');
    const engPopEl = container.querySelector('#vabEngineerPopover');
    const lightPopEl = container.querySelector('#vabLightingPopover');

    uiManager.registerPanel('partlabParts', {
        element: partsDockEl,
        render: renderPartsGrid,
        show: () => { if (partsDockEl) partsDockEl.style.display = 'flex'; },
        hide: () => { if (partsDockEl) partsDockEl.style.display = 'none'; }
    });
    uiManager.registerPanel('partlabPhysics', {
        element: engPopEl,
        render: (data) => renderAllDynamicViews(data),
        show: () => {},
        hide: () => {}
    });
    uiManager.registerPanel('partlabRender', {
        element: lightPopEl,
        render: () => {},
        show: () => {},
        hide: () => {}
    });
    _panelsRegistered = true;

    uiManager.showPanel('partlabParts');
    uiManager.showPanel('partlabPhysics');

    _designChangedHandler = (payload) => {
        _lastDesign = payload.design;
        _lastPhysics = payload.physics;
        if (payload.symmetryCount !== undefined) {
            _symmetryCount = payload.symmetryCount;
        }
        if (payload.angleSnap !== undefined) {
            _angleSnap = payload.angleSnap;
        }
        if (payload.heldPartTypeId !== undefined) {
            _heldPartTypeId = payload.heldPartTypeId;
        }
        if (payload.gizmoMode) {
            _gizmoMode = payload.gizmoMode;
        }
        uiManager.setData('partlabPhysics', payload);
    };

    _selectionChangedHandler = (payload) => {
        _selectedPartId = payload ? payload.partId : null;
        updateDeleteAndStageSelection();
        if (payload && payload.openInspector) {
            openPartInspector(payload.part, payload.partType, payload.screenX, payload.screenY);
        } else if (!_selectedPartId) {
            closePartInspector();
        } else {
            refreshOpenPartInspector();
        }
    };

    eventBus.on(Events.PARTLAB_DESIGN_CHANGED, _designChangedHandler);
    eventBus.on(Events.PARTLAB_SELECTION_CHANGED, _selectionChangedHandler);
}

/**
 * 当异步资产（KSP2 网格/贴图）加载完成并刷新缩略图后，更新对应零件格里的图片。
 * 若该格子当时渲染的是占位图标（还没有 <img>），整体重绘一次网格。
 */
export function updatePartTileThumbnail(typeId, dataUrl) {
    if (!_container || !typeId || !dataUrl) return;
    const img = _container.querySelector(`.vab-part-tile[data-part-type="${typeId}"] img.vab-tile-thumb`);
    if (img) {
        img.src = dataUrl;
        return;
    }
    renderPartsGrid();
}

function renderCategoryRail() {
    if (!_container) return;
    const rail = _container.querySelector('#vabCatRail');
    if (!rail) return;

    const tabs = [{ id: 'all', name: '全部零件' }, ...PART_CATEGORIES];
    rail.innerHTML = tabs.map((cat) => {
        const meta = CAT_ICONS[cat.id] || { icon: '◈', short: cat.name.slice(0, 2) };
        const isActive = cat.id === _activeCategory;
        return `
            <button type="button" class="vab-cat-tab ${isActive ? 'active' : ''}"
                data-action="select-cat" data-cat-id="${cat.id}" title="${cat.name}">
                <span class="vab-cat-icon">${meta.icon}</span>
                <span>${meta.short}</span>
            </button>
        `;
    }).join('');
}

function renderPartsGrid() {
    if (!_container) return;
    const grid = _container.querySelector('#vabPartsGrid');
    const titleEl = _container.querySelector('#vabCatTitleText');
    const countEl = _container.querySelector('#vabCatCountText');
    const trashHint = _container.querySelector('#vabDropTrashHint');
    if (!grid) return;

    const catObj = _activeCategory === 'all' ? null : getPartCategory(_activeCategory);
    if (titleEl) {
        titleEl.textContent = catObj ? catObj.name : '全部零件';
    }

    const q = _searchQuery.trim().toLowerCase();
    const filtered = PART_TYPES.filter((p) => {
        if (_activeCategory !== 'all' && p.category !== _activeCategory) return false;
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    });

    if (countEl) {
        countEl.textContent = `${filtered.length} 种`;
    }

    if (trashHint) {
        if (_heldPartTypeId) trashHint.classList.add('visible');
        else trashHint.classList.remove('visible');
    }

    grid.innerHTML = filtered.map((p) => {
        const thumbUrl = _getThumbnail ? _getThumbnail(p.id) : null;
        const isHeld = _heldPartTypeId === p.id;
        const canSrf = !!(p.collider && p.collider.allowSurfaceAttach);
        const shortName = p.name.replace(/\s+".*?"\s+/, ' ');
        return `
            <div class="vab-part-tile ${isHeld ? 'held' : ''}" data-part-type="${p.id}">
                ${canSrf ? '<span class="vab-tile-srf" title="支持径向贴合">径向</span>' : ''}
                <span class="vab-tile-cost">${p.cost}套</span>
                ${thumbUrl
                    ? `<img class="vab-tile-thumb" src="${thumbUrl}" alt="${p.name}">`
                    : `<div class="vab-tile-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">⚙</div>`
                }
                <span class="vab-tile-name">${shortName}</span>
            </div>
        `;
    }).join('');
}

function showPartHoverTooltip(partType, tileRect) {
    if (!_container || !partType) return;
    const tip = _container.querySelector('#vabPartTooltip');
    if (!tip) return;

    const cat = getPartCategory(partType.category);
    const specs = [
        ['结构干质量', `${partType.mass} kg`],
        ['建造耗材', `${partType.cost} 套材料`],
        ['挂载方式', (partType.collider && partType.collider.allowSurfaceAttach) ? '轴向节点 / 侧面径向' : '轴向节点对接']
    ];

    if (partType.engine) {
        specs.push(['最大推力', `${(partType.engine.maxThrust / 1000).toFixed(0)} kN`]);
        specs.push(['真空比冲 (Isp)', `${partType.engine.isp} s`]);
        specs.push(['推进剂类型', partType.engine.engineType === 'ion' ? '高压氙气 (Xe)' : '液氢 + 液氧 (1:8)']);
    }
    if (partType.resources) {
        for (const [resId, slot] of Object.entries(partType.resources)) {
            specs.push([RES_LABELS[resId] || resId, `${slot.capacity} kg`]);
        }
    }
    if (partType.reactionWheelTorque > 0) {
        specs.push(['动量轮扭矩', `${partType.reactionWheelTorque.toFixed(1)} N·m`]);
    }
    if (partType.capability === 'scan_resources') {
        specs.push(['特殊能力', `行星资源扫描 (Tier ${partType.scanTier})`]);
    } else if (partType.capability === 'deploy_facility') {
        specs.push(['特殊能力', '稳定圆轨道部署新设施']);
    } else if (partType.capability === 'cargo_hold') {
        specs.push(['扩展货仓容量', `${partType.cargoCapacity} kg (共享池)`]);
    }

    tip.innerHTML = `
        <div class="vab-tt-title">${partType.name}</div>
        <div class="vab-tt-sub">
            <span>分类：${cat ? cat.name : partType.category}</span>
            <span>ID: ${partType.id}</span>
        </div>
        <div class="vab-tt-specs">
            ${specs.map(([k, v]) => `
                <div class="vab-tt-spec-row">
                    <span>${k}</span>
                    <strong>${v}</strong>
                </div>
            `).join('')}
        </div>
        <div class="vab-tt-desc">${partType.description}</div>
    `;

    const topY = Math.max(52, Math.min(window.innerHeight - 260, tileRect ? tileRect.top : 80));
    tip.style.top = topY + 'px';
    tip.classList.add('visible');
}

function hidePartHoverTooltip() {
    if (!_container) return;
    const tip = _container.querySelector('#vabPartTooltip');
    if (tip) tip.classList.remove('visible');
}

function renderAllDynamicViews(payload) {
    if (!_container || !payload || !payload.physics) return;
    const { design, physics, canUndo, canRedo } = payload;

    // 1. 顶部栏船名与四项核心指标
    const nameInput = _container.querySelector('#vabVesselNameInput');
    if (nameInput && design && design.name && document.activeElement !== nameInput) {
        nameInput.value = design.name;
    }
    const costEl = _container.querySelector('#vabTopCost');
    const massEl = _container.querySelector('#vabTopMass');
    const dvEl = _container.querySelector('#vabTopDv');
    const twrEl = _container.querySelector('#vabTopTwr');
    if (costEl) costEl.textContent = `${physics.totalCost} 套`;
    if (massEl) massEl.textContent = formatMass(physics.wetMass);
    if (dvEl) dvEl.textContent = `${Math.round(physics.deltaV)} m/s`;
    if (twrEl) twrEl.textContent = physics.twr.toFixed(2);

    // 2. 底部对称圆盘、吸附圆盘、Gizmo 状态与 Undo/Redo
    const symDisc = _container.querySelector('#vabSymDisc');
    if (symDisc) symDisc.textContent = `${_symmetryCount}x`;
    const snapDisc = _container.querySelector('#vabSnapDisc');
    if (snapDisc) snapDisc.textContent = _angleSnap ? '⬡15°' : '◯自由';

    const gizmoBtns = _container.querySelectorAll('[data-action="set-gizmo"]');
    gizmoBtns.forEach((btn) => {
        if (btn.dataset.gizmo === _gizmoMode) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const stepGroup = _container.querySelector('#vabGizmoStepGroup');
    const negBtn = _container.querySelector('#vabStepNegBtn');
    const posBtn = _container.querySelector('#vabStepPosBtn');
    if (stepGroup) {
        if (_gizmoMode === 'offset' || _gizmoMode === 'rotate') {
            stepGroup.style.display = 'inline-flex';
            if (negBtn) negBtn.textContent = _gizmoMode === 'offset' ? '↓ 下移' : '↶ -15°';
            if (posBtn) posBtn.textContent = _gizmoMode === 'offset' ? '↑ 上移' : '↷ +15°';
        } else {
            stepGroup.style.display = 'none';
        }
    }

    const undoBtn = _container.querySelector('#vabUndoBtn');
    const redoBtn = _container.querySelector('#vabRedoBtn');
    if (undoBtn) {
        if (canUndo) undoBtn.classList.remove('disabled');
        else undoBtn.classList.add('disabled');
    }
    if (redoBtn) {
        if (canRedo) redoBtn.classList.remove('disabled');
        else redoBtn.classList.add('disabled');
    }

    updateDeleteAndStageSelection();
    renderPartsGrid();

    // 3. 右侧分级树（Staging Stack）
    renderStagingStack(physics.stages || []);

    // 4. 工程师报告角标与内容
    renderEngineerPopover(physics);
    refreshOpenPartInspector();
}

function updateDeleteAndStageSelection() {
    if (!_container) return;
    const delBtn = _container.querySelector('#vabDeleteBtn');
    if (delBtn) {
        const part = (_lastDesign && _selectedPartId)
            ? _lastDesign.parts.find(p => p.id === _selectedPartId)
            : null;
        const canDel = !!(part && part.parentId && part.attachMode !== 'root');
        if (canDel) delBtn.classList.remove('disabled');
        else delBtn.classList.add('disabled');
    }

    const stageItems = _container.querySelectorAll('.vab-stage-item');
    stageItems.forEach((el) => {
        if (el.dataset.partId === _selectedPartId) el.classList.add('selected');
        else el.classList.remove('selected');
    });
}

function renderStagingStack(stages) {
    if (!_container) return;
    const listEl = _container.querySelector('#vabStagingList');
    const badgeEl = _container.querySelector('#vabStageCountBadge');
    if (!listEl) return;

    if (badgeEl) {
        badgeEl.textContent = `${stages.length} 级`;
    }

    listEl.innerHTML = stages.map((st) => {
        const thrustStr = st.thrust > 0 ? `${(st.thrust / 1000).toFixed(0)} kN` : '被动级';
        const itemsHtml = st.items.length > 0
            ? st.items.map(item => `
                <div class="vab-stage-item ${item.partId === _selectedPartId ? 'selected' : ''}"
                    data-action="select-stage-part" data-part-id="${item.partId}">
                    <span>${item.icon} ${item.name.split(' ')[0]}</span>
                    <span style="color:var(--text-dim);">${item.detail}</span>
                </div>
            `).join('')
            : `<div style="font-size:10px;color:var(--text-dim);padding:3px 4px;">无激活设备</div>`;

        return `
            <div class="vab-stage-card">
                <div class="vab-stage-bar">
                    <span>STAGE ${st.stage}</span>
                    <span style="color:var(--accent);font-size:10px;">${thrustStr}</span>
                </div>
                <div class="vab-stage-items">${itemsHtml}</div>
            </div>
        `;
    }).join('');
}

function renderEngineerPopover(physics) {
    if (!_container || !physics) return;
    const report = physics.engineerReport || { canLaunch: true, errorCount: 0, warnCount: 0, checks: [] };
    const btnLabel = _container.querySelector('#vabEngBtnLabel');
    if (btnLabel) {
        if (report.errorCount > 0) {
            btnLabel.textContent = `工程师报告 (${report.errorCount} ✕)`;
            btnLabel.style.color = 'var(--danger)';
        } else if (report.warnCount > 0) {
            btnLabel.textContent = `工程师报告 (${report.warnCount} ⚠)`;
            btnLabel.style.color = 'var(--warn)';
        } else {
            btnLabel.textContent = '工程师报告 (✓)';
            btnLabel.style.color = 'var(--progress-green)';
        }
    }

    const body = _container.querySelector('#vabEngineerBody');
    if (!body) return;

    const propEntries = Object.entries(physics.resources || {});
    const propHtml = propEntries.length > 0
        ? propEntries.map(([resId, slot]) => `
            <div class="vab-eng-stat" style="grid-column:span 2;">
                <span>${RES_LABELS[resId] || resId}</span>
                <span>${Math.round(slot.amount)} / ${Math.round(slot.capacity)} kg</span>
            </div>
        `).join('')
        : `<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">未安装任何推进剂储罐</div>`;

    body.innerHTML = `
        <div class="ui-label">适航性与功能校验</div>
        <div class="vab-check-list">
            ${report.checks.map(c => `
                <div class="vab-check-item ${c.severity}">
                    <div class="vab-check-title">
                        ${c.severity === 'error' ? '✕ ' : (c.severity === 'warn' ? '⚠ ' : '✓ ')}${c.title}
                    </div>
                    <div class="vab-check-detail">${c.detail}</div>
                </div>
            `).join('')}
        </div>

        <div class="ui-label">全船工程与轨道力学参数</div>
        <div class="vab-eng-stats-grid">
            <div class="vab-eng-stat"><span>部件总数</span><span>${physics.partCount} 件</span></div>
            <div class="vab-eng-stat"><span>总建造耗材</span><span style="color:var(--ut-gold);">${physics.totalCost} 套</span></div>
            <div class="vab-eng-stat"><span>结构干重</span><span>${formatMass(physics.dryMass)}</span></div>
            <div class="vab-eng-stat"><span>满载总重</span><span>${formatMass(physics.wetMass)}</span></div>
            <div class="vab-eng-stat"><span>真实 ΔV</span><span style="color:var(--accent);">${Math.round(physics.deltaV)} m/s</span></div>
            <div class="vab-eng-stat"><span>推重比 TWR</span><span>${physics.twr.toFixed(2)}</span></div>
            <div class="vab-eng-stat"><span>合推力</span><span>${(physics.totalThrust / 1000).toFixed(1)} kN</span></div>
            <div class="vab-eng-stat"><span>加权比冲</span><span>${Math.round(physics.averageIsp)} s</span></div>
            <div class="vab-eng-stat"><span>满推燃烧时长</span><span>${physics.burnTime.toFixed(1)} s</span></div>
            <div class="vab-eng-stat"><span>动量轮总扭矩</span><span>${physics.reactionWheelTorque.toFixed(1)} N·m</span></div>
            <div class="vab-eng-stat" style="grid-column:span 2;">
                <span>绕 Z 轴转动惯量 (Iz)</span>
                <span>${Math.round(physics.moi)} kg·m²</span>
            </div>
            <div class="vab-eng-stat" style="grid-column:span 2;">
                <span>三维质心 (CoM)</span>
                <span>[${physics.com[0].toFixed(2)}, ${physics.com[1].toFixed(2)}, ${physics.com[2].toFixed(2)}] m</span>
            </div>
            ${propHtml}
        </div>
    `;
}

function renderWorkspaceModalList() {
    if (!_container) return;
    const listBox = _container.querySelector('#vabWorkspaceListBody');
    if (!listBox) return;

    const presets = getAllShipPresets();
    const saved = getSavedWorkspaces();

    let html = `<div class="ui-label">官方标准预设蓝图</div>`;
    html += presets.map(p => `
        <div class="vab-ws-item">
            <div style="min-width:0;">
                <div style="font-family:var(--font-mono-bold);font-size:12px;color:var(--text-bright);">${p.name}</div>
                <div style="font-size:10px;color:var(--text-dim);">${p.description}</div>
            </div>
            <button type="button" class="ui-btn-sm" data-action="load-preset" data-preset-id="${p.id}">加载</button>
        </div>
    `).join('');

    html += `<div class="ui-label" style="margin-top:8px;">玩家已保存工作区 (${saved.length})</div>`;
    if (saved.length === 0) {
        html += `<div style="font-size:11px;color:var(--text-dim);padding:6px 4px;">暂无保存记录（点击右上角「💾 保存」可存档当前飞行器）</div>`;
    } else {
        html += saved.map(w => `
            <div class="vab-ws-item">
                <div>
                    <div style="font-family:var(--font-mono-bold);font-size:12px;color:var(--accent);">${w.name}</div>
                    <div style="font-size:10px;color:var(--text-dim);">${w.partCount} 件部件</div>
                </div>
                <div style="display:flex;gap:4px;">
                    <button type="button" class="ui-btn-sm" data-action="load-saved-ws" data-ws-id="${w.id}">加载</button>
                    <button type="button" class="ui-btn-danger" data-action="delete-saved-ws" data-ws-id="${w.id}">删</button>
                </div>
            </div>
        `).join('');
    }

    listBox.innerHTML = html;
}

/**
 * 打开 KSP 右键部件属性检视窗（PAW：支持调节燃料装填量、货仓模拟配重、引擎推力限制、分级与拎起/拆除）。
 */
export function openPartInspector(part, partType, clientX, clientY) {
    if (!_container || !part || !partType) return;
    const paw = _container.querySelector('#vabPartInspector');
    if (!paw) return;

    const isRoot = !part.parentId || part.attachMode === 'root';
    let rowsHtml = '';

    // 1. 燃料罐推进剂装填量滑块（与本体资源系统联动）
    if (partType.resources) {
        for (const [resId, slot] of Object.entries(partType.resources)) {
            const cap = Number(slot.capacity) || 0;
            const cur = (part.resourceAmounts && part.resourceAmounts[resId] !== undefined)
                ? Number(part.resourceAmounts[resId])
                : Number(slot.amount);
            rowsHtml += `
                <div class="vab-paw-row">
                    <div class="vab-paw-row-head">
                        <span>${RES_LABELS[resId] || resId}</span>
                        <strong><span id="pawVal_${resId}">${Math.round(cur)}</span> / ${cap} kg</strong>
                    </div>
                    <input type="range" class="vab-paw-slider" data-paw-prop="res:${resId}"
                        min="0" max="${cap}" step="5" value="${Math.round(cur)}">
                </div>
            `;
        }
    }

    // 2. 货仓模拟配重滑块
    if (partType.cargoCapacity > 0) {
        const cap = partType.cargoCapacity;
        const cur = Number(part.cargoMass) || 0;
        rowsHtml += `
            <div class="vab-paw-row">
                <div class="vab-paw-row-head">
                    <span>📦 模拟装载货物</span>
                    <strong><span id="pawVal_cargoMass">${Math.round(cur)}</span> / ${cap} kg</strong>
                </div>
                <input type="range" class="vab-paw-slider" data-paw-prop="cargoMass"
                    min="0" max="${cap}" step="25" value="${Math.round(cur)}">
            </div>
        `;
    }

    // 3. 引擎推力限制滑块
    if (partType.engine) {
        const pct = Math.round(((part.thrustLimit !== undefined ? part.thrustLimit : 1.0)) * 100);
        rowsHtml += `
            <div class="vab-paw-row">
                <div class="vab-paw-row-head">
                    <span>🔥 引擎推力限制</span>
                    <strong><span id="pawVal_thrustLimit">${pct}</span>%</strong>
                </div>
                <input type="range" class="vab-paw-slider" data-paw-prop="thrustLimit"
                    min="5" max="100" step="5" value="${pct}">
            </div>
        `;
    }

    // 4. 分级 Stage 调整
    if (partType.engine || partType.id === 'struct_decoupler') {
        const st = Number(part.stage) || 0;
        rowsHtml += `
            <div class="vab-paw-row" style="flex-direction:row;align-items:center;justify-content:space-between;">
                <span>所属分级 (Stage)</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <button type="button" class="ui-btn-sm" data-action="paw-stage-delta" data-delta="-1">−</button>
                    <strong>STAGE ${st}</strong>
                    <button type="button" class="ui-btn-sm" data-action="paw-stage-delta" data-delta="1">+</button>
                </div>
            </div>
        `;
    }

    paw.innerHTML = `
        <div class="ui-panel-header" style="margin-bottom:6px;">
            <h3 class="ui-panel-title" style="font-size:12px;">⚙ ${partType.name}</h3>
            <button type="button" class="ui-btn-sm" data-action="close-paw">✕</button>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">
            干重: ${partType.mass} kg · 耗材: ${partType.cost} 套${part.symmetryCount > 1 ? ` · ${part.symmetryCount}x 对称组同步` : ''}
        </div>
        ${rowsHtml}
        <div style="display:flex;gap:6px;margin-top:8px;">
            ${!isRoot ? `
                <button type="button" class="ui-btn-sm" style="flex:1;color:var(--accent);" data-action="paw-pickup">
                    ✥ 拎起改装
                </button>
                <button type="button" class="ui-btn-danger" style="flex:1;" data-action="delete-selected">
                    🗑 拆除
                </button>
            ` : `<span style="font-size:10px;color:var(--warn);">★ 根部件（飞船核心基准点）</span>`}
        </div>
    `;

    const x = Math.max(325, Math.min(window.innerWidth - 280, (clientX || 480) + 16));
    const y = Math.max(58, Math.min(window.innerHeight - 260, (clientY || 220) - 20));
    paw.style.left = x + 'px';
    paw.style.top = y + 'px';
    paw.classList.add('open');
}

function refreshOpenPartInspector() {
    if (!_container || !_selectedPartId || !_lastDesign) return;
    const paw = _container.querySelector('#vabPartInspector');
    if (!paw || !paw.classList.contains('open')) return;
    const part = _lastDesign.parts.find(p => p.id === _selectedPartId);
    const partType = part ? getPartType(part.typeId) : null;
    if (!part || !partType) {
        closePartInspector();
    }
}

export function closePartInspector() {
    if (!_container) return;
    const paw = _container.querySelector('#vabPartInspector');
    if (paw) paw.classList.remove('open');
}

export function setPartLabHint(text, level = 'info') {
    if (!_container) return;
    const pill = _container.querySelector('#vabStatusPill');
    if (!pill) return;
    pill.textContent = text;
    pill.className = 'vab-status-pill' + (level === 'ok' ? ' ok' : (level === 'warn' ? ' warn' : (level === 'danger' ? ' danger' : '')));
}

/**
 * 显示/更新跟随鼠标的「手持零件」幽灵徽标（无论鼠标位于零件栏还是 3D 视口上方均可见）。
 * @param {string|null} typeId 手持部件类型 ID；null 表示隐藏
 * @param {number} clientX 鼠标视口 X
 * @param {number} clientY 鼠标视口 Y
 * @param {boolean} [valid=false] 当前所指位置是否可安装（绿色有效 / 红色无效）
 */
export function updateCursorGhost(typeId, clientX, clientY, valid = false) {
    if (!_container) return;
    const ghost = _container.querySelector('#vabCursorGhost');
    const img = _container.querySelector('#vabCursorGhostImg');
    const label = _container.querySelector('#vabCursorGhostLabel');
    if (!ghost) return;

    if (!typeId) {
        ghost.classList.remove('visible');
        return;
    }

    const partType = getPartType(typeId);
    if (partType) {
        const thumb = _getThumbnail ? _getThumbnail(typeId) : null;
        if (thumb && img && img.src !== thumb) {
            img.src = thumb;
        }
        if (label) {
            label.textContent = partType.name;
        }
    }

    ghost.classList.add('visible');
    if (valid) ghost.classList.remove('invalid');
    else ghost.classList.add('invalid');

    const gx = Math.max(38, Math.min(window.innerWidth - 38, Number(clientX) || 0));
    const gy = Math.max(38, Math.min(window.innerHeight - 38, Number(clientY) || 0));
    ghost.style.left = gx + 'px';
    ghost.style.top = gy + 'px';
}

export function hideCursorGhost() {
    if (!_container) return;
    const ghost = _container.querySelector('#vabCursorGhost');
    if (ghost) ghost.classList.remove('visible');
}

function bindUIEvents() {
    if (!_container) return;

    // 搜索框实时过滤
    const searchInput = _container.querySelector('#vabPartSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            _searchQuery = searchInput.value || '';
            renderPartsGrid();
        });
    }

    // 飞船名称输入同步
    const vesselInput = _container.querySelector('#vabVesselNameInput');
    if (vesselInput) {
        vesselInput.addEventListener('change', () => {
            if (_callbacks.onRenameVessel) {
                _callbacks.onRenameVessel(vesselInput.value.trim() || '未命名飞行器');
            }
        });
    }

    // 左侧零件格：悬停弹出详情浮窗 + 单击拿起零件
    const partsDock = _container.querySelector('#vabPartsDock');
    if (partsDock) {
        partsDock.addEventListener('pointerover', (e) => {
            const tile = e.target.closest('.vab-part-tile');
            if (!tile) return;
            const partType = getPartType(tile.dataset.partType);
            if (partType) {
                showPartHoverTooltip(partType, tile.getBoundingClientRect());
            }
        });

        partsDock.addEventListener('pointerout', (e) => {
            const related = e.relatedTarget;
            if (!related || !related.closest || !related.closest('.vab-part-tile')) {
                hidePartHoverTooltip();
            }
        });

        partsDock.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const tile = e.target.closest('.vab-part-tile');
            if (!tile) return;
            const typeId = tile.dataset.partType;
            if (!typeId) return;
            // 左键按下零件格即拿起该零件（KSP 原版：可按住直接拖到飞船松手安装，
            // 也可单击拿起后再移动鼠标到飞船单击安装）
            e.preventDefault();
            hidePartHoverTooltip();
            if (_callbacks.onPickCatalogPart) _callbacks.onPickCatalogPart(typeId, e);
        });

        partsDock.addEventListener('click', (e) => {
            // 点击零件面板空白处 → 丢弃手上零件（点格子本身由 pointerdown 处理）
            const tile = e.target.closest('.vab-part-tile');
            if (!tile && _heldPartTypeId) {
                if (_callbacks.onDiscardHeldPart) _callbacks.onDiscardHeldPart();
            }
        });
    }

    // 对称圆盘支持右键逆向降档
    const symDisc = _container.querySelector('#vabSymDisc');
    if (symDisc) {
        symDisc.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (_callbacks.onCycleSymmetry) _callbacks.onCycleSymmetry(-1);
        });
    }

    // PAW 滑块实时调节（燃料存量 / 货仓配重 / 推力限制）
    _container.addEventListener('input', (e) => {
        const slider = e.target.closest('.vab-paw-slider');
        if (!slider) return;
        const propKey = slider.dataset.pawProp;
        const rawVal = Number(slider.value);

        if (propKey.startsWith('res:')) {
            const resId = propKey.slice(4);
            const labelEl = _container.querySelector('#pawVal_' + resId);
            if (labelEl) labelEl.textContent = String(Math.round(rawVal));
            if (_callbacks.onUpdatePartProperty) _callbacks.onUpdatePartProperty(propKey, rawVal);
        } else if (propKey === 'cargoMass') {
            const labelEl = _container.querySelector('#pawVal_cargoMass');
            if (labelEl) labelEl.textContent = String(Math.round(rawVal));
            if (_callbacks.onUpdatePartProperty) _callbacks.onUpdatePartProperty('cargoMass', rawVal);
        } else if (propKey === 'thrustLimit') {
            const labelEl = _container.querySelector('#pawVal_thrustLimit');
            if (labelEl) labelEl.textContent = String(Math.round(rawVal));
            if (_callbacks.onUpdatePartProperty) _callbacks.onUpdatePartProperty('thrustLimit', rawVal / 100);
        }
    });

    // 全局按钮动作委托
    _container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        switch (action) {
            case 'select-cat': {
                _activeCategory = btn.dataset.catId || 'all';
                renderCategoryRail();
                renderPartsGrid();
                break;
            }
            case 'ws-new':
                if (_callbacks.onNewWorkspace) _callbacks.onNewWorkspace();
                break;
            case 'ws-save':
                if (_callbacks.onSaveWorkspace) _callbacks.onSaveWorkspace();
                renderWorkspaceModalList();
                break;
            case 'ws-open': {
                _workspaceOpen = !_workspaceOpen;
                const modal = _container.querySelector('#vabWorkspaceModal');
                if (modal) {
                    if (_workspaceOpen) {
                        renderWorkspaceModalList();
                        modal.classList.add('open');
                    } else {
                        modal.classList.remove('open');
                    }
                }
                break;
            }
            case 'load-preset': {
                const presetId = btn.dataset.presetId;
                _workspaceOpen = false;
                const modal = _container.querySelector('#vabWorkspaceModal');
                if (modal) modal.classList.remove('open');
                if (_callbacks.onLoadPreset) _callbacks.onLoadPreset(presetId);
                break;
            }
            case 'load-saved-ws': {
                const wsId = btn.dataset.wsId;
                _workspaceOpen = false;
                const modal = _container.querySelector('#vabWorkspaceModal');
                if (modal) modal.classList.remove('open');
                if (_callbacks.onLoadSavedWorkspace) _callbacks.onLoadSavedWorkspace(wsId);
                break;
            }
            case 'delete-saved-ws': {
                const wsId = btn.dataset.wsId;
                if (_callbacks.onDeleteSavedWorkspace) _callbacks.onDeleteSavedWorkspace(wsId);
                renderWorkspaceModalList();
                break;
            }
            case 'vab-launch': {
                // 打开工程师报告进行适航确认
                _engineerOpen = true;
                const engPop = _container.querySelector('#vabEngineerPopover');
                if (engPop) engPop.classList.add('open');
                if (_callbacks.onLaunchVessel) _callbacks.onLaunchVessel();
                break;
            }
            case 'exit-partlab':
                if (_callbacks.onExit) _callbacks.onExit();
                break;
            case 'set-gizmo': {
                const mode = btn.dataset.gizmo || 'place';
                if (_callbacks.onSetGizmoMode) _callbacks.onSetGizmoMode(mode);
                break;
            }
            case 'gizmo-step-neg':
                if (_callbacks.onGizmoStep) _callbacks.onGizmoStep(-1);
                break;
            case 'gizmo-step-pos':
                if (_callbacks.onGizmoStep) _callbacks.onGizmoStep(1);
                break;
            case 'undo':
                if (_callbacks.onUndo) _callbacks.onUndo();
                break;
            case 'redo':
                if (_callbacks.onRedo) _callbacks.onRedo();
                break;
            case 'delete-selected':
                closePartInspector();
                if (_callbacks.onDeleteSelected) _callbacks.onDeleteSelected();
                break;
            case 'cycle-symmetry':
                if (_callbacks.onCycleSymmetry) _callbacks.onCycleSymmetry(1);
                break;
            case 'toggle-snap':
                if (_callbacks.onToggleAngleSnap) _callbacks.onToggleAngleSnap();
                break;
            case 'toggle-center': {
                const key = btn.dataset.center;
                if (key && key in _centersState) {
                    _centersState[key] = !_centersState[key];
                    const activeCls = 'active-' + key;
                    if (_centersState[key]) btn.classList.add(activeCls);
                    else btn.classList.remove(activeCls);
                    if (_callbacks.onToggleCenters) _callbacks.onToggleCenters({ ..._centersState });
                }
                break;
            }
            case 'camera-fit':
                if (_callbacks.onCameraFit) _callbacks.onCameraFit();
                break;
            case 'toggle-engineer-popover': {
                _engineerOpen = !_engineerOpen;
                const pop = _container.querySelector('#vabEngineerPopover');
                const lBtn = _container.querySelector('#vabEngLauncherBtn');
                if (pop) {
                    if (_engineerOpen) pop.classList.add('open');
                    else pop.classList.remove('open');
                }
                if (lBtn) {
                    if (_engineerOpen) lBtn.classList.add('active');
                    else lBtn.classList.remove('active');
                }
                break;
            }
            case 'toggle-lighting-popover': {
                _lightingOpen = !_lightingOpen;
                const pop = _container.querySelector('#vabLightingPopover');
                const lBtn = _container.querySelector('#vabLightLauncherBtn');
                if (pop) {
                    if (_lightingOpen) pop.classList.add('open');
                    else pop.classList.remove('open');
                }
                if (lBtn) {
                    if (_lightingOpen) lBtn.classList.add('active');
                    else lBtn.classList.remove('active');
                }
                break;
            }
            case 'set-bg': {
                const bgId = btn.dataset.bgId;
                _currentBgId = bgId;
                const bgBtns = _container.querySelectorAll('[data-action="set-bg"]');
                bgBtns.forEach(b => {
                    if (b.dataset.bgId === bgId) b.classList.add('pl-btn-active');
                    else b.classList.remove('pl-btn-active');
                });
                if (_callbacks.onSetBackground) _callbacks.onSetBackground(bgId);
                break;
            }
            case 'select-stage-part': {
                const partId = btn.dataset.partId;
                if (_callbacks.onSelectPartById) {
                    const rect = btn.getBoundingClientRect();
                    _callbacks.onSelectPartById(partId, true, rect.left - 270, rect.top);
                }
                break;
            }
            case 'close-paw':
                closePartInspector();
                break;
            case 'paw-pickup':
                closePartInspector();
                if (_callbacks.onPickupSelectedSubtree) _callbacks.onPickupSelectedSubtree();
                break;
            case 'paw-stage-delta': {
                const delta = parseInt(btn.dataset.delta, 10) || 0;
                if (_lastDesign && _selectedPartId && _callbacks.onUpdatePartProperty) {
                    const p = _lastDesign.parts.find(it => it.id === _selectedPartId);
                    if (p) {
                        const nextStage = Math.max(0, Math.min(9, (Number(p.stage) || 0) + delta));
                        _callbacks.onUpdatePartProperty('stage', nextStage);
                        const partType = getPartType(p.typeId);
                        const paw = _container.querySelector('#vabPartInspector');
                        if (paw && partType) {
                            openPartInspector(p, partType, parseInt(paw.style.left, 10) - 16, parseInt(paw.style.top, 10) + 20);
                        }
                    }
                }
                break;
            }
            case 'export-json':
                if (_callbacks.onExportJson) _callbacks.onExportJson();
                break;
            case 'import-json':
                if (_callbacks.onImportJson) _callbacks.onImportJson();
                break;
            default:
                break;
        }
    });

    // 光照与日食滑块
    const lightToggle = _container.querySelector('#vabLightToggle');
    if (lightToggle) {
        lightToggle.addEventListener('change', () => {
            if (_callbacks.onSetLighting) _callbacks.onSetLighting(lightToggle.checked);
        });
    }
    const sunSlider = _container.querySelector('#vabSunAngleSlider');
    const sunVal = _container.querySelector('#vabSunAngleVal');
    if (sunSlider) {
        sunSlider.addEventListener('input', () => {
            if (sunVal) sunVal.textContent = sunSlider.value + '°';
            if (_callbacks.onSetSunAngle) _callbacks.onSetSunAngle(Number(sunSlider.value));
        });
    }
    const eclipseSlider = _container.querySelector('#vabEclipseSlider');
    const eclipseVal = _container.querySelector('#vabEclipseVal');
    if (eclipseSlider) {
        eclipseSlider.addEventListener('input', () => {
            if (eclipseVal) eclipseVal.textContent = eclipseSlider.value + '%';
            if (_callbacks.onSetEclipseVisibility) {
                _callbacks.onSetEclipseVisibility(Number(eclipseSlider.value) / 100);
            }
        });
    }
}

export function getPartLabViewportCenterRatio(canvasCssWidth) {
    const w = Math.max(640, canvasCssWidth || window.innerWidth || 1280);
    let leftDockW = 330;
    let rightStageW = 176;
    if (_container) {
        const dockEl = _container.querySelector('#vabPartsDock');
        const stageEl = _container.querySelector('#vabStagingDock');
        if (dockEl && dockEl.offsetWidth > 0) leftDockW = dockEl.offsetWidth;
        if (stageEl && stageEl.offsetWidth > 0) rightStageW = stageEl.offsetWidth + 12;
    }
    const centerPx = leftDockW + (w - leftDockW - rightStageW) * 0.5;
    return centerPx / w;
}

export function destroyPartLabUI() {
    if (_designChangedHandler) {
        eventBus.off(Events.PARTLAB_DESIGN_CHANGED, _designChangedHandler);
        _designChangedHandler = null;
    }
    if (_selectionChangedHandler) {
        eventBus.off(Events.PARTLAB_SELECTION_CHANGED, _selectionChangedHandler);
        _selectionChangedHandler = null;
    }

    if (_panelsRegistered) {
        ['partlabParts', 'partlabPhysics', 'partlabRender'].forEach((id) => {
            uiManager.hidePanel(id);
            uiManager.unregisterPanel(id);
        });
        _panelsRegistered = false;
    }

    if (_container && _container.parentNode) {
        _container.parentNode.removeChild(_container);
    }
    _container = null;
    _callbacks = {};
    _getThumbnail = null;
}
