'use strict';

import { uiManager } from './uiManager.js';
import { sceneManager } from '../sceneManager.js';
import { audioCore } from '../audio/audioCore.js';
import { t } from '../config/strings.js';
import { SETTINGS_CATEGORIES, SETTINGS_ROWS, SETTINGS_GROUP_LABELS } from '../config/settingsConfig.js';

// 设置面板 — 0.2.5 从 scene 抽离为覆盖式 UI 面板，配置数据驱动
// 原 settingsScene.js 以 scene 形式注册，切换场景会触发 audioDirector 停止音乐
// （SCENE_CHANGED 无 settings 分支，from=menu/flight/tracking 时 stopMusic）。
// 改为 uiManager 面板后不触发场景切换，音频连续播放，且可从任意场景覆盖打开。
// 返回目标天然为"原场景"（不切场景），无需记录前场景。
// 分类/设置行/选项定义集中在 ../config/settingsConfig.js，本模块只读渲染。

// 面板 DOM（一次性创建，常驻 body，显示/隐藏切换）
const container = document.createElement('div');
container.id = 'settingsContainer';
container.style.display = 'none';
container.innerHTML = `
    <div id="settingsNav"></div>
    <div id="settingsContent"></div>
`;
document.body.appendChild(container);

const navEl = container.querySelector('#settingsNav');
const contentEl = container.querySelector('#settingsContent');

let _currentCategory = 'display';

// 按 group 查找设置行配置（事件分发用）
function findRow(group) {
    for (const rows of Object.values(SETTINGS_ROWS)) {
        const row = rows.find(r => r.group === group);
        if (row) return row;
    }
    return null;
}

// 读取设置行的当前值（storageKey → defaultValue）
function getRowValue(row) {
    return localStorage.getItem(row.storageKey) || row.defaultValue;
}

// 分段按钮组 — 生成 HTML（option.labelKey 引用 strings.js，缺省用 option.label 字面量）
function _renderButtonGroup(row, currentValue) {
    let html = `<div class="settings-btn-group">`;
    for (const opt of row.options) {
        const isSelected = opt.value === currentValue;
        const state = isSelected ? 'selected' : 'unselected';
        const label = opt.labelKey ? t(opt.labelKey) : opt.label;
        html += `<button data-group="${row.group}" class="settings-btn ${state}" data-value="${opt.value}">${label}</button>`;
    }
    html += `</div>`;
    return html;
}

// 设置行 — 左侧标签 + 右侧控件
function _renderSettingRow(label, controlHtml) {
    return `<div class="settings-row">
        <div class="settings-row-label">${label}</div>
        <div class="settings-row-control">${controlHtml}</div>
    </div>`;
}

// 分组标题条
function _renderGroupHeader(title) {
    return `<div class="settings-group-header">${title}</div>`;
}

function _renderNav() {
    let html = '<div class="settings-nav-title">' + t('settings.title') + '</div>';
    for (const cat of SETTINGS_CATEGORIES) {
        const isActive = cat.id === _currentCategory;
        const color = cat.enabled
            ? (isActive ? '#88ccff' : '#ccc')
            : '#555';
        const cursor = cat.enabled ? 'pointer' : 'default';
        const activeClass = isActive ? ' active' : '';
        const isEnable = cat.enabled ?  '' : ' disabled';
        html += `<div data-cat="${cat.id}" class="settings-cat${activeClass}${isEnable}" style="
            cursor:${cursor};
        ">${t(cat.labelKey)}</div>`;
    }
    // 底部返回按钮（关闭面板，不再切场景）
    html += `<div style="margin-top:auto; padding-top:12px;">
        <div id="settingsBackBtn" class="settings-back-btn">${t('common.back')}</div>
    </div>`;
    navEl.innerHTML = html;

    // 绑定分类点击
    navEl.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => {
            const catId = el.getAttribute('data-cat');
            const cat = SETTINGS_CATEGORIES.find(c => c.id === catId);
            if (cat && cat.enabled) {
                _currentCategory = catId;
                _renderNav();
                _renderContent();
            }
        });
    });

    // 绑定返回按钮
    const backBtn = navEl.querySelector('#settingsBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            closeSettings();
        });
    }
}

function _renderContent() {
    const cat = SETTINGS_CATEGORIES.find(c => c.id === _currentCategory);
    if (!cat) return;

    // 内容区标题
    let html = `<div class="settings-content-title">${t(cat.labelKey)}</div>`;

    const rows = SETTINGS_ROWS[cat.id] || [];
    if (cat.enabled && rows.length > 0) {
        // 数据驱动渲染：分组标题 + 各设置行
        const groupLabelKey = SETTINGS_GROUP_LABELS[cat.id];
        if (groupLabelKey) {
            html += _renderGroupHeader(t(groupLabelKey));
        }
        for (const row of rows) {
            html += _renderSettingRow(t(row.labelKey), _renderButtonGroup(row, getRowValue(row)));
        }
    } else if (!cat.enabled) {
        // 未启用的分类 — 灰色占位
        html += `<div style="color:#555;font-size:13px;margin-top:60px;text-align:center;">${t('settings.comingSoon')}</div>`;
    }

    contentEl.innerHTML = html;

    // 绑定分段按钮组事件（数据驱动：通过 group 查配置做存储与副作用）
    contentEl.querySelectorAll('button[data-group]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const group = btn.getAttribute('data-group');
            const value = btn.getAttribute('data-value');
            const row = findRow(group);
            if (!row) return;

            localStorage.setItem(row.storageKey, value);
            _renderContent();

            // 菜单音乐切换：仅当处于主菜单时立即试听（面板化后场景不再切换）
            if (group === 'menuMusic' && sceneManager.getCurrentScene() === 'menu') {
                audioCore.playMusic('menu', value);
            }
        });
    });
}

// 设置面板显隐的内部实现（仅由 uiManager 的 show/hide 回调调用）
function _showSettings() {
    // 与 ESC 菜单互斥：从 ESC 菜单进入时关闭 ESC 菜单
    uiManager.hidePanel('esc');
    _currentCategory = 'display';
    container.style.display = 'flex';
    _renderNav();
    _renderContent();
}

// 隐藏设置面板的内部实现（仅由 uiManager 的 show/hide 回调调用）
function _hideSettings() {
    container.style.display = 'none';
}

// 打开设置面板（对外入口：统一转发 uiManager，保证 UI_PANEL_OPENED 广播）
function openSettings() {
    uiManager.showPanel('settings');
}

// 关闭设置面板（对外入口：统一转发 uiManager，保证 UI_PANEL_CLOSED 广播）
function closeSettings() {
    uiManager.hidePanel('settings');
}

// 全局 ESC：设置面板可见时关闭（不切场景）
// 注意：必须 stopPropagation —— 飞行/追踪场景下 menuUI 的 window 级 ESC 处理器
// 会 toggleEscMenu()，若不拦截会同时打开 ESC 菜单（document 先于 window 冒泡）。
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && container.style.display !== 'none') {
        e.stopPropagation();
        closeSettings();
    }
});

// 注册到 uiManager，与开始游戏面板等统一显隐管理
uiManager.registerPanel('settings', {
    element: container,
    show: _showSettings,
    hide: _hideSettings,
    render: () => {}
});

export { openSettings, closeSettings };
