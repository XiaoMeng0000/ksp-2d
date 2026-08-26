'use strict';

import { uiManager } from './uiManager.js';
import { t } from '../config/strings.js';
import {
    starSystemRegistry,
    isHomeworldSystem,
    validateSystemSelection,
    getDefaultSystemIds
} from '../config/starSystemIndex.js';

// 星系选择面板 — 0.2.5 新增
// 从"创建新战役"对话框的「星系配置」行点开,以覆盖层形式展示:
//   - 家园星系:单选(组合中必须恰好一个,默认选中默认组合中的 homeworld)
//   - 可选星系:复选(非 homeworld 的实体星系)
//   - 占位星系:仅显示名称,不可勾选
//   - 右侧分布示意图:homeworld 居中,各星系按 distance/bearingDeg 归一化描点
// 确认时输出完整组合 id 数组(homeworld 在前),由调用方处理

const overlay = document.createElement('div');
overlay.id = 'systemSelectPanel';
overlay.className = 'ssp-overlay';
overlay.style.display = 'none';
overlay.innerHTML = `
    <div class="ssp-dialog">
        <div class="ssp-title">${t('systemselect.title')}</div>
        <div class="ssp-body">
            <div class="ssp-list" id="sspList"></div>
            <div class="ssp-chart-box">
                <canvas id="sspChart" width="240" height="240"></canvas>
                <div class="ssp-chart-hint" id="sspChartHint">${t('systemselect.chartHint')}</div>
            </div>
        </div>
        <div class="ssp-actions">
            <button class="ui-btn" data-action="ssp-cancel">${t('systemselect.cancel')}</button>
            <button class="ui-btn-primary" data-action="ssp-confirm">${t('systemselect.confirm')}</button>
        </div>
    </div>
`;
document.body.appendChild(overlay);

// 面板状态
let _homeworldId = null;            // 选中的 homeworld 星系(单选)
let _selectedExtras = new Set();    // 选中的非 homeworld 实体星系
let _onConfirm = null;              // 确认回调(ids) => void

// 星系分组(数据驱动,全部来自注册表)
function _groupSystems() {
    const homeworlds = [];
    const optional = [];
    const placeholders = [];
    for (const system of starSystemRegistry) {
        const meta = system.meta;
        if (!meta.enabled) continue;
        if (meta.placeholder) {
            placeholders.push(meta);
        } else if (isHomeworldSystem(meta.id)) {
            homeworlds.push(meta);
        } else {
            optional.push(meta);
        }
    }
    return { homeworlds, optional, placeholders };
}

// 构建一张分类卡(紫头条 + 卡体),content 为卡体内部元素
function _buildGroupCard(title, content) {
    const card = document.createElement('div');
    card.className = 'ssp-group-card';

    const head = document.createElement('div');
    head.className = 'ssp-group-head';
    head.textContent = title;
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'ssp-group-body';
    if (content) body.appendChild(content);
    card.appendChild(body);
    return card;
}

