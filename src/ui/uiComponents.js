'use strict';
// UI组件 - 通知和对话框组件

import { textureManager } from '../graphics/textureManager.js';
import { eventBus, Events } from '../eventBus.js';
import { t } from '../config/ui/strings.js';
import { getResourceType } from '../config/entities/resourceTypes.js';

export function createNotification(message, type = 'info', duration = 2000) {
    // 创建或获取通知容器
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        document.body.appendChild(container);
    }

    // 堆叠通知 - 创建独立通知元素（外观由 dialogs.css 统一定义，type 仅作语义标记）
    const div = document.createElement('div');
    div.className = 'ui-notification ui-notification-' + type;
    div.textContent = message;

    // 堆叠通知 - 插入到最顶部（视觉上的底部）
    if (container.firstChild) {
        container.insertBefore(div, container.firstChild);
    } else {
        container.appendChild(div);
    }

    // 堆叠通知 - 触发淡入动画
    requestAnimationFrame(() => {
        div.style.opacity = '1';
    });

    // 堆叠通知 - 定时器结束后淡出并移除
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => {
            if (div.parentNode) div.parentNode.removeChild(div);
        }, 300);
    }, duration);

    // 堆叠通知 - 限制通知数量，超过5个时移除最旧的
    while (container.children.length > 5) {
        container.removeChild(container.lastChild);
    }

    return div;
}

export function createDialog(title, items, onSelect, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-overlay';
    const panel = document.createElement('div');
    panel.className = 'ui-dialog';
    let html = `<h3 class="ui-dialog-title">${title}</h3>`;
    if (items.length === 0) {
        html += `<p style="color:var(--text-dim);">${t('common.empty')}</p>`;
    } else {
        html += `<div class="ui-list">`;
        items.forEach((item) => {
            const subtitle = item.subtitle || (item.timestamp ? new Date(item.timestamp).toLocaleString() : '');
            html += `
                <button data-id="${item.id}" class="ui-list-item">
                    <div class="ui-list-item-title">${item.name}</div>
                    ${subtitle ? `<div class="ui-list-item-sub">${subtitle}</div>` : ''}
                </button>
            `;
        });
        html += `</div>`;
    }
    html += `
        <div class="ui-dialog-actions" style="margin-top:12px;">
            <button id="dialogCancelBtn" class="ui-btn">${t('common.cancel')}</button>
        </div>
    `;
    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    eventBus.emit(Events.UI_PANEL_OPENED, { panelId: 'dialog' });

    // 统一关闭辅助：移除 overlay 并广播关闭事件（所有关闭路径共用）
    const closeDialog = () => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: 'dialog' });
    };

    panel.querySelectorAll('[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeDialog();
            onSelect(id);
        });
    });
    const cancelBtn = panel.querySelector('#dialogCancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            closeDialog();
            if (onCancel) onCancel();
        });
    }
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeDialog();
            if (onCancel) onCancel();
        }
    });
    return overlay;
}

// 输入对话框组件
export function createInputDialog(title, placeholder, defaultValue, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-overlay';
    const panel = document.createElement('div');
    panel.className = 'ui-dialog';
    panel.innerHTML = `
        <h3 class="ui-dialog-title">${title}</h3>
        <input type="text" id="dialogInput" class="ui-input" placeholder="${placeholder || ''}"
            value="${defaultValue || ''}">
        <div class="ui-dialog-actions">
            <button id="dialogCancelBtn" class="ui-btn">${t('common.cancel')}</button>
            <button id="dialogConfirmBtn" class="ui-btn">${t('common.confirm')}</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    eventBus.emit(Events.UI_PANEL_OPENED, { panelId: 'dialog' });

    const input = panel.querySelector('#dialogInput');
    const confirmBtn = panel.querySelector('#dialogConfirmBtn');
    const cancelBtn = panel.querySelector('#dialogCancelBtn');

    input.focus();
    input.select();

    const close = () => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: 'dialog' });
    };

    const handleConfirm = () => {
        const value = input.value.trim();
        if (value) {
            close();
            onConfirm(value);
        }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') {
            close();
            if (onCancel) onCancel();
        }
    });
    cancelBtn.addEventListener('click', () => {
        close();
        if (onCancel) onCancel();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            close();
            if (onCancel) onCancel();
        }
    });

    return overlay;
}

// 确认对话框组件
// 增加自定义按钮文字参数
export function createConfirmDialog(title, message, onConfirm, onCancel, confirmText = t('common.confirmDefault'), cancelText = t('common.cancel')) {
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-overlay';
    const panel = document.createElement('div');
    panel.className = 'ui-dialog';
    // 使用自定义按钮文字
    panel.innerHTML = `
        <h3 class="ui-dialog-title-danger">${title}</h3>
        <p class="ui-dialog-body">${message}</p>
        <div class="ui-dialog-actions">
            <button id="dialogCancelBtn" class="ui-btn">${cancelText}</button>
            <button id="dialogConfirmBtn" class="ui-btn-danger-solid">${confirmText}</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    eventBus.emit(Events.UI_PANEL_OPENED, { panelId: 'dialog' });

    const confirmBtn = panel.querySelector('#dialogConfirmBtn');
    const cancelBtn = panel.querySelector('#dialogCancelBtn');

    const close = () => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: 'dialog' });
    };

    confirmBtn.addEventListener('click', () => {
        close();
        if (onConfirm) onConfirm();
    });
    cancelBtn.addEventListener('click', () => {
        close();
        if (onCancel) onCancel();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            close();
            if (onCancel) onCancel();
        }
    });

    return overlay;
}

