'use strict';

// 全局 DOM tooltip — 统一飞行 HUD 及全游戏的鼠标悬停提示组件
// 背景：此前悬停提示混用两套机制导致视觉/位置不一致——
//   a) 浏览器原生 title 属性（跟随鼠标、系统默认样式、即时显示）
//   b) Canvas 自绘 tooltip（固定位置、延迟 0.3s、自绘样式）
// 本组件收敛为统一机制：常驻 body 的 DOM 元素，跟随鼠标定位，样式走 root.css 的
// .game-tooltip 类（与游戏面板风格一致）。视觉样式（底色/边框/圆角/字体）统一在
// root.css 管理，本模块只负责定位与显隐。
// 用法：showTooltip(text, clientX, clientY) / hideTooltip()

const tooltipEl = document.createElement('div');
tooltipEl.className = 'game-tooltip';
tooltipEl.style.display = 'none';
document.body.appendChild(tooltipEl);

// 相对鼠标指针的偏移（px）
const OFFSET = 14;
// 距视口边缘的最小留白（px）
const EDGE_PAD = 4;
// 悬停显示延迟（ms）：鼠标悬停停留该时长后才显示提示
const HOVER_DELAY = 500;

let _timer = null;

/**
 * 在指定屏幕坐标显示提示（延迟 HOVER_DELAY 后显示）
 * 提示框位置固定在触发点，不随鼠标移动；重复调用会重置延迟计时。
 * 调用方应在"进入新悬停目标"时调用一次，避免频繁移动导致永远不显示。
 * @param {string} text - 提示文本
 * @param {number} clientX - 触发点 clientX
 * @param {number} clientY - 触发点 clientY
 * @param {number} [delayMs] - 显示延迟（毫秒），缺省 HOVER_DELAY
 */
export function showTooltip(text, clientX, clientY, delayMs = HOVER_DELAY) {
    clearTimeout(_timer);
    _timer = setTimeout(() => {
        tooltipEl.textContent = text;
        tooltipEl.style.display = 'block';

        // 先测量再定位（textContent 写入后宽度才准确）
        const rect = tooltipEl.getBoundingClientRect();
        let left = clientX + OFFSET;
        let top = clientY + OFFSET;
        if (left + rect.width > window.innerWidth - EDGE_PAD) {
            left = clientX - rect.width - OFFSET;
        }
        if (top + rect.height > window.innerHeight - EDGE_PAD) {
            top = clientY - rect.height - OFFSET;
        }
        tooltipEl.style.left = Math.max(EDGE_PAD, left) + 'px';
        tooltipEl.style.top = Math.max(EDGE_PAD, top) + 'px';
    }, delayMs);
}

/**
 * 隐藏提示（同时取消未到期的延迟计时）
 */
export function hideTooltip() {
    clearTimeout(_timer);
    tooltipEl.style.display = 'none';
    tooltipEl.textContent = '';
}
