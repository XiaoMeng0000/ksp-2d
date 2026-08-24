'use strict';

import { uiManager } from './uiManager.js';
import { sceneManager } from '../sceneManager.js';
import { saveManager } from '../saveManager.js';
import { gameState } from '../gameState.js';
import { t } from '../config/strings.js';
import { formatGameTime, formatGameDate } from '../utils/format.js';
import { openNewCampaignDialog } from './newCampaignDialog.js';

// 开始游戏面板 — 0.2.5 新增
// 主菜单"开始游戏"打开的内嵌式综合面板（0.2.6 由左侧滑出改为内嵌圆角，与设置页同款），
// 整合原 game 子菜单的所有功能：
//   - 左列「战役」：世界列表 + 创建新战役 / 删除战役
//   - 右列「游戏」：选中世界的存档（检查点）列表 + 加载 / 删除
// 复用了 saveManager 的世界/检查点查询与增删接口，不重复实现存档逻辑。

// 面板 DOM（一次性创建，显示/隐藏切换；元素常驻 body，避免场景进出重复构建）
const panel = document.createElement('div');
panel.id = 'startGamePanel';
panel.className = 'start-game-panel';
panel.style.display = 'none';
panel.innerHTML = `
    <div class="sgp-header">
        <span class="sgp-title">${t('startgame.title')}</span>
        <button class="sgp-close" data-action="sgp-close">${t('startgame.close')}</button>
    </div>
    <div class="sgp-body">
        <div class="sgp-col sgp-col-worlds">
            <div class="sgp-col-title">
                <span>${t('startgame.worlds')}</span>
                <span class="sgp-count" id="sgpWorldCount"></span>
            </div>
            <button class="sgp-new-campaign" data-action="sgp-new-campaign">${t('startgame.newCampaign')}</button>
            <div class="sgp-list" id="sgpWorldList"></div>
            <div class="sgp-col-footer">
                <button class="ui-btn-danger" data-action="sgp-delete-world" disabled>${t('startgame.deleteWorld')}</button>
            </div>
        </div>
        <div class="sgp-col sgp-col-games">
            <div class="sgp-col-title">
                <span>${t('startgame.games')}</span>
                <span class="sgp-count" id="sgpCpCount"></span>
            </div>
            <div class="sgp-meta-card" id="sgpCpMeta" style="display:none;"></div>
            <div class="sgp-list" id="sgpCpList"></div>
            <div class="sgp-col-footer sgp-actions">
                <button class="ui-btn" data-action="sgp-load-game">${t('startgame.loadGame')}</button>
                <button class="ui-btn-danger" data-action="sgp-delete-checkpoint">${t('startgame.deleteGame')}</button>
            </div>
        </div>
    </div>
`;
document.body.appendChild(panel);

// 面板内部状态
let _selectedWorldId = null;
let _selectedCheckpointId = null;

// 渲染世界列表（左列）
function renderWorldList() {
    const listEl = document.getElementById('sgpWorldList');
    const countEl = document.getElementById('sgpWorldCount');
    const worlds = saveManager.getWorldList();

    countEl.textContent = t('startgame.worldCount', { n: worlds.length });

    listEl.innerHTML = '';
    if (worlds.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sgp-empty';
        empty.textContent = t('startgame.noWorlds');
        listEl.appendChild(empty);
        _selectedWorldId = null;
        return;
    }

    for (const w of worlds) {
        const row = document.createElement('div');
        row.className = 'sgp-world-row' + (w.id === _selectedWorldId ? ' sgp-selected' : '');
        row.dataset.worldId = w.id;

        const nameEl = document.createElement('div');
        nameEl.className = 'sgp-world-name';
        nameEl.textContent = w.name;

        const subEl = document.createElement('div');
        subEl.className = 'sgp-world-sub';
        subEl.textContent = t('startgame.worldItem', { name: new Date(w.createdAt).toLocaleString(), count: w.checkpointCount });

        row.appendChild(nameEl);
        row.appendChild(subEl);
        listEl.appendChild(row);
    }

    // 无选中或选中被删除时，默认选中第一个世界
    if (!worlds.some(w => w.id === _selectedWorldId)) {
        _selectedWorldId = worlds[0].id;
    }
}

