'use strict';

// UI 点击/悬停音效采集模块 — 监听 document click/mouseover（捕获阶段），识别 UI 元素交互并广播
// UI_CLICKED / UI_HOVERED；播放决策由 audioDirector 查配置完成
// 业务层不直接出声（音频规范铁律）
// 新增可交互组件时：在此登记 HIT_SELECTOR（命中）/ SELECTED_SELECTOR（选中态）/ EXCLUDE_SELECTOR（排除）

import { eventBus, Events } from '../eventBus.js';

// 命中选择器：这些元素上的点击视为"UI 点击"（button 与自定义点击区全覆盖）
const HIT_SELECTOR = [
    'button',
    '.ui-btn',
    '[data-action]',
    '.nc-mode-card',          // 新建战役模式卡
    '.settings-cat',          // 设置分类导航
    '.settings-back-btn',     // 设置返回按钮
    '.msp-row',               // 模块选择弹窗行
    '.msp-uninstall',         // 模块选择弹窗卸载行
    '.msp-cat-head',          // 模块选择弹窗分类折叠头
    '.vis-toggle-btn',        // 可见性筛选展开钮
    '.tracking-node-card',    // 追踪站天体卡（飞船/设施）
    '.tracking-node',         // 追踪站天体树节点行（可展开/收起）
    '.tracking-group-header', // 追踪站分组头
    '.sgp-world-row',         // 开始游戏世界行
    '.sgp-cp-row'             // 开始游戏存档行
].join(',');

// 选中态选择器：命中这些标记的点击播放"已选中再点"变体（闷一点、小声一点）
const SELECTED_SELECTOR = [
    '.selected',              // settings-btn.selected / 设施部署选项 selected
    '.nc-mode-selected',      // 新建战役选中模式卡
    '.tracking-tab-active',   // 追踪站当前导航 Tab
    '.settings-cat.active',   // 设置当前分类
    '.sgp-selected',          // 开始游戏已选中世界/存档行
    '.tracking-node-selected' // 追踪站已选中的天体节点/卡片
].join(',');

// 排除选择器：这些元素的点击不广播（时间加速档位格属另一套音效，不在此采集）
const EXCLUDE_SELECTOR = '.timewarp-cell';

// 捕获阶段监听：先于业务处理器执行，避免被业务侧 stopPropagation 干扰
document.addEventListener('click', (e) => {
    const hit = e.target.closest(HIT_SELECTOR);
    if (!hit) {
        return; // 非 UI 点击（Canvas 世界 / 遮罩本体等）不广播
    }
    if (hit.closest(EXCLUDE_SELECTOR)) {
        return; // 排除清单（档位格等）
    }
    // 屏幕位置变调：按钮中心 y / 视口高度（0=顶部，1=底部），audioDirector 据此查表变调
    const rect = hit.getBoundingClientRect();
    const yRatio = window.innerHeight > 0
        ? (rect.top + rect.height / 2) / window.innerHeight
        : 0.5;
    const variant = hit.closest(SELECTED_SELECTOR) ? 'selected' : 'normal';
    eventBus.emit(Events.UI_CLICKED, { variant, yRatio });
}, true);

// 悬停音采集：document mouseover 捕获阶段委托（与点击共用 HIT/EXCLUDE 选择器）
// 去重：同元素内移动（子元素 mouseover 冒泡）不重播，仅"进入新 UI 元素"时广播
let _lastHoverEl = null;
document.addEventListener('mouseover', (e) => {
    // 时间加速档位格：独立悬停音（按档位变调，不进通用 UI 悬停机制）
    const warpCell = e.target.closest('.timewarp-cell');
    if (warpCell) {
        if (warpCell !== _lastHoverEl) {
            _lastHoverEl = warpCell;
            eventBus.emit(Events.UI_WARP_HOVERED, {
                rate: parseFloat(warpCell.dataset.rate) || 1
            });
        }
        return;
    }
    const hit = e.target.closest(HIT_SELECTOR);
    if (!hit) {
        _lastHoverEl = null; // 移出 UI 区域 → 重置，下次进入同元素会重播
        return;
    }
    if (hit.closest(EXCLUDE_SELECTOR)) {
        _lastHoverEl = null;
        return;
    }
    if (hit === _lastHoverEl) {
        return;
    }
    _lastHoverEl = hit;
    const rect = hit.getBoundingClientRect();
    const yRatio = window.innerHeight > 0
        ? (rect.top + rect.height / 2) / window.innerHeight
        : 0.5;
    eventBus.emit(Events.UI_HOVERED, { yRatio });
}, true);
