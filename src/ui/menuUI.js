'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { createNotification, createDialog, createInputDialog, createConfirmDialog } from './uiComponents.js';
import { sceneManager } from '../sceneManager.js';
import { saveManager } from '../saveManager.js';
import { toggleDebugPanel, refreshDebugPanel } from './debugUI.js';
import { textureManager } from '../graphics/textureManager.js';

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

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

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
            { id: 'escSettingsBtn', label: '设置', action: 'window.openSettings()' },
            { id: 'escQuitBtn', label: '退出到主菜单', action: 'window.quitToMenu()' }
        ];
    }
    return [
        { id: 'escResumeBtn', label: '继续游戏', action: 'window.resumeGame()' },
        { id: 'escSaveBtn', label: '存档', action: 'window.saveGame()' },
        { id: 'escLoadBtn', label: '读档', action: 'window.loadGame()' },
        { id: 'escTrackingBtn', label: '追踪站', action: 'window.openTrackingStation()' },
        { id: 'escSettingsBtn', label: '设置', action: 'window.openSettings()' },
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
        'window.openSettings()': () => { if (typeof window.openSettings === 'function') window.openSettings(); },
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
