'use strict';

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { shipSystem } from '../ship/shipSystem.js';
import { gameState } from '../gameState.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityCompartments, getFacilityType, getCompartmentDef } from '../config/entities/facilityTypes.js';
import { getModuleDef, getCapabilityToolbar } from '../config/entities/moduleTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml, renderFuelBarsHtml, showModuleSelectorPopup, createDialog, createInputDialog } from './uiComponents.js';
import { showTooltip, hideTooltip } from './uiTooltip.js';
// 尝鲜版：飞船货仓与星球扫描已移除（见 docs/尝鲜版方案.md），
// 设施存储 / 补给仍保留（船坞建造与加注依赖 cargoSystem 的设施侧接口）
import { getStorageAmount } from '../resources/cargoSystem.js';
import { STORAGE_RESOURCE_IDS } from '../resources/cargoSystem.js';
import { getResourceType } from '../config/entities/resourceTypes.js';
import { celestialBodies } from '../physics/physics.js';
import { t } from '../config/ui/strings.js';
import { makePanelDraggable, cascadePanelOpen } from './panelDrag.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});
let _currentFacility = null;
let _facilityMenuOpen = false;

// 飞船建造UI - 左侧工具栏
const leftToolbar = document.createElement('div');
leftToolbar.id = 'leftToolbar';
leftToolbar.innerHTML = '';
document.body.appendChild(leftToolbar);

// 已打开面板对应的工具栏图标 id 集合(选中态 = 右侧亮绿条)
// 0.2.4 多面板并存:图标与"打开的面板"一一挂接,允许多条亮条同时存在
let _activeToolbarIds = new Set();
let _panelOpenerIcon = {};   // panelId → 打开该面板的图标 id

function setActiveToolbar(id) {
    if (!id) return;
    _activeToolbarIds.add(id);
    syncToolbarActive();
}

function clearActiveToolbar() {
    _activeToolbarIds.clear();
    _panelOpenerIcon = {};
    syncToolbarActive();
}

function syncToolbarActive() {
    // 自愈:静默关闭(模式切换/直接置 display:none 不发 UI_PANEL_CLOSED)的面板,
    // 其图标亮条一并移除,保证"亮条 = 面板确实打开"
    for (const [panelId, iconId] of Object.entries(_panelOpenerIcon)) {
        if (!isPanelOpen(panelId)) {
            delete _panelOpenerIcon[panelId];
            _activeToolbarIds.delete(iconId);
        }
    }
    leftToolbar.querySelectorAll('.toolbar-item').forEach((el) => {
        el.classList.toggle('active', _activeToolbarIds.has(el.dataset.toolbarId));
    });
}

// 面板是否处于打开状态(图标亮条自愈判断;页面面板按 _pages 注册表查询)
function isPanelOpen(panelId) {
    if (panelId === 'shipBuilder' || panelId === 'facilityDeploy') {
        return uiManager.isPanelVisible(panelId);
    }
    return isPageOpen(panelId);
}

// 工具栏页面面板是否打开(_pages 注册表在模块下方初始化,仅运行时调用)
function isPageOpen(pageId) {
    const page = _pages[pageId];
    return page ? page.el.style.display === 'block' : false;
}

// 关闭图标对应的面板(0.2.4 图标点击切换语义:页面面板与 uiManager 面板统一入口)
function closePanel(panelId) {
    if (panelId === 'shipBuilder' || panelId === 'facilityDeploy') {
        uiManager.hidePanel(panelId);
    } else {
        setPageVisible(panelId, false);
    }
}

// 工具栏能力图标 → 面板 id 映射(0.2.4 图标点击切换语义:图标与其面板 1:1)
// 尝鲜版：货仓 / 扫描能力已移除，只剩部署设施入口（完整版功能，点击提示下载完整版）
const CAPABILITY_PANEL = {
    deploy_facility: 'facilityDeploy'
};

