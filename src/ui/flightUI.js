'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityCompartments, getFacilityType, getCompartmentDef } from '../facility/facilityTypes.js';
import { getModuleDef, getAllModules } from '../ship/moduleTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml } from './uiComponents.js';

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
leftToolbar.style.cssText = `
    position:fixed;left:15px;top:50%;transform:translateY(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:8px;display:flex;flex-direction:column;gap:8px;
    max-height:75vh;overflow-y:auto;
    z-index:900;opacity:0;pointer-events:none;transition:opacity 0.3s ease;
    font-family:monospace;
`;
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
        btn.style.cssText = `
            width:40px;height:40px;padding:0;background:rgba(0,0,0,0.85);color:#88ccff;
            border:1px solid #555;border-radius:3px;cursor:pointer;
            font-family:monospace;font-size:16px;display:flex;
            align-items:center;justify-content:center;flex-shrink:0;
        `;
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

        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(136,204,255,0.15)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(0,0,0,0.85)';
        });
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
                createIcon('🔧', '部署设施', () => {
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
            html = '<div style="display:flex;align-items:center;justify-content:center;height:120px;color:#555;font-size:13px;">蓝图研究功能开发中...</div>';
            break;
        default:
            html = '<div style="color:#555;">未知舱室</div>';
    }

    content.innerHTML = html;
    panel.style.display = 'block';

    // 舱室初始化钩子（绑定事件）
    if (compartmentId === 'dock_hub') bindDockHubEvents(facility);
}

