// UI组件 - 通知和对话框组件

import { textureManager } from '../graphics/textureManager.js';
import { t } from '../config/strings.js';
import { getResourceType } from '../resources/resourceTypes.js';
import { getModuleDef, getModuleCategories, getModulesByCategory } from '../ship/moduleTypes.js';

export function createNotification(message, type = 'info', duration = 2000) {
    // 创建或获取通知容器
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        document.body.appendChild(container);
    }

    // 堆叠通知 - 创建独立通知元素（边框颜色由类型 class 控制）
    const div = document.createElement('div');
    div.className = 'ui-notification ui-notification-' + type;
    div.textContent = message;

    // 堆叠通知 - 插入到最顶部（视觉上的底部）
    if (container.firstChild) {
        container.insertBefore(div, container.firstChild);
    } else {
        container.appendChild(div);
    }

    // 堆叠通知 - 触发淡入和上移动画
    requestAnimationFrame(() => {
        div.style.opacity = '1';
        div.style.transform = 'translateY(0)';
    });

    // 堆叠通知 - 定时器结束后淡出并移除
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transform = 'translateY(10px)';
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

    panel.querySelectorAll('[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            onSelect(id);
        });
    });
    const cancelBtn = panel.querySelector('#dialogCancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (onCancel) onCancel();
        });
    }
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
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

    const input = panel.querySelector('#dialogInput');
    const confirmBtn = panel.querySelector('#dialogConfirmBtn');
    const cancelBtn = panel.querySelector('#dialogCancelBtn');

    input.focus();
    input.select();

    const close = () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
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

    const confirmBtn = panel.querySelector('#dialogConfirmBtn');
    const cancelBtn = panel.querySelector('#dialogCancelBtn');

    const close = () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
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

// 辅助：HTML 转义（用户输入内容拼 innerHTML 前必须转义，防 XSS）
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 辅助：将 textureKey 转为 PNG <img> HTML 字符串，纹理未就绪时返回 fallback Emoji
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

// 模块选择弹窗（0.2.7 共享组件：统一飞船建造 showModuleSelector 与设施模块管理 showFacilityModuleSelector）
// opts:
//   anchorEl          锚定元素（弹窗跟随其右侧弹出）
//   onSelect(modDef)  必填，点击模块行（安装/替换）
//   onUninstall()     可选，提供则弹窗底部显示"卸载"危险行
//   installedModuleId 可选，显示"已安装"提示行
//   showBonuses       可选，行尾显示加成+价格（飞船建造用）
//   showTooltip       可选，悬停显示模块详情（飞船建造用）
// 视觉统一走 ksp2_panels.css（.module-selector-popup / .msp-*）
export function showModuleSelectorPopup(opts) {
    const existing = document.querySelector('.module-selector-popup');
    if (existing) existing.remove();

    const rect = opts.anchorEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'module-selector-popup';
    popup.style.cssText = `
        position:fixed;left:${Math.min(rect.right + 8, window.innerWidth - 240)}px;top:${rect.top}px;
    `;

    const closeHandler = () => { popup.remove(); document.removeEventListener('click', closeHandler); };
    const escHandler = (e) => {
        if (e.key === 'Escape') { popup.remove(); document.removeEventListener('click', closeHandler); }
    };

    // 已安装提示（飞船建造：当前槽位已有模块）
    const installedDef = opts.installedModuleId ? getModuleDef(opts.installedModuleId) : null;
    if (installedDef) {
        const installedRow = document.createElement('div');
        installedRow.className = 'msp-installed';
        installedRow.innerHTML = t('build.installed')
            + '<span style="color:var(--accent);">' + renderIconHtml(installedDef.iconTextureKey, installedDef.icon) + ' ' + installedDef.name + '</span>';
        popup.appendChild(installedRow);
    }

    // 分类卡（紫头顶条，点击折叠仅剩顶头）
    for (const cat of getModuleCategories()) {
        const card = document.createElement('div');
        card.className = 'msp-cat-card';

        const head = document.createElement('div');
        head.className = 'msp-cat-head';
        head.innerHTML = '<span class="tg-arrow">▾</span>' + cat.name;
        head.addEventListener('click', (e) => {
            e.stopPropagation();
            card.classList.toggle('collapsed');
        });
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'msp-cat-body';

        for (const def of getModulesByCategory(cat.id)) {
            const row = document.createElement('div');
            row.className = 'msp-row';
            // 名称（左）
            let labelHtml = '<span>' + renderIconHtml(def.iconTextureKey, def.icon) + ' ' + def.name + '</span>';
            // 行尾（右）：建造=加成+价格 / 设施=价格或免费
            if (opts.showBonuses) {
                labelHtml += '<span class="msp-bonus">'
                    + t('build.bonusShort', { mass: def.massBonus.toFixed(1), moi: def.momentOfInertiaBonus.toFixed(0) })
                    + (def.price ? t('build.modulePriceSuffix', { price: def.price }) : '')
                    + '</span>';
            } else {
                labelHtml += '<span class="msp-price">' + (def.price > 0 ? def.price + t('economy.kitsUnit') : t('common.free')) + '</span>';
            }
            row.innerHTML = labelHtml;

            // 悬停详情提示（飞船建造用）
            let tooltip = null;
            if (opts.showTooltip) {
                row.addEventListener('mouseenter', () => {
                    tooltip = document.createElement('div');
                    tooltip.className = 'msp-tooltip';
                    tooltip.innerHTML = '<div class="msp-tooltip-title">' + def.name + '</div>'
                        + '<div class="msp-tooltip-desc">' + def.description + '</div>'
                        + '<div class="msp-tooltip-stats">' + t('build.massBonus', { v: def.massBonus.toFixed(1) }) + ' · ' + t('build.moiBonus', { v: def.momentOfInertiaBonus.toFixed(0) }) + '</div>';
                    document.body.appendChild(tooltip);
                    const rowRect = row.getBoundingClientRect();
                    tooltip.style.left = (rowRect.right + 8) + 'px';
                    tooltip.style.top = rowRect.top + 'px';
                });
                row.addEventListener('mouseleave', () => {
                    if (tooltip) { tooltip.remove(); tooltip = null; }
                });
            }

            // 点击安装/替换
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                popup.remove();
                if (tooltip) tooltip.remove();
                opts.onSelect(def);
            });

            body.appendChild(row);
        }
        card.appendChild(body);
        popup.appendChild(card);
    }

    // 卸载危险行（仅已安装模块时显示）
    if (opts.onUninstall && installedDef) {
        const uninstallRow = document.createElement('div');
        uninstallRow.className = 'msp-uninstall';
        uninstallRow.textContent = t('build.uninstall');
        uninstallRow.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.remove();
            opts.onUninstall();
        });
        popup.appendChild(uninstallRow);
    }

    document.body.appendChild(popup);
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
        document.addEventListener('keydown', escHandler);
    }, 0);
}