// 渲染星系列表(分类卡样式:紫头条+卡体;条目=状态竖条+名称,未选暗条/选中绿条)
function _renderList() {
    const listEl = document.getElementById('sspList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const groups = _groupSystems();

    // 家园星系(单选)
    const hwCard = _buildGroupCard(t('systemselect.homeworldSection'), null);
    const hwBody = hwCard.querySelector('.ssp-group-body');
    for (const meta of groups.homeworlds) {
        const item = document.createElement('div');
        item.className = 'ssp-item' + (meta.id === _homeworldId ? ' ssp-selected' : '');
        item.innerHTML = `
            <span class="ssp-bar"></span>
            <span class="ssp-name">${meta.name}</span>
            <span class="ssp-sub">${t('systemselect.homeworldTag')}</span>
        `;
        item.addEventListener('click', () => {
            _homeworldId = meta.id;
            _renderList();
            _drawChart();
        });
        hwBody.appendChild(item);
    }
    listEl.appendChild(hwCard);

    // 可选星系(复选;为空时不渲分类卡)
    if (groups.optional.length > 0) {
        const optCard = _buildGroupCard(t('systemselect.optionalSection'), null);
        const optBody = optCard.querySelector('.ssp-group-body');
        for (const meta of groups.optional) {
            const checked = _selectedExtras.has(meta.id);
            const item = document.createElement('div');
            item.className = 'ssp-item' + (checked ? ' ssp-selected' : '');
            item.innerHTML = `
                <span class="ssp-bar"></span>
                <span class="ssp-name">${meta.name}</span>
                <span class="ssp-sub">${t('systemselect.distanceLabel', { d: meta.distance || 0 })}</span>
            `;
            item.addEventListener('click', () => {
                if (checked) {
                    _selectedExtras.delete(meta.id);
                } else {
                    _selectedExtras.add(meta.id);
                }
                _renderList();
                _drawChart();
            });
            optBody.appendChild(item);
        }
        listEl.appendChild(optCard);
    }

    // 占位星系(仅显示名称,不可勾选;状态竖条恒为暗条)
    if (groups.placeholders.length > 0) {
        const phCard = _buildGroupCard(t('systemselect.placeholderSection'), null);
        const phBody = phCard.querySelector('.ssp-group-body');
        for (const meta of groups.placeholders) {
            const item = document.createElement('div');
            item.className = 'ssp-item ssp-disabled';
            item.innerHTML = `
                <span class="ssp-bar"></span>
                <span class="ssp-name">${meta.name}</span>
                <span class="ssp-sub">${t('systemselect.placeholderTag')}</span>
            `;
            phBody.appendChild(item);
        }
        listEl.appendChild(phCard);
    }
}

// 绘制分布示意图(homeworld 居中,其余按距离归一化+方位角描点)
function _drawChart() {
    const canvas = document.getElementById('sspChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const maxR = size / 2 - 26;

    ctx.clearRect(0, 0, size, size);

    // 同心参考环 --text-faint(可读作弱化参考线)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    for (const r of [0.33, 0.66, 1]) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * r, 0, Math.PI * 2);
        ctx.stroke();
    }

    const groups = _groupSystems();
    const allMeta = [...groups.homeworlds, ...groups.optional, ...groups.placeholders];
    const maxDist = Math.max(1, ...allMeta.map(m => m.distance || 0));

    // homeworld 居中原点 --ut-gold(金色语义:家园/时间金)
    ctx.fillStyle = '#d4c86a';  // --ut-gold
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(212, 200, 106, 0.85)';  // --ut-gold @ 85%
    ctx.font = '11px monospace';
    ctx.fillText(t('systemselect.chartCenter'), cx + 10, cy + 4);

    // 其余星系描点(画布 y 轴向下,bearing 逆时针 → y 取负)
    // 色值对照:占位灰 --text-faint;选中绿 --progress-green;未选中 --theme-border-hover(蓝)
    const dotColor = (meta) => {
        if (meta.placeholder) return '#555555';       // --text-faint
        if (meta.id === _homeworldId) return '#d4c86a'; // --ut-gold
        return _selectedExtras.has(meta.id) ? '#3dff3d' : '#4B758A';  // --progress-green / --theme-border-hover
    };
    for (const meta of allMeta) {
        if (isHomeworldSystem(meta.id)) continue;
        const r = ((meta.distance || 0) / maxDist) * maxR;
        const angle = (meta.bearingDeg || 0) * Math.PI / 180;
        const x = cx + r * Math.cos(angle);
        const y = cy - r * Math.sin(angle);
        ctx.fillStyle = dotColor(meta);
        ctx.beginPath();
        ctx.arc(x, y, meta.placeholder ? 3 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';  // --text-main @ 55%
        ctx.fillText(meta.name, x + 8, y + 4);
    }
}

// 当前组合(homeworld 在前)
function _currentIds() {
    const ids = [];
    if (_homeworldId) ids.push(_homeworldId);
    for (const id of _selectedExtras) {
        if (id !== _homeworldId) ids.push(id);
    }
    return ids;
}

// 打开面板
function openSystemSelectPanel(options) {
    const opts = options || {};
    const defaults = getDefaultSystemIds();
    _homeworldId = (opts.homeworldId && isHomeworldSystem(opts.homeworldId))
        ? opts.homeworldId
        : defaults[0] || null;
    _selectedExtras = new Set((opts.extraIds || []).filter(id => id !== _homeworldId));
    _onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;

    _renderList();
    _drawChart();
    uiManager.showPanel('systemSelectPanel');
}

function closeSystemSelectPanel() {
    uiManager.hidePanel('systemSelectPanel');
}

function _confirmSelection() {
    const ids = _currentIds();
    const validation = validateSystemSelection(ids);
    if (!validation.ok) {
        window.showNotification(t('systemselect.invalidCombo'), 'error');
        return;
    }
    closeSystemSelectPanel();
    if (_onConfirm) {
        _onConfirm(ids);
    }
}

// 事件委托
overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
        case 'ssp-cancel':
            closeSystemSelectPanel();
            break;
        case 'ssp-confirm':
            _confirmSelection();
            break;
    }
});

uiManager.registerPanel('systemSelectPanel', {
    element: overlay,
    show: () => {
        overlay.style.display = 'flex';
        _renderList();
        _drawChart();
    },
    hide: () => {
        overlay.style.display = 'none';
    },
    render: () => {}
});

export { openSystemSelectPanel, closeSystemSelectPanel };
