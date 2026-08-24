'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { CREDITS } from '../config/creditsConfig.js';
import { t } from '../config/strings.js';

// 制作人员（0.2.7：顶部 // 标题 + 左右分割式布局；分割线仅限内容区，不覆盖装饰线/返回按钮区域）
// 视觉走 scenes.css（#creditsPanel / .doc-* 共用类）
function registerCreditsScene() {
    let panel = null;
    let escHandler = null;

    function _close() {
        sceneManager.switchTo('menu');
    }

    function _renderContent(contentEl) {
        contentEl.innerHTML = '';

        for (const section of CREDITS.sections) {
            // 0.2.7：纯标题节（无分组/子项，如"灵感来源"占位）跳过，只渲染实内容
            if (!section.groups && !section.subItems) {
                continue;
            }

            // 节标题（橙色）+ 副标（----- 牵头人，白）
            const sectionTitle = document.createElement('h2');
            sectionTitle.className = 'doc-section-title warn';

            if (section.lead) {
                const titleLabel = document.createElement('span');
                titleLabel.textContent = section.title;
                sectionTitle.appendChild(titleLabel);

                const leadLabel = document.createElement('span');
                leadLabel.textContent = '----- ' + section.lead;
                leadLabel.className = 'doc-section-lead';
                sectionTitle.appendChild(leadLabel);
            } else {
                sectionTitle.textContent = section.title;
            }
            contentEl.appendChild(sectionTitle);

            // 分组
            if (section.groups) {
                for (const group of section.groups) {
                    const groupName = document.createElement('div');
                    groupName.textContent = group.name;
                    groupName.className = 'doc-group-name';
                    contentEl.appendChild(groupName);

                    for (const row of group.rows) {
                        // 双列格网：角色右对齐 | 名字左对齐（参考图排版）
                        const rowEl = document.createElement('div');
                        rowEl.className = 'doc-credit-row';

                        const roleLabel = document.createElement('span');
                        roleLabel.textContent = row.role;
                        roleLabel.className = 'doc-credit-role';
                        rowEl.appendChild(roleLabel);

                        const namesEl = document.createElement('div');
                        namesEl.className = 'doc-credit-names';
                        for (const member of row.members) {
                            const nameSpan = document.createElement('span');
                            nameSpan.textContent = member.name;
                            nameSpan.className = 'doc-credit-name';
                            namesEl.appendChild(nameSpan);
                        }
                        rowEl.appendChild(namesEl);

                        contentEl.appendChild(rowEl);
                    }
                }
            }

            // 灵感来源子项（兼容旧 subItems 数据）
            if (section.subItems) {
                for (const subItem of section.subItems) {
                    const subEl = document.createElement('div');
                    subEl.textContent = subItem;
                    subEl.className = 'doc-subitem';
                    contentEl.appendChild(subEl);
                }
            }

            // 节间距
            const spacer = document.createElement('div');
            spacer.className = 'doc-spacer';
            contentEl.appendChild(spacer);
        }
    }

    sceneManager.registerScene('credits', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'creditsPanel';

            // ========== 顶部标题区 ==========
            const header = document.createElement('div');
            header.className = 'doc-header';

            const title = document.createElement('h1');
            title.textContent = '// ' + t('credits.pageTitle');
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

export { registerCreditsScene };
