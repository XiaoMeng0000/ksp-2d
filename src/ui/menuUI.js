'use strict'

// 0.2.5：ESC 菜单已抽离为独立组件 escMenuUI.js（KSP2 控制台风格，独立 --esc-* 配色），
// 本模块保留：通知/对话框的全局挂载、存档管理面板（archiveManagerPanel）。

import { uiManager } from './uiManager.js';
import { createNotification, createDialog, createInputDialog, createConfirmDialog, renderIconHtml, escapeHtml } from './uiComponents.js';
import { saveManager } from '../saveManager.js';
import { t } from '../config/strings.js';

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
                    ${escapeHtml(world.name)}
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
            <span class="archive-world-name">${escapeHtml(world.metadata.name)}</span>
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
                        <div class="archive-checkpoint-name">${escapeHtml(cp.name)}</div>
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
    createConfirmDialog(t('archive.confirmDeleteTitle'), t('archive.confirmDeleteWorld', { name: escapeHtml(world.metadata.name) }), () => {
        saveManager.deleteWorld(worldId);
        renderWorldList();
        window.showNotification(t('archive.worldDeleted'), 'success');
    }, () => {});
}

// 存档管理 - 删除检查点确认
function deleteCheckpoint(worldId, checkpointId) {
    const checkpoints = saveManager.getCheckpointList(worldId);
    const cp = checkpoints.find(c => c.id === checkpointId);
    createConfirmDialog(t('archive.confirmDeleteTitle'), t('archive.confirmDeleteCheckpoint', { name: escapeHtml(cp.name) }), () => {
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
