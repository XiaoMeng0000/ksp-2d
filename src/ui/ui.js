﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import { stateToKepler } from '../physics/orbitalMechanics.js';
// 导入 uiManager（相对路径更新）
import { uiManager } from './uiManager.js';
// 导入事件总线
import { eventBus, Events } from '../eventBus.js';
// 导入 UI 组件
import { createNotification, createDialog, createInputDialog, createConfirmDialog } from './uiComponents.js';
// 导入场景管理器（相对路径更新）
import { sceneManager } from '../sceneManager.js';
// 导入存档管理器（相对路径更新）
import { saveManager } from '../saveManager.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityCompartments, getFacilityType, getCompartmentDef, getFacilityCategories, getFacilitiesByCategory, getServiceName } from '../facility/facilityTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { toggleDebugPanel, refreshDebugPanel } from './debugUI.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});
let _currentFacility = null;
let _facilityMenuOpen = false;
let _controlledDockedShipId = null;

// 导入飞船模板和分类配置
import { SHIP_TEMPLATES } from '../ship/shipTemplates.js';
 import { SHIP_CATEGORIES } from '../ship/shipCategories.js';
import { getModuleDef, getModuleCategories, getModulesByCategory, getAllModules } from '../ship/moduleTypes.js';

// 追踪站 - 数据格式化函数
function formatSpeed(vel) {
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (speed >= 1000) {
        return (speed / 1000).toFixed(2) + ' km/s';
    }
    return speed.toFixed(1) + ' m/s';
}

function formatDistance(m) {
    if (m >= 1000000) {
        return (m / 1000000).toFixed(2) + ' Mm';
    } else if (m >= 1000) {
        return (m / 1000).toFixed(1) + ' km';
    }
    return Math.round(m) + ' m';
}

function formatEccentricity(e) {
    if (e < 0.01) return '圆形';
    if (e < 0.5) return '椭圆形';
    if (e < 0.8) return '椭圆';
    return '高椭圆';
}

function formatTime(s) {
    if (s >= 3600) {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h + 'h ' + m + 'm';
    }
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + 'm ' + sec + 's';
}

window.formatSpeed = formatSpeed;
window.formatDistance = formatDistance;
window.formatEccentricity = formatEccentricity;
window.formatTime = formatTime;



// 追踪站 - 创建信息窗口
const trackingInfo = document.createElement('div');
trackingInfo.id = 'trackingInfo';
trackingInfo.style.display = 'none';
trackingInfo.style.position = 'fixed';
trackingInfo.style.top = '20px';
trackingInfo.style.right = '20px';
trackingInfo.style.width = '240px';
trackingInfo.style.background = 'rgba(0, 0, 0, 0.85)';
trackingInfo.style.color = 'white';
trackingInfo.style.padding = '12px 15px';
trackingInfo.style.fontFamily = 'monospace';
trackingInfo.style.fontSize = '12px';
trackingInfo.style.border = '1px solid #444';
trackingInfo.style.borderRadius = '5px';
trackingInfo.style.zIndex = '1000';
document.body.appendChild(trackingInfo);

