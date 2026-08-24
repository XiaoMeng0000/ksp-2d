'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { gameState } from '../gameState.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityCompartments, getFacilityType, getCompartmentDef } from '../facility/facilityTypes.js';
import { getModuleDef, getCapabilityToolbar } from '../ship/moduleTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml, renderFuelBarsHtml, showModuleSelectorPopup } from './uiComponents.js';
import { showTooltip, hideTooltip } from './uiTooltip.js';
import {
    getCargoCapacity, getCargoUsed, getCargoAmount, hasCargoHold,
    getStorageAmount, transferStorageToCargo, transferCargoToStorage,
    transferBetweenFacilities, STORAGE_RESOURCE_IDS
} from '../resources/cargoSystem.js';
import {
    getShipScanTier, getScanProgress, startScan, cancelScan,
    getScanDuration, getVisibleBodyResources, GAME_DAY_SECONDS
} from '../resources/scanSystem.js';
import { getResourceType } from '../resources/resourceTypes.js';
import { celestialBodies } from '../physics/physics.js';
import { t } from '../config/strings.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});
let _currentFacility = null;
let _facilityMenuOpen = false;
let _controlledDockedShipId = null;

// 飞船建造UI - 左侧工具栏
const leftToolbar = document.createElement('div');
leftToolbar.id = 'leftToolbar';
leftToolbar.innerHTML = '';
document.body.appendChild(leftToolbar);

