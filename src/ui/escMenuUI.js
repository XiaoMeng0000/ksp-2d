'use strict';

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { createDialog, createConfirmDialog, renderIconHtml } from './uiComponents.js';  
import { sceneManager } from '../sceneManager.js';
import { saveManager } from '../saveManager.js';
import { gameState } from '../gameState.js';
import { toggleDebugPanel, refreshDebugPanel } from './debugUI.js';
import { t } from '../config/strings.js';
import { ESC_ACTIONS, ESC_SECTIONS } from '../config/escMenuConfig.js';
import { VERSION_TEXT } from '../config/version.js';
import { formatUniverseTime } from '../utils/format.js';

// ============================================================
// ESC 菜单 — 0.2.5 大型重构，独立配色组件（KSP2 终端控制台风格）
// 布局/配色见 src/ui/styles/esc_menu.css（--esc-* 独立变量）
// 行配置数据驱动（escMenuConfig.js），本模块只负责渲染与事件分发
// 面板 DOM 一次性创建常驻 body，每次 show 按当前场景/世界状态全量重渲染
// 场景自适应：tracking 场景下设施组的"追踪站"行替换为"回到飞行器"
// ============================================================

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据
// （thrust 模式下阻止进追踪站/退出；回飞行器的 noShip 检测）
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

// 缓存宇宙时间（元信息展示；与 saveManager._cachedTime 同源事件）
let _universeTime = 0;
eventBus.on(Events.CELESTIAL_TIME_UPDATED, ({ time }) => {
    _universeTime = time;
});

// ---- 面板 DOM（一次性创建，常驻 body） ----
const container = document.createElement('div');
container.id = 'escMenu';
container.style.display = 'none';
document.body.appendChild(container);

// ---- 元信息读取 ----

// 游戏模式（'sandbox' 自由 | 'career' 生涯）
function getGameModeText() {
    return gameState.getState().player.gameMode === 'career'
        ? t('common.modeCareer')
        : t('common.modeSandbox');
}

// ---- 数据驱动渲染 ----

// 虚线分隔条（例图标志性元素：标题下/元信息下/footer 上方）
function _renderDash() {
    return '<div class="esc-dash"></div>';
}

// 一行元信息（左 label + 中间 ···· + 右 value）
function _renderMetaRow(labelKey) {
    return `<div class="esc-meta-row flightdata">
        <span class="esc-meta-label">${t(labelKey)}</span>
        <span class="esc-meta-dots">${'.'.repeat(40)}</span>
        <span class="esc-meta-value flightdata"></span>
    </div>`;
}

// 行号格式化：10 以内补零（00 01 02 ...），三位以上保持原样
function _padLine(n) {
    return String(n).padStart(2, '0');
}

// 单行 HTML（行号按渲染顺序自动生成，0 起）
// - labelKey2 存在时拆双色标签：动作词（继承行 tone）+ 名词（白色）
// - plain 行（footer）不渲染 .esc-icon span
function _renderRow(item, lineNum, scene) {
    // 场景自适应：tracking 场景下设施组的 tracking 行替换为"回到飞行器"
    let labelKey = item.labelKey;
    let icon = item.icon;
    let iconKey = item.iconKey;    // 新增
    let action = item.action;
    if (item.id === 'tracking' && scene === 'tracking') {
        labelKey = 'esc.backToFlight';
        icon = '🚀';
        iconKey = 'icon_back_to_ship';
        action = 'esc-back-to-flight';
    }
    const disabledCls = item.disabled ? ' esc-row-disabled' : '';
    
    // 图标渲染：优先使用 iconKey（调用 renderIconHtml），否则直接显示 icon 字符串
    let iconHtml = '';
    if (item.tone !== 'plain') {   // plain 行不渲染图标
        if (iconKey) {
            // 尺寸可根据设计调整，这里用 24px
            iconHtml = renderIconHtml(iconKey, icon, 24);
        } else if (icon) {
            iconHtml = `<span class="esc-icon">${icon}</span>`;
        }
    }
    
    const label2Html = item.labelKey2 ? `<span class="esc-label-2">${t(item.labelKey2)}</span>` : '';
    return `<div class="esc-row esc-row-tone-${item.tone}${disabledCls}" data-action="${action}">
        <span class="esc-line-num">${_padLine(lineNum)}</span>
        ${iconHtml}
        <span class="esc-label">${t(labelKey)}${label2Html}</span>
    </div>`;
}

