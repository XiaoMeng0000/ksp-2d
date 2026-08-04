// UI组件 - 通知和对话框组件

import { textureManager } from '../graphics/textureManager.js';

export function createNotification(message, type = 'info', duration = 2000) {
    // 堆叠通知 - 添加 warning 类型颜色
    const colors = { success: '#88ccff', error: '#ff6666', info: '#aaa', warning: '#ffaa44' };

    // 创建或获取通知容器
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10001;
            display: flex;
            flex-direction: column-reverse;
            align-items: center;
            gap: 8px;
            pointer-events: none;
            max-width: 90vw;
        `;
        document.body.appendChild(container);
    }

    // 堆叠通知 - 创建独立通知元素
    const div = document.createElement('div');
    div.style.cssText = `
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid ${colors[type] || colors.info};
        border-radius: 3px;
        padding: 8px 16px;
        color: white;
        font-family: monospace;
        font-size: 12px;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.3s ease;
        pointer-events: none;
        text-align: center;
        max-width: 80vw;
        min-width: 120px;
    `;
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
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.8);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
    `;
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: rgba(0, 0, 0, 0.85); border: 1px solid #555;
        border-radius: 5px; padding: 15px; min-width: 280px;
        max-width: 450px; max-height: 70vh; overflow-y: auto;
        font-family: monospace; color: white;
    `;
    let html = `<h3 style="color:#88ccff;margin:0 0 12px 0;border-bottom:1px solid #444;padding-bottom:5px;">${title}</h3>`;
    if (items.length === 0) {
        html += `<p style="color:#666;">列表为空</p>`;
    } else {
        html += `<div style="display:flex;flex-direction:column;gap:6px;">`;
        items.forEach((item) => {
            const subtitle = item.subtitle || (item.timestamp ? new Date(item.timestamp).toLocaleString() : '');
            html += `
                <button data-id="${item.id}" style="padding:8px 12px;background:#333;border:1px solid #555;border-radius:3px;color:#ddd;font-family:monospace;font-size:12px;cursor:pointer;text-align:left;">
                    <div style="font-weight:bold;">${item.name}</div>
                    ${subtitle ? `<div style="color:#666;font-size:11px;">${subtitle}</div>` : ''}
                </button>
            `;
        });
        html += `</div>`;
    }
    html += `
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
            <button id="dialogCancelBtn" style="padding:4px 12px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">取消</button>
        </div>
    `;
    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelectorAll('[data-id]').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(136,204,255,0.15)';
            btn.style.borderColor = '#555';
            btn.style.color = '#88ccff';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#333';
            btn.style.borderColor = '#555';
            btn.style.color = '#ddd';
        });
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
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.8);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
    `;
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: rgba(0, 0, 0, 0.85); border: 1px solid #555;
        border-radius: 5px; padding: 15px; min-width: 280px;
        max-width: 380px; font-family: monospace; color: white;
    `;
    panel.innerHTML = `
        <h3 style="color:#88ccff;margin:0 0 12px 0;border-bottom:1px solid #444;padding-bottom:5px;">${title}</h3>
        <input type="text" id="dialogInput" placeholder="${placeholder || ''}" 
            style="width:100%;padding:6px 10px;margin-bottom:12px;box-sizing:border-box;
            background:#333;color:#fff;font-family:monospace;font-size:12px;outline:none;border:1px solid #555;border-radius:3px;"
            value="${defaultValue || ''}">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="dialogCancelBtn" style="padding:4px 12px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">取消</button>
            <button id="dialogConfirmBtn" style="padding:4px 12px;background:rgba(136,204,255,0.2);color:#88ccff;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">确定</button>
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
export function createConfirmDialog(title, message, onConfirm, onCancel, confirmText = '确认', cancelText = '取消') {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.8);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
    `;
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: rgba(0, 0, 0, 0.85); border: 1px solid #555;
        border-radius: 5px; padding: 15px; min-width: 280px;
        max-width: 380px; font-family: monospace; color: white;
    `;
    // 使用自定义按钮文字
    panel.innerHTML = `
        <h3 style="color:#ff6666;margin:0 0 10px 0;border-bottom:1px solid #444;padding-bottom:5px;">${title}</h3>
        <p style="color:#aaa;margin:0 0 15px 0;font-size:12px;">${message}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="dialogCancelBtn" style="padding:4px 12px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">${cancelText}</button>
            <button id="dialogConfirmBtn" style="padding:4px 12px;background:rgba(255,80,80,0.2);color:#ff6666;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">${confirmText}</button>
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