// 统一工具栏 — 动态图标渲染
// mode: 'ship' | 'facility' | 'off'
// data: { modules, shipId } 或 { facilityId } 或 null
function renderToolbarIcons(mode, data) {
    leftToolbar.innerHTML = '';
    if (mode === 'off' || !data) return;

    const createIcon = (icon, title, onClick, textureKey) => {
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
        if (textureKey) {
            const tex = textureManager.get(textureKey);
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

        btn.addEventListener('click', onClick);
        leftToolbar.appendChild(btn);
    };

    if (mode === 'ship') {
        const seen = new Set();
        for (const mod of (data.modules || [])) {
            const def = getModuleDef(mod.type);
            if (!def || !def.capability) continue;
            if (seen.has(def.capability)) continue;
            seen.add(def.capability);

            // 数据驱动收敛：图标/文案由 CAPABILITY_TOOLBAR 查表，行为按 capability 分发
            const tb = getCapabilityToolbar(def.capability);
            if (!tb) continue;
            const onClick = () => {
                if (def.capability === 'deploy_facility') {
                    window.openFacilityDeployPanel();
                } else if (def.capability === 'cargo_hold') {
                    const ship = window.__shipSystem?.getActiveShip();
                    if (ship) openUtilityPanel(t('cargo.title'), buildShipCargoContent(ship));
                } else if (def.capability === 'scan_resources') {
                    const ship = window.__shipSystem?.getActiveShip();
                    if (ship) openUtilityPanel(t('scan.menuTitle'), buildScanContent(ship));
                }
            };
            createIcon(tb.icon, t(tb.labelKey), onClick, tb.iconId);
        }
    } else if (mode === 'facility') {
        const facility = facilitySystem.getFacility(data.facilityId);
        if (!facility) return;
        _currentFacility = facility;
        _controlledDockedShipId = null;

        const compartments = getFacilityCompartments(facility.typeId);
        for (const comp of compartments) {
            const compIcon = comp.icon || '📦';
            const compName = comp.name || comp.id;

            if (comp.id === 'assembly_shop') {
                createIcon(compIcon, compName, () => {
                    window.openShipBuilder();
                }, 'comp_' + comp.id);
            } else {
                createIcon(compIcon, compName, () => {
                    uiManager.hidePanel('shipBuilder');
                    openCompartmentPanel(facility, comp.id);
                }, 'comp_' + comp.id);
            }
        }
    }
}
window.renderToolbarIcons = renderToolbarIcons;

// ========== 通用工具面板（0.2.0 阶段5） ==========
// 复用 toolbarPanel 容器展示非舱室内容（货仓/货物表/模块管理/调拨）
function openUtilityPanel(title, html) {
    const panel = document.getElementById('toolbarPanel');
    const titleEl = document.getElementById('toolbarPanelTitle');
    const content = document.getElementById('toolbarPanelContent');
    if (!panel || !content) return;
    if (titleEl) titleEl.textContent = title;
    content.innerHTML = html;
    panel.style.display = 'block';
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

// 飞船货仓面板内容（飞行工具栏入口）— 仅显示 ship.cargo，不含自带燃料
// 0.2.7 分区布局：容量区 + 货物清单区（按类别分组，参考图行样式）
function buildShipCargoContent(ship) {
    const cap = getCargoCapacity(ship);
    const used = getCargoUsed(ship);

    // 分区一：货仓容量（共享池进度条）
    let html = '<div class="tkp-section">' + t('cargo.sectionCapacity') + '</div>'
        + '<div class="tkp-card-sm">' + storageRowHtml('—', used, cap) + '</div>';

    // 分区二：货物清单（按类别分组）
    html += '<div class="tkp-section">' + t('cargo.sectionCargo') + '</div>';
    const cargoEntries = Object.entries(ship.cargo || {}).filter(([, slot]) => slot && slot.amount > 0);
    if (cargoEntries.length === 0) {
        html += '<div class="tkp-card-sm"><div class="tkp-hint" style="margin:0;">' + t('cargo.empty') + '</div></div>';
    } else {
        html += '<div class="tkp-card-sm">'
            + storageGroupedHtml(
                cargoEntries.map(([resId]) => resId),
                (resId) => {
                    const slot = ship.cargo[resId];
                    return slot || { amount: 0, capacity: 0 };
                })
            + '</div>';
    }
    // 明确提示：自带燃料（燃料罐）不在货仓
    html += '<div class="tkp-hint-muted">' + t('cargo.fuelNote') + '</div>';
    return html;
}

// 扫描菜单内容（0.2.0 阶段6；0.2.7 分区布局整改：目标卡 + 资源行 + 操作区）
function buildScanContent(ship) {
    const bodyId = ship.currentSOI;
    const body = celestialBodies.find(b => b.name === bodyId);

    // 深空无宿主 → 卡片内提示
    if (!bodyId || !body) {
        return '<div class="tkp-section">' + t('scan.targetSection') + '</div>'
            + '<div class="tkp-card"><div class="tkp-hint" style="margin:0;">' + t('scan.deepSpace') + '</div></div>';
    }

    const tier = getShipScanTier(ship);
    const bodyTexKey = body.textureKey ? body.textureKey + '_surface' : null;

    // 分区一：扫描目标大卡片（左图右文，对齐参考图 IdentityCard）
    let html = '<div class="tkp-section">' + t('scan.targetSection') + '</div>'
        + '<div class="tkp-card">'
        + '<div class="tkp-card-main">'
        + '<div class="tkp-card-icon">' + renderIconHtml(bodyTexKey, '🪐', 72) + '</div>'
        + '<div class="tkp-card-info">'
        + '<div class="tkp-card-title">' + body.name + '</div>'
        + '<div class="tkp-sub">' + t('scan.scannerTier', { tier: tier }) + '</div>'
        + '<div class="tkp-desc">' + t('scan.cardDesc') + '</div>'
        + '</div>'
        + '</div>'
        + '</div>';

    // 分区二：资源丰度列表（扫描等级内可见的资源，+++++ 条 + 百分比）
    // 行列表放入次级卡片（二级背景），与目标卡形成层级
    html += '<div class="tkp-section">' + t('scan.resourcesSection') + '</div>';
    const visible = getVisibleBodyResources(bodyId);
    const entries = Object.entries(visible);
    if (entries.length === 0) {
        html += '<div class="tkp-card-sm"><div class="tkp-hint" style="margin:0;">' + t('scan.noResources') + '</div></div>';
    } else {
        html += '<div class="tkp-card-sm"><div class="tkp-rows">';
        for (const [resId, info] of entries) {
            const def = getResourceType(resId);
            const name = def ? def.name : resId;
            const pct = Math.round((info.abundance ?? 0) * 100);
            const barLen = Math.max(0, Math.round(pct / 10));   // 每 10% 一个 +
            const bar = '+'.repeat(barLen);
            // 资源绿 #8c8：纯状态色、无对应变量，按规范允许内联例外（与旧实现一致）
            html += '<div class="tkp-row">'
                + '<span class="tkp-row-label">' + name + '</span>'
                + '<span style="flex:1;color:#8c8;font-family:var(--font-mono-bold);font-size:11px;'
                + 'letter-spacing:1px;white-space:nowrap;overflow:hidden;">' + bar + '</span>'
                + '<span class="tkp-row-value" style="width:44px;color:#8c8;text-align:right;">' + pct + '%</span>'
                + '</div>';
        }
        html += '</div>';   // 关闭 .tkp-rows
        html += '</div>';   // 关闭 .tkp-card-sm
    }

    // 扫描状态区：进行中显示进度条 + 取消；否则显示开始扫描按钮
    const progress = getScanProgress(bodyId);
    if (progress && progress.scanning) {
        const pct = progress.scanDuration > 0
            ? Math.min(100, progress.progress / progress.scanDuration * 100)
            : 0;
        const daysLeft = Math.max(0, (progress.scanDuration - progress.progress) / GAME_DAY_SECONDS);
        html += '<div id="scanProgressSection" data-body-id="' + bodyId + '" class="tkp-progress-wrap">'
            + '<div class="tkp-progress-head">'
            + '<span>' + t('scan.inProgress', { tier: progress.scanTier }) + '</span>'
            + '<span id="scanProgressText">' + pct.toFixed(1) + '% · ' + t('scan.daysLeft', { d: daysLeft.toFixed(2) }) + '</span>'
            + '</div>'
            + '<div class="tkp-progress">'
            + '<div id="scanProgressBar" class="tkp-progress-bar" style="width:' + pct + '%;"></div>'
            + '</div>'
            + '</div>'
            + '<div class="tkp-actions">'
            + '<button data-action="cancel-scan" class="tkp-btn">' + t('scan.cancel') + '</button>'
            + '</div>';
    } else {
        const knownTier = gameState.getState().player.scannedBodies?.[bodyId]?.tiersScanned || 0;
        const duration = getScanDuration(bodyId, tier);
        const durationDays = duration / GAME_DAY_SECONDS;
        html += '<div class="tkp-actions">'
            + '<button data-action="start-scan" class="tkp-btn-primary">' + t('scan.startBtn', { d: durationDays.toFixed(1) }) + '</button>'
            + '</div>';
        // 已扫等级提示（可继续用更高级扫描仪深扫）
        if (knownTier > 0) {
            html += '<div class="tkp-hint-muted">' + t('scan.knownTier', { tier: knownTier }) + '</div>';
        }
    }
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
            (resId) => (facility.storage && facility.storage[resId]) || { amount: 0, capacity: 0 },
            {
                right: (resId) => '<button data-action="transfer-out" data-res-id="' + resId + '" class="tkp-btn" style="flex:none;height:20px;padding:0 8px;font-size:10px;">' + t('facility.transfer') + '</button>'
            })
        + '</div>';
    return html;
}

// 设施间调拨流程：行内调拨按钮 → 选目标设施 → 输入数量 → 转移
function startFacilityTransfer(fromFacility, resId) {
    const others = facilitySystem.getAllFacilities().filter(f => f.id !== fromFacility.id);
    if (others.length === 0) {
        window.showNotification(t('facility.noOtherFacilities'), 'warning');
        return;
    }
    // 临时 dialog：uiComponents.createDialog 依赖 window 绑定，直接内联构建列表
    window.__createDialog(
        t('facility.transferTarget'),
        others.map(f => ({ id: f.id, name: f.name })),
        (toFacilityId) => {
            const toFacility = facilitySystem.getFacility(toFacilityId);
            if (!toFacility) return;
            const available = getStorageAmount(fromFacility, resId);
            window.__createInputDialog(
                t('facility.transferAmount', {
                    name: getResourceType(resId)?.name || resId,
                    from: fromFacility.name,
                    to: toFacility.name,
                    max: Math.floor(available)
                }),
                '',
                String(Math.floor(available)),
                (valStr) => {
                    const amount = parseFloat(valStr);
                    if (isNaN(amount) || amount <= 0) {
                        window.showNotification(t('build.invalidNumber'), 'error');
                        return;
                    }
                    const moved = transferBetweenFacilities(fromFacility, toFacility, resId, amount);
                    if (moved > 0) {
                        facilitySystem.persistFacility(fromFacility);
                        facilitySystem.persistFacility(toFacility);
                        window.showNotification(t('cargo.transferred', { n: Math.floor(moved) }), 'success');
                    } else {
                        window.showNotification(t('cargo.transferFailed'), 'error');
                    }
                    // 刷新货物表面板
                    openUtilityPanel(t('facility.storage'), buildFacilityStorageContent(fromFacility));
                }
            );
        }
    );
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
                + renderIconHtml(def?.iconTextureKey, def?.icon, 12) + ' ' + (def ? def.name : mod.type) + '</span>'
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
            openUtilityPanel(t('dock.moduleManage'), buildModuleManageContent(facilitySystem.getFacility(facility.id), shipId));
        }
    });
}

