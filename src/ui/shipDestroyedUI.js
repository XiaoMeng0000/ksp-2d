'use strict';

// 飞船损毁总结面板（KSP Flight Results 风格）
// 订阅 SHIP_DESTROYED：自动暂停游戏并弹出损毁报告，
// 玩家可选择"读取存档"（打开检查点列表）或"前往追踪站"。

import { eventBus, Events } from '../eventBus.js';
import { sceneManager } from '../sceneManager.js';
import { timeWarp } from '../timeWarp.js';

// 最近一次游戏时间缓存（CELESTIAL_TIME_UPDATED 广播，供损毁报告展示）
let _lastGameTime = 0;
// 当前损毁面板 overlay（防止同一帧多次销毁重复弹窗）
let _overlay = null;

eventBus.on(Events.CELESTIAL_TIME_UPDATED, ({ time }) => {
    _lastGameTime = time;
});

// 损毁原因文案映射
const REASON_TEXT = {
    atmosphere: '在大气层中坠毁',
    surface: '撞击天体表面'
};

// 数值格式化：>=1000 转 km，否则保留 m
function formatDist(value) {
    if (value >= 1000) {
        return (value / 1000).toFixed(1) + ' km';
    }
    return Math.round(value) + ' m';
}

// 关闭面板并恢复时间（1x）
function closePanel() {
    if (_overlay && _overlay.parentNode) {
        _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
    document.removeEventListener('keydown', escHandler);
    timeWarp.warpToIndex(1);
}

function escHandler(e) {
    if (e.key === 'Escape') {
        closePanel();
    }
}

// 展示损毁报告面板
function showDestroyedPanel(data) {
    // 自动暂停（warpToIndex(0) 联动场景暂停门控）
    timeWarp.warpToIndex(0);

    // 重复销毁时先清理旧面板
    if (_overlay) {
        closePanel();
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = ''
        + 'position:fixed;inset:0;background:rgba(0,0,0,0.8);'
        + 'display:flex;align-items:center;justify-content:center;'
        + 'z-index:10000;';

    const panel = document.createElement('div');
    panel.style.cssText = ''
        + 'background:rgba(0,0,0,0.88);border:1px solid #ff5566;'
        + 'border-radius:6px;padding:22px;min-width:320px;'
        + 'max-width:380px;font-family:monospace;color:white;'
        + 'text-align:center;';

    // 标题
    const title = document.createElement('h3');
    title.textContent = '💥 飞船损毁报告';
    title.style.cssText = 'color:#ff5566;margin:0 0 16px 0;border-bottom:1px solid #444;padding-bottom:10px;font-size:18px;';

    // 损毁信息
    const infoRows = [
        ['飞船', data.shipName || data.shipId || '未知'],
        ['损毁原因', REASON_TEXT[data.reason] || data.reason || '未知'],
        ['所在天体', data.bodyName || '深空'],
        ['损毁高度', formatDist(data.altitude || 0)],
        ['损毁速度', Math.round(data.speed || 0) + ' m/s'],
        ['游戏时间', _lastGameTime.toFixed(1) + ' s']
    ];

    const infoBox = document.createElement('div');
    infoBox.style.cssText = 'margin-bottom:20px;';
    for (const [label, value] of infoRows) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;font-size:13px;';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.style.cssText = 'color:#aaa;';
        const valueSpan = document.createElement('span');
        valueSpan.textContent = value;
        valueSpan.style.cssText = 'color:#fff;';
        row.appendChild(labelSpan);
        row.appendChild(valueSpan);
        infoBox.appendChild(row);
    }
    panel.appendChild(infoBox);

    // 按钮组
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:center;gap:10px;';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '读取存档';
    const trackingBtn = document.createElement('button');
    trackingBtn.textContent = '前往追踪站';

    const btnStyle = ''
        + 'padding:8px 14px;background:#333;color:#ddd;'
        + 'border:1px solid #666;border-radius:4px;'
        + 'font-family:monospace;font-size:13px;cursor:pointer;';
    const btnHover = (btn) => {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(136,204,255,0.15)';
            btn.style.color = '#88ccff';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#333';
            btn.style.color = '#ddd';
        });
    };
    loadBtn.style.cssText = btnStyle;
    trackingBtn.style.cssText = btnStyle;
    btnHover(loadBtn);
    btnHover(trackingBtn);

    // 读取存档：恢复时间后打开检查点列表（两级菜单）
    loadBtn.addEventListener('click', () => {
        closePanel();
        if (typeof window.openLoadMenu === 'function') {
            window.openLoadMenu();
        } else {
            window.showNotification('存档菜单未加载', 'error');
        }
    });

    // 前往追踪站：恢复时间并切换场景（已在追踪站则仅恢复）
    trackingBtn.addEventListener('click', () => {
        closePanel();
        if (sceneManager.getCurrentScene() !== 'tracking') {
            sceneManager.switchTo('tracking');
        }
    });

    btnRow.appendChild(loadBtn);
    btnRow.appendChild(trackingBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    _overlay = overlay;

    // ESC / 点击遮罩关闭（兜底防卡死）
    document.addEventListener('keydown', escHandler);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closePanel();
        }
    });
}

// 订阅飞船销毁事件
eventBus.on(Events.SHIP_DESTROYED, (data) => {
    showDestroyedPanel(data);
});

console.log('[ShipDestroyedUI] 损毁报告面板已加载');
