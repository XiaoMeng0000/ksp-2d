'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { gameState } from '../gameState.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityCompartments, getFacilityType, getCompartmentDef } from '../facility/facilityTypes.js';
import { getModuleDef, getModuleCategories, getModulesByCategory, getCapabilityToolbar } from '../ship/moduleTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml, renderFuelBarsHtml } from './uiComponents.js';
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

// 资源行（货仓/存储共用）：图标名 [进度条] 数量/容量
function storageRowHtml(resId, amount, capacity, opts = {}) {
    const def = getResourceType(resId);
    const name = def ? def.name : resId;
    const pct = capacity > 0 ? Math.min(100, Math.max(0, amount / capacity * 100)) : 0;
    const color = opts.color || 'var(--accent)';
    const rightHtml = opts.right || '';
    const capText = capacity > 0 ? ' / ' + Math.floor(capacity) : '';
    return '<div style="display:flex;align-items:center;gap:6px;">'
        + '<span style="width:88px;flex-shrink:0;color:#888;font-size:11px;text-align:right;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</span>'
        + '<span style="flex:1;display:inline-block;height:6px;background:#333;border-radius:3px;overflow:hidden;">'
        + '<span style="display:block;width:' + pct + '%;height:100%;background:' + color + ';border-radius:3px;"></span></span>'
        + '<span style="width:70px;flex-shrink:0;color:#888;font-size:10px;white-space:nowrap;">'
        + Math.floor(amount) + capText + '</span>'
        + rightHtml
        + '</div>';
}

// 飞船货仓面板内容（飞行工具栏入口）— 仅显示 ship.cargo，不含自带燃料
function buildShipCargoContent(ship) {
    const cap = getCargoCapacity(ship);
    const used = getCargoUsed(ship);
    const pct = cap > 0 ? (used / cap * 100) : 0;

    let html = '<div style="margin-bottom:10px;">'
        + '<div style="color:var(--text-dim);font-size:10px;margin-bottom:4px;">' + t('cargo.capacity') + '</div>'
        + storageRowHtml('—', used, cap)
        + '</div>';
    html += '<hr class="ui-divider" style="margin:8px 0;">';

    const cargoEntries = Object.entries(ship.cargo || {}).filter(([, slot]) => slot && slot.amount > 0);
    if (cargoEntries.length === 0) {
        html += '<div style="color:#555;font-size:11px;text-align:center;padding:14px 0;">' + t('cargo.empty') + '</div>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:4px;">';
        for (const [resId, slot] of cargoEntries) {
            html += storageRowHtml(resId, slot.amount, cap, { color: '#8c8' });
        }
        html += '</div>';
    }
    // 明确提示：自带燃料（燃料罐）不在货仓
    html += '<div style="color:#555;font-size:10px;margin-top:10px;">' + t('cargo.fuelNote') + '</div>';
    return html;
}

