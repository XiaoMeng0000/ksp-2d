'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { getFacilityType, getFacilityCompartments, getFacilityCategories, getFacilitiesByCategory, getServiceName } from '../facility/facilityTypes.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml } from './uiComponents.js';

// 设施部署面板 — 设施类型选择面板
const facilityDeployPanel = document.createElement('div');
facilityDeployPanel.id = 'facilityDeployPanel';
facilityDeployPanel.style.cssText = `
    display:none;position:fixed;left:70px;top:50%;transform:translateY(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:15px;width:650px;max-height:70vh;overflow:hidden;
    z-index:999;font-family:monospace;
`;
facilityDeployPanel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:15px;padding-bottom:8px;border-bottom:1px solid #444;">
        <h3 style="color:#88ccff;margin:0;font-size:14px;">部署设施</h3>
        <button id="facilityDeployCloseBtn" style="padding:4px 10px;background:#333;
            color:#aaa;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:12px;cursor:pointer;">关闭</button>
    </div>
    <div style="display:flex;height:calc(100% - 80px);gap:15px;">
        <div style="width:35%;display:flex;flex-direction:column;gap:10px;">
            <div id="facilityDeployCategories" style="flex:1;overflow-y:auto;"></div>
        </div>
        <div style="width:65%;display:flex;flex-direction:column;gap:10px;">
            <div id="facilityDeployDetail" style="background:#333;border:1px solid #555;
                border-radius:3px;padding:10px;color:#666;font-size:12px;">
                <div>选择设施查看数据</div>
            </div>
        </div>
    </div>
    <div style="position:absolute;bottom:15px;right:15px;">
        <button id="facilityDeployBuildBtn" style="padding:8px 24px;background:#333;
            color:#88ccff;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:13px;cursor:pointer;">部署</button>
    </div>
`;
document.body.appendChild(facilityDeployPanel);

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
            <div style="border:1px solid #555;border-radius:3px;overflow:hidden;">
                <div style="padding:8px;background:#333;cursor:pointer;display:flex;
                    align-items:center;justify-content:space-between;"
                    onclick="window.__toggleFacilityCategory('${cat.id}')">
                    <span style="color:#88ccff;font-size:12px;">${cat.name}</span>
                    <span style="color:#666;font-size:10px;">${isExpanded ? '-' : '+'}</span>
                </div>
                <div id="fcat-${cat.id}" style="display:${isExpanded ? 'block' : 'none'};">
                    ${facilities.length === 0 ? '<div style="padding:6px 10px;color:#666;font-size:11px;">暂无设施</div>' :
                        facilities.map(fac => `
                            <button onclick="window.__selectFacilityType('${fac.id}')"
                                style="width:100%;padding:6px 10px;background:transparent;
                                border:none;border-bottom:1px solid #444;color:#ddd;
                                font-family:monospace;font-size:12px;cursor:pointer;
                                text-align:left;"
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
        if (btn.dataset.facilityId === typeId) {
            btn.style.background = '#2a2a4a';
            btn.style.color = '#88ccff';
        } else {
            btn.style.background = 'transparent';
            btn.style.color = '#ddd';
        }
    });

    renderFacilityDeployDetail(type);
}

// 渲染设施详情
function renderFacilityDeployDetail(type) {
    const detailEl = document.getElementById('facilityDeployDetail');

    const compartments = getFacilityCompartments(type.id);
    const compartmentsHtml = compartments.length > 0
        ? compartments.map(c => `<span style="display:inline-block;margin:2px;
            padding:2px 6px;background:#222;border:1px solid #555;border-radius:3px;
            font-size:10px;color:#aaa;">${renderIconHtml('comp_' + c.id, c.icon)} ${c.name}</span>`).join('')
        : '';

    const servicesHtml = type.services.length > 0
        ? type.services.map(s => `<span style="display:inline-block;margin:2px;
            padding:2px 6px;background:#222;border:1px solid #555;border-radius:3px;
            font-size:10px;color:#88cc88;">${getServiceName(s)}</span>`).join('')
        : '';

    detailEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            ${renderIconHtml(type.iconTextureKey, type.icon, 32)}
            <div>
                <div style="color:#88ccff;font-size:13px;font-weight:bold;">${type.name}</div>
                <div style="color:#${type.color.slice(1)};font-size:11px;">
                    对接位: ${type.baseDocks}
                </div>
            </div>
        </div>
        <div style="color:#aaa;font-size:11px;margin-bottom:10px;line-height:1.5;">
            ${type.description}
        </div>
        <div style="margin-bottom:8px;">
            <div style="color:#666;font-size:10px;margin-bottom:3px;">舱室</div>
            <div>${compartmentsHtml}</div>
        </div>
        <div>
            <div style="color:#666;font-size:10px;margin-bottom:3px;">服务</div>
            <div>${servicesHtml}</div>
        </div>
    `;
}

// 设施部署 — 执行部署
function deployFacility() {
    if (!selectedFacilityTypeId) {
        window.showNotification('请先选择要部署的设施类型', 'warning');
        return;
    }

    eventBus.emit(Events.SHIP_COMMAND, {
        action: 'deployFacility',
        params: { typeId: selectedFacilityTypeId }
    });

    selectedFacilityTypeId = null;
    uiManager.hidePanel('facilityDeploy');
    window.showNotification('设施部署中...', 'info');
}

// 打开设施部署面板
window.openFacilityDeployPanel = function() {
    renderFacilityDeployCategories();
    selectedFacilityTypeId = null;
    document.getElementById('facilityDeployDetail').innerHTML =
        '<div>选择设施查看数据</div>';
    const tp = document.getElementById('toolbarPanel');
    if (tp) tp.style.display = 'none';
    uiManager.showPanel('facilityDeploy');
};

// 暴露到全局
window.__toggleFacilityCategory = toggleFacilityCategory;
window.__selectFacilityType = selectFacilityType;

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
