'use strict';

// 「完整版内容一览」面板（尝鲜版）
//
// 形态：覆盖式面板（不切场景、不打断音乐），可从主菜单与「下载完整版」弹窗进入。
// 数据：分区内容见 config/ui/fullVersionConfig.js；本文件只负责渲染与交互。
// 通信：注册到 uiManager（panelId: 'fullVersion'），对外入口 openFullVersion()。

import { uiManager } from './uiManager.js';
import { t } from '../config/ui/strings.js';
import { FULL_VERSION_SECTIONS, FULL_VERSION_DOWNLOAD_URL } from '../config/ui/fullVersionConfig.js';
import { escapeHtml } from './uiComponents.js';

const container = document.createElement('div');
container.id = 'fullVersionContainer';
container.className = 'ui-dialog-overlay';
container.style.display = 'none';
container.innerHTML = `
    <div class="ui-dialog" style="width:min(760px, 92vw); max-height:86vh; display:flex; flex-direction:column; padding:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--theme-menu-border);">
            <span style="font-family:var(--font-mono-bold); font-size:15px; color:var(--text-bright); letter-spacing:1px;">// ${t('fullVersion.title')}</span>
            <button id="fullVersionCloseBtn" class="ui-btn" style="padding:3px 10px;">${t('fullVersion.close')}</button>
        </div>
        <div id="fullVersionBody" style="overflow-y:auto; padding:14px 18px; display:flex; flex-direction:column; gap:10px;"></div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 18px; border-top:1px solid var(--theme-menu-border);">
            <span style="font-size:11px; color:var(--text-dim);">${t('fullVersion.subtitle')}</span>
            <button id="fullVersionDownloadBtn" class="ui-btn-primary" style="padding:7px 16px; flex:none;">${t('fullVersion.download')}</button>
        </div>
    </div>
`;
document.body.appendChild(container);

const bodyEl = container.querySelector('#fullVersionBody');

// 渲染分区卡片（内容来自配置，纯数据 → 空态安全）
function _renderBody() {
    bodyEl.innerHTML = FULL_VERSION_SECTIONS.map((section) => {
        const items = (section.items || []).map((line) => `<li style="margin:2px 0;">${escapeHtml(line)}</li>`).join('');
        return `<div class="tkp-card-sm">
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:16px;">${section.icon || '•'}</span>
                <span style="font-family:var(--font-mono-bold); font-size:13px; color:var(--text-bright);">${escapeHtml(section.title)}</span>
                <span style="font-size:10px; color:var(--accent); border:1px solid var(--accent); border-radius:3px; padding:0 5px;">${t('fullVersion.badge')}</span>
            </div>
            <div style="font-size:11px; color:var(--text-dim); margin:4px 0 6px;">${escapeHtml(section.desc || '')}</div>
            <ul style="margin:0; padding-left:18px; font-size:12px; color:var(--text-main); line-height:1.6;">${items}</ul>
        </div>`;
    }).join('');
}

// 下载按钮：新窗口打开 Releases 页（不阻断当前游戏）
container.querySelector('#fullVersionDownloadBtn').addEventListener('click', () => {
    window.open(FULL_VERSION_DOWNLOAD_URL, '_blank', 'noopener');
});

container.querySelector('#fullVersionCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('fullVersion');
});

uiManager.registerPanel('fullVersion', {
    show: () => {
        _renderBody();
        container.style.display = 'flex';
    },
    hide: () => {
        container.style.display = 'none';
    },
    render: () => {}
});

// 对外入口（主菜单 / teaser 弹窗 / 控制台调试）
function openFullVersion() {
    uiManager.showPanel('fullVersion');
}

export { openFullVersion };

if (typeof window !== 'undefined') {
    window.openFullVersion = openFullVersion;
}
