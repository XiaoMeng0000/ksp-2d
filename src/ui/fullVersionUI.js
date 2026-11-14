'use strict';

// 「完整版内容一览」面板（尝鲜版）
//
// 形态：覆盖式面板（不切场景、不打断音乐），可从主菜单与「下载完整版」弹窗进入。
// 视觉：复用设施 / 资源面板的分级背景语言 —— 每块内容一张分组卡（紫色顶条 + 深底卡体），
//       卡头可点击折叠；不使用 emoji 图标。
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
    <div class="ui-dialog" style="width:min(720px, 94vw); max-height:86vh; display:flex; flex-direction:column; padding:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--theme-menu-border);">
            <span style="font-family:var(--font-mono-bold); font-size:15px; color:var(--text-bright); letter-spacing:1px;">// ${t('fullVersion.title')}</span>
            <button id="fullVersionCloseBtn" class="ui-btn" style="padding:3px 10px;">${t('fullVersion.close')}</button>
        </div>
        <div id="fullVersionBody" class="tkp-page tkp-embed" style="overflow-y:auto; padding:8px 14px 4px 14px;"></div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-top:1px solid var(--theme-menu-border);">
            <span style="font-size:11px; color:var(--text-dim); line-height:1.5;">${t('fullVersion.subtitle')}</span>
            <button id="fullVersionDownloadBtn" class="ui-btn-primary" style="padding:7px 16px; flex:none;">${t('fullVersion.download')}</button>
        </div>
    </div>
`;
document.body.appendChild(container);

const bodyEl = container.querySelector('#fullVersionBody');

// 一张分区卡：紫色顶头条（含折叠箭头）+ 深底卡体（说明 + 条目）
// 结构与设施面板的资源分组卡一致：.tkp-res-group-card / -head / -body
function _sectionHtml(section) {
    const items = (section.items || [])
        .map((line) => `<div class="tkp-desc" style="padding:2px 0;">· ${escapeHtml(line)}</div>`)
        .join('');
    const desc = section.desc
        ? `<div class="tkp-hint-muted" style="text-align:left; margin:0 0 6px 0;">${escapeHtml(section.desc)}</div>`
        : '';
    return `<div class="tkp-res-group-card" data-section-id="${section.id}">
        <div class="tkp-res-group-head" data-action="toggle-fullversion-group">
            <span class="tg-arrow">▾</span>
            <span>${escapeHtml(section.title)}</span>
        </div>
        <div class="tkp-res-group-body">
            ${desc}${items}
        </div>
    </div>`;
}

function _renderBody() {
    bodyEl.innerHTML = FULL_VERSION_SECTIONS.map(_sectionHtml).join('')
        + '<div class="tkp-hint-muted" style="text-align:left; margin:6px 0 0 0;">'
        + t('fullVersion.footerHint') + '</div>';
}

// 折叠：与资源面板同款交互（点击顶头折叠，仅剩紫条）
bodyEl.addEventListener('click', (e) => {
    const head = e.target.closest('[data-action="toggle-fullversion-group"]');
    if (!head) return;
    const card = head.closest('.tkp-res-group-card');
    if (card) card.classList.toggle('collapsed');
});

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