window.updateTrackingInfo = function(node) {
    trackingInfo.style.display = 'block';
    let html = `<div style="font-weight: bold; margin-bottom: 8px; color: #88ccff;">${node.name}</div>`;
    html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0 8px 0;">';
    html += `<div>类型: ${node.type === 'star' ? '恒星' : 
        node.type === 'planet' ? '行星' : 
        node.type === 'moon' ? '卫星' : 
        node.type === 'ship' ? '飞船' : 
        node.type === 'facility' ? '设施' : '未知'}</div>`;
    
    if (node.type === 'ship') {
        // 追踪站 - 用真实 ID 获取具体飞船（而非总是活动飞船）
        const ship = (window.__shipSystem && node.id) 
            ? window.__shipSystem.getShip(node.id) 
            : (_cachedShipData && _cachedShipData.exists
                ? { vel: _cachedShipData.vel, currentSOI: _cachedShipData.currentSOI,
                    fuel: _cachedShipData.fuel, dryMass: _cachedShipData.dryMass,
                    kepler: _cachedShipData.kepler, currentGM: _cachedShipData.currentGM,
                    pos: _cachedShipData.pos }
                : null);
        if (ship) {
            html += `<div>速度: ${formatSpeed(ship.vel)}</div>`;
            html += `<div>SOI: ${ship.currentSOI || '深空'}</div>`;
            // 追踪站 - 扩展显示燃料、质量、Δv
            const fuel = ship.fuel !== undefined ? ship.fuel : 'N/A';
            const maxFuel = ship.maxFuel !== undefined ? ship.maxFuel : 'N/A';
            html += `<div>燃料: ${fuel} / ${maxFuel}</div>`;
            // 使用 dryMass，单位改为 t
            const mass = ship.dryMass !== undefined ? ship.dryMass : 'N/A';
            html += `<div>干质量: ${mass} t</div>`;
            // 追踪站 - 计算 Δv
            let dv = 'N/A';
            if (ship.kepler && ship.currentGM !== undefined) {
                const gm = ship.currentGM;
                const a = ship.kepler.a;
                const v = Math.sqrt(gm * (2 / Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y) - 1 / a));
                dv = formatSpeed({ x: v, y: 0 });
            }
            html += `<div>Δv: ${dv}</div>`;
            if (ship.kepler) {
                html += `<div>离心率: ${formatEccentricity(ship.kepler.e)}</div>`;
            }

            // 模块系统 - 追踪站显示飞船模块
            const modules = ship.modules || [];
            html += '<hr style="border:none;border-top:1px solid #444;margin:8px 0;">';
            html += '<div style="color:#666;font-size:11px;margin-bottom:4px;">模块:</div>';
            if (modules.length === 0) {
                html += '<div style="color:#555;font-size:10px;margin-bottom:4px;">无</div>';
            } else {
                const counts = {};
                for (const mod of modules) {
                    counts[mod.type] = (counts[mod.type] || 0) + 1;
                }
                for (const [typeId, count] of Object.entries(counts)) {
                    const def = getModuleDef(typeId);
                    if (def) {
                        html += `<div style="color:#ddd;font-size:10px;margin-bottom:2px;">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name} (×${count})</div>`;
                    }
                }
            }

            // 追踪站 - 添加控制/摧毁按钮（统一带边框样式，等高等宽）
            html += `<div style="margin-top: 10px; display: flex; gap: 6px;">
                <button id="trackingControlBtn" style="
                    flex: 1; padding: 5px 0; font-family: monospace; font-size: 12px;
                    background: rgba(68, 170, 68, 0.15); color: #4c4;
                    border: 1px solid #4c4; border-radius: 3px; cursor: pointer;
                ">控制</button>
                <button id="trackingDestroyBtn" style="
                    flex: 1; padding: 5px 0; font-family: monospace; font-size: 12px;
                    background: rgba(170, 68, 68, 0.15); color: #c44;
                    border: 1px solid #c44; border-radius: 3px; cursor: pointer;
                ">摧毁</button>
            </div>`;
        }
    } else if (node.type === 'facility') {
        html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0 8px 0;">';
        const typeCfg = node.facilityTypeId ? getFacilityType(node.facilityTypeId) : null;
        html += '<div>类型: ' + (typeCfg ? typeCfg.name : '设施') + '</div>';
        html += '<div>对接口: ' + (node.usedDocks ?? 0) + ' / ' + (node.maxDocks ?? 0) + '</div>';
        
        // 停靠飞船列表
        const fac = node.id ? facilitySystem.getFacility(node.id) : null;
        if (fac && fac.dockedShips && fac.dockedShips.length > 0) {
            html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0;">';
            html += '<div style="color:#666;font-size:11px;margin-bottom:4px;">停靠飞船:</div>';
            for (const s of fac.dockedShips) {
                html += '<div style="color:#ddd;font-size:10px;margin-bottom:2px;">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (s.displayName || s.id) + '</div>';
            }
        } else {
            html += '<div style="color:#555;font-size:10px;margin-top:4px;">无停靠飞船</div>';
        }
        
        // 设施控制 + 摧毁按钮
        html += '<div style="margin-top: 10px; display: flex; gap: 6px;">' +
            '<button id="trackingControlBtn" style="flex:1;padding:5px 0;font-family:monospace;font-size:12px;' +
            'background:rgba(68,170,68,0.15);color:#4c4;border:1px solid #4c4;border-radius:3px;cursor:pointer;">控制</button>' +
            '<button id="trackingDestroyBtn" style="flex:1;padding:5px 0;font-family:monospace;font-size:12px;' +
            'background:rgba(170,68,68,0.15);color:#c44;border:1px solid #c44;border-radius:3px;cursor:pointer;">摧毁</button>' +
            '</div>';
    }
    
    trackingInfo.innerHTML = html;
    
    // 追踪站 - 控制按钮点击事件（飞船和设施共用）
    const controlBtn = document.getElementById('trackingControlBtn');
    if (controlBtn) {
        controlBtn.addEventListener('click', function onControlClick() {
            if (node.type === 'ship') {
                const activeShip = window.__shipSystem?.getActiveShip();
                if (node.id && node.id !== activeShip?.id && typeof window.__shipSystem !== 'undefined') {
                    window.__shipSystem.switchShip(node.id);
                }
            }
            // 设施类型：传递 ID 给飞行场景聚焦
            if (node.type === 'facility') {
                window.__pendingFacilityId = node.id;
            }
            // 切换到飞行场景（设施也走这里，飞行场景会处理聚焦）
            if (typeof sceneManager !== 'undefined') {
                sceneManager.switchTo('flight');
            }
        }, { once: true });
    }
    
    // 追踪站 - 摧毁按钮点击事件（带二次确认，防止误操作）
    const destroyBtn = document.getElementById('trackingDestroyBtn');
    if (destroyBtn) {
        destroyBtn.addEventListener('click', function onDestroyClick() {
            // 飞船最小保留检查（仅飞船类型）
            if (node.type === 'ship') {
                const allShips = window.__shipSystem?.getAllShips() || [];
                if (allShips.length <= 1) {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('至少保留一艘飞船', 'warning');
                    }
                    return;
                }
            }
            // 弹出确认对话框
            window.__createConfirmDialog(
                '确认摧毁',
                node.type === 'facility' ? '摧毁设施将释放所有停靠飞船，该操作无法撤销。是否继续？' : '该操作无法撤销，是否继续摧毁？',
                () => {
                    if (typeof node.delete === 'function') {
                        node.delete();
                    }
                    window.hideTrackingInfo();
                    if (typeof window.buildTrackingTree === 'function') {
                        const newTree = window.buildTrackingTree();
                        if (typeof window.renderTrackingNav === 'function') {
                            window.renderTrackingNav(newTree);
                        }
                    }
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(node.type === 'facility' ? '设施已摧毁' : '飞船已摧毁', 'info');
                    }
                },
                () => {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('已取消摧毁', 'info');
                    }
                },
                '摧毁',
                '取消'
            );
        }, { once: true });
    }
};

window.hideTrackingInfo = function() {
    trackingInfo.style.display = 'none';
};

// ESC 菜单 — 创建 ESC 菜单
const escMenu = document.createElement('div');
escMenu.id = 'escMenu';
escMenu.style.display = 'none';
escMenu.style.position = 'fixed';
escMenu.style.inset = '0';
escMenu.style.background = 'rgba(0, 0, 0, 0.7)';
escMenu.style.alignItems = 'center';
escMenu.style.justifyContent = 'center';
escMenu.style.zIndex = '10000';
escMenu.style.backdropFilter = 'blur(4px)';

function getCurrentWorldName() {
    if (!window.currentWorldId) return '无';
    if (typeof window.__saveManager !== 'undefined') {
        const world = window.__saveManager.getWorld(window.currentWorldId);
        return world ? world.metadata.name : '未知';
    }
    return '未知';
}

// 追踪站 - 根据场景返回 ESC 菜单按钮列表
function getEscButtons(scene) {
    if (scene === 'tracking') {
        return [
            { id: 'escResumeBtn', label: '继续游戏', action: 'window.resumeGame()' },
            { id: 'escSaveBtn', label: '存档', action: 'window.saveGame()' },
            { id: 'escLoadBtn', label: '读档', action: 'window.loadGame()' },
            { id: 'escBackBtn', label: '回到飞行器', action: 'window.backToFlight()' },
            { id: 'escQuitBtn', label: '退出到主菜单', action: 'window.quitToMenu()' }
        ];
    }
    return [
        { id: 'escResumeBtn', label: '继续游戏', action: 'window.resumeGame()' },
        { id: 'escSaveBtn', label: '存档', action: 'window.saveGame()' },
        { id: 'escLoadBtn', label: '读档', action: 'window.loadGame()' },
        { id: 'escTrackingBtn', label: '追踪站', action: 'window.openTrackingStation()' },
        { id: 'escQuitBtn', label: '退出到主菜单', action: 'window.quitToMenu()' }
    ];
}

