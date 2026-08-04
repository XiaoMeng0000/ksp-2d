'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { CREDITS } from '../config/creditsConfig.js';

function registerCreditsScene() {
    let panel = null;
    let escHandler = null;

    function _close() {
        sceneManager.switchTo('menu');
    }

    function _renderIcon(member, container) {
        const iconWrapper = document.createElement('div');
        iconWrapper.style.cssText = ''
            + 'display:inline-block;width:28px;height:28px;'
            + 'border-radius:50%;margin-right:6px;'
            + 'vertical-align:middle;overflow:hidden;';

        if (member.icon) {
            // TODO: 加载纹理图片，这里先尝试从 textureManager 获取
            const img = textureManager.get(member.icon);
            if (img) {
                const imgEl = document.createElement('img');
                imgEl.src = img.src;
                imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                iconWrapper.appendChild(imgEl);
                container.appendChild(iconWrapper);
                return;
            }
        }

        // 占位：灰色圆形 + 白色问号
        iconWrapper.style.cssText += ''
            + 'background:#333;'
            + 'display:inline-flex;align-items:center;justify-content:center;';
        const placeholder = document.createElement('span');
        placeholder.textContent = '?';
        placeholder.style.cssText = 'color:#888;font-size:14px;font-family:monospace;';
        iconWrapper.appendChild(placeholder);
        container.appendChild(iconWrapper);
    }

    function _renderContent(contentEl) {
        contentEl.innerHTML = '';

        for (const section of CREDITS.sections) {
            // 节标题 + 牵头人（同行，同色）
            const sectionTitle = document.createElement('h2');
            let titleText = '// ' + section.title;
            if (section.lead) {
                titleText += ' ----- ' + section.lead;
            }
            sectionTitle.textContent = titleText;
            sectionTitle.style.cssText = 'color:#A04040;font-family:monospace;font-size:20px;margin:0 0 20px 0;';
            contentEl.appendChild(sectionTitle);

            // 分组
            if (section.groups) {
                for (const group of section.groups) {
                    const groupName = document.createElement('div');
                    groupName.textContent = group.name;
                    groupName.style.cssText = 'color:#ccc;font-family:monospace;font-size:14px;margin-bottom:12px;';
                    contentEl.appendChild(groupName);

                    for (const row of group.rows) {
                        const rowEl = document.createElement('div');
                        rowEl.style.cssText = 'margin-bottom:10px;padding-left:20px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;';

                        const roleLabel = document.createElement('span');
                        roleLabel.textContent = row.role + ' ---';
                        roleLabel.style.cssText = 'color:#666;font-family:monospace;font-size:13px;';

                        rowEl.appendChild(roleLabel);

                        for (const member of row.members) {
                            const nameSpan = document.createElement('span');
                            nameSpan.textContent = member.name;
                            nameSpan.style.cssText = 'color:white;font-family:monospace;font-size:13px;margin-right:12px;';
                            rowEl.appendChild(nameSpan);
                        }

                        contentEl.appendChild(rowEl);
                    }
                }
            }

            // 灵感来源 — 同行 lead + 对齐子项
            if (section.subItems) {
                for (const subItem of section.subItems) {
                    const subEl = document.createElement('div');
                    subEl.textContent = subItem;
                    subEl.style.cssText = 'color:#A04040;font-family:monospace;font-size:20px;margin-bottom:8px;padding-left:200px;';
                    contentEl.appendChild(subEl);
                }
            }

            // 节间距
            const spacer = document.createElement('div');
            spacer.style.cssText = 'height:30px;';
            contentEl.appendChild(spacer);
        }
    }

    sceneManager.registerScene('credits', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'creditsPanel';
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

export { registerCreditsScene };