// 空行占位（保留行号，固定高度拉开分组距离）
function _renderEmptyRow(lineNum) {
    return `<div class="esc-row-empty">
        <span class="esc-line-num">${_padLine(lineNum)}</span>
    </div>`;
}

// 分组标题行（本身占一个行号，例图 ## VEHICLE 前有行号 4）
function _renderGroupTitle(title, lineNum) {
    return `<div class="esc-row esc-group-title">
        <span class="esc-line-num">${_padLine(lineNum)}</span>
        <span class="esc-group-title-text">## ${title}</span>
    </div>`;
}

// 全量渲染（show 时调用：世界名/宇宙时间/游戏模式随开随取）
function renderMenu() {
    const scene = sceneManager.getCurrentScene();

    // ---- 计算容器最大行数 ----
    const containerHeight = container.clientHeight;
    const style = getComputedStyle(container);
    const lineHeight = parseFloat(style.getPropertyValue('--esc-line-height')) || 28;
    const maxRows = Math.max(Math.floor(containerHeight / lineHeight), 1);

    let rowsHtml = '';
    let footerItems = [];        // 存放底部控件（section === 'footer'）
    let lineNum = 0;
    let lastSection = null;

    // ---- 第一次遍历：处理除 footer 组以外的所有行 ----
    for (const item of ESC_ACTIONS) {
        if (item.section === 'footer') {
            footerItems.push(item);   // 暂存，不立即渲染
            continue;
        }

        // 跨分组处理（非 footer 组之间的切换）
        if (item.section !== lastSection) {
            // 上一组尾随空行
            const prevSection = lastSection ? ESC_SECTIONS[lastSection] : null;
            if (prevSection && prevSection.emptyRowsAfter > 0) {
                for (let i = 0; i < prevSection.emptyRowsAfter; i++) {
                    rowsHtml += _renderEmptyRow(lineNum);
                    lineNum++;
                }
            }
            // 当前分组标题
            const section = ESC_SECTIONS[item.section];
            if (section && section.titleKey) {
                rowsHtml += _renderGroupTitle(t(section.titleKey), lineNum);
                lineNum++;
            }
            lastSection = item.section;
        }

        rowsHtml += _renderRow(item, lineNum, scene);
        lineNum++;
    }

    // 处理最后一个非 footer 组的尾随空行
    if (lastSection && ESC_SECTIONS[lastSection] && ESC_SECTIONS[lastSection].emptyRowsAfter > 0) {
        for (let i = 0; i < ESC_SECTIONS[lastSection].emptyRowsAfter; i++) {
            rowsHtml += _renderEmptyRow(lineNum);
            lineNum++;
        }
    }

    // ---- 填充空行至底部（留出底部控件 + 版本行） ----
    const footerCount = footerItems.length;
    const remaining = maxRows - lineNum - footerCount - 1;   // 减 1 给版本行
    if (remaining > 0) {
        for (let i = 0; i < remaining; i++) {
            rowsHtml += _renderEmptyRow(lineNum);
            lineNum++;
        }
    } else if (remaining < 0) {
        console.warn('[ESC] 菜单内容行数超过容器容量，可能溢出');
    }

    // ---- 渲染底部控件（设置、返回菜单等） ----
    for (const item of footerItems) {
        rowsHtml += _renderRow(item, lineNum, scene);
        lineNum++;
    }

    // ---- 版本行（固定在最后） ----
    const versionHtml = `
        <div class="esc-version">
            <span class="esc-line-num">${_padLine(lineNum)}</span>
            <span>${VERSION_TEXT}</span>
        </div>
    `;

    // ---- 组装完整面板 ----
    container.innerHTML = `
        <div class="esc-header">
            <span class="esc-agency"></span>
            <span class="esc-agency-logo"></span>
        </div>
        ${_renderDash()}
        <div class="esc-meta">
            ${_renderMetaRow('esc.universeTime')}
            ${_renderMetaRow('esc.gameMode')}
        </div>
        ${_renderDash()}
        ${rowsHtml}
        ${versionHtml}
    `;

    // 动态文本填充（防 XSS）
    container.querySelector('.esc-agency').textContent = t('esc.agencyTitle');
    const metaValues = container.querySelectorAll('.esc-meta-value');
    metaValues[0].textContent = formatUniverseTime(_universeTime);
    metaValues[1].textContent = getGameModeText();
}

