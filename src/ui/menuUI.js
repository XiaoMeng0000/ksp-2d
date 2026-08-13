'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { createNotification, createDialog, createInputDialog, createConfirmDialog, renderIconHtml } from './uiComponents.js';
import { sceneManager } from '../sceneManager.js';
import { saveManager } from '../saveManager.js';
import { toggleDebugPanel, refreshDebugPanel } from './debugUI.js';
import { t } from '../config/strings.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

// ESC 菜单 — 创建 ESC 菜单
const escMenu = document.createElement('div');
escMenu.id = 'escMenu';
escMenu.style.display = 'none';

function getCurrentWorldName() {
    if (!window.currentWorldId) return t('common.none');
    if (typeof window.__saveManager !== 'undefined') {
        const world = window.__saveManager.getWorld(window.currentWorldId);
        return world ? world.metadata.name : t('common.unknown');
    }
    return t('common.unknown');
}

// 追踪站 - 根据场景返回 ESC 菜单按钮列表
// handler 直接引用模块内函数（openSettings 由 main.js 提供，做一层包装）
function getEscButtons(scene) {
    if (scene === 'tracking') {
        return [
            { id: 'escResumeBtn', label: t('esc.resume'), handler: resumeGame },
            { id: 'escSaveBtn', label: t('esc.save'), handler: saveGame },
            { id: 'escLoadBtn', label: t('esc.load'), handler: loadGame },
            { id: 'escBackBtn', label: t('esc.backToFlight'), handler: backToFlight },
            { id: 'escSettingsBtn', label: t('common.settings'), handler: () => window.openSettings() },
            { id: 'escQuitBtn', label: t('esc.quitToMenu'), handler: quitToMenu }
        ];
    }
    return [
        { id: 'escResumeBtn', label: t('esc.resume'), handler: resumeGame },
        { id: 'escSaveBtn', label: t('esc.save'), handler: saveGame },
        { id: 'escLoadBtn', label: t('esc.load'), handler: loadGame },
        { id: 'escTrackingBtn', label: t('esc.openTracking'), handler: openTrackingStation },
        { id: 'escSettingsBtn', label: t('common.settings'), handler: () => window.openSettings() },
        { id: 'escQuitBtn', label: t('esc.quitToMenu'), handler: quitToMenu }
    ];
}

// 追踪站 - 渲染 ESC 菜单按钮
function renderEscMenuButtons(scene) {
    const buttons = getEscButtons(scene);
    const btnContainer = document.getElementById('escBtnContainer');
    if (!btnContainer) return;
    
    btnContainer.innerHTML = '';
    
    buttons.forEach(btn => {
        const el = document.createElement('button');
        el.id = btn.id;
        el.textContent = btn.label;
        el.className = 'ui-btn';
        if (btn.handler) el.addEventListener('click', btn.handler);
        btnContainer.appendChild(el);
    });
}

escMenu.innerHTML = `
    <div class="ui-dialog" style="padding: 20px 25px; min-width: 250px;">
        <h3 class="ui-dialog-title" style="margin-bottom: 10px;">${t('esc.menu')}</h3>
        <div id="escCurrentWorld">${t('esc.currentWorld', { name: getCurrentWorldName() })}</div>
        <div id="escBtnContainer"></div>
        <p class="esc-close-hint">${t('esc.closeHint')}</p>
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
            worldDisplay.textContent = t('esc.currentWorld', { name: getCurrentWorldName() });
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



// ESC 菜单 — 按钮事件处理函数（模块内私有，不再挂 window）
function resumeGame() {
    uiManager.hidePanel('esc');
}

// 追踪站 - 打开追踪站
function openTrackingStation() {
    if (_cachedShipData && _cachedShipData.mode === 'thrust') {
        window.showNotification(t('esc.blockedThrustTracking'), 'warning');
        return;
    }
    uiManager.hidePanel('esc');
    sceneManager.switchTo('tracking');
}

// 追踪站 - 回到飞行器
function backToFlight() {
    if (!_cachedShipData || !_cachedShipData.exists) {
        window.showNotification(t('esc.noShip'), 'warning');
        return;
    }
    uiManager.hidePanel('esc');
    sceneManager.switchTo('flight');
}

// 层级存档 - 存档功能（在当前世界创建检查点）
function saveGame() {
    try {
        const worldId = window.currentWorldId;
        if (!worldId) {
            window.showNotification(t('common.noWorld'), 'info');
            return;
        }
        const world = saveManager.getWorld(worldId);
        const checkpointName = t('common.checkpointName', { n: world.checkpoints.length + 1 });
        const id = saveManager.saveCheckpoint(worldId, checkpointName);
        if (id) window.showNotification(t('archive.saved'), 'success');
        else window.showNotification(t('archive.saveFailed'), 'error');
    } catch (e) {
        console.error('[Save] 存档异常:', e);
        window.showNotification(t('archive.saveError'), 'error');
    }
}

// 层级存档 - 读档功能（显示当前世界的检查点列表）
function loadGame() {
    const worldId = window.currentWorldId;
    if (!worldId) {
        window.showNotification(t('common.noWorld'), 'info');
        return;
    }
    const list = saveManager.getCheckpointList(worldId);
    if (list.length === 0) {
        window.showNotification(t('archive.noCheckpoints'), 'info');
        return;
    }
    const items = list.map(c => ({
        id: c.id,
        name: c.name,
        subtitle: t('archive.checkpointSubtitle', { ts: c.timestamp, time: c.gameTime.toFixed(1) })
    }));
    createDialog(t('archive.selectCheckpoint'), items, (selectedId) => {
        const success = saveManager.loadCheckpoint(worldId, selectedId);
        if (success) {
            window.showNotification(t('archive.loaded'), 'success');
            if (sceneManager.getCurrentScene() === 'menu') {
                sceneManager.switchTo('flight');
            }
            refreshDebugPanel();
        } else {
            window.showNotification(t('archive.loadFailed'), 'error');
        }
    });
}

// 退出优化 - 优化退出游戏流程
function quitToMenu() {
    // 1. 检查是否在推力模式
    if (_cachedShipData && _cachedShipData.mode === 'thrust') {
        window.showNotification(t('esc.blockedThrustQuit'), 'warning');
        return;
    }

    // 2. 弹出确认对话框
    createConfirmDialog(
        t('esc.quitTitle'),
        t('esc.quitMessage'),
        () => {
            // 用户选择「保存并退出」
            const worldId = window.currentWorldId;
            if (worldId) {
                const world = saveManager.getWorld(worldId);
                const checkpointName = t('common.checkpointName', { n: world.checkpoints.length + 1 });
                saveManager.saveCheckpoint(worldId, checkpointName);
                window.showNotification(t('archive.savedCheckpoint'), 'success');
            }
            uiManager.hidePanel('esc');
            sceneManager.switchTo('menu');
        },
        () => {
            // 用户选择「退出」（不保存）
            uiManager.hidePanel('esc');
            sceneManager.switchTo('menu');
        },
        t('esc.saveAndQuit'),  // 确认按钮文字
        t('esc.quitDirect')     // 取消按钮文字
    );
}

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
archiveManagerPanel.style.display = 'none';
archiveManagerPanel.innerHTML = `
    <div class="ui-dialog" style="min-width: 350px; max-width: 550px; max-height: 80vh; padding: 15px;">
        <h3 class="ui-dialog-title" style="margin-bottom: 15px;">${t('archive.title')}</h3>
        <div id="archiveManagerContent"></div>
        <button id="archiveManagerCloseBtn" class="ui-btn" style="margin-top:12px;">${t('common.close')}</button>
    </div>