// 统一工具栏 — 动态图标渲染（0.2.7 KSP2 重构：竖排标题 + 裸图标行 + 状态竖条选中态）
// mode: 'ship' | 'facility' | 'off'
// data: { modules, shipId } 或 { facilityId } 或 null
export function renderToolbarIcons(mode, data) {
    leftToolbar.innerHTML = '';
    if (mode === 'off' || !data) return;

    // 图标行：裸图标 + 右侧状态竖条（无方框底，参考图样式）
    const createIcon = (icon, title, onClick, texture, iconId, panelId) => {
        const item = document.createElement('div');
        item.className = 'toolbar-item';
        item.dataset.toolbarId = iconId || '';

        const btn = document.createElement('button');
        btn.className = 'toolbar-icon-btn';

        // 悬停提示：统一走全局 DOM tooltip（进入时触发一次，延迟显示、位置固定）
        btn.addEventListener('mouseenter', (e) => {
            showTooltip(title, e.clientX, e.clientY);
        });
        btn.addEventListener('mouseleave', () => {
            hideTooltip();
        });

        // PNG 纹理就绪时用 <img>，否则 fallback 到 Emoji
        if (texture) {
            const tex = textureManager.get(texture);
            if (tex) {
                const img = document.createElement('img');
                img.src = tex.src;
                img.style.cssText = 'width:28px;height:28px;object-fit:contain;';
                btn.appendChild(img);
            } else {
                btn.innerHTML = icon;
            }
        } else {
            btn.innerHTML = icon;
        }

        btn.addEventListener('click', () => {
            // 0.2.4 切换语义:图标与其面板 1:1 映射,点已打开面板的图标 → 关闭该面板
            if (panelId && isPanelOpen(panelId) && _panelOpenerIcon[panelId] === iconId) {
                closePanel(panelId);
                return;
            }
            // 否则打开/刷新面板,并记录打开者图标(供关闭时精确熄灭亮条)
            onClick();
            if (panelId) {
                setActiveToolbar(iconId);
                _panelOpenerIcon[panelId] = iconId;
            }
        });

        const bar = document.createElement('span');
        bar.className = 'toolbar-item-bar';

        item.appendChild(btn);
        item.appendChild(bar);
        leftToolbar.appendChild(item);
    };

    if (mode === 'ship') {
        const seen = new Set();
        for (const mod of (data.modules || [])) {
            const def = getModuleDef(mod.type);
            if (!def || !def.capability) continue;
            if (seen.has(def.capability)) continue;
            seen.add(def.capability);

            // 数据驱动收敛：图标/文案由 CAPABILITY_TOOLBAR 查表，行为按 capability 分发
            // 0.3.0：按钮贴图取 tb.iconTexture（就近声明），iconId 只作 DOM id 用
            const tb = getCapabilityToolbar(def.capability);
            if (!tb) continue;
            const onClick = () => {
                if (def.capability === 'deploy_facility') {
                    // 尝鲜版不提供设施部署：请求事件已无人订阅，后续由完整版提示弹窗接管
                    eventBus.emit(Events.FACILITY_DEPLOY_REQUESTED);
                }
            };
            createIcon(tb.icon, t(tb.labelKey), onClick, tb.iconTexture, tb.iconId, CAPABILITY_PANEL[def.capability] || null);
        }
    } else if (mode === 'facility') {
        const facility = facilitySystem.getFacility(data.facilityId);
        if (!facility) return;
        _currentFacility = facility;

        const compartments = getFacilityCompartments(facility.typeId);
        for (const comp of compartments) {
            const compIcon = comp.icon || '📦';
            const compName = comp.name || comp.id;

            if (comp.id === 'assembly_shop') {
                createIcon(compIcon, compName, () => {
                    // 命令经 eventBus 下发（原 window.openShipBuilder；避免 flightUI ⇄ shipBuilderUI 互相 import 成环）
                    eventBus.emit(Events.SHIP_BUILDER_REQUESTED);
                }, comp.iconTexture, comp.id, 'shipBuilder');
            } else {
                // 0.2.4 多面板并存:不再先关闭建造面板,舱室面板与建造面板可同时存在
                createIcon(compIcon, compName, () => {
                    openCompartmentPanel(facility, comp.id);
                }, comp.iconTexture, comp.id, comp.id);
            }
        }
    }
    // 0.2.4 多面板并存:重建图标列表后,按当前仍打开的面板同步亮条
    syncToolbarActive();
}
window.renderToolbarIcons = renderToolbarIcons;

