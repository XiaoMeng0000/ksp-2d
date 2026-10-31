'use strict';

import { uiManager } from './uiManager.js';
import { t } from '../config/ui/strings.js';
import { getLatestNews, markDismissedToday } from '../news/latestNewsClient.js';
import { getTexturePath } from '../config/assets/assetManifest.js';

// ============================================================
// 最新消息面板（0.3.0）
// - 内容来自在线仓库（src/news/latestNewsClient.js，启动加载阶段已拉取），此处只读渲染
// - 视觉遵循 docs/UI面板视觉风格规范.md：壳(--theme-bg + 紫描边) → 紫头条 → 内容二级背景卡
// - 动效：自屏幕上方滑入居中；关闭沿原轨迹滑回上方（CSS 过渡，JS 只切类）
// - 底部：左「今日内不再显示」勾选，右「去公告查看」「我知道了！」
// - 入口：启动进主菜单自动弹出 / 公告面板左侧导航顶部「最新消息」
// ============================================================

// 与 CSS 出场过渡时长保持一致
const HIDE_MS = 300;

let _built = false;
let _hideTimer = null;
let _onHideDone = null;

// 折叠图片区：内置图缺失或加载失败时，面板自然变矮，不留空框
function _collapseImage() {
    const imageBox = document.getElementById('latestNewsImageBox');
    if (imageBox) imageBox.style.display = 'none';
}

// 面板 DOM（一次性创建，常驻 body，显示/隐藏切换）
const container = document.createElement('div');
container.id = 'latestNewsPanel';
document.body.appendChild(container);

function _buildPanel() {
    const windowEl = document.createElement('div');
    windowEl.className = 'ln-window';
    // 紫头条：标题（'// ' 前缀由 CSS ::before 提供，与全项目分区标题一致）
    const topbar = document.createElement('div');
    topbar.className = 'ln-topbar';

    const titleEl = document.createElement('span');
    titleEl.className = 'ln-title';
    titleEl.id = 'latestNewsTitle';
    topbar.appendChild(titleEl);
    windowEl.appendChild(topbar);

    // 内容区：二级背景卡（图片 + 正文）
    const bodyEl = document.createElement('div');
    bodyEl.className = 'ln-body';

    const cardEl = document.createElement('div');
    cardEl.className = 'ln-card';

    const imageBox = document.createElement('div');
    imageBox.className = 'ln-image-box';
    imageBox.id = 'latestNewsImageBox';

    const img = document.createElement('img');
    img.className = 'ln-image';
    img.id = 'latestNewsImage';
    img.alt = '';
    img.addEventListener('error', _collapseImage);
    imageBox.appendChild(img);
    cardEl.appendChild(imageBox);

    const textEl = document.createElement('div');
    textEl.className = 'ln-text';
    textEl.id = 'latestNewsText';
    cardEl.appendChild(textEl);

    bodyEl.appendChild(cardEl);
    windowEl.appendChild(bodyEl);

    // 底部：左勾选 + 右双按钮
    const footer = document.createElement('div');
    footer.className = 'ln-footer';

    const dismissLabel = document.createElement('label');
    dismissLabel.className = 'ln-dismiss';
    const dismissCheck = document.createElement('input');
    dismissCheck.type = 'checkbox';
    dismissCheck.id = 'latestNewsDismissCheck';
    dismissLabel.appendChild(dismissCheck);
    const dismissText = document.createElement('span');
    dismissText.textContent = t('news.dismissToday');
    dismissLabel.appendChild(dismissText);
    footer.appendChild(dismissLabel);

    const actions = document.createElement('div');
    actions.className = 'ln-actions';

    const btnAnnouncement = document.createElement('button');
    btnAnnouncement.type = 'button';
    btnAnnouncement.className = 'ln-btn';
    btnAnnouncement.textContent = t('news.btn.announcement');
    btnAnnouncement.addEventListener('click', () => {
        // 先滑回上方，动画结束后再打开公告面板，形成「摘要 → 详情」的衔接
        closeThen(() => {
            uiManager.showPanel('announcement');
        });
    });
    actions.appendChild(btnAnnouncement);

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'ln-btn ln-btn-primary';
    btnOk.textContent = t('news.btn.ok');
    btnOk.addEventListener('click', closeThen);
    actions.appendChild(btnOk);

    footer.appendChild(actions);
    windowEl.appendChild(footer);
    container.appendChild(windowEl);
}