// 货仓调拨面板（对接枢纽入口，需飞船有货运模块）— 船舱 ↔ 设施存储 双向
// 0.2.7 v2 分组卡样式：与设施仓储/货仓同款（分类卡+紫头顶条+条外文字+折叠），行尾 →← 按钮
function buildCargoTransferContent(facility, shipId) {
    const ship = facility.dockedShips.find(s => s.id === shipId);
    if (!ship) return '<div class="tkp-card"><div class="tkp-hint" style="margin:0;">' + t('facility.unknownCompartment') + '</div></div>';

    const cap = getCargoCapacity(ship);
    const used = getCargoUsed(ship);

    // 限定显示资源：任一侧有量 或 设施有容量槽（参考仓储全量语义，但过滤无槽项的 0/0 死行）
    const transferResIds = STORAGE_RESOURCE_IDS.filter((resId) => {
        const slot = facility.storage && facility.storage[resId];
        return getCargoAmount(ship, resId) > 0 || (slot && (slot.amount > 0 || slot.capacity > 0));
    });

    let html = '<div class="tkp-section">' + t('cargo.transferSection') + '</div>'
        + '<div class="tkp-hint-muted" style="text-align:left;margin:0 0 8px;">'
        + t('dock.cargoShip', { name: ship.displayName || ship.id }) + ' · '
        + t('cargo.capacityShort') + ' ' + Math.floor(used) + '/' + Math.floor(cap)
        + '</div>';

    if (transferResIds.length === 0) {
        html += '<div class="tkp-card-sm"><div class="tkp-hint" style="margin:0;">' + t('cargo.empty') + '</div></div>';
    } else {
        html += '<div class="tkp-card-sm">'
            + storageGroupedHtml(
                transferResIds,
                (resId) => {
                    const slot = facility.storage && facility.storage[resId];
                    return slot || { amount: 0, capacity: 0 };
                },
                {
                    amountWidth: 110,
                    // 双值：设施 → 船（条显示设施侧容量）
                    value: (resId) => t('cargo.facToShip', {
                        fac: Math.floor((facility.storage && facility.storage[resId]) ? facility.storage[resId].amount : 0),
                        ship: Math.floor(getCargoAmount(ship, resId))
                    }),
                    right: (resId) => '<button data-action="load-cargo" data-ship-id="' + shipId + '" data-res-id="' + resId + '" class="tkp-btn">→</button>'
                        + '<button data-action="unload-cargo" data-ship-id="' + shipId + '" data-res-id="' + resId + '" class="tkp-btn">←</button>'
                })
            + '</div>';
    }
    html += '<div class="tkp-hint-muted">' + t('cargo.fuelNote') + '</div>';
    return html;
}