// ========== 工具栏页面面板（0.2.4 重构：每个内容页独立浮层,可并存/拖动/错位） ==========
// 打开(或刷新)一个工具栏页面面板:页面对应独立 .tkp-page 浮层,互不覆盖 —
// 指令舱 / 对接枢纽 / 补给站 / 仓储 / 模块管理可同时打开
// （尝鲜版：货仓 / 扫描 / 货仓调拨页面随对应系统移除）
function openPage(pageId, title, html) {
    const page = getPage(pageId);
    page.titleEl.textContent = title;
    page.contentEl.innerHTML = html;
    setPageVisible(pageId, true);
}

// 资源条行（货仓/存储共用）— 0.2.7 v2：名字/数量在条外（条内无文字），空槽常显
// 进度条默认绿色（--progress-green，全项目统一），调用方可传 opts.color 覆盖
// opts.value 覆盖数量文本（调拨页双值用）；opts.right 行尾操作按钮 HTML；opts.amountWidth 覆盖数量列宽(px)
function storageRowHtml(resId, amount, capacity, opts = {}) {
    const def = getResourceType(resId);
    const name = def ? def.name : resId;
    const pct = capacity > 0 ? Math.min(100, Math.max(0, amount / capacity * 100)) : 0;
    const color = opts.color || 'var(--progress-green)';
    const rightHtml = opts.right || '';
    const capText = capacity > 0 ? ' / ' + Math.floor(capacity) : '';
    const valueText = opts.value || (Math.floor(amount) + capText);
    const amountStyle = opts.amountWidth ? ' style="width:' + opts.amountWidth + 'px;"' : '';
    return '<div class="tkp-res-row">'
        + '<span class="tkp-res-name">' + name + '</span>'
        + '<span class="tkp-res-track"><span class="tkp-res-fill" style="width:' + pct + '%;background:' + color + ';"></span></span>'
        + '<span class="tkp-res-amount"' + amountStyle + '>' + valueText + '</span>'
        + rightHtml
        + '</div>';
}

// 按资源类别分组的存储列表（0.2.7 v2：一个分类一张卡，卡内资源条行）
// 卡头 = 紫色顶条（点击折叠仅剩顶头）；resIds：显示顺序；getSlot(resId) → { amount, capacity }
// opts 透传 storageRowHtml（right/color/value）
function storageGroupedHtml(resIds, getSlot, opts = {}) {
    let html = '';
    let currentCat = null;
    let cardOpen = false;
    const closeCard = () => {
        if (cardOpen) {
            html += '</div></div>';
            cardOpen = false;
        }
    };
    for (const resId of resIds) {
        const def = getResourceType(resId);
        const cat = def ? def.category : 'raw';
        if (cat !== currentCat) {
            closeCard();
            currentCat = cat;
            html += '<div class="tkp-res-group-card">'
                + '<div class="tkp-res-group-head" data-action="toggle-res-group" data-cat="' + cat + '">'
                + '<span class="tg-arrow">▾</span>'
                + t('cat.' + cat)
                + '</div>'
                + '<div class="tkp-res-group-body">';
            cardOpen = true;
        }
        const slot = getSlot(resId);
        const rowOpts = {};
        if (opts.color) rowOpts.color = opts.color;
        if (opts.right) rowOpts.right = opts.right(resId);
        if (opts.value) rowOpts.value = opts.value(resId);
        if (opts.amountWidth) rowOpts.amountWidth = opts.amountWidth;
        html += storageRowHtml(resId, slot ? slot.amount || 0 : 0, slot ? slot.capacity || 0 : 0, rowOpts);
    }
    closeCard();
    return html;
}

// 设施货物表（指令舱入口）— 全资源 amount/capacity + 行内调拨按钮
// 0.2.7 参考图样式：全量列表（含 0 量暗行），按资源类别分组
function buildFacilityStorageContent(facility) {
    let html = '<div class="tkp-section">' + t('facility.storageSection') + '</div>'
        + '<div class="tkp-hint-muted" style="text-align:left;margin:0 0 8px;">' + t('facility.storageHint') + '</div>';
    html += '<div class="tkp-card-sm">'
        + storageGroupedHtml(
            STORAGE_RESOURCE_IDS,
            (resId) => (facility.storage && facility.storage[resId]) || { amount: 0, capacity: 0 })
        + '</div>';
    return html;
}

