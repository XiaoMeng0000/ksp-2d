'use strict';

// 场景级加载界面（DOM 覆盖层）—— 只负责显示，不含业务逻辑：
//   · 订阅 SceneManager 的 SCENE_LOADING_* 事件刷新，不轮询任何业务模块；
//   · 背景为海报（配置路径），等比例铺满（cover）并允许裁边，绝不拉伸；
//     图片在启动阶段预载（display:none 的元素不会触发背景图请求，必须提前拉取），
//     未就绪时由配置的纯色兜底，不会白屏；
//   · 进度是「阶段进度」，不是下载字节百分比：WebGL 上下文创建 / 着色器编译 /
//     GPU 纹理上传多为同步调用，其内部无法刷新界面。
// 与启动加载画面（index.html 的 #loadingScreen）相互独立，互不影响。

import { eventBus, Events } from '../eventBus.js';
import { t } from '../config/ui/strings.js';
import { SCENE_LOADING_CONFIG } from '../config/ui/sceneLoadingConfig.js';

let _root = null;        // 覆盖层根节点
let _bgEl = null;        // 背景层（海报）
let _bgReady = false;    // 海报是否已解码完成
let _bgPreload = null;   // 海报预载句柄（只载一次）
let _stage = null;       // 阶段文案
let _track = null;       // 进度轨道（progressbar 语义，供读屏与调试取值）
let _bar = null;         // 进度条填充
let _percent = null;     // 百分比文字
let _bound = false;
let _hideTimer = null;   // 淡出结束后的隐藏定时器（淡出期间再次显示需取消）

// 调试统计（仅控制台核对用，业务代码不消费）
const _stats = {
    visibleCount: 0,
    lastShowAt: 0,
    lastHideAt: 0,
    lastVisibleMs: 0,
    lastProgress: 0,
    bgReadyAtShow: false,
    progressSamples: [],
    progressLog: []
};
if (typeof window !== 'undefined') {
    window.__sceneLoadingStats = _stats;
}

// 背景图写入（仅在预载完成后调用，避免遮罩首帧露出兜底色）
function _applyBackgroundImage() {
    if (!_bgEl || !_bgReady) return;
    if (!SCENE_LOADING_CONFIG.backgroundPath) return;   // 未配海报 → 保留兜底纯色
    _bgEl.style.backgroundImage = 'url("' + SCENE_LOADING_CONFIG.backgroundPath + '")';
}

// 启动阶段预载海报：
// display:none 的遮罩不会触发 background-image 请求，若等到首次显示才取图，
// 遮罩头一两帧只能显示兜底色（表现为「先绿一下再变成海报」）。
function _preloadBackground() {
    if (_bgPreload || typeof Image === 'undefined') return;
    if (!SCENE_LOADING_CONFIG.backgroundPath) return;   // 未配海报 → 不预载
    const img = new Image();
    _bgPreload = img;
    img.onload = () => {
        const markReady = () => {
            _bgReady = true;
            _applyBackgroundImage();
        };
        // 先解码再上屏：避免图片已下载但首帧仍来不及解码
        if (typeof img.decode === 'function') {
            img.decode().then(markReady).catch(markReady);
        } else {
            markReady();
        }
    };
    img.onerror = () => {
        console.warn('[SceneLoading] 背景图加载失败，使用纯色兜底：' + SCENE_LOADING_CONFIG.backgroundPath);
    };
    img.src = SCENE_LOADING_CONFIG.backgroundPath;
}