// 扫描菜单内容（0.2.0 阶段6：当前星球图标 + 资源丰度条 + 开始扫描/进度）
function buildScanContent(ship) {
    const bodyId = ship.currentSOI;
    const body = celestialBodies.find(b => b.name === bodyId);

    // 深空无宿主 → 提示
    if (!bodyId || !body) {
        return '<div style="color:#555;font-size:12px;text-align:center;padding:20px 0;">' + t('scan.deepSpace') + '</div>';
    }

    const tier = getShipScanTier(ship);
    const bodyTexKey = body.textureKey ? body.textureKey + '_surface' : null;

    // 头部：星球图标 + 名称
    let html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
        + '<span style="width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;'
        + 'flex-shrink:0;">' + renderIconHtml(bodyTexKey, '🪐', 36) + '</span>'
        + '<div>'
        + '<div style="color:var(--accent);font-size:14px;font-weight:bold;">' + body.name + '</div>'
        + '<div style="color:var(--text-dim);font-size:10px;">' + t('scan.scannerTier', { tier: tier }) + '</div>'
        + '</div>'
        + '</div>';
    html += '<hr class="ui-divider" style="margin:8px 0;">';

    // 资源丰度列表（扫描等级内可见的资源，+++++ 条 + 百分比）
    const visible = getVisibleBodyResources(bodyId);
    const entries = Object.entries(visible);
    if (entries.length === 0) {
        html += '<div style="color:#555;font-size:11px;text-align:center;padding:14px 0;">' + t('scan.noResources') + '</div>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px;">';
        for (const [resId, info] of entries) {
            const def = getResourceType(resId);
            const name = def ? def.name : resId;
            const pct = Math.round((info.abundance ?? 0) * 100);
            const barLen = Math.max(0, Math.round(pct / 10));   // 每 10% 一个 +
            const bar = '+'.repeat(barLen);
            html += '<div style="display:flex;align-items:center;gap:8px;">'
                + '<span style="width:80px;flex-shrink:0;color:#888;font-size:11px;text-align:right;'
                + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</span>'
                + '<span style="flex:1;color:#8c8;font-family:var(--font-mono-bold);font-size:11px;'
                + 'letter-spacing:1px;white-space:nowrap;overflow:hidden;">' + bar + '</span>'
                + '<span style="width:44px;flex-shrink:0;color:#8c8;font-size:11px;text-align:right;">' + pct + '%</span>'
                + '</div>';
        }
        html += '</div>';
    }

    // 扫描状态区：进行中显示进度条；否则显示开始扫描按钮
    const progress = getScanProgress(bodyId);
    if (progress && progress.scanning) {
        const pct = progress.scanDuration > 0
            ? Math.min(100, progress.progress / progress.scanDuration * 100)
            : 0;
        const daysLeft = Math.max(0, (progress.scanDuration - progress.progress) / GAME_DAY_SECONDS);
        html += '<hr class="ui-divider" style="margin:8px 0;">'
            + '<div id="scanProgressSection" data-body-id="' + bodyId + '" style="display:flex;flex-direction:column;gap:5px;">'
            + '<div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:10px;">'
            + '<span>' + t('scan.inProgress', { tier: progress.scanTier }) + '</span>'
            + '<span id="scanProgressText">' + pct.toFixed(1) + '% · ' + t('scan.daysLeft', { d: daysLeft.toFixed(2) }) + '</span>'
            + '</div>'
            + '<div style="height:8px;background:#333;border-radius:4px;overflow:hidden;">'
            + '<div id="scanProgressBar" style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:4px;'
            + 'transition:width 0.3s ease;"></div>'
            + '</div>'
            + '<button data-action="cancel-scan" style="margin-top:4px;padding:6px 0;background:var(--danger-solid-bg);'
            + 'color:var(--danger-solid);border:1px solid var(--danger-solid-border);border-radius:3px;cursor:pointer;'
            + 'font-family:var(--font-mono);font-size:11px;">' + t('scan.cancel') + '</button>'
            + '</div>';
    } else {
        const knownTier = gameState.getState().player.scannedBodies?.[bodyId]?.tiersScanned || 0;
        const duration = getScanDuration(bodyId, tier);
        const durationDays = duration / GAME_DAY_SECONDS;
        html += '<button data-action="start-scan" style="'
            + 'width:100%;padding:8px 0;background:var(--accent-bg);color:var(--accent);'
            + 'border:1px solid var(--accent-border);border-radius:3px;cursor:pointer;'
            + 'font-family:var(--font-mono);font-size:12px;'
            + '">' + t('scan.startBtn', { d: durationDays.toFixed(1) }) + '</button>';
        // 已扫等级提示（可继续用更高级扫描仪深扫）
        if (knownTier > 0) {
            html += '<div style="color:var(--text-dim);font-size:10px;text-align:center;margin-top:6px;">'
                + t('scan.knownTier', { tier: knownTier }) + '</div>';
        }
    }
    return html;
}