// 模块管理面板（对接枢纽入口）— 槽位列表，空槽安装 / 已装卸载
// 0.2.7 分区布局：飞船信息区 + 槽位网格（.tkp-grid）
function buildModuleManageContent(facility, shipId) {
    const ship = facility.dockedShips.find(s => s.id === shipId);
    if (!ship) return '<div class="tkp-card"><div class="tkp-hint" style="margin:0;">' + t('facility.unknownCompartment') + '</div></div>';

    const total = ship.moduleSlots || 0;

    // 分区一：飞船信息（名称 + 槽位数 + 提示）
    let html = '<div class="tkp-section">' + t('dock.shipSection') + '</div>'
        + '<div class="tkp-card-sm">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
        + '<span style="font-size:13px;color:var(--text-bright);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (ship.displayName || ship.id) + '</span>'
        + '<span style="flex-shrink:0;color:var(--text-dim);font-size:10px;">' + t('dock.slotsCount', { n: total }) + '</span>'
        + '</div>'
        + '<div class="tkp-hint-muted" style="text-align:left;margin:6px 0 0;">' + t('dock.moduleManageHint') + '</div>'
        + '</div>';

    if (total === 0) {
        html += '<div class="tkp-card-sm"><div class="tkp-hint" style="margin:0;">' + t('build.noSlots') + '</div></div>';
        return html;
    }

    // 分区二：槽位网格（空槽虚线安装 / 已装模块卡 + 卸载）
    html += '<div class="tkp-section">' + t('dock.slotsSection') + '</div>'
        + '<div class="tkp-grid">';
    for (let i = 0; i < total; i++) {
        const mod = ship.modules[i];
        if (mod) {
            const def = getModuleDef(mod.type);
            html += '<div class="tkp-slot" style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;">'
                + '<span style="font-size:11px;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + renderIconHtml(def?.iconTexture, def?.icon, 12) + ' ' + (def ? def.name : mod.type) + '</span>'
                + '<button data-action="uninstall-module" data-ship-id="' + shipId + '" data-mod-id="' + mod.id + '" class="tkp-btn" style="flex:none;height:20px;padding:0 8px;font-size:10px;">' + t('build.uninstall') + '</button>'
                + '</div>';
        } else {
            html += '<button data-action="install-module" data-ship-id="' + shipId + '" data-slot-index="' + i + '" class="tkp-slot-empty">'
                + t('build.slotIndex', { i: i + 1 }) + ' · ' + t('dock.installModule') + '</button>';
        }
    }
    html += '</div>';
    return html;
}

// 模块安装选择弹窗（模块管理面板：空槽点击）— 0.2.7 统一走共享组件 showModuleSelectorPopup
// 视觉（紫描边外框/分类紫头折叠/无边框行）由 ksp2_panels.css 统一管理
function showFacilityModuleSelector(facility, shipId, anchorEl) {
    showModuleSelectorPopup({
        anchorEl,
        onSelect: (def) => {
            const ok = facilitySystem.addModuleToShip(facility.id, shipId, def.id);
            if (!ok) {
                window.showNotification(t('economy.insufficientKits'), 'error');
            } else {
                window.showNotification(t('dock.moduleInstalled', { name: def.name }), 'success');
            }
            openPage('moduleManage', t('dock.moduleManage'), buildModuleManageContent(facilitySystem.getFacility(facility.id), shipId));
        }
    });
}

// ========== 舱室内容渲染 ==========
function openCompartmentPanel(facility, compartmentId) {
    const compDef = getCompartmentDef(compartmentId);
    const title = compDef ? compDef.name : compartmentId;

    let html = '';
    switch (compartmentId) {
        case 'bridge':
            html = buildBridgeContent(facility);
            break;
        case 'dock_hub':
            html = buildDockHubContent(facility);
            break;
        case 'supply_terminal':
            html = buildSupplyTerminalContent(facility);
            break;
        case 'laboratory':
            html = '<div class="tkp-card"><div class="tkp-hint" style="margin:0;">' + t('facility.bridgeResearch') + '</div></div>';
            break;
        default:
            html = '<div style="color:var(--text-faint);">' + t('facility.unknownCompartment') + '</div>';
    }

    openPage(compartmentId, title, html);

    // 舱室初始化钩子（绑定事件）
    if (compartmentId === 'dock_hub') bindDockHubEvents(facility);
}

