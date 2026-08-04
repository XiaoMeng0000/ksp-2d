'use strict';

import { sceneManager } from '../sceneManager.js';

function registerInfoScene() {
    let panel = null;
    let escHandler = null;

    function _closeInfo() {
        sceneManager.switchTo('menu');
    }

    sceneManager.registerScene('info', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'infoScenePanel';
            panel.style.cssText = ''
                + 'position:fixed;inset:0;z-index:2000;'
                + 'background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);'
                + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
                + 'font-family:monospace;';

            const textContainer = document.createElement('div');
            textContainer.style.cssText = 'max-width:70%;text-align:left;';

            const h1 = document.createElement('h1');
            h1.textContent = '公测公告';
            h1.style.cssText = 'color:#A04040;font-size:28px;margin:0 0 30px 0;text-align:center;';

            const p = document.createElement('p');
            p.style.cssText = 'color:#ccc;font-size:15px;line-height:2.0;white-space:pre-line;';
            p.textContent = '尊敬的玩家：\n\n感谢您参与 KSP 2D:轨道工程师 v0.2.3 首次公开测试！\n\n这是一个正在开发中的早期版本，部分功能可能尚不完整。\n\n如果您在游戏过程中遇到任何问题，欢迎通过开发群提交反馈。\n\n祝您游戏愉快！\n\n—— 【逃逸速度】';

            textContainer.appendChild(h1);
            textContainer.appendChild(p);

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '关闭';
            closeBtn.style.cssText = ''
                + 'position:absolute;bottom:40px;right:40px;'
                + 'padding:12px 40px;'
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
                _closeInfo();
            });

            panel.appendChild(textContainer);
            panel.appendChild(closeBtn);
            document.body.appendChild(panel);

            escHandler = (event) => {
                if (event.key === 'Escape') {
                    _closeInfo();
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

export { registerInfoScene };