// 调拨数量输入（船↔设施共用；dir: 'load' 设施→船 | 'unload' 船→设施）
function promptTransferAmount(facility, shipId, resId, dir) {
    const ship = facility.dockedShips.find(s => s.id === shipId);
    if (!ship) return;
    const max = dir === 'load'
        ? getStorageAmount(facility, resId)
        : getCargoAmount(ship, resId);
    if (max <= 0) return;
    const def = getResourceType(resId);
    window.__createInputDialog(
        t(dir === 'load' ? 'cargo.loadAmount' : 'cargo.unloadAmount', {
            name: def ? def.name : resId, max: Math.floor(max)
        }),
        '',
        String(Math.floor(max)),
        (valStr) => {
            const amount = parseFloat(valStr);
            if (isNaN(amount) || amount <= 0) {
                window.showNotification(t('build.invalidNumber'), 'error');
                return;
            }
            const moved = dir === 'load'
                ? transferStorageToCargo(facility, ship, resId, amount)
                : transferCargoToStorage(ship, facility, resId, amount);
            if (moved > 0) {
                facilitySystem.persistFacility(facility);
                window.showNotification(t('cargo.transferred', { n: Math.floor(moved) }), 'success');
            } else {
                window.showNotification(t('cargo.transferFailed'), 'error');
            }
            const updated = facilitySystem.getFacility(facility.id);
            _currentFacility = updated;
            openUtilityPanel(t('dock.cargoHold'), buildCargoTransferContent(updated, shipId));
        }
    );
}