// 指令舱内容（0.2.7 分区布局：设施信息卡网格 + 货物表入口 + 当前受控飞船卡）
function buildBridgeContent(facility) {
    const typeConfig = getFacilityType(facility.typeId);
    const typeName = typeConfig ? typeConfig.name : t('facility.typeName');
    const docksUsed = facility.usedDocks || 0;
    const docksMax = facility.maxDocks || 0;
    const pct = docksMax > 0 ? (docksUsed / docksMax * 100) : 0;

    const info = (label, value, accent) => `
        <div class="tkp-info">
            <span class="tkp-info-label">${label}</span>
            <span class="tkp-info-value" style="color:${accent || 'var(--text-mid)'};">${value}</span>
        </div>`;

    // 分区一：设施信息（2×2 信息卡网格）
    let html = '<div class="tkp-section">' + t('facility.infoSection') + '</div>'
        + '<div class="tkp-grid">';
    html += info(t('facility.nameLabel'), facility.name);
    html += info(t('facility.typeLabel'), typeName, 'var(--accent)');
    html += info(t('facility.dockLabel'),
        `<span style="display:inline-block;width:80px;height:6px;background:var(--theme-panel);border-radius:3px;vertical-align:middle;margin-right:6px;">
            <span style="display:inline-block;width:${pct}%;height:100%;background:var(--accent);border-radius:3px;"></span>
        </span> ${docksUsed} / ${docksMax}`, 'var(--accent)');
    html += info(t('facility.upgradeLabel'), (facility.upgradeLevel || 1) + t('facility.levelSuffix'));
    html += '</div>';

    // 0.2.0 阶段5：指令舱货物表入口（所属天体/交互范围卡片已按需求移除）
    html += '<div class="tkp-actions"><button data-action="open-storage" class="tkp-btn">' + t('facility.storage') + '</button></div>';

    // 0.2.5：原"当前受控飞船卡 + release-control 按钮"已移除（_controlledDockedShipId 恒为 null 的死代码，
    // 0.2.0 阶段5 起控制切换改走模块管理/起飞；未来"远程接管停靠飞船"可从 git 历史恢复）
    return html;
}