// 渲染内容（只读 client 数据；文本一律 textContent，禁止 HTML 注入）
function _render() {
    const news = getLatestNews();
    if (!news) return;

    const titleEl = document.getElementById('latestNewsTitle');
    if (titleEl) titleEl.textContent = news.title || t('news.title');

    // 每次打开都重置勾选：勾选是本次操作，不跨次保留
    const check = document.getElementById('latestNewsDismissCheck');
    if (check) check.checked = false;

    const imageBox = document.getElementById('latestNewsImageBox');
    const img = document.getElementById('latestNewsImage');
    if (imageBox && img) {
        // 内置配图：imageKey → 资源清单 key → 本地路径（不联网，浏览器已预载）
        const imagePath = news.textureKey ? getTexturePath(news.textureKey) : '';
        if (imagePath) {
            imageBox.style.display = '';
            if (img.getAttribute('src') !== imagePath) img.src = imagePath;
        } else {
            imageBox.style.display = 'none';
            img.removeAttribute('src');
        }
    }

    const textEl = document.getElementById('latestNewsText');
    if (textEl) {
        textEl.innerHTML = '';
        textEl.scrollTop = 0;
        const lines = news.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const p = document.createElement('p');
            p.textContent = lines[i];
            textEl.appendChild(p);
        }
    }
}

// 显示（仅由 uiManager 的 show 回调调用）
function _show() {
    if (!getLatestNews()) return; // 无内容不弹（启动决策已在 splashScene 处过滤）
    if (!_built) {
        _buildPanel();
        _built = true;
    }
    _render();

    if (_hideTimer) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }
    _onHideDone = null;

    // 与 ESC 菜单互斥（同公告/设置面板）
    uiManager.hidePanel('esc');

    container.style.display = 'flex';
    // 双 rAF：等 display 生效后再加过渡类，滑入动画才会触发
    // （若两次 rAF 之间被关闭，不再补类，避免下次打开时丢失入场动画）
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (container.style.display === 'flex') container.classList.add('ln-in');
        });
    });
}

// 隐藏（仅由 uiManager 的 hide 回调调用）：记录勾选 → 滑回上方 → 收尾
function _hide() {
    const check = document.getElementById('latestNewsDismissCheck');
    if (check && check.checked) {
        markDismissedToday();
        check.checked = false;
    }

    container.classList.remove('ln-in');
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(() => {
        _hideTimer = null;
        container.style.display = 'none';
        const done = _onHideDone;
        _onHideDone = null;
        if (typeof done === 'function') done();
    }, HIDE_MS);
}

// 关闭并在出场动画结束后执行回调（用于「去公告查看」的衔接）
function closeThen(onDone) {
    _onHideDone = typeof onDone === 'function' ? onDone : null;
    uiManager.hidePanel('latestNews');
}

// 对外入口：打开最新消息（启动路径 / 公告面板导航）
function openLatestNews() {
    if (!getLatestNews()) {
        console.warn('[LatestNews] 当前无最新消息内容，跳过打开');
        return;
    }
    uiManager.showPanel('latestNews');
}

function closeLatestNews() {
    uiManager.hidePanel('latestNews');
}

// 注册到 uiManager（与设置/百科/公告面板统一显隐管理）
uiManager.registerPanel('latestNews', {
    element: container,
    show: _show,
    hide: _hide,
    render: () => {
        if (container.style.display !== 'none') _render();
    }
});

// 全局 ESC：面板可见时关闭
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && container.style.display !== 'none') {
        e.stopPropagation();
        closeLatestNews();
    }
});

export { openLatestNews, closeLatestNews };