// 追踪站 - 渲染 ESC 菜单按钮
function renderEscMenuButtons(scene) {
    const buttons = getEscButtons(scene);
    const btnContainer = document.getElementById('escBtnContainer');
    if (!btnContainer) return;
    
    btnContainer.innerHTML = '';
    // 将 action 字符串映射到 window 函数，避免 onclick 属性中的可执行字符串
    const actionMap = {
        'window.resumeGame()': () => { if (typeof window.resumeGame === 'function') window.resumeGame(); },
        'window.saveGame()': () => { if (typeof window.saveGame === 'function') window.saveGame(); },
        'window.loadGame()': () => { if (typeof window.loadGame === 'function') window.loadGame(); },
        'window.openTrackingStation()': () => { if (typeof window.openTrackingStation === 'function') window.openTrackingStation(); },
        'window.backToFlight()': () => { if (typeof window.backToFlight === 'function') window.backToFlight(); },
        'window.quitToMenu()': () => { if (typeof window.quitToMenu === 'function') window.quitToMenu(); }
    };
    
    buttons.forEach(btn => {
        const el = document.createElement('button');
        el.id = btn.id;
        el.textContent = btn.label;
        el.style.cssText = 'padding:6px 12px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:13px;cursor:pointer;';
        const handler = actionMap[btn.action];
        if (handler) el.addEventListener('click', handler);
        btnContainer.appendChild(el);
    });
}

escMenu.innerHTML = `
    <div style="background: rgba(0, 0, 0, 0.85); padding: 20px 25px; border: 1px solid #555; border-radius: 5px; min-width: 250px; font-family: monospace;">
        <h3 style="color: #88ccff; margin: 0 0 10px 0; border-bottom: 1px solid #444; padding-bottom: 5px;">菜单</h3>
        <div id="escCurrentWorld" style="color:#666;font-size:12px;margin-bottom:15px;">当前世界：${getCurrentWorldName()}</div>
        <div id="escBtnContainer" style="display: flex; flex-direction: column; gap: 8px;"></div>
        <p style="margin-top: 15px; color: #666; font-size: 11px;">按 ESC 关闭</p>
    </div>
`;
document.body.appendChild(escMenu);

// ESC 菜单 — 注册 esc 面板
uiManager.registerPanel('esc', {
    element: escMenu,
    render: () => {},
    show: () => {
        const worldDisplay = document.getElementById('escCurrentWorld');
        if (worldDisplay) {
            worldDisplay.textContent = `当前世界：${getCurrentWorldName()}`;
        }
        // 追踪站 - 根据当前场景渲染按钮
        const currentScene = sceneManager.getCurrentScene();
        renderEscMenuButtons(currentScene);
        escMenu.style.display = 'flex';
    },
    hide: () => { escMenu.style.display = 'none'; }
});



// ESC 菜单 — 切换 ESC 菜单
function toggleEscMenu() {
    if (uiManager.isPanelVisible('esc')) {
        uiManager.hidePanel('esc');
    } else {
        uiManager.showPanel('esc');
    }
}

window.addEventListener('keydown', (e) => {
    const escVisible = uiManager.isPanelVisible('esc');
    const currentScene = sceneManager.getCurrentScene();
    // ESC 键切换菜单（在飞行和追踪站场景生效）
    if (e.key === 'Escape') {
        e.preventDefault();
        if (currentScene === 'flight' || currentScene === 'tracking') {
            toggleEscMenu();
        }
        return;
    }
    // ESC 菜单打开时阻止其他快捷键
    if (escVisible) {
        return;
    }
    // 追踪站 - 控制锁定时忽略所有快捷键（F1、Z、X）
    if (_cachedShipData && _cachedShipData.controlsLocked) {
        return;
    }
    // F1 调试面板
    if (e.key === 'F1') {
        e.preventDefault();
        toggleDebugPanel();
    }
});



// ESC 菜单 — 按钮事件处理函数
window.resumeGame = function() {
    uiManager.hidePanel('esc');
};

// 追踪站 - 打开追踪站
window.openTrackingStation = function() {
    if (_cachedShipData && _cachedShipData.mode === 'thrust') {
        window.showNotification('推力模式下无法进入追踪站！', 'warning');
        return;
    }
    uiManager.hidePanel('esc');
    sceneManager.switchTo('tracking');
};

// 追踪站 - 回到飞行器
window.backToFlight = function() {
    if (!_cachedShipData || !_cachedShipData.exists) {
        window.showNotification('没有找到飞船', 'warning');
        return;
    }
    uiManager.hidePanel('esc');
    sceneManager.switchTo('flight');
};

// 层级存档 - 存档功能（在当前世界创建检查点）
window.saveGame = function() {
    try {
        const worldId = window.currentWorldId;
        if (!worldId) {
            window.showNotification('没有当前世界', 'info');
            return;
        }
        const world = saveManager.getWorld(worldId);
        const checkpointName = `检查点 ${world.checkpoints.length + 1}`;
        const id = saveManager.saveCheckpoint(worldId, checkpointName);
        if (id) window.showNotification('存档成功！已保存检查点', 'success');
        else window.showNotification('存档失败', 'error');
    } catch (e) {
        console.error('[Save] 存档异常:', e);
        window.showNotification('存档异常', 'error');
    }
};

// 层级存档 - 读档功能（显示当前世界的检查点列表）
window.loadGame = function() {
    const worldId = window.currentWorldId;
    if (!worldId) {
        window.showNotification('没有当前世界', 'info');
        return;
    }
    const list = saveManager.getCheckpointList(worldId);
    if (list.length === 0) {
        window.showNotification('没有找到检查点', 'info');
        return;
    }
    const items = list.map(c => ({
        id: c.id,
        name: c.name,
        subtitle: `${new Date(c.timestamp).toLocaleString()} · 游戏时间 ${c.gameTime.toFixed(1)}s`
    }));
    createDialog('选择检查点', items, (selectedId) => {
        const success = saveManager.loadCheckpoint(worldId, selectedId);
        if (success) {
            window.showNotification('✅ 读档成功！', 'success');
            if (sceneManager.getCurrentScene() === 'menu') {
                sceneManager.switchTo('flight');
            }
            refreshDebugPanel();
        } else {
            window.showNotification('❌ 读档失败', 'error');
        }
    });
};

// 退出优化 - 优化退出游戏流程
window.quitToMenu = function() {
    // 1. 检查是否在推力模式
    if (_cachedShipData && _cachedShipData.mode === 'thrust') {
        window.showNotification('推力模式下无法退出！', 'warning');
        return;
    }

    // 2. 弹出确认对话框
    window.__createConfirmDialog(
        '退出到主菜单',
        '是否保存当前进度？未保存的数据将丢失。',
        () => {
            // 用户选择「保存并退出」
            const worldId = window.currentWorldId;
            if (worldId) {
                const world = window.__saveManager.getWorld(worldId);
                const checkpointName = `检查点 ${world.checkpoints.length + 1}`;
                window.__saveManager.saveCheckpoint(worldId, checkpointName);
                window.showNotification('✅ 已保存检查点', 'success');
            }
            uiManager.hidePanel('esc');
            sceneManager.switchTo('menu');
        },
        () => {
            // 用户选择「退出」（不保存）
            uiManager.hidePanel('esc');
            sceneManager.switchTo('menu');
        },
        '保存并退出',  // 确认按钮文字
        '直接退出'     // 取消按钮文字
    );
};

