'use strict';

import { uiManager } from './uiManager.js';
import { t } from '../config/strings.js';

// 创建新战役对话框 — 0.2.5 新增
// 从"开始游戏"面板的「创建新战役」进入，以覆盖层形式展示（案例图2 结构）：
//   - 左列：游戏模式（自由/生涯）+ 战役名称输入
//   - 右列：模式预览卡片（点击可切换选中）
// 功能边界：自由模式直接创建当前自由模式存档；生涯模式尚未完成，点击提示。
// 命名全部走 t()，术语与游戏内一致（自由模式/生涯模式）。

// 当前选中模式：'sandbox' | 'career'
let _selectedMode = 'sandbox';

const overlay = document.createElement('div');
overlay.id = 'newCampaignDialog';
overlay.className = 'nc-overlay';
overlay.style.display = 'none';
overlay.innerHTML = `
    <div class="nc-dialog">
        <div class="nc-title">${t('newcampaign.title')}</div>
        <div class="nc-body">
            <div class="nc-form">
                <div class="nc-field">
                    <div class="nc-label">${t('newcampaign.gameMode')}</div>
                    <div class="nc-form-input" id="ncModeDisplay">${t('common.modeSandbox')}</div>
                </div>
                <div class="nc-field">
                    <div class="nc-label">${t('newcampaign.campaignName')}</div>
                    <input id="ncNameInput" class="nc-input" type="text"
                        placeholder="${t('newcampaign.namePlaceholder')}"
                        value="${t('newcampaign.nameDefault')}">
                </div>
            </div>
            <div class="nc-mode-cards">
                <div class="nc-mode-card nc-mode-selected" data-mode="sandbox">
                    <div class="nc-mode-title">${t('common.modeSandbox')}</div>
                    <div class="nc-mode-desc">${t('newcampaign.modeDescSandbox')}</div>
                </div>
                <div class="nc-mode-card" data-mode="career">
                    <div class="nc-mode-title">${t('common.modeCareer')}</div>
                    <div class="nc-mode-desc">${t('newcampaign.modeDescCareer')}</div>
                </div>
            </div>
        </div>
        <div class="nc-actions">
            <button class="ui-btn" data-action="nc-cancel">${t('newcampaign.cancel')}</button>
            <button class="ui-btn-primary" data-action="nc-start">${t('newcampaign.start')}</button>
        </div>
    </div>
`;
document.body.appendChild(overlay);

// 切换选中模式并同步 UI
function selectMode(mode) {
    _selectedMode = mode;
    overlay.querySelectorAll('.nc-mode-card').forEach(card => {
        card.classList.toggle('nc-mode-selected', card.dataset.mode === mode);
    });
    const display = document.getElementById('ncModeDisplay');
    if (display) {
        display.textContent = mode === 'career' ? t('common.modeCareer') : t('common.modeSandbox');
    }
}

// 开始创建：自由模式直接创建；生涯模式提示未完成
function startCampaign() {
    const nameInput = document.getElementById('ncNameInput');
    const name = (nameInput && nameInput.value.trim()) || t('newcampaign.nameDefault');

    if (_selectedMode === 'career') {
        window.showNotification(t('newcampaign.modeNotReady'), 'warning');
        return;
    }

    // 自由模式：调用 main.js 提供的核心创建逻辑（创建世界→切飞行场景）
    if (typeof window.applyNewGameCreation === 'function') {
        const worldId = window.applyNewGameCreation(name);
        if (worldId) {
            closeNewCampaignDialog();
            // 创建成功并已切入飞行，关闭左侧开始游戏面板
            uiManager.hidePanel('startGamePanel');
        }
    } else {
        window.showNotification(t('newgame.uiNotLoaded'), 'error');
    }
}

// 事件委托
overlay.addEventListener('click', (e) => {
    const modeCard = e.target.closest('.nc-mode-card');
    if (modeCard) {
        selectMode(modeCard.dataset.mode);
        return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
        case 'nc-cancel':
            closeNewCampaignDialog();
            break;
        case 'nc-start':
            startCampaign();
            break;
    }
});

// 打开对话框的内部实现（默认选中自由模式；仅由 uiManager 的 show 回调调用）
function _showNewCampaignDialog() {
    selectMode('sandbox');
    overlay.style.display = 'flex';
    const nameInput = document.getElementById('ncNameInput');
    if (nameInput) {
        nameInput.value = t('newcampaign.nameDefault');
        nameInput.focus();
        nameInput.select();
    }
}

// 关闭对话框的内部实现（左侧开始游戏面板保持原状；仅由 uiManager 的 hide 回调调用）
function _hideNewCampaignDialog() {
    overlay.style.display = 'none';
}

// 打开对话框（对外入口：统一转发 uiManager，保证 UI_PANEL_OPENED 广播）
function openNewCampaignDialog() {
    uiManager.showPanel('newCampaignDialog');
}

// 关闭对话框（对外入口：统一转发 uiManager，保证 UI_PANEL_CLOSED 广播）
function closeNewCampaignDialog() {
    uiManager.hidePanel('newCampaignDialog');
}

// 注册到 uiManager，统一显隐管理
uiManager.registerPanel('newCampaignDialog', {
    element: overlay,
    show: _showNewCampaignDialog,
    hide: _hideNewCampaignDialog,
    render: () => {}
});

export { openNewCampaignDialog, closeNewCampaignDialog };