// 信息对话框组件(单按钮"知道了"— 纯提示,无确认分支,玩家只能关闭)
// 用于需要用户注意但不提供选择余地的场景(如星系组合校验失败)
export function createInfoDialog(title, message, okText = t('common.confirmDefault')) {
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-overlay';
    const panel = document.createElement('div');
    panel.className = 'ui-dialog';
    panel.innerHTML = `
        <h3 class="ui-dialog-title">${title}</h3>
        <p class="ui-dialog-body">${message}</p>
        <div class="ui-dialog-actions">
            <button id="dialogOkBtn" class="ui-btn">${okText}</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    eventBus.emit(Events.UI_PANEL_OPENED, { panelId: 'dialog' });

    const close = () => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: 'dialog' });
    };

    const okBtn = panel.querySelector('#dialogOkBtn');
    okBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    return overlay;
}

// 辅助：HTML 转义（用户输入内容拼 innerHTML 前必须转义，防 XSS）
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 辅助：将纹理清单 key 转为 <img> HTML 字符串，纹理未就绪时返回 fallback Emoji
// 0.3.0：key 可为「实体配置里的资产路径」（就近声明）或「通用 UI 图标短 key」
export function renderIconHtml(textureKey, fallbackEmoji, sizePx) {
    if (!textureKey) return fallbackEmoji || '';
    const tex = textureManager.get(textureKey);
    if (tex) {
        const s = sizePx || 14;
        return `<img src="${tex.src}" style="width:${s}px;height:${s}px;object-fit:contain;vertical-align:middle;">`;
    }
    return fallbackEmoji || '';
}

// 燃料分槽进度条（0.2.0 阶段4）— 每种推进剂独立一条 bar，供各面板复用
// 0.2.7 v2：标签/数量在条外（条内无文字），空槽常显（0 量不消失），默认绿
export function renderFuelBarsHtml(ship, opts = {}) {
    if (!ship) return '';
    const color = opts.color || 'var(--progress-green)';

    const rows = [];
    if (ship.resources) {
        for (const [resId, slot] of Object.entries(ship.resources)) {
            if (!slot) continue;
            const def = getResourceType(resId);
            rows.push({
                name: def ? def.name : resId,
                unit: def ? def.unit : '',
                amount: slot.amount || 0,
                capacity: slot.capacity || 0
            });
        }
    } else if (typeof ship.fuel === 'number') {
        rows.push({ name: t('common.fuel'), unit: '', amount: ship.fuel, capacity: ship.fuelCapacity ?? ship.fuel });
    }

    let html = '';
    for (const r of rows) {
        const pct = r.capacity > 0 ? Math.min(100, Math.max(0, r.amount / r.capacity * 100)) : 0;
        html += '<div class="tkp-res-row" style="gap:4px;">'
            + '<span class="tkp-res-name" style="width:64px;text-align:left;">' + r.name + '</span>'
            + '<span class="tkp-res-track"><span class="tkp-res-fill" style="width:' + pct + '%;background:' + color + ';"></span></span>'
            + '<span class="tkp-res-amount">' + Math.floor(r.amount) + ' / ' + Math.floor(r.capacity) + (r.unit ? ' ' + r.unit : '') + '</span>'
            + '</div>';
    }
    return html;
}