// 渲染选中世界的存档列表（右列）
function renderCheckpointList() {
    const listEl = document.getElementById('sgpCpList');
    const countEl = document.getElementById('sgpCpCount');
    const checkpoints = _selectedWorldId ? saveManager.getCheckpointList(_selectedWorldId) : [];

    countEl.textContent = checkpoints.length > 0 ? t('startgame.gameCount', { n: checkpoints.length }) : '';

    listEl.innerHTML = '';
    if (!_selectedWorldId) {
        const empty = document.createElement('div');
        empty.className = 'sgp-empty';
        empty.textContent = t('startgame.selectWorldHint');
        listEl.appendChild(empty);
        return;
    }
    if (checkpoints.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sgp-empty';
        empty.textContent = t('startgame.noCheckpoints');
        listEl.appendChild(empty);
        _selectedCheckpointId = null;
        return;
    }

    for (const cp of checkpoints) {
        const row = document.createElement('div');
        row.className = 'sgp-cp-row' + (cp.id === _selectedCheckpointId ? ' sgp-selected' : '');
        row.dataset.cpId = cp.id;

        const nameEl = document.createElement('div');
        nameEl.className = 'sgp-cp-name';
        nameEl.textContent = cp.name;

        const subEl = document.createElement('div');
        subEl.className = 'sgp-cp-sub';
        subEl.textContent = t('archive.checkpointSubtitleCn', { ts: cp.timestamp, time: cp.gameTime.toFixed(1) });

        row.appendChild(nameEl);
        row.appendChild(subEl);
        listEl.appendChild(row);
    }

    // 无选中或选中被删除时，默认选中第一个存档
    if (!checkpoints.some(c => c.id === _selectedCheckpointId)) {
        _selectedCheckpointId = checkpoints[0].id;
    }
}

// 渲染选中存档的元信息块（右列顶部，数据驱动：名称/最近游玩/游戏时间/游戏模式）
// 用 DOM API 构建（避免 innerHTML 拼接玩家自定义名称的 XSS 隐患）
function renderCheckpointMeta() {
    const metaEl = document.getElementById('sgpCpMeta');
    const checkpoints = _selectedWorldId ? saveManager.getCheckpointList(_selectedWorldId) : [];
    const cp = _selectedCheckpointId ? checkpoints.find(c => c.id === _selectedCheckpointId) : null;

    if (!cp) {
        metaEl.style.display = 'none';
        return;
    }

    // 游戏模式：从 GameState 读取（加载存档后即该世界的模式）
    const mode = gameState.getState().player.gameMode === 'career'
        ? t('common.modeCareer')
        : t('common.modeSandbox');

    metaEl.innerHTML = '';

    const nameEl = document.createElement('div');
    nameEl.className = 'sgp-meta-name';
    nameEl.textContent = cp.name;
    metaEl.appendChild(nameEl);

    const rows = [
        { label: t('startgame.metaLastPlayed'), value: formatGameDate(cp.timestamp) },
        { label: t('startgame.metaGameTime'),   value: formatGameTime(cp.gameTime) },
        { label: t('startgame.metaGameMode'),   value: mode }
    ];
    for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'sgp-meta-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'sgp-meta-label';
        labelEl.textContent = row.label;
        const valueEl = document.createElement('span');
        valueEl.className = 'sgp-meta-value';
        valueEl.textContent = row.value;
        item.appendChild(labelEl);
        item.appendChild(valueEl);
        metaEl.appendChild(item);
    }

    metaEl.style.display = 'block';
}

// 完整刷新（元信息块单独刷新，覆盖无世界/空存档等提前 return 的分支）
function renderAll() {
    renderWorldList();
    renderCheckpointList();
    renderCheckpointMeta();
    syncFooterButtons();
}

// 同步底部按钮可用态
function syncFooterButtons() {
    const delWorldBtn = panel.querySelector('[data-action="sgp-delete-world"]');
    const loadBtn = panel.querySelector('[data-action="sgp-load-game"]');
    const delCpBtn = panel.querySelector('[data-action="sgp-delete-checkpoint"]');
    const hasWorld = !!_selectedWorldId;
    const hasCp = !!_selectedCheckpointId;
    delWorldBtn.disabled = !hasWorld;
    loadBtn.disabled = !hasCp;
    delCpBtn.disabled = !hasCp;
}

