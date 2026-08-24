'use strict';

import { sceneManager } from '../sceneManager.js';
import { LICENSE } from '../config/licenseConfig.js';
import { t } from '../config/strings.js';

// 版权声明（0.2.7 v2 参考 KSP 原版：顶部 // 标题 + 装饰线 + 半透明背景 + 左对齐正文流 + 底部 BACK）
// 无卡片设计；视觉走 scenes.css（#licensePanel / .doc-* 共用类）
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

            // ========== 正文滚动区 ==========
            const body = document.createElement('div');
            body.className = 'doc-body';

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'doc-content';

            _renderContent(contentWrapper);

            body.appendChild(contentWrapper);
            panel.appendChild(body);

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