// 设施货物表（指令舱入口）— 全资源 amount/capacity + 行内调拨按钮
function buildFacilityStorageContent(facility) {
    let html = '<div style="color:var(--text-dim);font-size:10px;margin-bottom:8px;">'
        + t('facility.storageHint') + '</div>';
    let any = false;
    html += '<div style="display:flex;flex-direction:column;gap:4px;">';
    for (const resId of STORAGE_RESOURCE_IDS) {
        const slot = facility.storage && facility.storage[resId];
        if (!slot || (slot.amount <= 0 && slot.capacity <= 0)) continue;
        any = true;
        html += storageRowHtml(resId, slot.amount, slot.capacity, {
            color: '#8c8',
            right: '<button data-action="transfer-out" data-res-id="' + resId + '" class="ui-btn-sm" style="flex-shrink:0;padding:2px 8px;font-size:10px;">' + t('facility.transfer') + '</button>'
        });
    }
    html += '</div>';
    if (!any) {
        html += '<div style="color:#555;font-size:11px;text-align:center;padding:14px 0;">' + t('cargo.empty') + '</div>';
    }
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
function buildModuleManageContent(facility, shipId) {
    const ship = facility.dockedShips.find(s => s.id === shipId);
    if (!ship) return '<div style="color:#555;">' + t('facility.unknownCompartment') + '</div>';

    let html = '<div style="color:var(--text-dim);font-size:10px;margin-bottom:8px;">'
        + t('dock.moduleManageHint') + '</div>';

    const total = ship.moduleSlots || 0;
    if (total === 0) {
        return '<div style="color:#555;font-size:11px;text-align:center;padding:14px 0;">' + t('build.noSlots') + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">';
    for (let i = 0; i < total; i++) {
        const mod = ship.modules[i];
        if (mod) {
            const def = getModuleDef(mod.type);
            html += '<div style="background:#2a2a2a;border:1px solid #555;border-radius:3px;padding:6px 8px;display:flex;align-items:center;justify-content:space-between;gap:6px;">'
                + '<span style="font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + renderIconHtml(def?.iconTextureKey, def?.icon, 12) + ' ' + (def ? def.name : mod.type) + '</span>'
                + '<button data-action="uninstall-module" data-ship-id="' + shipId + '" data-mod-id="' + mod.id + '" class="ui-btn-sm" style="padding:2px 8px;font-size:10px;flex-shrink:0;">' + t('build.uninstall') + '</button>'
                + '</div>';
        } else {
            html += '<button data-action="install-module" data-ship-id="' + shipId + '" data-slot-index="' + i + '" '
                + 'style="background:#222;border:1px dashed #555;border-radius:3px;padding:6px 8px;cursor:pointer;'
                + 'color:#888;font-size:11px;font-family:var(--font-mono);">'
                + t('build.slotIndex', { i: i + 1 }) + ' · ' + t('dock.installModule') + '</button>';
        }
    }
    html += '</div>';
    return html;
}

// 模块安装选择弹窗（模块管理面板：空槽点击）
function showFacilityModuleSelector(facility, shipId, anchorEl) {
    const existing = document.querySelector('.module-selector-popup');
    if (existing) existing.remove();

    const rect = anchorEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'module-selector-popup';
    popup.style.cssText = `
        position:fixed;left:${Math.min(rect.right + 8, window.innerWidth - 220)}px;top:${rect.top}px;
        background:rgba(0,0,0,0.92);border:1px solid #555;border-radius:4px;
        padding:6px 0;min-width:200px;max-height:300px;overflow-y:auto;
        z-index:10001;font-family:var(--font-mono);font-size:12px;color:#ddd;
    `;

    const closeHandler = () => { popup.remove(); document.removeEventListener('click', closeHandler); };
    const escHandler = (e) => {
        if (e.key === 'Escape') { popup.remove(); document.removeEventListener('click', closeHandler); }
    };

    for (const cat of getModuleCategories()) {
        const header = document.createElement('div');
        header.style.cssText = 'padding:4px 10px;color:#88ccff;font-size:11px;';
        header.textContent = cat.name;
        popup.appendChild(header);

        for (const def of getModulesByCategory(cat.id)) {
            const row = document.createElement('div');
            row.style.cssText = 'padding:4px 10px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;';
            row.innerHTML = '<span>' + renderIconHtml(def.iconTextureKey, def.icon) + ' ' + def.name + '</span>'
                + '<span style="color:#cc8;font-size:10px;">' + (def.price > 0 ? def.price + t('economy.kitsUnit') : t('common.free')) + '</span>';
            row.addEventListener('mouseenter', () => { row.style.background = 'rgba(136,204,255,0.1)'; });
            row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const ok = facilitySystem.addModuleToShip(facility.id, shipId, def.id);
                if (!ok) {
                    window.showNotification(t('economy.insufficientKits'), 'error');
                } else {
                    window.showNotification(t('dock.moduleInstalled', { name: def.name }), 'success');
                }
                popup.remove();
                document.removeEventListener('click', closeHandler);
                openUtilityPanel(t('dock.moduleManage'), buildModuleManageContent(facilitySystem.getFacility(facility.id), shipId));
            });
            popup.appendChild(row);
        }
    }

    document.body.appendChild(popup);
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
        document.addEventListener('keydown', escHandler);
    }, 0);
}