`;
document.body.appendChild(archiveManagerPanel);

// 存档管理 - 事件委托（避免字符串 onclick）
archiveManagerPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const worldId = btn.dataset.worldId;
    if (action === 'view-checkpoints') {
        renderCheckpointList(worldId);
    } else if (action === 'delete-world') {
        deleteWorld(worldId);
    } else if (action === 'back-to-worlds') {
        renderWorldList();
    } else if (action === 'delete-checkpoint') {
        deleteCheckpoint(worldId, btn.dataset.cpId);
    }
});

// 存档管理 - 当前查看的世界ID
let currentArchiveWorldId = null;

// 存档管理 - 渲染世界列表（阶段 4 起改为命名导出，供 main.js 直接引用）
export function renderWorldList() {
    const content = document.getElementById('archiveManagerContent');
    const worldList = saveManager.getWorldList();

    if (worldList.length === 0) {
        content.innerHTML = `<p style="color:var(--text-dim);">${t('archive.noWorlds')}</p>`;
        return;
    }

    let html = '<div class="ui-list">';
    worldList.forEach(world => {
        html += `
            <div class="archive-world-row">
                <button data-action="view-checkpoints" data-world-id="${world.id}" class="archive-world-btn">
                    ${world.name}
                </button>
                <button data-action="delete-world" data-world-id="${world.id}" class="ui-btn-danger">
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
        <div class="archive-back-row">
            <button data-action="back-to-worlds" class="archive-back-btn">
                ${t('archive.backToList')}
            </button>
            <span class="archive-world-name">${world.metadata.name}</span>
        </div>
    `;

    if (checkpoints.length === 0) {
        html += `<p style="color:var(--text-dim);">${t('archive.noCheckpointsInWorld')}</p>`;
    } else {
        html += '<div class="ui-list">';
        checkpoints.forEach(cp => {
            html += `
                <div class="archive-checkpoint-row">
                    <div style="text-align:left;">
                        <div class="archive-checkpoint-name">${cp.name}</div>
                        <div class="archive-checkpoint-sub">${t('archive.checkpointSubtitleCn', { ts: cp.timestamp, time: cp.gameTime.toFixed(1) })}</div>
                    </div>
                    <button data-action="delete-checkpoint" data-world-id="${worldId}" data-cp-id="${cp.id}" class="ui-btn-danger">
                        ${t('common.delete')}
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
    createConfirmDialog(t('archive.confirmDeleteTitle'), t('archive.confirmDeleteWorld', { name: world.metadata.name }), () => {
        saveManager.deleteWorld(worldId);
        renderWorldList();
        window.showNotification(t('archive.worldDeleted'), 'success');
    }, () => {});
}

// 存档管理 - 删除检查点确认
function deleteCheckpoint(worldId, checkpointId) {
    const checkpoints = saveManager.getCheckpointList(worldId);
    const cp = checkpoints.find(c => c.id === checkpointId);
    createConfirmDialog(t('archive.confirmDeleteTitle'), t('archive.confirmDeleteCheckpoint', { name: cp.name }), () => {
        saveManager.deleteCheckpoint(worldId, checkpointId);
        renderCheckpointList(worldId);
        window.showNotification(t('archive.checkpointDeleted'), 'success');
    }, () => {});
}

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
