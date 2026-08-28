'use strict';

import { uiManager } from './uiManager.js';
import { ENCYCLOPEDIA } from '../config/encyclopediaConfig.js';
import { t } from '../config/strings.js';

// 游戏百科（0.2.7 全量面板化：由 scene 改为 uiManager 覆盖式面板，参照设置页面板化先例）
// 收益：菜单 BGM 连续、分类状态保留（重开不丢）、自动获得 UI_PANEL_OPENED/CLOSED 面板音效
// 视觉走 ksp2_panels.css（#encyclopediaPanel / .enc-*），JS 只做数据渲染与分类交互

// 当前选中分类（模块级状态：面板重开时保留）
let _selectedCategory = 0;
let _built = false;

// 面板 DOM（一次性创建，常驻 body，显示/隐藏切换）
const container = document.createElement('div');
container.id = 'encyclopediaPanel';
container.className = 'scene-fullscreen';
container.style.display = 'none';
document.body.appendChild(container);

// 左导航：分类列表（选中项高亮）
function _renderCategoryList(navEl, contentEl) {
    navEl.innerHTML = '';

    for (let i = 0; i < ENCYCLOPEDIA.length; i++) {
        const cat = ENCYCLOPEDIA[i];
        const item = document.createElement('div');
        item.textContent = cat.category;
        item.className = 'enc-nav-item' + (i === _selectedCategory ? ' active' : '');
        item.addEventListener('click', () => {
            _selectedCategory = i;
            _renderContent(contentEl);
            _renderCategoryList(navEl, contentEl);
        });
        navEl.appendChild(item);
    }
}

// 右内容：分类标题 + 条目卡（紫头 + 深色卡体分段）
function _renderContent(contentEl) {
    contentEl.innerHTML = '';
    const cat = ENCYCLOPEDIA[_selectedCategory];
    if (!cat) return;

    const title = document.createElement('div');
    title.textContent = cat.category;
    title.className = 'enc-content-title';
    contentEl.appendChild(title);

    for (const entry of cat.entries) {
        const card = document.createElement('div');
        card.className = 'enc-card';

        const cardTitle = document.createElement('h3');
        cardTitle.textContent = entry.title;
        cardTitle.className = 'enc-card-title';
        card.appendChild(cardTitle);

        const body = document.createElement('div');
        body.className = 'enc-card-body';

        // 按空行拆分段落，逐段渲染
        const paragraphs = entry.content.split(/\r?\n\s*\r?\n/);
        for (const para of paragraphs) {
            const p = document.createElement('p');
            p.textContent = para;
            body.appendChild(p);
        }

        card.appendChild(body);
        contentEl.appendChild(card);
    }
}

// 首次打开时构建 DOM（懒构建；之后仅显隐切换，分类状态保留）
function _buildPanel() {
    // 居中大窗口（蓝灰壳 + 紫描边）
    const windowEl = document.createElement('div');
    windowEl.className = 'enc-window';

    // 顶栏：标题 + 关闭
    const topbar = document.createElement('div');
    topbar.className = 'enc-topbar';

    const titleEl = document.createElement('span');
    titleEl.textContent = t('encyclopedia.title');
    titleEl.className = 'enc-title';
    topbar.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = t('encyclopedia.close');
    closeBtn.className = 'enc-close';
    closeBtn.addEventListener('click', () => {
        closeEncyclopedia();
    });
    topbar.appendChild(closeBtn);

    windowEl.appendChild(topbar);

    // 主体：左导航 + 右内容
    const bodyEl = document.createElement('div');
    bodyEl.className = 'enc-body';

    const navEl = document.createElement('div');
    navEl.id = 'encyclopediaNav';

    const contentEl = document.createElement('div');
    contentEl.id = 'encyclopediaContent';

    bodyEl.appendChild(navEl);
    bodyEl.appendChild(contentEl);
    windowEl.appendChild(bodyEl);
    container.appendChild(windowEl);

    _renderCategoryList(navEl, contentEl);
    _renderContent(contentEl);
}

// 显示面板的内部实现（仅由 uiManager 的 show 回调调用）
function _showEncyclopedia() {
    // 与 ESC 菜单互斥（同设置面板模式）
    uiManager.hidePanel('esc');
    if (!_built) {
        _buildPanel();
        _built = true;
    }
    container.style.display = 'flex';
}

// 隐藏面板的内部实现（仅由 uiManager 的 hide 回调调用）
function _hideEncyclopedia() {
    container.style.display = 'none';
}

// 打开百科全书（对外入口：统一转发 uiManager，保证 UI_PANEL_OPENED 广播）
function openEncyclopedia() {
    uiManager.showPanel('encyclopedia');
}

// 关闭百科全书（对外入口：统一转发 uiManager，保证 UI_PANEL_CLOSED 广播）
function closeEncyclopedia() {
    uiManager.hidePanel('encyclopedia');
}

// 全局 ESC：面板可见时关闭（不切场景）
// 注意：必须 stopPropagation —— 菜单场景下 ESC 菜单的 window 级处理器会 toggleEscMenu()
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && container.style.display !== 'none') {
        e.stopPropagation();
        closeEncyclopedia();
    }
});

// 注册到 uiManager，与设置/开始游戏面板统一显隐管理
uiManager.registerPanel('encyclopedia', {
    element: container,
    show: _showEncyclopedia,
    hide: _hideEncyclopedia,
    render: () => {}
});

export { openEncyclopedia, closeEncyclopedia };