// ---- 事件分发（委托：整面板一个 click 监听） ----

container.addEventListener('click', (e) => {
    const row = e.target.closest('.esc-row');
    if (!row) return;
    // 占位行：仅提示，不执行
    if (row.classList.contains('esc-row-disabled')) {
        window.showNotification(t('esc.notReady'), 'info');
        return;
    }
    handleAction(row.dataset.action);
});

function handleAction(action) {
    switch (action) {
        case 'esc-resume': hideEscMenu(); break;
        case 'esc-save': saveGame(); break;
        case 'esc-load': loadGame(); break;
        case 'esc-tracking': openTrackingStation(); break;
        case 'esc-back-to-flight': backToFlight(); break;
        case 'esc-settings': window.openSettings(); break;
        case 'esc-quit': quitToMenu(); break;
        // 未知 action（含未来取消 disabled 的 encyclopedia/missions 占位）：提示而非静默
        default:
            window.showNotification(t('esc.notReady'), 'info');
    }
}

// ---- 面板显隐 ----

function toggleEscMenu() {
    if (uiManager.isPanelVisible('esc')) {
        uiManager.hidePanel('esc');
    } else {
        uiManager.showPanel('esc');
    }
}

function hideEscMenu() {
    uiManager.hidePanel('esc');
}

// 注册到 uiManager（与其他面板统一显隐管理；settingsUI 打开时会互斥关闭本面板）
uiManager.registerPanel('esc', {
    element: container,
    show: () => {
        // 先显示再渲染：_fillRemainingRows 需要测量 clientHeight
        container.style.display = 'flex';
        renderMenu();
    },
    hide: () => {
        container.style.display = 'none';
    },
    render: () => { }
});

// ---- 窗口 resize 动态更新行数 ----
let resizeTimer = null;
function onWindowResize() {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
        resizeTimer = null;
        // 仅当 ESC 菜单可见时重新渲染
        if (uiManager.isPanelVisible('esc')) {
            renderMenu();
        }
    }, 100);
}
window.addEventListener('resize', onWindowResize);

// ---- 全局按键（ESC 切换菜单 / 菜单打开时屏蔽其他快捷键 / F1 调试面板） ----

window.addEventListener('keydown', (e) => {
    const escVisible = uiManager.isPanelVisible('esc');
    const settingsVisible = uiManager.isPanelVisible('settings');
    const currentScene = sceneManager.getCurrentScene();
    // ESC 键切换菜单（仅飞行/追踪站场景处理并拦截默认行为，其他场景不干扰）
    if (e.key === 'Escape') {
        if (currentScene === 'flight' || currentScene === 'tracking') {
            e.preventDefault();
            toggleEscMenu();
        }
        return;
    }
    // ESC 菜单或设置面板打开时阻止其他快捷键（F1 调试面板等）
    if (escVisible || settingsVisible) {
        return;
    }
    // 控制锁定时忽略快捷键（F1）
    if (_cachedShipData && _cachedShipData.controlsLocked) {
        return;
    }
    // F1 调试面板
    if (e.key === 'F1') {
        e.preventDefault();
        toggleDebugPanel();
    }
});