// 货仓调拨面板（对接枢纽入口，需飞船有货运模块）— 船舱 ↔ 设施存储 双向
function buildCargoTransferContent(facility, shipId) {
    const ship = facility.dockedShips.find(s => s.id === shipId);
    if (!ship) return '<div style="color:#555;">' + t('facility.unknownCompartment') + '</div>';

    const cap = getCargoCapacity(ship);
    const used = getCargoUsed(ship);
    let html = '<div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:10px;margin-bottom:6px;">'
        + '<span>' + t('dock.cargoShip', { name: ship.displayName || ship.id }) + '</span>'
        + '<span>' + t('cargo.capacityShort') + ' ' + Math.floor(used) + '/' + Math.floor(cap) + '</span>'
        + '</div>';

    html += '<div style="display:flex;flex-direction:column;gap:4px;">';
    let any = false;
    for (const resId of STORAGE_RESOURCE_IDS) {
        const shipAmount = getCargoAmount(ship, resId);
        const slot = facility.storage && facility.storage[resId];
        const facAmount = slot ? slot.amount : 0;
        const facCap = slot ? slot.capacity : 0;
        if (shipAmount <= 0 && facAmount <= 0 && facCap <= 0) continue;
        any = true;
        const def = getResourceType(resId);
        const name = def ? def.name : resId;
        html += '<div style="display:flex;align-items:center;gap:6px;">'
            + '<span style="width:76px;flex-shrink:0;color:#888;font-size:10px;text-align:right;'
            + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</span>'
            + '<span style="flex:1;color:#aaa;font-size:10px;">' + t('cargo.facToShip', { fac: Math.floor(facAmount), ship: Math.floor(shipAmount) }) + '</span>'
            + '<button data-action="load-cargo" data-ship-id="' + shipId + '" data-res-id="' + resId + '" class="ui-btn-sm" style="padding:2px 8px;font-size:10px;flex-shrink:0;">→</button>'
            + '<button data-action="unload-cargo" data-ship-id="' + shipId + '" data-res-id="' + resId + '" class="ui-btn-sm" style="padding:2px 8px;font-size:10px;flex-shrink:0;">←</button>'
            + '</div>';
    }
    html += '</div>';
    if (!any) {
        html += '<div style="color:#555;font-size:11px;text-align:center;padding:14px 0;">' + t('cargo.empty') + '</div>';
    }
    html += '<div style="color:#555;font-size:10px;margin-top:10px;">' + t('cargo.fuelNote') + '</div>';
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
            html = '<div style="display:flex;align-items:center;justify-content:center;height:120px;color:#555;font-size:13px;">' + t('facility.bridgeResearch') + '</div>';
            break;
        default:
            html = '<div style="color:#555;">' + t('facility.unknownCompartment') + '</div>';
    }

    content.innerHTML = html;
    panel.style.display = 'block';

    // 舱室初始化钩子（绑定事件）
    if (compartmentId === 'dock_hub') bindDockHubEvents(facility);
}

