'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { SHIP_TEMPLATES } from '../ship/shipTemplates.js';
import { SHIP_CATEGORIES } from '../ship/shipCategories.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { stateToKepler } from '../physics/orbitalMechanics.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml, showModuleSelectorPopup } from './uiComponents.js';
import { sceneManager } from '../sceneManager.js';
import { consumeStorage } from '../resources/cargoSystem.js';
import { t } from '../config/strings.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

// 飞船建造UI - 飞船建造界面弹窗
const shipBuilderPanel = document.createElement('div');
shipBuilderPanel.id = 'shipBuilderPanel';
shipBuilderPanel.innerHTML = `
    <div class="ui-panel-header">
        <h3 class="ui-panel-title">${t('build.title')}</h3>
        <button id="shipBuilderCloseBtn" class="ui-btn-sm">关闭</button>
    </div>
    <div class="builder-body">
        <div class="builder-left">
            <div class="builder-preview">NO DATA</div>
            <div id="shipBuilderCategories" class="builder-categories"></div>
        </div>
        <div class="builder-right">
            <div id="shipBuilderStats" class="builder-stats">
                <div>${t('build.selectHint')}</div>
            </div>
            <div class="builder-slots-box">
                <div class="builder-slots-label">${t('build.moduleSlots')}</div>
                <div id="shipBuilderSlots" class="builder-slots"></div>
            </div>
        </div>
    </div>
    <div style="position:absolute;bottom:15px;right:15px;">
        <button id="shipBuilderBuildBtn" class="ui-btn-primary">${t('build.buildBtn')}</button>
    </div>
`;
document.body.appendChild(shipBuilderPanel);

// 飞船建造 - 事件委托（避免字符串 onclick）
shipBuilderPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-category') {
        toggleShipCategory(btn.dataset.catId);
    } else if (btn.dataset.action === 'select-ship') {
        selectShip(btn.dataset.shipId);
    }
});

// 飞船系统 - 从配置文件读取飞船数据
const shipBuilderData = {
    categories: Object.values(SHIP_CATEGORIES),

    getShipsByCategory(categoryId) {
        return SHIP_TEMPLATES.filter(t => t.category === categoryId);
    },

    getShipById(shipId) {
        return SHIP_TEMPLATES.find(t => t.id === shipId) || null;
    },

    getSlots(shipId) {
        const template = this.getShipById(shipId);
        if (!template) return [];
        return new Array(template.moduleSlots).fill(null);
    }
};

// 飞船建造UI - 当前选中的飞船
let selectedShip = null;

// 模块系统 - 建造时选择的模块（索引对应槽位，值为 moduleTypeId 或 null）
let selectedModules = [];

// 模块系统 - 暴露 selectedModules 到全局供阶段2调试
if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__selectedModules', {
        get() { return selectedModules; },
        set(v) {
            selectedModules = v;
            if (selectedShip) {
                renderShipBuilderSlots();
                updateShipBuilderStats();
            }
        }
    });
}

