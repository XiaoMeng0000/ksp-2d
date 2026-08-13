'use strict';

import { sceneManager } from '../sceneManager.js';
import { t } from '../config/strings.js';

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
            panel.className = 'scene-fullscreen';

            const textContainer = document.createElement('div');
            textContainer.className = 'info-text-container';

            const h1 = document.createElement('h1');
            h1.textContent = t('info.title');
            h1.className = 'info-title';

            const p = document.createElement('p');
            p.className = 'info-body';
            p.textContent = t('info.body');

            textContainer.appendChild(h1);
            textContainer.appendChild(p);

            const closeBtn = document.createElement('button');
            closeBtn.textContent = t('common.close');
            closeBtn.className = 'info-close-btn';
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
