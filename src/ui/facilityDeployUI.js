'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { getFacilityType, getFacilityCompartments, getFacilityCategories, getFacilitiesByCategory, getServiceName } from '../facility/facilityTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml } from './uiComponents.js';
import { makePanelDraggable, cascadePanelOpen } from './panelDrag.js';
import { t } from '../config/strings.js';

// 设施部署面板 — 设施类型选择面板
const facilityDeployPanel = document.createElement('div');
facilityDeployPanel.id = 'facilityDeployPanel';
facilityDeployPanel.innerHTML = `
    <div class="ui-panel-header">
        <h3 class="ui-panel-title">${t('facility.deployTitle')}</h3>
        <button id="facilityDeployCloseBtn" class="ui-btn-sm">关闭</button>
    </div>
    <div class="deploy-body">
        <div id="facilityDeployCategories" class="deploy-categories"></div>
        <div id="facilityDeployDetail" class="deploy-detail">
            <div>${t('facility.deployHint')}</div>
        </div>
    </div>
    <div style="position:absolute;bottom:15px;right:15px;">
        <button id="facilityDeployBuildBtn" class="ui-btn-primary">${t('facility.deployBtn')}</button>
    </div>
`;
document.body.appendChild(facilityDeployPanel);

// 部署面板 — 页头可拖动(panelDrag.js 共享工具)
makePanelDraggable(facilityDeployPanel, facilityDeployPanel.querySelector('.ui-panel-header'));

// 设施部署 - 事件委托（避免字符串 onclick）
facilityDeployPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-category') {
        toggleFacilityCategory(btn.dataset.catId);
    } else if (btn.dataset.action === 'select-facility') {
        selectFacilityType(btn.dataset.facilityId);
    }
});

// 设施部署面板 — 当前选中的设施类型
let selectedFacilityTypeId = null;


// ========== 设施部署面板 — 渲染与交互 ==========

// 渲染设施分类列表
function renderFacilityDeployCategories() {
    const container = document.getElementById('facilityDeployCategories');
    const categories = getFacilityCategories();
    let html = '';

    categories.forEach((cat, catIndex) => {
        const facilities = getFacilitiesByCategory(cat.id);
        const isExpanded = catIndex === 0;
        html += `
            <div class="deploy-cat-box">
                <div class="deploy-cat-header" data-action="toggle-category" data-cat-id="${cat.id}">
                    <span>${cat.name}</span>
                    <span>${isExpanded ? '-' : '+'}</span>
                </div>
                <div id="fcat-${cat.id}" style="display:${isExpanded ? 'block' : 'none'};">
                    ${facilities.length === 0 ? '<div style="padding:6px 10px;color:var(--text-dim);font-size:11px;">' + t('facility.noFacilities') + '</div>' :
                        facilities.map(fac => `
                            <button class="deploy-facility-btn" data-action="select-facility"
                                data-facility-id="${fac.id}">${renderIconHtml(fac.iconTextureKey, fac.icon)} ${fac.name}</button>
                        `).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// 切换设施分类展开/收起
function toggleFacilityCategory(catId) {
    const el = document.getElementById(`fcat-${catId}`);
    if (!el) return;
    const span = el.previousElementSibling.querySelector('span:last-child');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        span.textContent = '-';
    } else {
        el.style.display = 'none';
        span.textContent = '+';
    }
}

// 选择设施类型
function selectFacilityType(typeId) {
    const type = getFacilityType(typeId);
    if (!type) return;
    selectedFacilityTypeId = typeId;

    // 高亮选中按钮
    document.querySelectorAll('#facilityDeployCategories button[data-facility-id]').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.facilityId === typeId);
    });

    renderFacilityDeployDetail(type);
}

// 渲染设施详情
function renderFacilityDeployDetail(type) {
    const detailEl = document.getElementById('facilityDeployDetail');

    const compartments = getFacilityCompartments(type.id);
    const compartmentsHtml = compartments.length > 0
        ? compartments.map(c => `<span class="deploy-chip">${renderIconHtml('comp_' + c.id, c.icon)} ${c.name}</span>`).join('')
        : '';

    const servicesHtml = type.services.length > 0
        ? type.services.map(s => `<span class="deploy-chip-service">${getServiceName(s)}</span>`).join('')
        : '';

    detailEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            ${renderIconHtml(type.iconTextureKey, type.icon, 32)}
            <div>
                <div style="color:var(--accent);font-size:13px;font-weight:bold;">${type.name}</div>
                <div style="color:#${type.color.slice(1)};font-size:11px;">
                    ${t('facility.docksLabel')}${type.baseDocks}
                </div>
            </div>
        </div>
        <div style="color:var(--text-mid);font-size:11px;margin-bottom:10px;line-height:1.5;">
            ${type.description}
        </div>
        <div style="margin-bottom:8px;">
            <div style="color:var(--text-dim);font-size:10px;margin-bottom:3px;">${t('facility.compartmentsLabel')}</div>
            <div>${compartmentsHtml}</div>
        </div>
        <div>
            <div style="color:var(--text-dim);font-size:10px;margin-bottom:3px;">${t('facility.servicesLabel')}</div>
            <div>${servicesHtml}</div>
        </div>
    `;
}

// 设施部署 — 执行部署
function deployFacility() {
    if (!selectedFacilityTypeId) {
        window.showNotification(t('facility.deploySelectFirst'), 'warning');
        return;
    }

    eventBus.emit(Events.SHIP_COMMAND, {
        action: 'deployFacility',
        params: { typeId: selectedFacilityTypeId }
    });

    selectedFacilityTypeId = null;
    uiManager.hidePanel('facilityDeploy');
    window.showNotification(t('facility.deploying'), 'info');
}

// 打开设施部署面板
window.openFacilityDeployPanel = function() {
    renderFacilityDeployCategories();
    selectedFacilityTypeId = null;
    document.getElementById('facilityDeployDetail').innerHTML =
        '<div>' + t('facility.deployHint') + '</div>';
    // 0.3.0 多面板并存:不再关闭工具栏面板,部署/舱室/建造可同时打开
    uiManager.showPanel('facilityDeploy');
    // 0.3.0 多面板并存:与其它浮层面板同开时错位,避免完全重叠
    cascadePanelOpen(facilityDeployPanel);
};

// 设施部署面板 — 注册到 uiManager
uiManager.registerPanel('facilityDeploy', {
    show: () => {
        facilityDeployPanel.style.display = 'block';
    },
    hide: () => {
        facilityDeployPanel.style.display = 'none';
    },
    render: () => {}
});

// 设施部署面板 — 按钮事件
document.getElementById('facilityDeployCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('facilityDeploy');
});

document.getElementById('facilityDeployBuildBtn').addEventListener('click', deployFacility);
