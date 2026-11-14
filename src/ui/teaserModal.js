'use strict';

// 「请下载完整版」弹窗（尝鲜版）
//
// 用途：尝鲜版保留了一些完整版功能的入口（百科 / 扫描 / 编辑器 等），
//       点击这些入口时统一弹出本提示，并给出「查看完整版内容」的去处。
// 用法：showTeaser('encyclopedia')；也可经 eventBus 发 TEASER_REQUESTED { featureId }。
// 通信：注册到 uiManager（panelId: 'teaser'）；弹窗与「完整版内容」面板互斥。

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { t } from '../config/ui/strings.js';
import { TEASER_FEATURE_KEYS } from '../config/ui/fullVersionConfig.js';
import { openFullVersion } from './fullVersionUI.js';

const container = document.createElement('div');
container.id = 'teaserModal';
container.className = 'ui-dialog-overlay';
container.style.display = 'none';
container.innerHTML = `
    <div class="ui-dialog" style="width:min(420px, 88vw);">
        <h3 class="ui-dialog-title" id="teaserTitle"></h3>
        <p class="ui-dialog-body" id="teaserBody"></p>
        <div class="ui-dialog-actions" style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="teaserMoreBtn" class="ui-btn" style="padding:6px 14px;">${t('teaser.openFullVersion')}</button>
            <button id="teaserCloseBtn" class="ui-btn-primary" style="padding:6px 14px;">${t('teaser.close')}</button>
        </div>
    </div>
`;
document.body.appendChild(container);

const titleEl = container.querySelector('#teaserTitle');
const bodyEl = container.querySelector('#teaserBody');

// 功能名：配置里有映射就用映射，未知 featureId 兜底到通用标题
function _titleFor(featureId) {
    const key = TEASER_FEATURE_KEYS[featureId];
    if (key) {
        const text = t(key);
        if (text !== key) return text;
    }
    return t('teaser.title');
}

function showTeaser(featureId) {
    titleEl.textContent = _titleFor(featureId);
    bodyEl.textContent = t('teaser.body');
    uiManager.showPanel('teaser');
}

container.querySelector('#teaserMoreBtn').addEventListener('click', () => {
    uiManager.hidePanel('teaser');
    openFullVersion();
});

container.querySelector('#teaserCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('teaser');
});

// 点击遮罩关闭（与 uiComponents 的对话框一致）
container.addEventListener('click', (e) => {
    if (e.target === container) {
        uiManager.hidePanel('teaser');
    }
});

uiManager.registerPanel('teaser', {
    show: () => {
        container.style.display = 'flex';
    },
    hide: () => {
        container.style.display = 'none';
    },
    render: () => {}
});

// 唯一事件入口：任何模块（含飞行 HUD / 追踪站 / ESC 菜单）都可发 TEASER_REQUESTED
eventBus.on(Events.TEASER_REQUESTED, ({ featureId } = {}) => {
    showTeaser(featureId || 'unknown');
});

export { showTeaser };

if (typeof window !== 'undefined') {
    window.showTeaser = showTeaser;
}