function buildBridgeContent(facility) {
    const typeConfig = getFacilityType(facility.typeId);
    const typeName = typeConfig ? typeConfig.name : '设施';
    const docksUsed = facility.usedDocks || 0;
    const docksMax = facility.maxDocks || 0;
    const pct = docksMax > 0 ? (docksUsed / docksMax * 100) : 0;

    const card = (label, value, accent) => `
        <div style="background:#333;border:1px solid #555;border-radius:3px;
            padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0;">
            <span style="color:#666;font-size:10px;">${label}</span>
            <span style="color:${accent || '#ccc'};font-size:13px;font-weight:bold;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</span>
        </div>`;

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">';
    html += card('设施名称', facility.name);
    html += card('设施类型', typeName, '#88ccff');
    html += card('对接口',
        `<span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;vertical-align:middle;margin-right:6px;">
            <span style="display:inline-block;width:${pct}%;height:100%;background:#88ccff;border-radius:3px;"></span>
        </span> ${docksUsed} / ${docksMax}`, '#88ccff');
    html += card('升级等级', (facility.upgradeLevel || 1) + ' 级');
    html += '</div>';

    html += card('所属天体', facility.hostSOI || '-', '#aaa');
    html += '<div style="margin-top:8px;">' + card('交互范围', (facility.interactionRange || '-') + ' 单位', '#aaa') + '</div>';

    if (_controlledDockedShipId) {
        const ship = facility.dockedShips?.find(s => s.id === _controlledDockedShipId);
        if (ship) {
            html += '<hr style="border:none;border-top:1px solid #444;margin:12px 0;">';
            html += `<div style="color:#88ccff;font-size:13px;margin-bottom:8px;">${renderIconHtml('ship_default_active', '🚀', 12)} 当前控制：${ship.displayName || ship.id}</div>`;
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">';
            html += card('燃料', (ship.fuel ?? '-') + ' / ' + (ship.maxFuel ?? '-'));
            html += card('干质量', (ship.dryMass ?? '-') + ' t');
            html += card('模块', (ship.modules?.length || 0) + ' 个');
            html += '</div>';
            html += `<button onclick="window.__releaseShipControl()" style="
                padding:5px 16px;background:#333;color:#ccc;border:1px solid #555;
                border-radius:3px;cursor:pointer;font-family:monospace;font-size:12px;
            ">返回设施总览</button>`;
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
            + '">对接当前飞船：' + (activeShip.displayName || activeShip.id) + '（剩余 ' + freeDocks + ' 个对接口）</button>';
    } else if (activeShip && freeDocks <= 0) {
        html += '<div style="color:#c44;font-size:12px;margin-bottom:12px;padding:6px 10px;'
            + 'background:rgba(170,68,68,0.1);border:1px solid #644;border-radius:3px;">'
            + '⚠ 对接口已满（0/' + (facility.maxDocks || 0) + '）</div>';
    } else if (!activeShip) {
        html += '<div style="color:#666;font-size:11px;margin-bottom:10px;padding:4px 0;">控制飞船靠近后可对接</div>';
    }

    const dockedShips = facility.dockedShips || [];
    if (dockedShips.length === 0) {
        html += '<div style="color:#555;font-size:12px;text-align:center;padding:20px;">暂无停靠飞船</div>';
    } else {
        html += '<div style="color:#666;font-size:11px;margin-bottom:8px;">停靠飞船（' + dockedShips.length + ' 艘）</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        for (const ship of dockedShips) {
            const fuelPct = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel * 100) : 0;
            html += '<div style="background:#333;border:1px solid #555;border-radius:3px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:#aaa;margin-bottom:6px;font-weight:bold;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="margin-bottom:6px;">'
                + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">'
                + '<span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;">'
                + '<span style="display:inline-block;width:' + fuelPct + '%;height:100%;background:#4c4;border-radius:3px;"></span>'
                + '</span>'
                + '<span style="font-size:10px;color:#888;">' + fuelPct.toFixed(0) + '%</span>'
                + '</div>'
                + '<div style="font-size:10px;color:#666;">模块: ' + (ship.modules?.length || 0) + ' 个</div>'
                + '</div>';
            if (!activeShip) {
                html += '<div style="display:flex;gap:6px;">'
                    + '<button onclick="window.__facilitySwitchControl(\'' + ship.id + '\')" style="'
                    + 'flex:1;padding:5px 0;background:#333;color:#ccc;border:1px solid #555;'
                    + 'border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;'
                    + '">切换控制</button>'
                    + '<button onclick="window.__facilityUndockShip(\'' + ship.id + '\')" style="'
                    + 'flex:1;padding:5px 0;background:#333;color:#8f8;border:1px solid #484;'
                    + 'border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;'
                    + '">起飞</button>'
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
        html += '<div style="color:#555;font-size:12px;text-align:center;padding:20px;">暂无停靠飞船可补给</div>';
    } else {
        html += '<div style="color:#666;font-size:11px;margin-bottom:8px;">可补给飞船（' + dockedShips.length + ' 艘）</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        for (const ship of dockedShips) {
            const fuelPct = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel * 100) : 0;
            html += '<div style="background:#333;border:1px solid #555;border-radius:3px;padding:10px 12px;">'
                + '<div style="font-size:13px;color:#aaa;margin-bottom:6px;font-weight:bold;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (ship.displayName || ship.id) + '</div>'
                + '<div style="margin-bottom:8px;">'
                + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">'
                + '<span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;">'
                + '<span style="display:inline-block;width:' + fuelPct + '%;height:100%;background:#cc4;border-radius:3px;"></span>'
                + '</span>'
                + '<span style="font-size:10px;color:#888;">' + fuelPct.toFixed(0) + '%</span>'
                + '</div>'
                + '<div style="font-size:10px;color:#666;">' + (ship.fuel ?? '-') + ' / ' + (ship.maxFuel ?? '-') + '</div>'
                + '</div>'
                + '<button onclick="window.__facilityRefuelShip(\'' + ship.id + '\')" style="'
                + 'width:100%;padding:6px 0;background:#333;color:#cc4;border:1px solid #554;'
                + 'border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;'
                + '">补给燃料</button>'
                + '<div style="font-size:9px;color:#666;text-align:center;margin-top:4px;">消耗: 0 点数</div>'
                + '</div>';
        }
        html += '</div>';
    }
    return html;
}

// 全局辅助函数：释放停靠飞船控制权
window.__releaseShipControl = function() {
    _controlledDockedShipId = null;
    if (_currentFacility) {
        openCompartmentPanel(_currentFacility, 'bridge');
    }
};