// 层级存档 - 暴露 UI 组件到全局，供 main.js 使用
window.__createDialog = createDialog;
window.__createInputDialog = createInputDialog;
// 退出优化 - 暴露确认对话框到全局
window.__createConfirmDialog = createConfirmDialog;

// 使用 uiComponents 的 showNotification
window.showNotification = function(message, type = 'info', duration = 2000) {
    createNotification(message, type, duration);
};

// 存档管理 - 存档管理面板
const archiveManagerPanel = document.createElement('div');
archiveManagerPanel.id = 'archiveManagerPanel';
archiveManagerPanel.style.cssText = `
    display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;
    align-items:center;justify-content:center;font-family:monospace;
`;
archiveManagerPanel.innerHTML = `
    <div style="background: rgba(0, 0, 0, 0.85); border: 1px solid #555; border-radius: 5px; padding: 15px; min-width: 350px; max-width: 550px; max-height: 80vh; overflow-y: auto; font-family: monospace;">
        <h3 style="color: #88ccff; margin: 0 0 15px 0; border-bottom: 1px solid #444; padding-bottom: 5px;">存档管理</h3>
        <div id="archiveManagerContent"></div>
        <button id="archiveManagerCloseBtn" 
            style="margin-top:12px;padding:6px 12px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">关闭</button>
    </div>
`;
document.body.appendChild(archiveManagerPanel);

// 存档管理 - 当前查看的世界ID
let currentArchiveWorldId = null;

// 存档管理 - 渲染世界列表
function renderWorldList() {
    const content = document.getElementById('archiveManagerContent');
    const worldList = saveManager.getWorldList();

    if (worldList.length === 0) {
        content.innerHTML = `<p style="color:#666;">没有存档世界</p>`;
        return;
    }

    let html = '<div style="display:flex;flex-direction:column;gap:6px;">';
    worldList.forEach(world => {
        html += `
            <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 10px;background:#333;border:1px solid #555;border-radius:3px;">
                <button onclick="window.__renderCheckpointList('${world.id}')" 
                    style="background:none;border:none;color:#88ccff;font-family:monospace;
                    font-size:13px;cursor:pointer;text-align:left;font-weight:bold;">
                    ${world.name}
                </button>
                <button onclick="window.__deleteWorld('${world.id}')" 
                    style="padding:3px 8px;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);
                    border-radius:3px;color:#ff6666;font-family:monospace;font-size:12px;cursor:pointer;">
                    ${renderIconHtml('ui_trash_can', '🗑️', 12)}
                </button>
            </div>
        `;
    });
    html += '</div>';
    content.innerHTML = html;
}

