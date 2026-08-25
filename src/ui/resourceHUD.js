'use strict';

// 玩家 HUD（0.2.0 阶段4；0.2.7 调整）
// 左上角常驻显示：游戏模式 + 当前载具名（原科技点显示已替换为载具名）
// 数据源：GameState.player（模式）+ __shipSystem 活动飞船（载具名）；事件驱动 + 低频兜底轮询

import { gameState } from '../gameState.js';
import { eventBus, Events } from '../eventBus.js';
import { uiManager } from './uiManager.js';
import { t } from '../config/strings.js';

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

// 当前载具名（活动飞船；无则空）
function _getActiveShipName() {
    const ship = window.__shipSystem?.getActiveShip?.();
    return ship ? (ship.displayName || ship.id) : '';
}

let _lastShipName = null;

function renderHud() {
    const player = gameState.getState().player;
    const mode = player.gameMode || 'sandbox';
    const modeText = MODE_TEXT[mode] || mode;
    const shipName = _getActiveShipName();

    // 载具名变化才重写 DOM（避免每帧/每次轮询无谓刷新）
    if (shipName === _lastShipName) {
        return;
    }
    _lastShipName = shipName;

    let html = `<button class="prh-mode prh-mode-${mode}" title="${t('common.settings')}">${modeText}</button>`;
    if (shipName) {
        html += `<span class="prh-ship-name" title="${shipName}">${shipName}</span>`;
    }
    hudEl.innerHTML = html;
}

// 模式按钮 → 切换 ESC 菜单（经 uiManager 显隐，自动触发 UI_PANEL_OPENED/CLOSED 音频）
hudEl.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('.prh-mode');
    if (!modeBtn) return;
    if (uiManager.isPanelVisible('esc')) {
        uiManager.hidePanel('esc');
    } else {
        uiManager.showPanel('esc');
    }
});

// 事件驱动刷新（模式/载具相关状态变化时；载具名延迟由轮询兜底）
eventBus.on(Events.GAME_STATE_CHANGED, (data) => {
    if (!data || !data.changedKeys || data.changedKeys.includes('player')) {
        renderHud();
    }
});

// 场景控制：游戏内场景显示，主菜单/设置等隐藏；进入飞行时刷新载具名
eventBus.on(Events.SCENE_CHANGED, (data) => {
    const gameScenes = ['flight', 'tracking', 'galaxies'];
    hudEl.style.display = gameScenes.includes(data.to) ? 'flex' : 'none';
    _lastShipName = null;
    renderHud();
});
hudEl.style.display = 'none';

// 兜底轮询（低频）
setInterval(renderHud, POLL_INTERVAL);

// 挂载到 window 供调试
if (typeof window !== 'undefined') {
    window.__playerResourceHud = { refresh: renderHud };
}