// 构建 DOM（首次显示时调用；之后复用）
function _build() {
    if (_root) return;

    _root = document.createElement('div');
    _root.id = 'sceneLoadingScreen';
    _root.className = 'scene-loading';
    // 淡出时长与配置同源（CSS 只留缺省值，真实时长以此为准）
    _root.style.transitionDuration = (SCENE_LOADING_CONFIG.fadeOutMs | 0) + 'ms';

    // 背景层：色值 + 图片都来自配置；cover 保证任何窗口比例都不变形
    const bg = document.createElement('div');
    bg.className = 'scene-loading-bg';
    bg.style.backgroundColor = SCENE_LOADING_CONFIG.fallbackColor;
    _bgEl = bg;
    _applyBackgroundImage();

    const panel = document.createElement('div');
    panel.className = 'scene-loading-panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');

    const title = document.createElement('div');
    title.className = 'scene-loading-title';
    title.textContent = t('loading.title');

    _stage = document.createElement('div');
    _stage.className = 'scene-loading-stage';
    _stage.textContent = t('loading.preparing');

    _track = document.createElement('div');
    _track.className = 'scene-loading-track';
    _track.setAttribute('role', 'progressbar');
    _track.setAttribute('aria-valuemin', '0');
    _track.setAttribute('aria-valuemax', '100');
    _track.setAttribute('aria-valuenow', '0');
    _track.setAttribute('aria-label', t('loading.title'));

    _bar = document.createElement('div');
    _bar.className = 'scene-loading-bar';
    _track.appendChild(_bar);

    _percent = document.createElement('div');
    _percent.className = 'scene-loading-percent';
    _percent.textContent = '0%';

    panel.appendChild(title);
    panel.appendChild(_stage);
    panel.appendChild(_track);
    panel.appendChild(_percent);

    _root.appendChild(bg);
    _root.appendChild(panel);
    document.body.appendChild(_root);
}

// 进度写入（0~1 → 百分比文本 + 进度条宽度 + 读屏值）
function _setProgress(progress) {
    if (!_root) return;
    const pct = Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * 100);
    _bar.style.width = pct + '%';
    _percent.textContent = pct + '%';
    _track.setAttribute('aria-valuenow', String(pct));
}

function _show() {
    _build();
    // 淡出过程中又被要求显示：取消待执行的隐藏，直接回到不透明状态
    if (_hideTimer) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }
    _root.classList.remove('is-hiding');
    _stage.textContent = t('loading.preparing');
    _setProgress(0);
    _root.classList.add('is-visible');
    _stats.visibleCount++;
    _stats.lastShowAt = performance.now();
    _stats.lastProgress = 0;
    _stats.bgReadyAtShow = _bgReady;
    _stats.progressSamples = [];
    _stats.progressLog = [];
}

// 完成：先淡出到透明，再从显示流中移除（淡出期间不再拦截鼠标）
function _hide() {
    if (!_root || !_root.classList.contains('is-visible')) return;
    if (_stats.lastShowAt && !_stats.lastHideAt) {
        // 调试统计：加载层从显示到开始淡出的时长（供控制台核对最短可见时间约束）
        _stats.lastVisibleMs = Math.round(performance.now() - _stats.lastShowAt);
        _stats.lastHideAt = performance.now();
    }
    _root.classList.add('is-hiding');
    _hideTimer = setTimeout(() => {
        _hideTimer = null;
        if (!_root) return;
        _root.classList.remove('is-hiding');
        _root.classList.remove('is-visible');
    }, Math.max(0, SCENE_LOADING_CONFIG.fadeOutMs | 0));
}

// 初始化：只建一次订阅（main.js 在注册场景前调用）；同时预载背景海报
export function initSceneLoadingUI() {
    if (_bound) return;
    _bound = true;

    _preloadBackground();

    eventBus.on(Events.SCENE_LOADING_STARTED, () => {
        _stats.lastHideAt = 0;
        _show();
    });

    eventBus.on(Events.SCENE_LOADING_PROGRESS, ({ progress, stage }) => {
        _build();
        _setProgress(progress);
        _stats.lastProgress = progress;
        if (_stats.progressSamples.length < 32) _stats.progressSamples.push(Math.round(progress * 100));
        // 调试统计：每个阶段相对加载层显示时刻的耗时（定位卡在哪个准备阶段）
        if (_stats.progressLog.length < 32) {
            _stats.progressLog.push({
                pct: Math.round(progress * 100),
                stage,
                ms: Math.round(performance.now() - (_stats.lastShowAt || performance.now()))
            });
        }
        _stage.textContent = stage ? t(stage) : (progress >= 1 ? t('loading.done') : t('loading.preparing'));
    });

    eventBus.on(Events.SCENE_LOADING_FINISHED, () => {
        _hide();
    });
}
