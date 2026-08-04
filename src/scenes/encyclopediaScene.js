'use strict';

import { sceneManager } from '../sceneManager.js';
import { ENCYCLOPEDIA } from '../config/encyclopediaConfig.js';

function registerEncyclopediaScene() {
    let panel = null;
    let escHandler = null;
    let _selectedCategory = 0;

    function _close() {
        sceneManager.switchTo('menu');
    }

    function _renderCategoryList(navEl, contentEl) {
        navEl.innerHTML = '';

        for (let i = 0; i < ENCYCLOPEDIA.length; i++) {
            const cat = ENCYCLOPEDIA[i];
            const item = document.createElement('div');
            item.textContent = cat.category;
            item.style.cssText = ''
                + 'padding:10px 16px;font-family:monospace;font-size:14px;'
                + 'cursor:pointer;color:rgba(255,255,255,0.6);'
                + 'transition:all 0.15s ease;'
                + 'border-left:3px solid transparent;';

            if (i === _selectedCategory) {
                item.style.color = 'white';
                item.style.background = 'rgba(80,80,160,0.4)';
                item.style.borderLeftColor = '#A04040';
            }

            item.addEventListener('mouseenter', () => {
                if (i !== _selectedCategory) {
                    item.style.background = 'rgba(255,255,255,0.05)';
                }
            });
            item.addEventListener('mouseleave', () => {
                if (i !== _selectedCategory) {
                    item.style.background = 'transparent';
                }
            });
            item.addEventListener('click', () => {
                _selectedCategory = i;
                _renderContent(contentEl);
                _renderCategoryList(navEl, contentEl);
            });

            navEl.appendChild(item);
        }
    }

    function _renderContent(contentEl) {
        contentEl.innerHTML = '';
        const cat = ENCYCLOPEDIA[_selectedCategory];
        if (!cat) return;

        for (const entry of cat.entries) {
            const entryDiv = document.createElement('div');
            entryDiv.style.cssText = 'margin-bottom:28px;';

            const title = document.createElement('h3');
            title.textContent = entry.title;
            title.style.cssText = 'color:#A04040;font-family:monospace;font-size:16px;margin:0 0 8px 0;';

            const body = document.createElement('p');
            body.textContent = entry.content;
            body.style.cssText = 'color:#999;font-family:monospace;font-size:13px;line-height:1.8;margin:0;';

            entryDiv.appendChild(title);
            entryDiv.appendChild(body);
            contentEl.appendChild(entryDiv);
        }
    }

    sceneManager.registerScene('encyclopedia', {
        enter() {
            _selectedCategory = 0;

            panel = document.createElement('div');
            panel.id = 'encyclopediaPanel';
            panel.style.cssText = ''
                + 'position:fixed;inset:0;z-index:2000;'
                + 'background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);'
                + 'display:flex;font-family:monospace;';

            // 左侧分类导航
            const navEl = document.createElement('div');
            navEl.id = 'encyclopediaNav';
            navEl.style.cssText = ''
                + 'width:200px;padding:60px 0 0 0;'
                + 'border-right:1px solid #333;'
                + 'overflow-y:auto;flex-shrink:0;';

            // 右侧内容区
            const contentEl = document.createElement('div');
            contentEl.id = 'encyclopediaContent';
            contentEl.style.cssText = ''
                + 'flex:1;padding:60px 80px 60px 60px;'
                + 'overflow-y:auto;';

            // 关闭按钮
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '关闭';
            closeBtn.style.cssText = ''
                + 'position:absolute;bottom:40px;right:40px;'
                + 'padding:10px 36px;'
                + 'background:rgba(30,30,30,0.8);color:white;'
                + 'border:1px solid #A04040;border-radius:4px;'
                + 'font-family:monospace;font-size:14px;'
                + 'cursor:pointer;transition:all 0.2s ease;';
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.background = '#2a2a2a';
                closeBtn.style.borderColor = '#c05050';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.background = 'rgba(30,30,30,0.8)';
                closeBtn.style.borderColor = '#A04040';
            });
            closeBtn.addEventListener('click', () => {
                _close();
            });

            _renderCategoryList(navEl, contentEl);
            _renderContent(contentEl);

            panel.appendChild(navEl);
            panel.appendChild(contentEl);
            panel.appendChild(closeBtn);
            document.body.appendChild(panel);

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