// ========== 舱室内容渲染 ==========
function openCompartmentPanel(facility, compartmentId) {
    const panel = document.getElementById('toolbarPanel');
    const title = document.getElementById('toolbarPanelTitle');
    const content = document.getElementById('toolbarPanelContent');
    if (!panel || !content) return;

    const compDef = getCompartmentDef(compartmentId);
    if (title) title.textContent = compDef ? compDef.name : compartmentId;

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

    content.innerHTML = html;
    panel.style.display = 'block';

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

    // 分区二：当前受控飞船卡（仅当存在）
    if (_controlledDockedShipId) {
        const ship = facility.dockedShips?.find(s => s.id === _controlledDockedShipId);
        if (ship) {
            html += '<div class="tkp-section">' + t('facility.controlSection') + '</div>'
                + '<div class="tkp-card">'
                + '<div style="font-size:13px;color:var(--text-bright);font-weight:bold;margin-bottom:8px;">'
                + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div class="tkp-grid" style="margin-bottom:10px;">';
            html += info(t('facility.dryMassLabel'), (ship.dryMass ?? '-') + ' t');
            html += info(t('facility.modulesLabel'), (ship.modules?.length || 0) + t('common.unitCount'));
            html += '</div>'
                // 0.2.0 阶段4：燃料分槽进度条（每种推进剂独立一条，占满整行）
                + '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">'
                + '<span class="tkp-info-label">' + t('facility.fuelLabel') + '</span>'
                + renderFuelBarsHtml(ship)
                + '</div>'
                + '<button data-action="release-control" class="tkp-btn">' + t('facility.backToOverview') + '</button>'
                + '</div>';
        }
    }
    return html;
}

// 对接枢纽内容（0.2.7 分区布局：对接操作区 + 停靠飞船卡网格）
function buildDockHubContent(facility) {
    const activeShip = window.__shipSystem?.getActiveShip();
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
                // 0.2.0 阶段5：切换控制改为模块管理 + 起飞；有货运模块的船追加货仓调拨入口
                html += '<div style="display:flex;gap:6px;margin-top:2px;">'
                    + '<button data-action="module-manage" data-ship-id="' + ship.id + '" class="tkp-btn" style="flex:1;height:24px;padding:0;font-size:11px;">' + t('dock.moduleManage') + '</button>'
                    + '<button data-action="undock-ship" data-ship-id="' + ship.id + '" class="tkp-btn" style="flex:1;height:24px;padding:0;font-size:11px;color:#8f8;border-color:#484;">' + t('dock.takeoff') + '</button>'
                    + '</div>';
                if (hasCargoHold(ship)) {
                    html += '<button data-action="cargo-transfer" data-ship-id="' + ship.id + '" class="tkp-btn" style="height:24px;padding:0;font-size:11px;color:#8c8;border-color:#484;">' + t('dock.cargoHold') + '</button>';
                }
            }
            html += '</div>';
        }
        html += '</div>';
    }
    return html;
}

