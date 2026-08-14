'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityCompartments, getFacilityType, getCompartmentDef } from '../facility/facilityTypes.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml } from './uiComponents.js';
import { getFuelAmount, getFuelCapacity } from '../resources/resourceSystem.js';
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
        btn.title = title;

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

            if (def.capability === 'deploy_facility') {
                createIcon('🔧', t('facility.deploy'), () => {
                    window.openFacilityDeployPanel();
                }, 'icon_deploy_facility');
            }
            // 后续扩展：更多 capability → 图标映射
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

    html += card(t('facility.hostBody'), facility.hostSOI || '-', '#aaa');
    html += '<div style="margin-top:8px;">' + card(t('facility.interactionRange'), (facility.interactionRange || '-') + t('facility.rangeUnit'), '#aaa') + '</div>';

    if (_controlledDockedShipId) {
        const ship = facility.dockedShips?.find(s => s.id === _controlledDockedShipId);
        if (ship) {
            html += '<hr style="border:none;border-top:1px solid #444;margin:12px 0;">';
            html += `<div style="color:#88ccff;font-size:13px;margin-bottom:8px;">${renderIconHtml('ship_default_active', '🚀', 12)} ${t('facility.currentControl')}${ship.displayName || ship.id}</div>`;
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">';
            html += card(t('facility.fuelLabel'), getFuelAmount(ship).toFixed(0) + ' / ' + getFuelCapacity(ship).toFixed(0));
            html += card(t('facility.dryMassLabel'), (ship.dryMass ?? '-') + ' t');
            html += card(t('facility.modulesLabel'), (ship.modules?.length || 0) + t('common.unitCount'));
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
            const fuelPct = getFuelCapacity(ship) > 0 ? (getFuelAmount(ship) / getFuelCapacity(ship) * 100) : 0;
            html += '<div style="background:#333;border:1px solid #555;border-radius:3px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:#aaa;margin-bottom:6px;font-weight:bold;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="margin-bottom:6px;">'
                + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">'
                + '<span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;">'
                + '<span style="display:inline-block;width:' + fuelPct + '%;height:100%;background:#4c4;border-radius:3px;"></span>'
                + '</span>'
                + '<span style="font-size:10px;color:#888;">' + fuelPct.toFixed(0) + '%</span>'
                + '</div>'
                + '<div style="font-size:10px;color:#666;">' + t('dock.modulesCount', { n: ship.modules?.length || 0 }) + '</div>'
                + '</div>';
            if (!activeShip) {
                html += '<div style="display:flex;gap:6px;">'
                    + '<button data-action="switch-control" data-ship-id="' + ship.id + '" style="'
                    + 'flex:1;padding:5px 0;background:#333;color:#ccc;border:1px solid #555;'
                    + 'border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;'
                    + '">' + t('dock.switchControl') + '</button>'
                    + '<button data-action="undock-ship" data-ship-id="' + ship.id + '" style="'
                    + 'flex:1;padding:5px 0;background:#333;color:#8f8;border:1px solid #484;'
                    + 'border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;'
                    + '">' + t('dock.takeoff') + '</button>'
                    + '</div>';
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
            const fuelPct = getFuelCapacity(ship) > 0 ? (getFuelAmount(ship) / getFuelCapacity(ship) * 100) : 0;
            html += '<div style="background:#333;border:1px solid #555;border-radius:3px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:#aaa;margin-bottom:6px;font-weight:bold;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="margin-bottom:8px;">'
                + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">'
                + '<span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;">'
                + '<span style="display:inline-block;width:' + fuelPct + '%;height:100%;background:#cc4;border-radius:3px;"></span>'
                + '</span>'
                + '<span style="font-size:10px;color:#888;">' + fuelPct.toFixed(0) + '%</span>'
                + '</div>'
                + '<div style="font-size:10px;color:#666;">' + getFuelAmount(ship).toFixed(0) + ' / ' + getFuelCapacity(ship).toFixed(0) + '</div>'
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

// 全局辅助函数：释放停靠飞船控制权
function releaseShipControl() {
    _controlledDockedShipId = null;
    if (_currentFacility) {
        openCompartmentPanel(_currentFacility, 'bridge');
    }
};

// 全局辅助函数：切换控制到停靠飞船
function facilitySwitchControl(shipId) {
    _controlledDockedShipId = shipId;
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

// 全局辅助函数：补给燃料
function facilityRefuelShip(shipId) {
    if (_currentFacility) {
        facilitySystem.refuelShip(_currentFacility.id, shipId);
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
        if (action === 'release-control') {
            releaseShipControl();
        } else if (action === 'switch-control') {
            facilitySwitchControl(shipId);
        } else if (action === 'undock-ship') {
            facilityUndockShip(shipId);
        } else if (action === 'refuel-ship') {
            facilityRefuelShip(shipId);
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