// 存档管理 - 渲染检查点列表
function renderCheckpointList(worldId) {
    currentArchiveWorldId = worldId;
    const content = document.getElementById('archiveManagerContent');
    const world = saveManager.getWorld(worldId);
    const checkpoints = saveManager.getCheckpointList(worldId);

    let html = `
        <div style="margin-bottom:12px;">
            <button onclick="window.__renderWorldList()" 
                style="padding:4px 10px;background:#333;color:#88ccff;border:1px solid #555;
                border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">
                返回世界列表
            </button>
            <span style="margin-left:10px;color:#aaa;font-size:12px;">${world.metadata.name}</span>
        </div>
    `;

    if (checkpoints.length === 0) {
        html += `<p style="color:#666;">该世界没有检查点</p>`;
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
        checkpoints.forEach(cp => {
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:8px 10px;background:#333;border:1px solid #555;border-radius:3px;">
                    <div style="text-align:left;">
                        <div style="color:#ddd;font-size:13px;font-weight:bold;">${cp.name}</div>
                        <div style="color:#666;font-size:11px;">${new Date(cp.timestamp).toLocaleString()} · 游戏时间 ${cp.gameTime.toFixed(1)}秒</div>
                    </div>
                    <button onclick="window.__deleteCheckpoint('${worldId}', '${cp.id}')" 
                        style="padding:3px 8px;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);
                        border-radius:3px;color:#ff6666;font-family:monospace;font-size:12px;cursor:pointer;">
                        删除
                    </button>
                </div>
            `;
        });
        html += '</div>';
    }

    content.innerHTML = html;
}

// 存档管理 - 删除世界确认
function deleteWorld(worldId) {
    const world = saveManager.getWorld(worldId);
    createConfirmDialog('确认删除', `确认删除世界 "${world.metadata.name}" 及其所有检查点？此操作不可恢复。`, () => {
        saveManager.deleteWorld(worldId);
        renderWorldList();
        window.showNotification('✅ 世界已删除', 'success');
    }, () => {});
}

// 存档管理 - 删除检查点确认
function deleteCheckpoint(worldId, checkpointId) {
    const checkpoints = saveManager.getCheckpointList(worldId);
    const cp = checkpoints.find(c => c.id === checkpointId);
    createConfirmDialog('确认删除', `确认删除检查点 "${cp.name}"？此操作不可恢复。`, () => {
        saveManager.deleteCheckpoint(worldId, checkpointId);
        renderCheckpointList(worldId);
        window.showNotification('✅ 检查点已删除', 'success');
    }, () => {});
}

// 存档管理 - 暴露函数到全局
window.__renderWorldList = renderWorldList;
window.__renderCheckpointList = renderCheckpointList;
window.__deleteWorld = deleteWorld;
window.__deleteCheckpoint = deleteCheckpoint;

// 存档管理 - 注册到 uiManager
uiManager.registerPanel('archiveManager', {
    show: () => {
        archiveManagerPanel.style.display = 'flex';
        currentArchiveWorldId = null;
        renderWorldList();
    },
    hide: () => {
        archiveManagerPanel.style.display = 'none';
    },
    render: () => {}
});

// 存档管理 - 关闭按钮事件
document.getElementById('archiveManagerCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('archiveManager');
});

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
                    // 关闭 shipBuilderPanel（如果开着的话）
                    if (shipBuilderPanel.style.display !== 'none') {
                        uiManager.hidePanel('shipBuilder');
                    }
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

// 追踪站 - 导航栏
const trackingNav = document.createElement('div');
trackingNav.id = 'trackingNav';
trackingNav.style.cssText = `
    position:fixed;left:15px;top:0;bottom:0;width:280px;
    background:rgba(0,0,0,0.85);border-right:1px solid #555;
    padding:15px;display:none;flex-direction:column;gap:2px;
    z-index:800;font-family:monospace;font-size:12px;
    overflow-y:auto;box-sizing:border-box;
`;
trackingNav.innerHTML = `
    <div style="color:#88ccff;margin-bottom:12px;font-size:14px;border-bottom:1px solid #444;padding-bottom:8px;">天体列表</div>
    <div id="trackingTree"></div>
`;
document.body.appendChild(trackingNav);

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

// 飞船建造UI - 飞船建造界面弹窗
const shipBuilderPanel = document.createElement('div');
shipBuilderPanel.id = 'shipBuilderPanel';
shipBuilderPanel.style.cssText = `
    display:none;position:fixed;left:70px;top:50%;transform:translateY(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:15px;width:650px;max-height:70vh;overflow:hidden;
    z-index:999;font-family:monospace;
`;
shipBuilderPanel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:15px;padding-bottom:8px;border-bottom:1px solid #444;">
        <h3 style="color:#88ccff;margin:0;font-size:14px;">飞船建造</h3>
        <button id="shipBuilderCloseBtn" style="padding:4px 10px;background:#333;
            color:#aaa;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:12px;cursor:pointer;">关闭</button>
    </div>
    <div style="display:flex;height:calc(100% - 80px);gap:15px;">
        <div style="width:35%;display:flex;flex-direction:column;gap:10px;">
            <div style="background:#333;border:1px solid #555;border-radius:3px;
                padding:10px;height:80px;display:flex;align-items:center;
                justify-content:center;color:#666;font-size:12px;">NO DATA</div>
            <div id="shipBuilderCategories" style="flex:1;overflow-y:auto;"></div>
        </div>
        <div style="width:65%;display:flex;flex-direction:column;gap:10px;">
            <div id="shipBuilderStats" style="background:#333;border:1px solid #555;
                border-radius:3px;padding:10px;color:#666;font-size:12px;">
                <div>选择飞船查看数据</div>
            </div>
            <div style="flex:1;background:#333;border:1px solid #555;border-radius:3px;
                padding:8px;overflow:hidden;">
                <div style="font-size:11px;color:#666;margin-bottom:5px;">模块槽</div>
                <div id="shipBuilderSlots" style="display:flex;gap:8px;overflow-x:auto;
                    padding-bottom:5px;"></div>
            </div>
        </div>
    </div>
    <div style="position:absolute;bottom:15px;right:15px;">
        <button id="shipBuilderBuildBtn" style="padding:8px 24px;background:#333;
            color:#88ccff;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:13px;cursor:pointer;">建造！</button>
    </div>
`;
document.body.appendChild(shipBuilderPanel);

// 设施部署面板 — 设施类型选择面板
const facilityDeployPanel = document.createElement('div');
facilityDeployPanel.id = 'facilityDeployPanel';
facilityDeployPanel.style.cssText = `
    display:none;position:fixed;left:70px;top:50%;transform:translateY(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:15px;width:650px;max-height:70vh;overflow:hidden;
    z-index:999;font-family:monospace;
`;
facilityDeployPanel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:15px;padding-bottom:8px;border-bottom:1px solid #444;">
        <h3 style="color:#88ccff;margin:0;font-size:14px;">部署设施</h3>
        <button id="facilityDeployCloseBtn" style="padding:4px 10px;background:#333;
            color:#aaa;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:12px;cursor:pointer;">关闭</button>
    </div>
    <div style="display:flex;height:calc(100% - 80px);gap:15px;">
        <div style="width:35%;display:flex;flex-direction:column;gap:10px;">
            <div id="facilityDeployCategories" style="flex:1;overflow-y:auto;"></div>
        </div>
        <div style="width:65%;display:flex;flex-direction:column;gap:10px;">
            <div id="facilityDeployDetail" style="background:#333;border:1px solid #555;
                border-radius:3px;padding:10px;color:#666;font-size:12px;">
                <div>选择设施查看数据</div>
            </div>
        </div>
    </div>
    <div style="position:absolute;bottom:15px;right:15px;">
        <button id="facilityDeployBuildBtn" style="padding:8px 24px;background:#333;
            color:#88ccff;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:13px;cursor:pointer;">部署</button>
    </div>
`;
document.body.appendChild(facilityDeployPanel);

// 设施部署面板 — 当前选中的设施类型
let selectedFacilityTypeId = null;

// 飞船系统 - 从配置文件读取飞船数据
const shipBuilderData = {
    categories: Object.values(SHIP_CATEGORIES),

    getShipsByCategory(categoryId) {
        return SHIP_TEMPLATES.filter(t => t.category === categoryId);
    },

    getShipById(shipId) {
        return SHIP_TEMPLATES.find(t => t.id === shipId) || null;
    },

    getSlots(shipId) {
        const template = this.getShipById(shipId);
        if (!template) return [];
        return new Array(template.moduleSlots).fill(null);
    }
};

// 飞船建造UI - 当前选中的飞船
let selectedShip = null;

// 模块系统 - 建造时选择的模块（索引对应槽位，值为 moduleTypeId 或 null）
let selectedModules = [];

// 模块系统 - 暴露 selectedModules 到全局供阶段2调试
if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__selectedModules', {
        get() { return selectedModules; },
        set(v) {
            selectedModules = v;
            if (selectedShip) {
                renderShipBuilderSlots();
                updateShipBuilderStats();
            }
        }
    });
}

// TEMP: 飞船建造UI-占位 - 渲染分类列表（使用占位接口）
function renderShipBuilderCategories() {
    const container = document.getElementById('shipBuilderCategories');
    let html = '';
    
    shipBuilderData.categories.forEach((cat, catIndex) => {
        // TEMP: 飞船建造UI-占位 - 使用 getShipsByCategory 接口获取飞船列表
        const ships = shipBuilderData.getShipsByCategory(cat.id);
        const isExpanded = catIndex === 0;
        html += `
            <div style="border:1px solid #555;border-radius:3px;overflow:hidden;">
                <div style="padding:8px;background:#333;cursor:pointer;display:flex;
                    align-items:center;justify-content:space-between;" 
                    onclick="window.__toggleShipCategory('${cat.id}')">
                    <span style="color:#88ccff;font-size:12px;">${cat.name}</span>
                    <span style="color:#666;font-size:10px;">${isExpanded ? '-' : '+'}</span>
                </div>
                <div id="cat-${cat.id}" style="display:${isExpanded ? 'block' : 'none'};">
                    ${ships.length === 0 ? '<div style="padding:6px 10px;color:#666;font-size:11px;">暂无飞船</div>' : 
                        ships.map(ship => `
                            <button onclick="window.__selectShip('${ship.id}')" 
                                style="width:100%;padding:6px 10px;background:transparent;
                                border:none;border-bottom:1px solid #444;color:#ddd;
                                font-family:monospace;font-size:12px;cursor:pointer;
                                text-align:left;" 
                                data-ship-id="${ship.id}">${ship.name}</button>
                        `).join('')}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 飞船建造UI - 切换分类展开/收起
function toggleShipCategory(catId) {
    const el = document.getElementById(`cat-${catId}`);
    const span = el.previousElementSibling.querySelector('span:last-child');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        span.textContent = '-';
    } else {
        el.style.display = 'none';
        span.textContent = '+';
    }
}

// TEMP: 飞船建造UI-占位 - 选择飞船（使用占位接口）
function selectShip(shipId) {
    const ship = shipBuilderData.getShipById(shipId);
    if (!ship) return;
    selectedShip = ship;
    selectedModules = new Array(ship.moduleSlots).fill(null);
    updateShipBuilderStats();
    renderShipBuilderSlots();
}

// 建造面板 - 更新 stats 显示（含简介 + 模块加成括号）
function updateShipBuilderStats() {
    const ship = selectedShip;
    if (!ship) return;

    // 计算模块累计加成
    let totalMassBonus = 0;
    let totalMoiBonus = 0;
    const slots = selectedModules;
    if (slots) {
        slots.forEach(modId => {
            if (modId) {
                const def = getModuleDef(modId);
                if (def) {
                    totalMassBonus += def.massBonus;
                    totalMoiBonus += def.momentOfInertiaBonus;
                }
            }
        });
    }

    const hasBonus = totalMassBonus !== 0 || totalMoiBonus !== 0;

    const massStr = ship.dryMass != null
        ? ship.dryMass.toFixed(1) + ' t'
        : '-';
    const bonusMassStr = hasBonus
        ? ` <span style="color:#666;">(${totalMassBonus > 0 ? '+' : ''}${totalMassBonus.toFixed(1)} t)</span>`
        : '';

    const moiStr = ship.momentOfInertia != null
        ? ship.momentOfInertia.toFixed(0) + ' kg·m²'
        : '-';
    const bonusMoiStr = hasBonus && ship.momentOfInertia != null
        ? ` <span style="color:#666;">(${totalMoiBonus > 0 ? '+' : ''}${totalMoiBonus.toFixed(0)})</span>`
        : '';

    // 简介行（有 description 时才显示 + 分隔线）
    const descHtml = ship.description
        ? `<div style="color:#aaa;font-size:11px;margin-bottom:6px;">${ship.description}</div>
        <hr style="border:none;border-top:1px solid #444;margin:6px 0 8px 0;">`
        : '';

    const statsEl = document.getElementById('shipBuilderStats');
    statsEl.innerHTML = `
        <div style="color:#88ccff;font-weight:bold;margin-bottom:4px;font-size:13px;">${ship.name}</div>
        ${descHtml}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div><span style="color:#666;">干质量:</span> <span style="color:#fff;">${massStr}${bonusMassStr}</span></div>
            <div><span style="color:#666;">推力:</span> <span style="color:#fff;">${ship.maxThrust != null ? ship.maxThrust.toFixed(0) : '-'} N</span></div>
            <div><span style="color:#666;">ΔV:</span> <span style="color:#fff;">${ship.initialDeltaV != null ? ship.initialDeltaV.toFixed(0) : '-'} m/s</span></div>
            <div><span style="color:#666;">燃料:</span> <span style="color:#fff;">${ship.fuelCapacity != null ? ship.fuelCapacity.toFixed(0) : '-'}</span></div>
            <div><span style="color:#666;">转动惯量:</span> <span style="color:#fff;">${moiStr}${bonusMoiStr}</span></div>
            <div><span style="color:#666;">槽位:</span> <span style="color:#fff;">${ship.moduleSlots != null ? ship.moduleSlots : '-'}</span></div>
        </div>
    `;
}

// 模块系统 - 模块选择弹窗
function showModuleSelector(slotIndex, slotElement) {
    // 移除已有弹窗
    const existing = document.querySelector('.module-selector-popup');
    if (existing) existing.remove();

    const rect = slotElement.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.className = 'module-selector-popup';
    popup.style.cssText = `
        position:fixed;left:${rect.right + 8}px;top:${rect.top}px;
        background:rgba(0,0,0,0.92);border:1px solid #555;border-radius:4px;
        padding:6px 0;min-width:180px;max-height:300px;overflow-y:auto;
        z-index:10001;font-family:monospace;font-size:12px;color:#ddd;
    `;

    const currentModuleId = selectedModules[slotIndex];

    // 已安装提示
    if (currentModuleId) {
        const def = getModuleDef(currentModuleId);
        if (def) {
            const installedRow = document.createElement('div');
            installedRow.style.cssText = 'padding:4px 10px;color:#666;border-bottom:1px solid #444;margin-bottom:4px;';
            installedRow.innerHTML = `已安装: <span style="color:#88ccff;">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name}</span>`;
            popup.appendChild(installedRow);
        }
    }

    // 分类分组
    const categories = getModuleCategories();
    const allExpanded = {};

    categories.forEach((cat, catIdx) => {
        allExpanded[cat.id] = true;

        // 分类标题行
        const header = document.createElement('div');
        header.style.cssText = `
            padding:4px 10px;cursor:pointer;display:flex;
            align-items:center;justify-content:space-between;
            color:#88ccff;font-size:11px;user-select:none;
        `;
        header.innerHTML = `<span>${cat.name}</span><span style="color:#666;font-size:10px;">-</span>`;
        popup.appendChild(header);

        // 模块列表容器
        const listContainer = document.createElement('div');
        listContainer.style.display = 'block';
        popup.appendChild(listContainer);

        const modules = getModulesByCategory(cat.id);
        const toggleSpan = header.querySelector('span:last-child');

        header.addEventListener('click', () => {
            allExpanded[cat.id] = !allExpanded[cat.id];
            listContainer.style.display = allExpanded[cat.id] ? 'block' : 'none';
            toggleSpan.textContent = allExpanded[cat.id] ? '-' : '+';
        });

        modules.forEach(modDef => {
            const row = document.createElement('div');
            row.style.cssText = `
                padding:4px 10px;cursor:pointer;display:flex;
                align-items:center;gap:4px;font-size:11px;
            `;
            row.innerHTML = `${renderIconHtml(modDef.iconTextureKey, modDef.icon)} ${modDef.name} <span style="color:#666;font-size:10px;">(+${modDef.massBonus.toFixed(1)}t +${modDef.momentOfInertiaBonus.toFixed(0)}惯)</span>`;

            // Tooltip
            let tooltip = null;
            row.addEventListener('mouseenter', () => {
                tooltip = document.createElement('div');
                tooltip.className = 'module-tooltip';
                tooltip.style.cssText = `
                    position:fixed;z-index:10002;
                    background:rgba(0,0,0,0.92);border:1px solid #555;
                    border-radius:4px;padding:8px 10px;min-width:160px;
                    font-family:monospace;font-size:11px;color:#ddd;
                    pointer-events:none;
                `;
                tooltip.innerHTML = `
                    <div style="color:#88ccff;font-weight:bold;margin-bottom:4px;">${modDef.name}</div>
                    <div style="color:#aaa;margin-bottom:4px;">${modDef.description}</div>
                    <div style="color:#666;">干质量加成: +${modDef.massBonus.toFixed(1)} t</div>
                    <div style="color:#666;">转动惯量加成: +${modDef.momentOfInertiaBonus.toFixed(0)} kg·m²</div>
                `;
                document.body.appendChild(tooltip);
                const rowRect = row.getBoundingClientRect();
                tooltip.style.left = (rowRect.right + 8) + 'px';
                tooltip.style.top = rowRect.top + 'px';
            });
            row.addEventListener('mouseleave', () => {
                if (tooltip) { tooltip.remove(); tooltip = null; }
            });

            // 点击安装/替换
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedModules[slotIndex] = modDef.id;
                popup.remove();
                if (tooltip) tooltip.remove();
                renderShipBuilderSlots();
                updateShipBuilderStats();
            });

            // hover 样式
            row.addEventListener('mouseenter', () => {
                row.style.background = 'rgba(136,204,255,0.1)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = 'transparent';
            });

            listContainer.appendChild(row);
        });
    });

    // 卸载选项（仅已安装时）
    if (currentModuleId) {
        const uninstallRow = document.createElement('div');
        uninstallRow.style.cssText = `
            padding:4px 10px;color:#c44;cursor:pointer;border-top:1px solid #444;
            margin-top:4px;font-size:11px;
        `;
        uninstallRow.textContent = '卸载';
        uninstallRow.addEventListener('mouseenter', () => {
            uninstallRow.style.background = 'rgba(170,68,68,0.15)';
        });
        uninstallRow.addEventListener('mouseleave', () => {
            uninstallRow.style.background = 'transparent';
        });
        uninstallRow.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedModules[slotIndex] = null;
            popup.remove();
            renderShipBuilderSlots();
            updateShipBuilderStats();
        });
        popup.appendChild(uninstallRow);
    }

    document.body.appendChild(popup);

    // 关闭逻辑
    const closeHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== slotElement) {
            popup.remove();
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('keydown', escHandler);
        }
    };
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            popup.remove();
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('keydown', escHandler);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
        document.addEventListener('keydown', escHandler);
    }, 0);
}

