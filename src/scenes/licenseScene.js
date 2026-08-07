'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { LICENSE } from '../config/licenseConfig.js';

function registerLicenseScene() {
    let panel = null;
    let escHandler = null;

    function _close() {
        sceneManager.switchTo('menu');
    }

    function _renderContent(contentEl) {
        contentEl.innerHTML = '';

        // 页面标题
        const pageTitle = document.createElement('h1');
        pageTitle.textContent = '// ' + LICENSE.title;
        pageTitle.style.cssText = 'color:#A04040;font-family:monospace;font-size:26px;margin:0 0 30px 0;';
        contentEl.appendChild(pageTitle);

        for (const section of LICENSE.sections) {
            // 节标题
            const sectionTitle = document.createElement('h2');
            sectionTitle.textContent = '// ' + section.title;
            sectionTitle.style.cssText = 'color:#A04040;font-family:monospace;font-size:18px;margin:0 0 16px 0;';
            contentEl.appendChild(sectionTitle);

            // 段落
            if (section.paragraphs) {
                for (const paragraph of section.paragraphs) {
                    const pEl = document.createElement('p');
                    pEl.textContent = paragraph;
                    pEl.style.cssText = 'color:#ccc;font-family:monospace;font-size:14px;line-height:1.9;margin:0 0 12px 0;padding-left:20px;';
                    contentEl.appendChild(pEl);
                }
            }

            // 节间距
            const spacer = document.createElement('div');
            spacer.style.cssText = 'height:30px;';
            contentEl.appendChild(spacer);
        }
    }

    sceneManager.registerScene('license', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'licensePanel';
            panel.style.cssText = ''
                + 'position:fixed;inset:0;z-index:2000;'
                + 'background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);'
                + 'display:flex;font-family:monospace;';

            // ========== 分割线 ==========
            const divider = document.createElement('div');
            divider.style.cssText = ''
                + 'width:1px;background:#333;'
                + 'align-self:stretch;flex-shrink:0;';

            // ========== 左侧 Logo 区 ==========
            const leftPanel = document.createElement('div');
            leftPanel.style.cssText = ''
                + 'width:280px;padding:0 40px;'
                + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
                + 'flex-shrink:0;';

            const logoContent = document.createElement('div');
            logoContent.style.cssText = 'text-align:center;';

            // 游戏标题
            if (textureManager.isReady() && textureManager.get('title')) {
                const titleImg = document.createElement('img');
                titleImg.src = textureManager.get('title').src;
                titleImg.style.cssText = 'max-width:220px;';
                logoContent.appendChild(titleImg);
            } else {
                const titleFallback = document.createElement('div');
                titleFallback.textContent = 'KSP 2D';
                titleFallback.style.cssText = 'color:#A04040;font-family:monospace;font-size:36px;';
                logoContent.appendChild(titleFallback);
            }

            leftPanel.appendChild(logoContent);

            // 返回按钮 — 左下角固定
            const backBtn = document.createElement('button');
            backBtn.textContent = '返回';
            backBtn.style.cssText = ''
                + 'position:absolute;bottom:40px;left:40px;'
                + 'padding:10px 36px;'
                + 'background:rgba(30,30,30,0.8);color:white;'
                + 'border:1px solid #A04040;border-radius:4px;'
                + 'font-family:monospace;font-size:14px;'
                + 'cursor:pointer;transition:all 0.2s ease;';
            backBtn.addEventListener('mouseenter', () => {
                backBtn.style.background = '#2a2a2a';
                backBtn.style.borderColor = '#c05050';
            });
            backBtn.addEventListener('mouseleave', () => {
                backBtn.style.background = 'rgba(30,30,30,0.8)';
                backBtn.style.borderColor = '#A04040';
            });
            backBtn.addEventListener('click', () => {
                _close();
            });
            panel.appendChild(backBtn);

            // ========== 右侧内容区 ==========
            const rightPanel = document.createElement('div');
            rightPanel.style.cssText = ''
                + 'flex:1;padding:0 60px 0 40px;'
                + 'display:flex;align-items:center;'
                + 'overflow-y:auto;';

            const contentWrapper = document.createElement('div');
            contentWrapper.style.cssText = 'width:100%;padding:60px 0;';

            _renderContent(contentWrapper);

            rightPanel.appendChild(contentWrapper);

            panel.appendChild(leftPanel);
            panel.appendChild(divider);
            panel.appendChild(rightPanel);
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

export { registerLicenseScene };
