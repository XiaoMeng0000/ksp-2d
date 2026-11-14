'use strict';

// 轨道船坞「建造选单」（尝鲜版）
//
// 定位：替代完整版的飞船编辑器 —— 尝鲜版不做零件拼装，玩家在船坞从预设船里选一艘建造。
// 入口：设施「装配车间」舱室按钮 → eventBus 的 SHIP_BUILDER_REQUESTED（沿用既有事件，不新增通信词汇）。
// 建造：直接复用 facilitySystem.buildShip（扣材料 → 创建 → 失败退款 → 出生在船坞旁），
//       本模块只负责展示与交互，不碰物理与资源记账。
// 通信：注册到 uiManager（panelId: 'shipPicker'）。

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { t } from '../config/ui/strings.js';
import { shipSystem } from '../ship/shipSystem.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { gameState } from '../gameState.js';
import { SHIP_TEMPLATES } from '../config/entities/shipTemplates.js';
import { getStorageAmount } from '../resources/cargoSystem.js';
import { escapeHtml } from './uiComponents.js';

// 标准重力（与 resourceSystem.G0 同值；本面板只做展示换算）
const G0 = 9.81;

// 由模板推算展示指标（ΔV / 推重比 / 满罐总质量）
function _metricsOf(template) {
    const fuel = Object.values(template.fuelTanks || {}).reduce((sum, v) => sum + v, 0);
    const dryMass = template.dryMass || 0;
    const m0 = dryMass + fuel;
    const dv = (template.isp > 0 && dryMass > 0) ? template.isp * G0 * Math.log(m0 / dryMass) : 0;
    const twr = (m0 > 0) ? (template.maxThrust || 0) / (m0 * G0) : 0;
    return { fuel, m0, dv, twr };
}

const fmt = (v, digits = 0) => v.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const container = document.createElement('div');
container.id = 'shipPickerContainer';
container.className = 'ui-dialog-overlay';
container.style.display = 'none';
container.innerHTML = `
    <div class="ui-dialog" style="width:min(700px, 94vw); max-height:88vh; display:flex; flex-direction:column; padding:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--theme-menu-border);">
            <span style="font-family:var(--font-mono-bold); font-size:15px; color:var(--text-bright); letter-spacing:1px;">// ${t('shipPicker.title')}</span>
            <button id="shipPickerCloseBtn" class="ui-btn" style="padding:3px 10px;">${t('shipPicker.close')}</button>
        </div>
        <div id="shipPickerBody" style="overflow-y:auto; padding:14px 18px; display:flex; flex-direction:column; gap:10px;"></div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 18px; border-top:1px solid var(--theme-menu-border);">
            <span id="shipPickerStorage" style="font-size:11px; color:var(--text-dim);"></span>
            <button id="shipPickerEditorTeaser" class="ui-btn" style="padding:5px 12px; font-size:11px; opacity:0.85;">${t('shipPicker.editorTeaser')}</button>
        </div>
    </div>
`;
document.body.appendChild(container);

const bodyEl = container.querySelector('#shipPickerBody');
const storageEl = container.querySelector('#shipPickerStorage');

// 已建造数量（用于自动命名：入门练习船 → 入门练习船 2）
function _countBuilt(templateName) {
    return shipSystem.getAllShips().filter(s => (s.displayName || '').indexOf(templateName) === 0).length;
}

// 单张模板卡片
function _cardHtml(template) {
    const m = _metricsOf(template);
    return `<div class="tkp-card-sm" data-template-id="${template.id}">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span style="font-family:var(--font-mono-bold); font-size:13px; color:var(--text-bright);">${escapeHtml(template.name)}</span>
            <button data-action="build-ship" data-template-id="${template.id}" class="ui-btn-primary" style="padding:5px 14px; flex:none;">${t('shipPicker.build')}</button>
        </div>
        <div style="font-size:11px; color:var(--text-dim); margin:4px 0 6px; line-height:1.5;">${escapeHtml(template.description || '')}</div>
        <div style="display:flex; gap:14px; font-size:12px; color:var(--text-main); flex-wrap:wrap;">
            <span>${t('shipPicker.dv')} <b style="color:var(--accent);">${fmt(m.dv)} m/s</b></span>
            <span>${t('shipPicker.twr')} <b>${m.twr.toFixed(2)}</b></span>
            <span>${t('shipPicker.mass')} <b>${fmt(template.dryMass)} t</b></span>
            <span>${t('shipPicker.cost')} <b>${fmt(template.cost || 0)}</b></span>
        </div>
    </div>`;
}

// 渲染面板主体：船坞材料存量 + 全部预设船
function _render() {
    const facility = gameState.getActiveFacility();
    if (storageEl) {
        const kits = facility ? getStorageAmount(facility, 'materialKits') : 0;
        storageEl.textContent = t('shipPicker.storageHint') + ': ' + fmt(kits);
    }
    bodyEl.innerHTML = SHIP_TEMPLATES.map(_cardHtml).join('');
}

// 建造：唯一入口走 facilitySystem.buildShip（扣费/退款/出生位置全部在其中）
function _buildShip(templateId) {
    const facility = gameState.getActiveFacility();
    if (!facility) {
        window.showNotification(t('shipPicker.fail.noFacility'), 'error');
        return;
    }
    const template = SHIP_TEMPLATES.find(tpl => tpl.id === templateId);
    if (!template) {
        window.showNotification(t('shipPicker.fail.unknown'), 'error');
        return;
    }
    const built = _countBuilt(template.name);
    const shipName = built === 0 ? template.name : template.name + ' ' + (built + 1);

    const result = facilitySystem.buildShip(facility.id, templateId, shipName, []);
    if (!result || !result.ok) {
        const reason = result && result.reason;
        const message = reason === 'insufficientKits'
            ? t('shipPicker.fail.materials')
            : (reason === 'noFacility' ? t('shipPicker.fail.noFacility') : t('shipPicker.fail.unknown'));
        window.showNotification(message, 'error');
        _render();   // 材料不足时刷新存量显示，便于玩家判断
        return;
    }

    // 建造成功：切控制权到新船（与旧建造面板一致的行为）
    shipSystem.switchShip(result.ship.id);
    window.showNotification(t('shipPicker.built', { name: shipName }), 'success');
    uiManager.hidePanel('shipPicker');
}

// 卡片按钮事件委托（避免字符串 onclick）
bodyEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="build-ship"]');
    if (!btn) return;
    _buildShip(btn.dataset.templateId);
});

container.querySelector('#shipPickerCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('shipPicker');
});

// 完整版飞船编辑器 → 完整版引导弹窗
container.querySelector('#shipPickerEditorTeaser').addEventListener('click', () => {
    eventBus.emit(Events.TEASER_REQUESTED, { featureId: 'shipEditor' });
});

uiManager.registerPanel('shipPicker', {
    show: () => {
        _render();
        container.style.display = 'flex';
    },
    hide: () => {
        container.style.display = 'none';
    },
    render: () => _render()
});

// 入口：设施「装配车间」舱室按钮（flightUI 发事件）
eventBus.on(Events.SHIP_BUILDER_REQUESTED, () => {
    uiManager.showPanel('shipPicker');
});

export function openShipPicker() {
    uiManager.showPanel('shipPicker');
}

if (typeof window !== 'undefined') {
    window.openShipPicker = openShipPicker;
}