function buildBridgeContent(facility) {
    const typeConfig = getFacilityType(facility.typeId);
    const typeName = typeConfig ? typeConfig.name : t('facility.typeName');
    const docksUsed = facility.usedDocks || 0;
    const docksMax = facility.maxDocks || 0;
    const pct = docksMax > 0 ? (docksUsed / docksMax * 100) : 0;

    const card = (label, value, accent) => `
        <div class="ui-card" style="padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0;">
            <span style="color:var(--text-dim);font-size:10px;">${label}</span>
            <span style="color:${accent || 'var(--text-mid)'};font-size:13px;font-weight:bold;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</span>
        </div>`;

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">';
    html += card(t('facility.nameLabel'), facility.name);
    html += card(t('facility.typeLabel'), typeName, '#88ccff');
    html += card(t('facility.dockLabel'),
        `<span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;vertical-align:middle;margin-right:6px;">
            <span style="display:inline-block;width:${pct}%;height:100%;background:#88ccff;border-radius:3px;"></span>
        </span> ${docksUsed} / ${docksMax}`, '#88ccff');
    html += card(t('facility.upgradeLabel'), (facility.upgradeLevel || 1) + t('facility.levelSuffix'));
    html += '</div>';

    // 0.2.0 阶段5：指令舱加入货物表入口（所属天体/交互范围卡片已按需求移除）
    html += '<button data-action="open-storage" style="'
        + 'width:100%;padding:8px;background:var(--accent-bg);color:var(--accent);'
        + 'border:1px solid var(--accent-border);border-radius:3px;cursor:pointer;'
        + 'font-family:var(--font-mono);font-size:12px;'
        + '">' + t('facility.storage') + '</button>';

    if (_controlledDockedShipId) {
        const ship = facility.dockedShips?.find(s => s.id === _controlledDockedShipId);
        if (ship) {
            html += '<hr style="border:none;border-top:1px solid #444;margin:12px 0;">';
            html += `<div style="color:#88ccff;font-size:13px;margin-bottom:8px;">${renderIconHtml('ship_default_active', '🚀', 12)} ${t('facility.currentControl')}${ship.displayName || ship.id}</div>`;
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">';
            html += card(t('facility.dryMassLabel'), (ship.dryMass ?? '-') + ' t');
            html += card(t('facility.modulesLabel'), (ship.modules?.length || 0) + t('common.unitCount'));
            // 0.2.0 阶段4：燃料分槽进度条（每种推进剂独立一条，占满整行）
            html += '<div style="grid-column:1 / -1;display:flex;flex-direction:column;gap:4px;">'
                + '<span style="color:var(--text-dim);font-size:10px;">' + t('facility.fuelLabel') + '</span>'
                + renderFuelBarsHtml(ship)
                + '</div>';
            html += '</div>';
            html += `<button data-action="release-control" style="
                padding:5px 16px;background:#333;color:#ccc;border:1px solid #555;
                border-radius:3px;cursor:pointer;font-family:monospace;font-size:12px;
            ">${t('facility.backToOverview')}</button>`;
        }
    }
    return html;
}