function bindDockHubEvents(facility) {
    const dockBtn = document.getElementById('dockCurrentShipBtn');
    if (dockBtn) {
        dockBtn.addEventListener('click', () => {
            const activeShip = window.__shipSystem?.getActiveShip();
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

// 扫描菜单进度实时刷新（0.2.0 阶段6）：面板可见且进度区存在时，每 500ms 重算进度条
setInterval(() => {
    const panel = document.getElementById('toolbarPanel');
    const section = document.getElementById('scanProgressSection');
    if (!panel || panel.style.display === 'none' || !section) return;
    const bodyId = section.dataset.bodyId;
    if (!bodyId) return;
    const p = getScanProgress(bodyId);
    // 扫描结束/取消（scanning=false）：重新渲染菜单，进度条区切回"开始扫描"按钮
    // （原实现只 return，导致完成后进度条残留、按钮不变回）
    if (p && !p.scanning) {
        const ship = gameState.getActiveShip();
        if (ship) openUtilityPanel(t('scan.menuTitle'), buildScanContent(ship));
        return;
    }
    if (!p || !p.scanning) return;
    const pct = p.scanDuration > 0 ? Math.min(100, p.progress / p.scanDuration * 100) : 0;
    const bar = document.getElementById('scanProgressBar');
    const text = document.getElementById('scanProgressText');
    if (bar) bar.style.width = pct + '%';
    if (text) {
        const daysLeft = Math.max(0, (p.scanDuration - p.progress) / GAME_DAY_SECONDS);
        text.textContent = pct.toFixed(1) + '% · ' + t('scan.daysLeft', { d: daysLeft.toFixed(2) });
    }
}, 500);

// 全局辅助函数：获取当前受控设施（建造扣费等外部面板使用，0.2.0 阶段5）
window.__getControlledFacility = function() {
    return _currentFacility;
};

// 全局辅助函数：释放停靠飞船控制权
function releaseShipControl() {
    _controlledDockedShipId = null;
    if (_currentFacility) {
        openCompartmentPanel(_currentFacility, 'bridge');
    }
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

const dockPromptEl = document.createElement('div');
dockPromptEl.id = 'dockPrompt';
dockPromptEl.style.display = 'none';
dockPromptEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="color:var(--text-mid);font-size:12px;">${t('dock.promptDock')}</span>
            <span id="dockPromptFacName">${t('facility.typeName')}</span>
        </div>
        <button id="dockPromptBtn" class="ui-btn" style="padding:5px 14px;background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent);font-size:13px;">${t('dock.promptBtn')}</button>
    </div>
`;
document.body.appendChild(dockPromptEl);

document.getElementById('dockPromptBtn').addEventListener('click', () => {
    if (_dockCallback) _dockCallback();
});

window.showDockPrompt = function(facility, onDock) {
    if (!facility) return;
    document.getElementById('dockPromptFacName').textContent = facility.name || t('facility.typeName');
    _dockCallback = onDock;
    dockPromptEl.style.display = 'block';
};

window.hideDockPrompt = function() {
    dockPromptEl.style.display = 'none';
    _dockCallback = null;
};

// 统一工具栏 — 浮层面板（舱室内容显示容器，0.2.7 页头升级为 KSP2 风格 .tkp-header）
const toolbarPanel = document.createElement('div');
toolbarPanel.id = 'toolbarPanel';
toolbarPanel.style.display = 'none';
toolbarPanel.innerHTML = `
    <div class="tkp-header">
        <span id="toolbarPanelTitle" class="tkp-title">${t('facility.typeName')}</span>
        <button id="toolbarPanelCloseBtn" class="tkp-close">✕</button>
    </div>
    <div id="toolbarPanelContent"></div>
`;
document.body.appendChild(toolbarPanel);

const toolbarPanelContentEl = document.getElementById('toolbarPanelContent');
if (toolbarPanelContentEl) {
    toolbarPanelContentEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const shipId = btn.dataset.shipId;
        const resId = btn.dataset.resId;
        if (action === 'release-control') {
            releaseShipControl();
        } else if (action === 'undock-ship') {
            facilityUndockShip(shipId);
        } else if (action === 'refuel-ship') {
            facilityRefuelShip(shipId);
        } else if (action === 'open-storage') {
            // 0.2.0 阶段5：指令舱 → 设施货物表
            if (_currentFacility) openUtilityPanel(t('facility.storage'), buildFacilityStorageContent(_currentFacility));
        } else if (action === 'transfer-out') {
            // 0.2.0 阶段5：设施间资源调拨（货物表行内按钮）
            if (_currentFacility && resId) startFacilityTransfer(_currentFacility, resId);
        } else if (action === 'module-manage') {
            // 0.2.0 阶段5：对接枢纽 → 模块管理
            if (_currentFacility) openUtilityPanel(t('dock.moduleManage'), buildModuleManageContent(_currentFacility, shipId));
        } else if (action === 'install-module') {
            if (_currentFacility) showFacilityModuleSelector(_currentFacility, shipId, btn);
        } else if (action === 'uninstall-module') {
            if (_currentFacility && btn.dataset.modId) {
                facilitySystem.removeModuleFromShip(_currentFacility.id, shipId, btn.dataset.modId);
                const updated = facilitySystem.getFacility(_currentFacility.id);
                _currentFacility = updated;
                window.showNotification(t('dock.moduleRemoved'), 'info');
                openUtilityPanel(t('dock.moduleManage'), buildModuleManageContent(updated, shipId));
            }
        } else if (action === 'cargo-transfer') {
            // 0.2.0 阶段5：对接枢纽 → 货仓调拨（船舱 ↔ 设施存储）
            if (_currentFacility) openUtilityPanel(t('dock.cargoHold'), buildCargoTransferContent(_currentFacility, shipId));
        } else if (action === 'load-cargo') {
            if (_currentFacility) promptTransferAmount(_currentFacility, shipId, resId, 'load');
        } else if (action === 'unload-cargo') {
            if (_currentFacility) promptTransferAmount(_currentFacility, shipId, resId, 'unload');
        } else if (action === 'start-scan') {
            // 0.2.0 阶段6：开始扫描（失败分支通知提示，含"资源已知"）
            const ship = window.__shipSystem?.getActiveShip();
            if (ship && ship.currentSOI) {
                const result = startScan(ship, ship.currentSOI);
                if (!result.ok) {
                    window.showNotification(
                        t('scan.reason.' + result.reason, { name: ship.currentSOI, tier: getShipScanTier(ship) }),
                        'warning'
                    );
                }
                openUtilityPanel(t('scan.menuTitle'), buildScanContent(ship));
            }
        } else if (action === 'cancel-scan') {
            const ship = window.__shipSystem?.getActiveShip();
            cancelScan();
            if (ship) openUtilityPanel(t('scan.menuTitle'), buildScanContent(ship));
        } else if (action === 'toggle-res-group') {
            // 0.2.7 资源分类折叠（DOM class 切换，折叠后仅剩紫色顶头）
            const card = btn.closest('.tkp-res-group-card');
            if (card) card.classList.toggle('collapsed');
        }
    });
}

document.getElementById('toolbarPanelCloseBtn').addEventListener('click', () => {
    toolbarPanel.style.display = 'none';
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
        toolbarPanel.style.display = 'none';
        // 兜底隐藏对接提示框，防止场景切换时遗留
        window.hideDockPrompt?.();
    }
    uiManager.hidePanel('esc');
});
