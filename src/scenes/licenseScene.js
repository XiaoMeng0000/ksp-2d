'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { LICENSE } from '../config/licenseConfig.js';
import { t } from '../config/strings.js';

// 版权声明（与制作人员同款：顶部 // 标题 + 左右分割式布局；分割线仅限内容区，不覆盖装饰线/返回按钮区域）
// 视觉走 scenes.css（#licensePanel / .doc-* 共用类）
function registerLicenseScene() {
    let panel = null;
    let escHandler = null;

    function _close() {
        sceneManager.switchTo('menu');
    }

    function _renderContent(contentEl) {
        contentEl.innerHTML = '';

        for (const section of LICENSE.sections) {
            // 节标题
            const sectionTitle = document.createElement('h2');
            sectionTitle.textContent = section.title;
            sectionTitle.className = 'doc-section-title';
            contentEl.appendChild(sectionTitle);

            // 段落
            if (section.paragraphs) {
                for (const paragraph of section.paragraphs) {
                    const pEl = document.createElement('p');
                    pEl.textContent = paragraph;
                    pEl.className = 'doc-para';
                    contentEl.appendChild(pEl);
                }
            }

            // 节间距
            const spacer = document.createElement('div');
            spacer.className = 'doc-spacer';
            contentEl.appendChild(spacer);
        }
    }

    sceneManager.registerScene('license', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'licensePanel';

            // ========== 顶部标题区 ==========
            const header = document.createElement('div');
            header.className = 'doc-header';

            const title = document.createElement('h1');
            title.textContent = '// ' + LICENSE.title;
            title.className = 'doc-title';
            header.appendChild(title);

            panel.appendChild(header);

            // 标题装饰分隔线
            const headerLine = document.createElement('div');
            headerLine.className = 'doc-header-line';
            panel.appendChild(headerLine);

            // ========== 左右分割区（左侧 Logo + 短分割线 + 右侧内容） ==========
            const split = document.createElement('div');
            split.className = 'doc-split';

            // 左侧 Logo 水印
            const leftPanel = document.createElement('div');
            leftPanel.className = 'doc-left';

            if (textureManager.isReady() && textureManager.get('title')) {
                const logoImg = document.createElement('img');
                logoImg.src = textureManager.get('title').src;
                leftPanel.appendChild(logoImg);
            } else {
                const logoFallback = document.createElement('div');
                logoFallback.className = 'doc-logo-text';
                logoFallback.textContent = 'KSP 2D';
                leftPanel.appendChild(logoFallback);
            }
            split.appendChild(leftPanel);

            // 短分割线（仅内容区高度，不覆盖装饰线/返回按钮区域）
            const divider = document.createElement('div');
            divider.className = 'doc-divider';
            split.appendChild(divider);

            // 右侧内容区（内容水平+垂直居中）
            const rightPanel = document.createElement('div');
            rightPanel.className = 'doc-right';

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'doc-content';

            _renderContent(contentWrapper);

            rightPanel.appendChild(contentWrapper);
            split.appendChild(rightPanel);

            panel.appendChild(split);

            // 结尾装饰分隔线
            const footerLine = document.createElement('div');
            footerLine.className = 'doc-header-line';
            footerLine.style = 'margin-bottom: 180px;'
            panel.appendChild(footerLine);

            // ========== 返回按钮（左下角固定） ==========
            const backBtn = document.createElement('button');
            backBtn.textContent = t('common.back');
            backBtn.className = 'doc-back';
            backBtn.addEventListener('click', () => {
                _close();
            });
            panel.appendChild(backBtn);

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