// 模块系统 - 渲染模块槽（读取 selectedModules）
function renderShipBuilderSlots() {
    const slotsEl = document.getElementById('shipBuilderSlots');
    slotsEl.innerHTML = '';
    
    const slots = selectedModules;
    
    if (!slots || slots.length === 0) {
        slotsEl.innerHTML = '<div style="color:#666;font-size:11px;">暂无模块槽</div>';
        return;
    }
    
    slots.forEach((moduleTypeId, index) => {
        const slotDiv = document.createElement('div');
        slotDiv.style.cssText = `
            min-width:80px;padding:8px;background:#222;border:1px solid #555;
            border-radius:3px;text-align:center;color:#ddd;font-size:11px;
            flex-shrink:0;cursor:pointer;transition:all 0.2s ease;
        `;

        const def = moduleTypeId ? getModuleDef(moduleTypeId) : null;

        if (def) {
            slotDiv.innerHTML = `
                <div style="color:#88ccff;font-size:10px;margin-bottom:4px;">槽${index + 1}</div>
                <div style="font-size:11px;">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name}</div>
            `;
        } else {
            slotDiv.innerHTML = `
                <div style="color:#88ccff;font-size:10px;margin-bottom:4px;">槽${index + 1}</div>
                空
            `;
        }
        
        // TEMP: 飞船建造UI-占位 - 鼠标悬停样式
        slotDiv.addEventListener('mouseenter', () => {
            slotDiv.style.borderColor = '#88ccff';
            slotDiv.style.background = '#2a2a3a';
        });
        slotDiv.addEventListener('mouseleave', () => {
            slotDiv.style.borderColor = '#555';
            slotDiv.style.background = '#222';
        });
        
        // 模块系统 - 点击打开模块选择弹窗
        slotDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            showModuleSelector(index, slotDiv);
        });
        
        slotsEl.appendChild(slotDiv);
    });
}