// TEMP: 飞船建造UI-占位 - 渲染分类列表（使用占位接口）
function renderShipBuilderCategories() {
    const container = document.getElementById('shipBuilderCategories');
    let html = '';
    
    shipBuilderData.categories.forEach((cat, catIndex) => {
        // TEMP: 飞船建造UI-占位 - 使用 getShipsByCategory 接口获取飞船列表
        const ships = shipBuilderData.getShipsByCategory(cat.id);
        const isExpanded = catIndex === 0;
        html += `
            <div class="builder-cat-box">
                <div class="builder-cat-header" 
                    data-action="toggle-category" data-cat-id="${cat.id}">
                    <span>${cat.name}</span>
                    <span>${isExpanded ? '-' : '+'}</span>
                </div>
                <div id="cat-${cat.id}" style="display:${isExpanded ? 'block' : 'none'};">
                    ${ships.length === 0 ? '<div style="padding:6px 10px;color:var(--text-dim);font-size:11px;">' + t('build.noShips') + '</div>' : 
                        ships.map(ship => `
                            <button data-action="select-ship" 
                                class="builder-ship-btn" 
                                data-ship-id="${ship.id}">${ship.name}</button>
                        `).join('')}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 飞船建造UI - 切换分类展开/收起
function toggleShipCategory(catId) {
    const el = document.getElementById(`cat-${catId}`);
    const span = el.previousElementSibling.querySelector('span:last-child');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        span.textContent = '-';
    } else {
        el.style.display = 'none';
        span.textContent = '+';
    }
}

// TEMP: 飞船建造UI-占位 - 选择飞船（使用占位接口）
function selectShip(shipId) {
    const ship = shipBuilderData.getShipById(shipId);
    if (!ship) return;
    selectedShip = ship;
    selectedModules = new Array(ship.moduleSlots).fill(null);
    updateShipBuilderStats();
    renderShipBuilderSlots();
}

// 建造面板 - 计算模板燃料总容量（0.2.0：模板燃料改为 fuelTanks，兼容旧 fuelCapacity）
function getTemplateFuelTotal(ship) {
    if (!ship) return 0;
    if (ship.fuelTanks) {
        return Object.values(ship.fuelTanks).reduce((sum, cap) => sum + (cap || 0), 0);
    }
    return ship.fuelCapacity ?? 0;
}

// 建造面板 - 满燃料 ΔV（KSP 式火箭方程），含已选模块的干质量加成
function computeTemplateDeltaV(ship, massBonus) {
    if (!ship || !ship.isp) return 0;
    const g0 = 9.81;
    const dryMass = (ship.dryMass || 0) + (massBonus || 0);
    const totalMass = dryMass + getTemplateFuelTotal(ship);
    if (dryMass <= 0 || totalMass <= dryMass) return 0;
    return ship.isp * g0 * Math.log(totalMass / dryMass);
}

// 建造面板 - 更新 stats 显示（含简介 + 模块加成括号）
function updateShipBuilderStats() {
    const ship = selectedShip;
    if (!ship) return;

    // 计算模块累计加成
    let totalMassBonus = 0;
    let totalMoiBonus = 0;
    let totalModuleCost = 0;
    const slots = selectedModules;
    if (slots) {
        slots.forEach(modId => {
            if (modId) {
                const def = getModuleDef(modId);
                if (def) {
                    totalMassBonus += def.massBonus;
                    totalMoiBonus += def.momentOfInertiaBonus;
                    totalModuleCost += (def.price || 0);
                }
            }
        });
    }

    const hasBonus = totalMassBonus !== 0 || totalMoiBonus !== 0;

    const massStr = ship.dryMass != null
        ? ship.dryMass.toFixed(1) + ' t'
        : '-';
    const bonusMassStr = hasBonus
        ? ` <span style="color:var(--text-dim);">(${totalMassBonus > 0 ? '+' : ''}${totalMassBonus.toFixed(1)} t)</span>`
        : '';

    const moiStr = ship.momentOfInertia != null
        ? ship.momentOfInertia.toFixed(0) + ' kg·m²'
        : '-';
    const bonusMoiStr = hasBonus && ship.momentOfInertia != null
        ? ` <span style="color:var(--text-dim);">(${totalMoiBonus > 0 ? '+' : ''}${totalMoiBonus.toFixed(0)})</span>`
        : '';

    // 简介行（有 description 时才显示 + 分隔线）
    const descHtml = ship.description
        ? `<div style="color:var(--text-mid);font-size:11px;margin-bottom:6px;">${ship.description}</div>
        <hr style="border:none;border-top:1px solid var(--theme-border-row);margin:6px 0 8px 0;">`
        : '';

    const statsEl = document.getElementById('shipBuilderStats');
    const totalCost = (ship.cost || 0) + totalModuleCost;
    statsEl.innerHTML = `
        <div style="color:var(--accent);font-weight:bold;margin-bottom:4px;font-size:13px;">${ship.name}</div>
        ${descHtml}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div><span style="color:var(--text-dim);">${t('build.dryMass')}</span> <span style="color:var(--text-bright);">${massStr}${bonusMassStr}</span></div>
            <div><span style="color:var(--text-dim);">${t('build.thrust')}</span> <span style="color:var(--text-bright);">${ship.maxThrust != null ? ship.maxThrust.toFixed(0) : '-'} N</span></div>
            <div><span style="color:var(--text-dim);">${t('build.dv')}</span> <span style="color:var(--text-bright);">${computeTemplateDeltaV(ship, totalMassBonus).toFixed(0)} m/s</span></div>
            <div><span style="color:var(--text-dim);">${t('build.fuel')}</span> <span style="color:var(--text-bright);">${getTemplateFuelTotal(ship).toFixed(0)}</span></div>
            <div><span style="color:var(--text-dim);">${t('build.moi')}</span> <span style="color:var(--text-bright);">${moiStr}${bonusMoiStr}</span></div>
            <div><span style="color:var(--text-dim);">${t('build.slots')}</span> <span style="color:var(--text-bright);">${ship.moduleSlots != null ? ship.moduleSlots : '-'}</span></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#cc8;">${t('economy.buildCost', { cost: totalCost })}${totalModuleCost > 0 ? t('build.costIncludesModules', { cost: totalModuleCost }) : ''}</div>
    `;
}

// 模块系统 - 模块选择弹窗（0.2.7 统一走共享组件 showModuleSelectorPopup）
function showModuleSelector(slotIndex, slotElement) {
    showModuleSelectorPopup({
        anchorEl: slotElement,
        onSelect: (modDef) => {
            selectedModules[slotIndex] = modDef.id;
            renderShipBuilderSlots();
            updateShipBuilderStats();
        },
        onUninstall: () => {
            selectedModules[slotIndex] = null;
            renderShipBuilderSlots();
            updateShipBuilderStats();
        },
        installedModuleId: selectedModules[slotIndex],
        showBonuses: true,
        showTooltip: true
    });
}

// 模块系统 - 渲染模块槽（读取 selectedModules）
function renderShipBuilderSlots() {
    const slotsEl = document.getElementById('shipBuilderSlots');
    slotsEl.innerHTML = '';
    
    const slots = selectedModules;
    
    if (!slots || slots.length === 0) {
        slotsEl.innerHTML = '<div style="color:var(--text-dim);font-size:11px;">' + t('build.noSlots') + '</div>';
        return;
    }
    
    slots.forEach((moduleTypeId, index) => {
        const slotDiv = document.createElement('div');
        slotDiv.className = 'builder-slot';

        const def = moduleTypeId ? getModuleDef(moduleTypeId) : null;

        if (def) {
            slotDiv.innerHTML = `
                <div class="builder-slot-label">${t('build.slotIndex', { i: index + 1 })}</div>
                <div style="font-size:11px;">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name}</div>
            `;
        } else {
            slotDiv.innerHTML = `
                <div class="builder-slot-label">${t('build.slotIndex', { i: index + 1 })}</div>
                ${t('build.slotEmpty')}
            `;
        }
        
        // 模块系统 - 点击打开模块选择弹窗
        slotDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            showModuleSelector(index, slotDiv);
        });
        
        slotsEl.appendChild(slotDiv);
    });
}

// 飞船建造UI - 建造按钮（完整闭环）
function buildShip() {
    if (!selectedShip) {
        window.showNotification(t('build.selectShipFirst'), 'warning');
        return;
    }

    // 获取起始天体数据
    const bodies = window.__celestialBodies || [];
    const homeworld = bodies.find(b => b.isHomeworld);
    if (!homeworld) {
        window.showNotification(t('build.noHomeBody'), 'error');
        return;
    }

    const defaultOrbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);

    // 弹出轨道高度输入框
    window.__createInputDialog(
        t('build.chooseAltitude'),
        t('build.altitudePrompt', { name: homeworld.name }),
        String(defaultOrbitR),
        (radiusStr) => {
            const radius = parseFloat(radiusStr);
            if (isNaN(radius) || radius <= 0) {
                window.showNotification(t('build.invalidNumber'), 'error');
                return;
            }

            // 计算速度和位置（圆形轨道）
            const orbitalSpeed = Math.sqrt(homeworld.gm / radius);
            // 顺行（逆时针，与天体公转同向）：pos 在 +x 时速度应沿 +y
            const vel = { x: 0, y: orbitalSpeed };

            // 创建飞船实例
            const shipName = t('build.shipNameSuffix', { name: selectedShip.name });
            const installedModules = selectedModules.filter(m => m !== null);
            // 0.2.0 阶段5：建造扣费从当前设施存储扣（全局资源已退场，只留科技点）
            const moduleCost = installedModules.reduce((sum, id) => {
                const def = getModuleDef(id);
                return sum + ((def && def.price) || 0);
            }, 0);
            const totalCost = (selectedShip.cost || 0) + moduleCost;
            const facility = window.__getControlledFacility ? window.__getControlledFacility() : null;
            if (!facility) {
                window.showNotification(t('build.noFacility'), 'error');
                return;
            }
            if (!consumeStorage(facility, 'materialKits', totalCost)) {
                window.showNotification(t('economy.insufficientKits'), 'error');
                return;
            }

            const newShip = window.__shipSystem.createShip(selectedShip.id, shipName, installedModules);
            if (!newShip) {
                window.showNotification(t('build.createFailed'), 'error');
                return;
            }

            // 设置初始轨道状态（pos 为相对宿主坐标）
            newShip.pos = { x: radius, y: 0 };
            newShip.vel = { x: vel.x, y: vel.y };
            newShip.currentSOI = homeworld.name;
            newShip.currentGM = homeworld.gm;
            newShip.kepler = stateToKepler(newShip.pos, vel, homeworld.gm);
            newShip.orbitTime = 0;
            newShip.mode = 'on_rails';

            // 持久化并切换活动飞船
            window.__shipSystem.persistShip(newShip);
            window.__shipSystem.switchShip(newShip.id);

            // 模块系统 - 建造完成后重置模块选择
            selectedModules = [];

            // 关闭建造面板，切换到飞行场景
            uiManager.hidePanel('shipBuilder');
            window.showNotification(t('build.launched'), 'success');
            sceneManager.switchTo('flight');
        },
        () => {
            window.showNotification(t('build.cancelled'), 'info');
        }
    );
}

// 飞船建造UI - 打开建造界面
window.openShipBuilder = function() {
    renderShipBuilderCategories();
    selectedShip = null;
    document.getElementById('shipBuilderStats').innerHTML = 
        '<div>' + t('build.selectHint') + '</div>';
    document.getElementById('shipBuilderSlots').innerHTML = '';
    // 关闭 toolbarPanel（与 shipBuilderPanel 互斥）
    const tp = document.getElementById('toolbarPanel');
    if (tp) tp.style.display = 'none';
    uiManager.showPanel('shipBuilder');
};

// 飞船建造UI - 注册到 uiManager
uiManager.registerPanel('shipBuilder', {
    show: () => {
        shipBuilderPanel.style.display = 'block';
    },
    hide: () => {
        shipBuilderPanel.style.display = 'none';
    },
    render: () => {}
});

// 飞船建造UI - 按钮事件
document.getElementById('shipBuilderCloseBtn').addEventListener('click', () => {
    uiManager.hidePanel('shipBuilder');
});

document.getElementById('shipBuilderBuildBtn').addEventListener('click', buildShip);