// 对接枢纽内容（0.2.7 分区布局：对接操作区 + 停靠飞船卡网格）
function buildDockHubContent(facility) {
    const activeShip = shipSystem.getActiveShip();
    const freeDocks = (facility.maxDocks || 0) - (facility.usedDocks || 0);

    // 分区一：对接操作
    let html = '<div class="tkp-section">' + t('dock.dockActionSection') + '</div>';
    if (activeShip && freeDocks > 0) {
        html += '<div class="tkp-actions"><button id="dockCurrentShipBtn" class="tkp-btn-primary">'
            + t('dock.dockCurrentShip', { name: (activeShip.displayName || activeShip.id), free: freeDocks }) + '</button></div>';
    } else if (activeShip && freeDocks <= 0) {
        html += '<div class="tkp-card-sm" style="color:var(--danger);font-size:12px;background:var(--danger-bg);border-color:var(--danger-border);">'
            + t('dock.docksFull', { max: (facility.maxDocks || 0) }) + '</div>';
    } else if (!activeShip) {
        html += '<div class="tkp-hint-muted" style="text-align:left;margin:0;">' + t('dock.approachHint') + '</div>';
    }

    // 分区二：停靠飞船卡网格
    html += '<div class="tkp-section">' + t('dock.dockedSection') + '</div>';
    const dockedShips = facility.dockedShips || [];
    if (dockedShips.length === 0) {
        html += '<div class="tkp-card-sm"><div class="tkp-hint" style="margin:0;">' + t('dock.noDockedShips') + '</div></div>';
    } else {
        html += '<div class="tkp-grid">';
        for (const ship of dockedShips) {
            html += '<div class="tkp-slot" style="display:flex;flex-direction:column;gap:6px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:var(--text-mid);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="display:flex;flex-direction:column;gap:4px;">' + renderFuelBarsHtml(ship) + '</div>'
                + '<div style="font-size:10px;color:var(--text-dim);">' + t('dock.modulesCount', { n: ship.modules?.length || 0 }) + '</div>';
            if (!activeShip) {
                // 0.2.0 阶段5：切换控制改为模块管理 + 起飞
                // （尝鲜版：货仓调拨入口随货仓系统移除）
                html += '<div style="display:flex;gap:6px;margin-top:2px;">'
                    + '<button data-action="module-manage" data-ship-id="' + ship.id + '" class="tkp-btn" style="flex:1;height:24px;padding:0;font-size:11px;">' + t('dock.moduleManage') + '</button>'
                    + '<button data-action="undock-ship" data-ship-id="' + ship.id + '" class="tkp-btn" style="flex:1;height:24px;padding:0;font-size:11px;color:#8f8;border-color:#484;">' + t('dock.takeoff') + '</button>'
                    + '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
    }
    return html;
}

function bindDockHubEvents(facility) {
    const page = _pages['dock_hub'];
    if (!page) return;
    const dockBtn = page.contentEl.querySelector('#dockCurrentShipBtn');
    if (dockBtn) {
        dockBtn.addEventListener('click', () => {
            const activeShip = shipSystem.getActiveShip();
            if (activeShip && _currentFacility) {
                facilitySystem.dockShip(_currentFacility.id, activeShip.id);
                const updated = facilitySystem.getFacility(_currentFacility.id);
                if (updated) {
                    _currentFacility = updated;
                    openCompartmentPanel(updated, 'dock_hub');
                }
            }
        }, { once: true });
    }
}

// 补给站内容（0.2.7 分区布局：可补给飞船卡网格）
function buildSupplyTerminalContent(facility) {
    let html = '<div class="tkp-section">' + t('dock.refuelSection') + '</div>';
    const dockedShips = facility.dockedShips || [];
    if (dockedShips.length === 0) {
        html += '<div class="tkp-card-sm"><div class="tkp-hint" style="margin:0;">' + t('dock.noDockedShipsRefuel') + '</div></div>';
    } else {
        html += '<div class="tkp-grid">';
        for (const ship of dockedShips) {
            html += '<div class="tkp-slot" style="display:flex;flex-direction:column;gap:6px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:var(--text-mid);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="display:flex;flex-direction:column;gap:4px;">'
                + renderFuelBarsHtml(ship)
                + (ship.engineOut
                    ? '<div style="font-size:10px;color:var(--danger);">' + t('dock.engineOut') + '</div>'
                    : '')
                + '</div>'
                + '<button data-action="refuel-ship" data-ship-id="' + ship.id + '" class="tkp-btn" style="height:24px;padding:0;font-size:11px;color:var(--refuel);border-color:var(--refuel-border);">' + t('dock.refuel') + '</button>'
                + '<div class="tkp-hint-muted" style="margin:0;">' + t('dock.refuelCost') + '</div>'
                + '</div>';
        }
        html += '</div>';
    }
    return html;
}

// 调试挂载：当前受控设施（0.2.0 阶段5 引入的全局辅助；现已无生产消费方 ——
// shipBuilderUI 改读 gameState.getActiveFacility()，保留仅供控制台调试）
window.__getControlledFacility = function() {
    return _currentFacility;
};

// 全局辅助函数：起飞
function facilityUndockShip(shipId) {
    if (_currentFacility) {
        facilitySystem.undockShip(_currentFacility.id, shipId);
        const updated = facilitySystem.getFacility(_currentFacility.id);
        if (updated) {
            _currentFacility = updated;
            openCompartmentPanel(updated, 'dock_hub');
        }
    }
};

// 全局辅助函数：补给燃料（0.2.0 阶段5：设施存储氢氧 → 飞船燃料罐转移）
function facilityRefuelShip(shipId) {
    if (_currentFacility) {
        const ok = facilitySystem.refuelShip(_currentFacility.id, shipId);
        if (!ok) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('economy.noFuelStorage'), 'error');
            }
            return;
        }
        if (typeof window.showNotification === 'function') {
            window.showNotification(t('dock.refuelDone'), 'success');
        }
        const updated = facilitySystem.getFacility(_currentFacility.id);
        if (updated) {
            _currentFacility = updated;
            openCompartmentPanel(updated, 'supply_terminal');
        }
    }
};