// ---- 动作实现（自 menuUI.js 迁移） ----

// 打开追踪站（推力模式下阻止，防止轨道状态与渲染不一致）
function openTrackingStation() {
    if (_cachedShipData && _cachedShipData.mode === 'thrust') {
        window.showNotification(t('esc.blockedThrustTracking'), 'warning');
        return;
    }
    hideEscMenu();
    sceneManager.switchTo('tracking');
}

// 回到飞行器（无飞船时阻止）
function backToFlight() {
    if (!_cachedShipData || !_cachedShipData.exists) {
        window.showNotification(t('esc.noShip'), 'warning');
        return;
    }
    hideEscMenu();
    sceneManager.switchTo('flight');
}

// 存档（在当前世界创建检查点）
function saveGame() {
    try {
        const worldId = window.currentWorldId;
        if (!worldId) {
            window.showNotification(t('common.noWorld'), 'info');
            return;
        }
        const world = saveManager.getWorld(worldId);
        const checkpointName = t('common.checkpointName', { n: world.checkpoints.length + 1 });
        const id = saveManager.saveCheckpoint(worldId, checkpointName);
        if (id) window.showNotification(t('archive.saved'), 'success');
        else window.showNotification(t('archive.saveFailed'), 'error');
    } catch (e) {
        console.error('[Save] 存档异常:', e);
        window.showNotification(t('archive.saveError'), 'error');
    }
}

// 读档（显示当前世界的检查点列表）
function loadGame() {
    const worldId = window.currentWorldId;
    if (!worldId) {
        window.showNotification(t('common.noWorld'), 'info');
        return;
    }
    const list = saveManager.getCheckpointList(worldId);
    if (list.length === 0) {
        window.showNotification(t('archive.noCheckpoints'), 'info');
        return;
    }
    const items = list.map(c => ({
        id: c.id,
        name: c.name,
        subtitle: t('archive.checkpointSubtitle', { ts: c.timestamp, time: c.gameTime.toFixed(1) })
    }));
    createDialog(t('archive.selectCheckpoint'), items, (selectedId) => {
        const success = saveManager.loadCheckpoint(worldId, selectedId);
        if (success) {
            window.showNotification(t('archive.loaded'), 'success');
            hideEscMenu();
            if (sceneManager.getCurrentScene() === 'menu') {
                sceneManager.switchTo('flight');
            }
            refreshDebugPanel();
        } else {
            window.showNotification(t('archive.loadFailed'), 'error');
        }
    });
}

// 退出到主菜单（推力模式阻止 + 保存确认）
function quitToMenu() {
    // 1. 检查是否在推力模式
    if (_cachedShipData && _cachedShipData.mode === 'thrust') {
        window.showNotification(t('esc.blockedThrustQuit'), 'warning');
        return;
    }

    // 2. 弹出确认对话框
    createConfirmDialog(
        t('esc.quitTitle'),
        t('esc.quitMessage'),
        () => {
            // 用户选择「保存并退出」
            const worldId = window.currentWorldId;
            if (worldId) {
                const world = saveManager.getWorld(worldId);
                const checkpointName = t('common.checkpointName', { n: world.checkpoints.length + 1 });
                saveManager.saveCheckpoint(worldId, checkpointName);
                window.showNotification(t('archive.savedCheckpoint'), 'success');
            }
            hideEscMenu();
            sceneManager.switchTo('menu');
        },
        () => {
            // 用户选择「退出」（不保存）
            hideEscMenu();
            sceneManager.switchTo('menu');
        },
        t('esc.saveAndQuit'),  // 确认按钮文字
        t('esc.quitDirect')    // 取消按钮文字
    );
}
