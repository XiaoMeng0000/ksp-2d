'use strict';

import { sceneManager } from '../sceneManager.js';
import { ENCYCLOPEDIA } from '../config/encyclopediaConfig.js';
import { t } from '../config/strings.js';

// 游戏百科（0.2.7 KSP2 设计语言重构：居中窗口 + 左导航 + 内容条目卡）
// 视觉全部走 scenes.css（#encyclopediaPanel / .enc-*），JS 只做数据渲染与分类交互
function registerEncyclopediaScene() {
    let panel = null;
    let escHandler = null;
    let _selectedCategory = 0;

    function _close() {
        sceneManager.switchTo('menu');
    }

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

    sceneManager.registerScene('encyclopedia', {
        enter() {
            _selectedCategory = 0;

            panel = document.createElement('div');
            panel.id = 'encyclopediaPanel';
            panel.className = 'scene-fullscreen';

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
                _close();
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

            panel.appendChild(windowEl);
            document.body.appendChild(panel);

            _renderCategoryList(navEl, contentEl);
            _renderContent(contentEl);

            escHandler = (event) => {
                if (event.key === 'Escape') {
                    _close();
                }
            };
            document.addEventListener('keydown', escHandler);
        },

        exit() {
            if (escHandler) {
                document.removeEventListener('keydown', escHandler);
                escHandler = null;
            }
            if (panel && panel.parentNode) {
                panel.parentNode.removeChild(panel);
            }
            panel = null;
        }
    });
}

export { registerEncyclopediaScene };