// 加载选中的存档并进入飞行
function loadSelectedGame() {
    if (!_selectedWorldId || !_selectedCheckpointId) {
        window.showNotification(t('startgame.selectWorldHint'), 'warning');
        return;
    }
    window.currentWorldId = _selectedWorldId;
    saveManager.loadCheckpoint(_selectedWorldId, _selectedCheckpointId);
    closeStartGamePanel();
    sceneManager.switchTo('flight');
}

// 删除选中战役（二次确认）
function deleteSelectedWorld() {
    const worlds = saveManager.getWorldList();
    const world = worlds.find(w => w.id === _selectedWorldId);
    if (!world) return;
    window.__createConfirmDialog(
        t('archive.confirmDeleteTitle'),
        t('startgame.confirmDeleteWorld', { name: world.name }),
        () => {
            saveManager.deleteWorld(world.id);
            _selectedWorldId = null;
            _selectedCheckpointId = null;
            renderAll();
            window.showNotification(t('archive.worldDeleted'), 'success');
        },
        () => {},
        t('common.delete'),
        t('common.cancel')
    );
}

// 删除选中存档（二次确认）
function deleteSelectedCheckpoint() {
    const checkpoints = saveManager.getCheckpointList(_selectedWorldId);
    const cp = checkpoints.find(c => c.id === _selectedCheckpointId);
    if (!cp) return;
    window.__createConfirmDialog(
        t('archive.confirmDeleteTitle'),
        t('startgame.confirmDeleteCheckpoint', { name: cp.name }),
        () => {
            saveManager.deleteCheckpoint(_selectedWorldId, cp.id);
            _selectedCheckpointId = null;
            renderAll();
            window.showNotification(t('archive.checkpointDeleted'), 'success');
        },
        () => {},
        t('common.delete'),
        t('common.cancel')
    );
}

// 事件委托（面板内所有交互）
panel.addEventListener('click', (e) => {
    // 世界行选中：默认选中该战役的第一个存档
    const worldRow = e.target.closest('.sgp-world-row');
    if (worldRow && panel.contains(worldRow)) {
        _selectedWorldId = worldRow.dataset.worldId;
        const firstCps = saveManager.getCheckpointList(_selectedWorldId);
        _selectedCheckpointId = firstCps.length > 0 ? firstCps[0].id : null;
        renderAll();
        return;
    }
    // 存档行选中
    const cpRow = e.target.closest('.sgp-cp-row');
    if (cpRow && panel.contains(cpRow)) {
        _selectedCheckpointId = cpRow.dataset.cpId;
        renderAll();
        return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
        case 'sgp-close':
            closeStartGamePanel();
            break;
        case 'sgp-new-campaign':
            openNewCampaignDialog();
            break;
        case 'sgp-load-game':
            loadSelectedGame();
            break;
        case 'sgp-delete-world':
            deleteSelectedWorld();
            break;
        case 'sgp-delete-checkpoint':
            deleteSelectedCheckpoint();
            break;
    }
});

// 打开面板的内部实现（展示 + 全量刷新；默认选中左侧第一个战役的右侧第一个存档）
// 仅由 uiManager 的 show 回调调用，保证 UI_PANEL_OPENED 广播
function _showStartGamePanel() {
    panel.style.display = 'flex';
    const worlds = saveManager.getWorldList();
    _selectedWorldId = worlds.length > 0 ? worlds[0].id : null;
    const firstCps = _selectedWorldId ? saveManager.getCheckpointList(_selectedWorldId) : [];
    _selectedCheckpointId = firstCps.length > 0 ? firstCps[0].id : null;
    renderAll();
}

// 关闭面板的内部实现（仅由 uiManager 的 hide 回调调用，保证 UI_PANEL_CLOSED 广播）
function _hideStartGamePanel() {
    panel.style.display = 'none';
}

// 打开面板（对外入口：统一转发 uiManager，保证 UI_PANEL_OPENED 广播）
function openStartGamePanel() {
    uiManager.showPanel('startGamePanel');
}

// 关闭面板（对外入口：统一转发 uiManager，保证 UI_PANEL_CLOSED 广播）
function closeStartGamePanel() {
    uiManager.hidePanel('startGamePanel');
}

// 注册到 uiManager，与其他面板统一显隐管理
uiManager.registerPanel('startGamePanel', {
    element: panel,
    show: _showStartGamePanel,
    hide: _hideStartGamePanel,
    render: renderAll
});

// 供 menuScene / main.js 等模块调用（等价于 window 桥，与 openSettings 风格一致）
export { openStartGamePanel, closeStartGamePanel };