// 飞船建造UI - 建造按钮（完整闭环）
function buildShip() {
    if (!selectedShip) {
        window.showNotification('请先选择一艘飞船', 'warning');
        return;
    }

    // 获取起始天体数据
    const bodies = window.__celestialBodies || [];
    const homeworld = bodies.find(b => b.isHomeworld);
    if (!homeworld) {
        window.showNotification('找不到起始天体数据', 'error');
        return;
    }

    const defaultOrbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);

    // 弹出轨道高度输入框
    window.__createInputDialog(
        '选择轨道高度',
        '请输入绕 ' + homeworld.name + ' 的轨道半径（米）',
        String(defaultOrbitR),
        (radiusStr) => {
            const radius = parseFloat(radiusStr);
            if (isNaN(radius) || radius <= 0) {
                window.showNotification('请输入有效数字', 'error');
                return;
            }

            // 计算速度（圆形轨道）
            const orbitalSpeed = Math.sqrt(homeworld.gm / radius);
            // 顺行（逆时针，与天体公转同向）：pos 在 +x 时速度应沿 +y
            const vel = { x: 0, y: orbitalSpeed };

            // 创建飞船实例
            const shipName = selectedShip.name + '号';
            const installedModules = selectedModules.filter(m => m !== null);
            const newShip = window.__shipSystem.createShip(selectedShip.id, shipName, installedModules);
            if (!newShip) {
                window.showNotification('飞船创建失败', 'error');
                return;
            }

            // 设置初始轨道状态（pos 为相对宿主坐标）
            newShip.pos = { x: radius, y: 0 };
            newShip.vel = { x: vel.x, y: vel.y };
            newShip.currentSOI = homeworld.name;
            newShip.currentGM = homeworld.gm;
            newShip.kepler = stateToKepler(newShip.pos, vel, homeworld.gm);
            newShip.orbitTime = 0;
            newShip.mode = 'on_rails';

            // 持久化并切换活动飞船
            window.__shipSystem.persistShip(newShip);
            window.__shipSystem.switchShip(newShip.id);

            // 模块系统 - 建造完成后重置模块选择
            selectedModules = [];

            // 关闭建造面板，切换到飞行场景
            uiManager.hidePanel('shipBuilder');
            window.showNotification('飞船建造完成，已发射！', 'success');
            sceneManager.switchTo('flight');
        },
        () => {
            window.showNotification('建造已取消', 'info');
        }
    );
}

// 飞船建造UI - 暴露函数到全局
window.__toggleShipCategory = toggleShipCategory;
window.__selectShip = selectShip;

// 飞船建造UI - 打开建造界面
window.openShipBuilder = function() {
    renderShipBuilderCategories();
    selectedShip = null;
    document.getElementById('shipBuilderStats').innerHTML = 
        '<div>选择飞船查看数据</div>';
    document.getElementById('shipBuilderSlots').innerHTML = '';
    // 关闭 toolbarPanel（与 shipBuilderPanel 互斥）
    toolbarPanel.style.display = 'none';
    uiManager.showPanel('shipBuilder');
};

