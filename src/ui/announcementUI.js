'use strict';

import { uiManager } from './uiManager.js';
import { ANNOUNCEMENTS } from '../config/announcementConfig.js';
import { t } from '../config/strings.js';

// 游戏公告（0.2.8 面板化：由 scene 改为 uiManager 覆盖式面板，参照百科面板化先例）
// - 视觉复用 ksp2_panels.css 的 .enc-*（#infoScenePanel 选择器即公告面板，保留原 id）
// - 版本导航（左）+ 内容卡片（右）；分类状态模块级保留
// - 仅通过 openAnnouncement() 打开（启动进主菜单自动打开 / 主菜单额外内容入口）

// 当前选中版本索引（面板重开时保留）
let _selectedIndex = 0;
let _built = false;

// 面板 DOM（一次性创建，常驻 body，显示/隐藏切换；id 与 CSS 选择器对应，勿改）
const container = document.createElement('div');
container.id = 'infoScenePanel';
container.className = 'scene-fullscreen';
container.style.display = 'none';
document.body.appendChild(container);

// 渲染左侧版本导航（选中项高亮；点击切换右侧内容）
function _renderNav(navEl) {
    navEl.innerHTML = '';

    for (let i = 0; i < ANNOUNCEMENTS.length; i++) {
        const item = document.createElement('div');
        item.textContent = ANNOUNCEMENTS[i].version;
        item.className = 'enc-nav-item' + (i === _selectedIndex ? ' active' : '');
        item.addEventListener('click', () => {
            _selectedIndex = i;
            _renderContent();
            _renderNav(navEl);
        });
        navEl.appendChild(item);
    }
}

// 渲染右侧内容：版本标题条 + 每个 section 一张卡片
function _renderContent() {
    const announcement = ANNOUNCEMENTS[_selectedIndex];
    if (!announcement) return;
    const contentEl = document.getElementById('infoSceneContent');
    contentEl.innerHTML = '';

    const title = document.createElement('div');
    title.textContent = '// ' + (announcement.title || announcement.version);
    title.className = 'enc-content-title';
    contentEl.appendChild(title);

    for (const section of announcement.sections) {
        const card = document.createElement('div');
        card.className = 'enc-card';

        const cardTitle = document.createElement('h3');
        cardTitle.textContent = section.title;
        cardTitle.className = 'enc-card-title';
        card.appendChild(cardTitle);

        const body = document.createElement('div');
        body.className = 'enc-card-body';
        for (const paragraph of section.paragraphs) {
            const p = document.createElement('p');
            p.textContent = paragraph;
            body.appendChild(p);
        }
        card.appendChild(body);
        contentEl.appendChild(card);
    }
}

// 首次打开时构建 DOM（懒构建；之后仅显隐切换，版本选择状态保留）
function _buildPanel() {
    // 居中大窗口（蓝灰壳 + 紫描边，与百科面板同语言）
    const windowEl = document.createElement('div');
    windowEl.className = 'enc-window';

    // 顶栏：标题 + 关闭
    const topbar = document.createElement('div');
    topbar.className = 'enc-topbar';

    const titleEl = document.createElement('span');
    titleEl.textContent = t('info.title');
    titleEl.className = 'enc-title';
    topbar.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = t('common.close');
    closeBtn.className = 'enc-close';
    closeBtn.addEventListener('click', () => {
        closeAnnouncement();
    });
    topbar.appendChild(closeBtn);

    windowEl.appendChild(topbar);

    // 主体：左版本导航 + 右内容
    const bodyEl = document.createElement('div');
    bodyEl.className = 'enc-body';

    const navEl = document.createElement('div');
    navEl.id = 'infoSceneNav';

    const contentEl = document.createElement('div');
    contentEl.id = 'infoSceneContent';

    bodyEl.appendChild(navEl);
    bodyEl.appendChild(contentEl);
    windowEl.appendChild(bodyEl);
    container.appendChild(windowEl);

    _renderNav(navEl);
    _renderContent();
}

// 显示面板的内部实现（仅由 uiManager 的 show 回调调用）
function _showAnnouncement() {
    // 无公告时静默跳过（与旧场景行为一致）
    if (ANNOUNCEMENTS.length === 0) {
        return;
    }
    // 与 ESC 菜单互斥（同设置/百科面板模式）
    uiManager.hidePanel('esc');
    if (!_built) {
        _buildPanel();
        _built = true;
    }
    container.style.display = 'flex';
}

// 隐藏面板的内部实现（仅由 uiManager 的 hide 回调调用）
function _hideAnnouncement() {
    container.style.display = 'none';
}

// 打开公告栏（对外入口：统一转发 uiManager，保证 UI_PANEL_OPENED 广播）
function openAnnouncement() {
    uiManager.showPanel('announcement');
}

// 关闭公告栏（对外入口：统一转发 uiManager，保证 UI_PANEL_CLOSED 广播）
function closeAnnouncement() {
    uiManager.hidePanel('announcement');
}

// 全局 ESC：面板可见时关闭（不切场景）
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && container.style.display !== 'none') {
        e.stopPropagation();
        closeAnnouncement();
    }
});

// 注册到 uiManager，与设置/百科/开始游戏面板统一显隐管理
uiManager.registerPanel('announcement', {
    element: container,
    show: _showAnnouncement,
    hide: _hideAnnouncement,
    render: () => {}
});

export { openAnnouncement, closeAnnouncement };
