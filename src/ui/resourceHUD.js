'use strict';

// 玩家资源 HUD（0.2.0 阶段4）
// 右上角常驻显示：游戏模式 + 材料套装 + 科技点
// 数据源：GameState.player（GAME_STATE_CHANGED 事件驱动刷新，无事件时低频兜底轮询）

import { gameState } from '../gameState.js';
import { eventBus, Events } from '../eventBus.js';
import { getResourceType } from '../resources/resourceTypes.js';
import { t } from '../config/strings.js';

// 需要显示的玩家全局资源（0.2.0 阶段5：全局仅科技点；实体资源见设施货物/飞船货仓）
const DISPLAY_RESOURCES = ['science'];

// 游戏模式 → 显示文本（数据驱动收敛：文案入库 strings.js）
const MODE_TEXT = {
    sandbox: t('common.modeSandbox'),
    career: t('common.modeCareer')
};

// 兜底轮询间隔（ms）— 补偿直接改 _state 不发事件的调试操作
const POLL_INTERVAL = 1000;

const hudEl = document.createElement('div');
hudEl.id = 'playerResourceHud';
document.body.appendChild(hudEl);

function renderHud() {
    const player = gameState.getState().player;
    const mode = player.gameMode || 'sandbox';
    const modeText = MODE_TEXT[mode] || mode;

    let html = `<span class="prh-mode prh-mode-${mode}">${modeText}</span>`;
    for (const resId of DISPLAY_RESOURCES) {
        const def = getResourceType(resId);
        const amount = player.resources && player.resources[resId]
            ? player.resources[resId].amount
            : 0;
        html += `<span class="prh-item">${def ? def.name : resId} <b class="prh-value">${Math.floor(amount)}</b> ${def ? def.unit : ''}</span>`;
    }
    hudEl.innerHTML = html;
}

// 事件驱动刷新
eventBus.on(Events.GAME_STATE_CHANGED, (data) => {
    if (!data || !data.changedKeys || data.changedKeys.includes('player')) {
        renderHud();
    }
});

// 场景控制：主菜单/设置等界面隐藏，游戏内场景显示
eventBus.on(Events.SCENE_CHANGED, (data) => {
    const gameScenes = ['flight', 'tracking', 'galaxies'];
    hudEl.style.display = gameScenes.includes(data.to) ? 'flex' : 'none';
});
hudEl.style.display = 'none';

// 兜底轮询（低频）
setInterval(renderHud, POLL_INTERVAL);

// 挂载到 window 供调试
if (typeof window !== 'undefined') {
    window.__playerResourceHud = { refresh: renderHud };
}