function buildDockHubContent(facility) {
    const activeShip = window.__shipSystem?.getActiveShip();
    let html = '';
    const freeDocks = (facility.maxDocks || 0) - (facility.usedDocks || 0);

    // 对接操作区
    if (activeShip && freeDocks > 0) {
        html += '<button id="dockCurrentShipBtn" style="'
            + 'width:100%;padding:8px;background:rgba(68,136,255,0.15);color:#88ccff;'
            + 'border:1px solid #448;border-radius:3px;cursor:pointer;'
            + 'font-family:monospace;font-size:12px;margin-bottom:12px;'
            + '">' + t('dock.dockCurrentShip', { name: (activeShip.displayName || activeShip.id), free: freeDocks }) + '</button>';
    } else if (activeShip && freeDocks <= 0) {
        html += '<div style="color:#c44;font-size:12px;margin-bottom:12px;padding:6px 10px;'
            + 'background:rgba(170,68,68,0.1);border:1px solid #644;border-radius:3px;">'
            + t('dock.docksFull', { max: (facility.maxDocks || 0) }) + '</div>';
    } else if (!activeShip) {
        html += '<div style="color:#666;font-size:11px;margin-bottom:10px;padding:4px 0;">' + t('dock.approachHint') + '</div>';
    }

    const dockedShips = facility.dockedShips || [];
    if (dockedShips.length === 0) {
        html += '<div style="color:#555;font-size:12px;text-align:center;padding:20px;">' + t('dock.noDockedShips') + '</div>';
    } else {
        html += '<div style="color:#666;font-size:11px;margin-bottom:8px;">' + t('dock.dockedShips', { n: dockedShips.length }) + '</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        for (const ship of dockedShips) {
            html += '<div style="background:#333;border:1px solid #555;border-radius:3px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:#aaa;margin-bottom:6px;font-weight:bold;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="margin-bottom:6px;display:flex;flex-direction:column;gap:4px;">'
                + renderFuelBarsHtml(ship)
                + '</div>'
                + '<div style="font-size:10px;color:#666;">' + t('dock.modulesCount', { n: ship.modules?.length || 0 }) + '</div>';
            if (!activeShip) {
                // 0.2.0 阶段5：切换控制改为模块管理 + 起飞；有货运模块的船追加货仓调拨入口
                html += '<div style="display:flex;gap:6px;margin-top:6px;">'
                    + '<button data-action="module-manage" data-ship-id="' + ship.id + '" style="'
                    + 'flex:1;padding:5px 0;background:#333;color:#ccc;border:1px solid #555;'
                    + 'border-radius:3px;cursor:pointer;font-family:var(--font-mono);font-size:11px;'
                    + '">' + t('dock.moduleManage') + '</button>'
                    + '<button data-action="undock-ship" data-ship-id="' + ship.id + '" style="'
                    + 'flex:1;padding:5px 0;background:#333;color:#8f8;border:1px solid #484;'
                    + 'border-radius:3px;cursor:pointer;font-family:var(--font-mono);font-size:11px;'
                    + '">' + t('dock.takeoff') + '</button>'
                    + '</div>';
                if (hasCargoHold(ship)) {
                    html += '<button data-action="cargo-transfer" data-ship-id="' + ship.id + '" style="'
                        + 'width:100%;margin-top:6px;padding:5px 0;background:#333;color:#8c8;border:1px solid #484;'
                        + 'border-radius:3px;cursor:pointer;font-family:var(--font-mono);font-size:11px;'
                        + '">' + t('dock.cargoHold') + '</button>';
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

function buildSupplyTerminalContent(facility) {
    let html = '';
    const dockedShips = facility.dockedShips || [];
    if (dockedShips.length === 0) {
        html += '<div style="color:#555;font-size:12px;text-align:center;padding:20px;">' + t('dock.noDockedShipsRefuel') + '</div>';
    } else {
        html += '<div style="color:#666;font-size:11px;margin-bottom:8px;">' + t('dock.refuelableShips', { n: dockedShips.length }) + '</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        for (const ship of dockedShips) {
            html += '<div style="background:#333;border:1px solid #555;border-radius:3px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:#aaa;margin-bottom:6px;font-weight:bold;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="margin-bottom:8px;display:flex;flex-direction:column;gap:4px;">'
                + renderFuelBarsHtml(ship)
                + (ship.engineOut
                    ? '<div style="font-size:10px;color:#e66;">' + t('dock.engineOut') + '</div>'
                    : '')
                + '</div>'
                + '<button data-action="refuel-ship" data-ship-id="' + ship.id + '" style="'
                + 'width:100%;padding:6px 0;background:#333;color:#cc4;border:1px solid #554;'
                + 'border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;'
                + '">' + t('dock.refuel') + '</button>'
                + '<div style="font-size:9px;color:#666;text-align:center;margin-top:4px;">' + t('dock.refuelCost') + '</div>'
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

// 统一工具栏 — 浮层面板（舱室内容显示容器）
const toolbarPanel = document.createElement('div');
toolbarPanel.id = 'toolbarPanel';
toolbarPanel.style.display = 'none';
toolbarPanel.innerHTML = `
    <div class="ui-panel-header">
        <span id="toolbarPanelTitle">${t('facility.typeName')}</span>
        <button id="toolbarPanelCloseBtn" class="ui-btn-sm">✕</button>
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