// 全局辅助函数：切换控制到停靠飞船
window.__facilitySwitchControl = function(shipId) {
    _controlledDockedShipId = shipId;
    if (_currentFacility) {
        openCompartmentPanel(_currentFacility, 'bridge');
    }
};

// 全局辅助函数：起飞
window.__facilityUndockShip = function(shipId) {
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
window.__facilityRefuelShip = function(shipId) {
    if (_currentFacility) {
        facilitySystem.refuelShip(_currentFacility.id, shipId);
        if (typeof window.showNotification === 'function') {
            window.showNotification('燃料补给完成', 'success');
        }
        const updated = facilitySystem.getFacility(_currentFacility.id);
        if (updated) {
            _currentFacility = updated;
            openCompartmentPanel(updated, 'supply_terminal');
        }
    }
};

// 全局辅助函数：建造飞船
window.__facilityBuildShip = function(templateId) {
    if (!_currentFacility) return;
    const tpl = window.__shipSystem?.getAllTemplates?.().find(t => t.id === templateId);
    const name = tpl ? tpl.name : '新建飞船';
    const result = facilitySystem.buildShip(_currentFacility.id, templateId, name);
    if (result && typeof window.showNotification === 'function') {
        window.showNotification('飞船已建造在设施附近', 'success');
    }
};

// 全局辅助函数：安装模块
window.__facilityAddModule = function(shipId) {
    if (!_currentFacility) return;
    const allModules = getAllModules();
    const modules = allModules.filter(m => m.id !== 'test_ballast');
    if (modules.length > 0) {
        facilitySystem.addModuleToShip(_currentFacility.id, shipId, modules[0].id);
    }
    const updated = facilitySystem.getFacility(_currentFacility.id);
    if (updated) {
        _currentFacility = updated;
    }
};

// 全局辅助函数：卸载模块
window.__facilityRemoveModule = function(shipId, moduleId) {
    if (!_currentFacility) return;
    facilitySystem.removeModuleFromShip(_currentFacility.id, shipId, moduleId);
    const updated = facilitySystem.getFacility(_currentFacility.id);
    if (updated) {
        _currentFacility = updated;
    }
};

// ========== 对接弹窗 ==========
let _dockCallback = null;

const dockPromptEl = document.createElement('div');
dockPromptEl.id = 'dockPrompt';
dockPromptEl.style.cssText = `
    display:none;position:fixed;left:50%;top:calc(50% + 45px);transform:translateX(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:10px 14px;z-index:990;font-family:monospace;
`;
dockPromptEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="color:#ccc;font-size:12px;">按 [B] 对接</span>
            <span id="dockPromptFacName" style="color:#888;font-size:10px;"></span>
        </div>
        <button id="dockPromptBtn" style="
            padding:5px 14px;background:rgba(136,204,255,0.15);color:#88ccff;
            border:1px solid #88ccff;border-radius:3px;font-family:monospace;
            font-size:13px;cursor:pointer;
        ">对接</button>
    </div>
`;
document.body.appendChild(dockPromptEl);

document.getElementById('dockPromptBtn').addEventListener('click', () => {
    if (_dockCallback) _dockCallback();
});

window.showDockPrompt = function(facility, onDock) {
    if (!facility) return;
    document.getElementById('dockPromptFacName').textContent = facility.name || '设施';
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
toolbarPanel.style.cssText = `
    display:none;position:fixed;left:70px;top:50%;transform:translateY(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:12px 15px;width:550px;box-sizing:border-box;max-height:70vh;overflow-y:auto;
    z-index:998;font-family:monospace;color:#ccc;font-size:12px;
`;
toolbarPanel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #444;">
        <span id="toolbarPanelTitle" style="color:#88ccff;font-size:13px;"></span>
        <button id="toolbarPanelCloseBtn" style="padding:2px 8px;background:#333;
            color:#aaa;border:1px solid #555;border-radius:3px;cursor:pointer;
            font-family:monospace;font-size:11px;">✕</button>
    </div>
    <div id="toolbarPanelContent"></div>
`;
document.body.appendChild(toolbarPanel);

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