// ========== 对接弹窗 ==========
let _dockCallback = null;
let _refuelCallback = null;   // 近设施时的「补给」按钮回调

const dockPromptEl = document.createElement('div');
dockPromptEl.id = 'dockPrompt';
dockPromptEl.style.display = 'none';
dockPromptEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="color:var(--text-mid);font-size:12px;">${t('dock.promptDock')}</span>
            <span id="dockPromptFacName">${t('facility.typeName')}</span>
        </div>
        <button id="dockPromptRefuelBtn" class="ui-btn" style="padding:5px 12px;font-size:12px;color:var(--refuel);border:1px solid var(--refuel-border);">${t('dock.promptRefuel')}</button>
        <button id="dockPromptBtn" class="ui-btn" style="padding:5px 14px;background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent);font-size:13px;">${t('dock.promptBtn')}</button>
    </div>
`;
document.body.appendChild(dockPromptEl);

document.getElementById('dockPromptBtn').addEventListener('click', () => {
    if (_dockCallback) _dockCallback();
});

// 补给：调设施补给接口（按飞船氢/氧缺口补满，受设施存量限制）
document.getElementById('dockPromptRefuelBtn').addEventListener('click', () => {
    if (_refuelCallback) _refuelCallback();
});

// facility: 当前最近设施；onDock: 对接回调；onRefuel: 补给回调（缺省则隐藏补给按钮）
export function showDockPrompt(facility, onDock, onRefuel) {
    if (!facility) return;
    document.getElementById('dockPromptFacName').textContent = facility.name || t('facility.typeName');
    _dockCallback = onDock;
    _refuelCallback = onRefuel || null;
    const refuelBtn = document.getElementById('dockPromptRefuelBtn');
    if (refuelBtn) refuelBtn.style.display = _refuelCallback ? 'inline-block' : 'none';
    dockPromptEl.style.display = 'block';
}

export function hideDockPrompt() {
    dockPromptEl.style.display = 'none';
    _dockCallback = null;
    _refuelCallback = null;
}

// 保留调试挂载（裁定：允许挂载，禁止生产代码消费）
window.showDockPrompt = showDockPrompt;
window.hideDockPrompt = hideDockPrompt;

// ========== 工具栏页面面板注册表（0.2.4 重构：每个内容页独立 .tkp-page 浮层） ==========
// 页面 id:货仓 cargo / 扫描 scan / 指令舱 bridge / 对接枢纽 dock_hub /
// 补给站 supply_terminal / 实验室 laboratory / 仓储 storage /
// 模块管理 moduleManage / 货仓调拨 cargoTransfer
// 每页独立实例:可并存打开、页头可拖动、关闭互不影响(不再共用单容器互斥替换)
const _pages = {};   // pageId → { el, titleEl, contentEl }

// 惰性创建页面面板(结构与旧 #toolbarPanel 一致,样式走 ksp2_panels.css .tkp-page)
function getPage(pageId) {
    let page = _pages[pageId];
    if (page) return page;
    const el = document.createElement('div');
    el.className = 'tkp-page';
    el.dataset.pageId = pageId;
    el.style.display = 'none';
    el.innerHTML = `
        <div class="tkp-header">
            <span class="tkp-title"></span>
            <button class="tkp-close">✕</button>
        </div>
        <div class="tkp-page-content"></div>
    `;
    document.body.appendChild(el);
    makePanelDraggable(el, el.querySelector('.tkp-header'));
    el.querySelector('.tkp-close').addEventListener('click', () => {
        setPageVisible(pageId, false);
    });
    el.querySelector('.tkp-page-content').addEventListener('click', onPageContentClick);
    page = {
        el,
        titleEl: el.querySelector('.tkp-title'),
        contentEl: el.querySelector('.tkp-page-content')
    };
    _pages[pageId] = page;
    return page;
}

// 页面显隐辅助：统一控制 display 并广播 UI_PANEL_OPENED/CLOSED
// 幂等判断避免重复调用重复发声；程序自动隐藏（场景切换/模式切换）走静默直接改 display
function setPageVisible(pageId, visible) {
    const page = _pages[pageId];
    if (!page) return;
    const isBlock = page.el.style.display === 'block';
    if (visible) {
        if (!isBlock) {
            page.el.style.display = 'block';
            eventBus.emit(Events.UI_PANEL_OPENED, { panelId: pageId });
            // 0.2.4 多面板并存:与其它浮层面板同开时错位,避免完全重叠
            cascadePanelOpen(page.el);
        }
    } else if (isBlock) {
        page.el.style.display = 'none';
        eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: pageId });
    }
}

// 静默关闭全部页面面板(场景切换用;不发事件,亮条由 clearActiveToolbar 清空)
function closeAllPages() {
    for (const pageId of Object.keys(_pages)) {
        const page = _pages[pageId];
        if (page.el.style.display !== 'none') {
            page.el.style.display = 'none';
        }
    }
}

// 页面面板内容点击 — data-action 事件委托(每个页面容器各绑一份)
function onPageContentClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const shipId = btn.dataset.shipId;
    const resId = btn.dataset.resId;
    if (action === 'undock-ship') {
        facilityUndockShip(shipId);
    } else if (action === 'refuel-ship') {
        facilityRefuelShip(shipId);
    } else if (action === 'open-storage') {
        // 0.2.0 阶段5：指令舱 → 设施货物表(独立仓储页面,与指令舱并存)
        if (_currentFacility) openPage('storage', t('facility.storage'), buildFacilityStorageContent(_currentFacility));
    } else if (action === 'module-manage') {
        // 0.2.0 阶段5：对接枢纽 → 模块管理(独立页面,与对接枢纽并存)
        if (_currentFacility) openPage('moduleManage', t('dock.moduleManage'), buildModuleManageContent(_currentFacility, shipId));
    } else if (action === 'install-module') {
        if (_currentFacility) showFacilityModuleSelector(_currentFacility, shipId, btn);
    } else if (action === 'uninstall-module') {
        if (_currentFacility && btn.dataset.modId) {
            facilitySystem.removeModuleFromShip(_currentFacility.id, shipId, btn.dataset.modId);
            const updated = facilitySystem.getFacility(_currentFacility.id);
            _currentFacility = updated;
            window.showNotification(t('dock.moduleRemoved'), 'info');
            openPage('moduleManage', t('dock.moduleManage'), buildModuleManageContent(updated, shipId));
        }
    } else if (action === 'toggle-res-group') {
        // 0.2.7 资源分类折叠（DOM class 切换，折叠后仅剩紫色顶头）
        const card = btn.closest('.tkp-res-group-card');
        if (card) card.classList.toggle('collapsed');
    }
}

// 0.2.7:任何可能经工具栏图标打开的面板关闭时,清除图标选中态(绿条)
// 覆盖:✕ 关工具栏页面面板 / 建造面板 / 设施部署面板(uiManager 面板的关闭路径)
// 0.2.4 多面板并存:只清除"打开该面板的图标"的亮条,其它仍打开的面板保持亮条
eventBus.on(Events.UI_PANEL_CLOSED, (data) => {
    if (!data || !data.panelId) return;
    const openerId = _panelOpenerIcon[data.panelId];
    if (!openerId) return;
    delete _panelOpenerIcon[data.panelId];
    _activeToolbarIds.delete(openerId);
    syncToolbarActive();
});

// 飞船建造UI - 场景切换时显示/隐藏工具栏
eventBus.on(Events.SCENE_CHANGED, (data) => {
    // 追踪站 - 工具栏只在飞行场景显示
    if (data.to === 'flight') {
        leftToolbar.style.opacity = '1';
        leftToolbar.style.pointerEvents = 'auto';
    } else {
        leftToolbar.style.opacity = '0';
        leftToolbar.style.pointerEvents = 'none';
        uiManager.hidePanel('shipBuilder');
        uiManager.hidePanel('facilityDeploy');
        closeAllPages();
        clearActiveToolbar();
        // 兜底隐藏对接提示框，防止场景切换时遗留（本模块自身函数，直接调用）
        hideDockPrompt();
    }
    uiManager.hidePanel('esc');
});