// 飞船建造UI - 注册到 uiManager
uiManager.registerPanel('shipBuilder', {
    show: () => {
        shipBuilderPanel.style.display = 'block';
    },
    hide: () => {
        shipBuilderPanel.style.display = 'none';
    },
    render: () => {}
});

// 飞船建造UI - 按钮事件
document.getElementById('shipBuilderCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('shipBuilder');
});

document.getElementById('shipBuilderBuildBtn').addEventListener('click', buildShip);

// ========== 设施部署面板 — 渲染与交互 ==========

// 辅助：将 textureKey 转为 PNG <img> HTML 字符串，纹理未就绪时返回 fallback Emoji
function renderIconHtml(textureKey, fallbackEmoji, sizePx) {
    if (!textureKey) return fallbackEmoji || '';
    const tex = textureManager.get(textureKey);
    if (tex) {
        const s = sizePx || 14;
        return `<img src="${tex.src}" style="width:${s}px;height:${s}px;object-fit:contain;vertical-align:middle;">`;
    }
    return fallbackEmoji || '';
}

// 渲染设施分类列表
function renderFacilityDeployCategories() {
    const container = document.getElementById('facilityDeployCategories');
    const categories = getFacilityCategories();
    let html = '';

    categories.forEach((cat, catIndex) => {
        const facilities = getFacilitiesByCategory(cat.id);
        const isExpanded = catIndex === 0;
        html += `
            <div style="border:1px solid #555;border-radius:3px;overflow:hidden;">
                <div style="padding:8px;background:#333;cursor:pointer;display:flex;
                    align-items:center;justify-content:space-between;"
                    onclick="window.__toggleFacilityCategory('${cat.id}')">
                    <span style="color:#88ccff;font-size:12px;">${cat.name}</span>
                    <span style="color:#666;font-size:10px;">${isExpanded ? '-' : '+'}</span>
                </div>
                <div id="fcat-${cat.id}" style="display:${isExpanded ? 'block' : 'none'};">
                    ${facilities.length === 0 ? '<div style="padding:6px 10px;color:#666;font-size:11px;">暂无设施</div>' :
                        facilities.map(fac => `
                            <button onclick="window.__selectFacilityType('${fac.id}')"
                                style="width:100%;padding:6px 10px;background:transparent;
                                border:none;border-bottom:1px solid #444;color:#ddd;
                                font-family:monospace;font-size:12px;cursor:pointer;
                                text-align:left;"
                                data-facility-id="${fac.id}">${renderIconHtml(fac.iconTextureKey, fac.icon)} ${fac.name}</button>
                        `).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// 切换设施分类展开/收起
function toggleFacilityCategory(catId) {
    const el = document.getElementById(`fcat-${catId}`);
    if (!el) return;
    const span = el.previousElementSibling.querySelector('span:last-child');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        span.textContent = '-';
    } else {
        el.style.display = 'none';
        span.textContent = '+';
    }
}

// 选择设施类型
function selectFacilityType(typeId) {
    const type = getFacilityType(typeId);
    if (!type) return;
    selectedFacilityTypeId = typeId;

    // 高亮选中按钮
    document.querySelectorAll('#facilityDeployCategories button[data-facility-id]').forEach(btn => {
        if (btn.dataset.facilityId === typeId) {
            btn.style.background = '#2a2a4a';
            btn.style.color = '#88ccff';
        } else {
            btn.style.background = 'transparent';
            btn.style.color = '#ddd';
        }
    });

    renderFacilityDeployDetail(type);
}

// 渲染设施详情
function renderFacilityDeployDetail(type) {
    const detailEl = document.getElementById('facilityDeployDetail');

    const compartments = getFacilityCompartments(type.id);
    const compartmentsHtml = compartments.length > 0
        ? compartments.map(c => `<span style="display:inline-block;margin:2px;
            padding:2px 6px;background:#222;border:1px solid #555;border-radius:3px;
            font-size:10px;color:#aaa;">${renderIconHtml('comp_' + c.id, c.icon)} ${c.name}</span>`).join('')
        : '';

    const servicesHtml = type.services.length > 0
        ? type.services.map(s => `<span style="display:inline-block;margin:2px;
            padding:2px 6px;background:#222;border:1px solid #555;border-radius:3px;
            font-size:10px;color:#88cc88;">${getServiceName(s)}</span>`).join('')
        : '';

    detailEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            ${renderIconHtml(type.iconTextureKey, type.icon, 32)}
            <div>
                <div style="color:#88ccff;font-size:13px;font-weight:bold;">${type.name}</div>
                <div style="color:#${type.color.slice(1)};font-size:11px;">
                    对接位: ${type.baseDocks}
                </div>
            </div>
        </div>
        <div style="color:#aaa;font-size:11px;margin-bottom:10px;line-height:1.5;">
            ${type.description}
        </div>
        <div style="margin-bottom:8px;">
            <div style="color:#666;font-size:10px;margin-bottom:3px;">舱室</div>
            <div>${compartmentsHtml}</div>
        </div>
        <div>
            <div style="color:#666;font-size:10px;margin-bottom:3px;">服务</div>
            <div>${servicesHtml}</div>
        </div>
    `;
}

// 设施部署 — 执行部署
function deployFacility() {
    if (!selectedFacilityTypeId) {
        window.showNotification('请先选择要部署的设施类型', 'warning');
        return;
    }

    eventBus.emit(Events.SHIP_COMMAND, {
        action: 'deployFacility',
        params: { typeId: selectedFacilityTypeId }
    });

    selectedFacilityTypeId = null;
    uiManager.hidePanel('facilityDeploy');
    window.showNotification('设施部署中...', 'info');
}

// 打开设施部署面板
window.openFacilityDeployPanel = function() {
    renderFacilityDeployCategories();
    selectedFacilityTypeId = null;
    document.getElementById('facilityDeployDetail').innerHTML =
        '<div>选择设施查看数据</div>';
    toolbarPanel.style.display = 'none';
    uiManager.showPanel('facilityDeploy');
};

// 暴露到全局
window.__toggleFacilityCategory = toggleFacilityCategory;
window.__selectFacilityType = selectFacilityType;

// 设施部署面板 — 注册到 uiManager
uiManager.registerPanel('facilityDeploy', {
    show: () => {
        facilityDeployPanel.style.display = 'block';
    },
    hide: () => {
        facilityDeployPanel.style.display = 'none';
    },
    render: () => {}
});

// 设施部署面板 — 按钮事件
document.getElementById('facilityDeployCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('facilityDeploy');
});

document.getElementById('facilityDeployBuildBtn').addEventListener('click', deployFacility);

// 飞船建造UI - 场景切换时显示/隐藏工具栏
// 追踪站 - 场景切换处理
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
    // 追踪站 - 仅在追踪站场景显示导航栏
    if (data.to === 'tracking') {
        trackingNav.style.display = 'flex';
    } else {
        trackingNav.style.display = 'none';
    }
    uiManager.hidePanel('esc');
});
