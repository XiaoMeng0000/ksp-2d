'use strict'

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { SHIP_TEMPLATES } from '../ship/shipTemplates.js';
import { SHIP_CATEGORIES } from '../ship/shipCategories.js';
import { getModuleDef, getModuleCategories, getModulesByCategory } from '../ship/moduleTypes.js';
import { stateToKepler } from '../physics/orbitalMechanics.js';
import { textureManager } from '../graphics/textureManager.js';
import { renderIconHtml } from './uiComponents.js';
import { sceneManager } from '../sceneManager.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

// 飞船建造UI - 飞船建造界面弹窗
const shipBuilderPanel = document.createElement('div');
shipBuilderPanel.id = 'shipBuilderPanel';
shipBuilderPanel.style.cssText = `
    display:none;position:fixed;left:70px;top:50%;transform:translateY(-50%);
    background:rgba(0,0,0,0.85);border:1px solid #555;border-radius:5px;
    padding:15px;width:650px;max-height:70vh;overflow:hidden;
    z-index:999;font-family:monospace;
`;
shipBuilderPanel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:15px;padding-bottom:8px;border-bottom:1px solid #444;">
        <h3 style="color:#88ccff;margin:0;font-size:14px;">飞船建造</h3>
        <button id="shipBuilderCloseBtn" style="padding:4px 10px;background:#333;
            color:#aaa;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:12px;cursor:pointer;">关闭</button>
    </div>
    <div style="display:flex;height:calc(100% - 80px);gap:15px;">
        <div style="width:35%;display:flex;flex-direction:column;gap:10px;">
            <div style="background:#333;border:1px solid #555;border-radius:3px;
                padding:10px;height:80px;display:flex;align-items:center;
                justify-content:center;color:#666;font-size:12px;">NO DATA</div>
            <div id="shipBuilderCategories" style="flex:1;overflow-y:auto;"></div>
        </div>
        <div style="width:65%;display:flex;flex-direction:column;gap:10px;">
            <div id="shipBuilderStats" style="background:#333;border:1px solid #555;
                border-radius:3px;padding:10px;color:#666;font-size:12px;">
                <div>选择飞船查看数据</div>
            </div>
            <div style="flex:1;background:#333;border:1px solid #555;border-radius:3px;
                padding:8px;overflow:hidden;">
                <div style="font-size:11px;color:#666;margin-bottom:5px;">模块槽</div>
                <div id="shipBuilderSlots" style="display:flex;gap:8px;overflow-x:auto;
                    padding-bottom:5px;"></div>
            </div>
        </div>
    </div>
    <div style="position:absolute;bottom:15px;right:15px;">
        <button id="shipBuilderBuildBtn" style="padding:8px 24px;background:#333;
            color:#88ccff;border:1px solid #555;border-radius:3px;font-family:monospace;
            font-size:13px;cursor:pointer;">建造！</button>
    </div>
`;
document.body.appendChild(shipBuilderPanel);

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
            <div style="border:1px solid #555;border-radius:3px;overflow:hidden;">
                <div style="padding:8px;background:#333;cursor:pointer;display:flex;
                    align-items:center;justify-content:space-between;" 
                    onclick="window.__toggleShipCategory('${cat.id}')">
                    <span style="color:#88ccff;font-size:12px;">${cat.name}</span>
                    <span style="color:#666;font-size:10px;">${isExpanded ? '-' : '+'}</span>
                </div>
                <div id="cat-${cat.id}" style="display:${isExpanded ? 'block' : 'none'};">
                    ${ships.length === 0 ? '<div style="padding:6px 10px;color:#666;font-size:11px;">暂无飞船</div>' : 
                        ships.map(ship => `
                            <button onclick="window.__selectShip('${ship.id}')" 
                                style="width:100%;padding:6px 10px;background:transparent;
                                border:none;border-bottom:1px solid #444;color:#ddd;
                                font-family:monospace;font-size:12px;cursor:pointer;
                                text-align:left;" 
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

// 建造面板 - 更新 stats 显示（含简介 + 模块加成括号）
function updateShipBuilderStats() {
    const ship = selectedShip;
    if (!ship) return;

    // 计算模块累计加成
    let totalMassBonus = 0;
    let totalMoiBonus = 0;
    const slots = selectedModules;
    if (slots) {
        slots.forEach(modId => {
            if (modId) {
                const def = getModuleDef(modId);
                if (def) {
                    totalMassBonus += def.massBonus;
                    totalMoiBonus += def.momentOfInertiaBonus;
                }
            }
        });
    }

    const hasBonus = totalMassBonus !== 0 || totalMoiBonus !== 0;

    const massStr = ship.dryMass != null
        ? ship.dryMass.toFixed(1) + ' t'
        : '-';
    const bonusMassStr = hasBonus
        ? ` <span style="color:#666;">(${totalMassBonus > 0 ? '+' : ''}${totalMassBonus.toFixed(1)} t)</span>`
        : '';

    const moiStr = ship.momentOfInertia != null
        ? ship.momentOfInertia.toFixed(0) + ' kg·m²'
        : '-';
    const bonusMoiStr = hasBonus && ship.momentOfInertia != null
        ? ` <span style="color:#666;">(${totalMoiBonus > 0 ? '+' : ''}${totalMoiBonus.toFixed(0)})</span>`
        : '';

    // 简介行（有 description 时才显示 + 分隔线）
    const descHtml = ship.description
        ? `<div style="color:#aaa;font-size:11px;margin-bottom:6px;">${ship.description}</div>
        <hr style="border:none;border-top:1px solid #444;margin:6px 0 8px 0;">`
        : '';

    const statsEl = document.getElementById('shipBuilderStats');
    statsEl.innerHTML = `
        <div style="color:#88ccff;font-weight:bold;margin-bottom:4px;font-size:13px;">${ship.name}</div>
        ${descHtml}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div><span style="color:#666;">干质量:</span> <span style="color:#fff;">${massStr}${bonusMassStr}</span></div>
            <div><span style="color:#666;">推力:</span> <span style="color:#fff;">${ship.maxThrust != null ? ship.maxThrust.toFixed(0) : '-'} N</span></div>
            <div><span style="color:#666;">ΔV:</span> <span style="color:#fff;">${ship.initialDeltaV != null ? ship.initialDeltaV.toFixed(0) : '-'} m/s</span></div>
            <div><span style="color:#666;">燃料:</span> <span style="color:#fff;">${ship.fuelCapacity != null ? ship.fuelCapacity.toFixed(0) : '-'}</span></div>
            <div><span style="color:#666;">转动惯量:</span> <span style="color:#fff;">${moiStr}${bonusMoiStr}</span></div>
            <div><span style="color:#666;">槽位:</span> <span style="color:#fff;">${ship.moduleSlots != null ? ship.moduleSlots : '-'}</span></div>
        </div>
    `;
}

// 模块系统 - 模块选择弹窗
function showModuleSelector(slotIndex, slotElement) {
    // 移除已有弹窗
    const existing = document.querySelector('.module-selector-popup');
    if (existing) existing.remove();

    const rect = slotElement.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.className = 'module-selector-popup';
    popup.style.cssText = `
        position:fixed;left:${rect.right + 8}px;top:${rect.top}px;
        background:rgba(0,0,0,0.92);border:1px solid #555;border-radius:4px;
        padding:6px 0;min-width:180px;max-height:300px;overflow-y:auto;
        z-index:10001;font-family:monospace;font-size:12px;color:#ddd;
    `;

    const currentModuleId = selectedModules[slotIndex];

    // 已安装提示
    if (currentModuleId) {
        const def = getModuleDef(currentModuleId);
        if (def) {
            const installedRow = document.createElement('div');
            installedRow.style.cssText = 'padding:4px 10px;color:#666;border-bottom:1px solid #444;margin-bottom:4px;';
            installedRow.innerHTML = `已安装: <span style="color:#88ccff;">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name}</span>`;
            popup.appendChild(installedRow);
        }
    }

    // 分类分组
    const categories = getModuleCategories();
    const allExpanded = {};

    categories.forEach((cat, catIdx) => {
        allExpanded[cat.id] = true;

        // 分类标题行
        const header = document.createElement('div');
        header.style.cssText = `
            padding:4px 10px;cursor:pointer;display:flex;
            align-items:center;justify-content:space-between;
            color:#88ccff;font-size:11px;user-select:none;
        `;
        header.innerHTML = `<span>${cat.name}</span><span style="color:#666;font-size:10px;">-</span>`;
        popup.appendChild(header);

        // 模块列表容器
        const listContainer = document.createElement('div');
        listContainer.style.display = 'block';
        popup.appendChild(listContainer);

        const modules = getModulesByCategory(cat.id);
        const toggleSpan = header.querySelector('span:last-child');

        header.addEventListener('click', () => {
            allExpanded[cat.id] = !allExpanded[cat.id];
            listContainer.style.display = allExpanded[cat.id] ? 'block' : 'none';
            toggleSpan.textContent = allExpanded[cat.id] ? '-' : '+';
        });

        modules.forEach(modDef => {
            const row = document.createElement('div');
            row.style.cssText = `
                padding:4px 10px;cursor:pointer;display:flex;
                align-items:center;gap:4px;font-size:11px;
            `;
            row.innerHTML = `${renderIconHtml(modDef.iconTextureKey, modDef.icon)} ${modDef.name} <span style="color:#666;font-size:10px;">(+${modDef.massBonus.toFixed(1)}t +${modDef.momentOfInertiaBonus.toFixed(0)}惯)</span>`;

            // Tooltip
            let tooltip = null;
            row.addEventListener('mouseenter', () => {
                tooltip = document.createElement('div');
                tooltip.className = 'module-tooltip';
                tooltip.style.cssText = `
                    position:fixed;z-index:10002;
                    background:rgba(0,0,0,0.92);border:1px solid #555;
                    border-radius:4px;padding:8px 10px;min-width:160px;
                    font-family:monospace;font-size:11px;color:#ddd;
                    pointer-events:none;
                `;
                tooltip.innerHTML = `
                    <div style="color:#88ccff;font-weight:bold;margin-bottom:4px;">${modDef.name}</div>
                    <div style="color:#aaa;margin-bottom:4px;">${modDef.description}</div>
                    <div style="color:#666;">干质量加成: +${modDef.massBonus.toFixed(1)} t</div>
                    <div style="color:#666;">转动惯量加成: +${modDef.momentOfInertiaBonus.toFixed(0)} kg·m²</div>
                `;
                document.body.appendChild(tooltip);
                const rowRect = row.getBoundingClientRect();
                tooltip.style.left = (rowRect.right + 8) + 'px';
                tooltip.style.top = rowRect.top + 'px';
            });
            row.addEventListener('mouseleave', () => {
                if (tooltip) { tooltip.remove(); tooltip = null; }
            });

            // 点击安装/替换
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedModules[slotIndex] = modDef.id;
                popup.remove();
                if (tooltip) tooltip.remove();
                renderShipBuilderSlots();
                updateShipBuilderStats();
            });

            // hover 样式
            row.addEventListener('mouseenter', () => {
                row.style.background = 'rgba(136,204,255,0.1)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = 'transparent';
            });

            listContainer.appendChild(row);
        });
    });

    // 卸载选项（仅已安装时）
    if (currentModuleId) {
        const uninstallRow = document.createElement('div');
        uninstallRow.style.cssText = `
            padding:4px 10px;color:#c44;cursor:pointer;border-top:1px solid #444;
            margin-top:4px;font-size:11px;
        `;
        uninstallRow.textContent = '卸载';
        uninstallRow.addEventListener('mouseenter', () => {
            uninstallRow.style.background = 'rgba(170,68,68,0.15)';
        });
        uninstallRow.addEventListener('mouseleave', () => {
            uninstallRow.style.background = 'transparent';
        });
        uninstallRow.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedModules[slotIndex] = null;
            popup.remove();
            renderShipBuilderSlots();
            updateShipBuilderStats();
        });
        popup.appendChild(uninstallRow);
    }

    document.body.appendChild(popup);

    // 关闭逻辑
    const closeHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== slotElement) {
            popup.remove();
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('keydown', escHandler);
        }
    };
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            popup.remove();
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('keydown', escHandler);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
        document.addEventListener('keydown', escHandler);
    }, 0);
}

// 模块系统 - 渲染模块槽（读取 selectedModules）
function renderShipBuilderSlots() {
    const slotsEl = document.getElementById('shipBuilderSlots');
    slotsEl.innerHTML = '';
    
    const slots = selectedModules;
    
    if (!slots || slots.length === 0) {
        slotsEl.innerHTML = '<div style="color:#666;font-size:11px;">暂无模块槽</div>';
        return;
    }
    
    slots.forEach((moduleTypeId, index) => {
        const slotDiv = document.createElement('div');
        slotDiv.style.cssText = `
            min-width:80px;padding:8px;background:#222;border:1px solid #555;
            border-radius:3px;text-align:center;color:#ddd;font-size:11px;
            flex-shrink:0;cursor:pointer;transition:all 0.2s ease;
        `;

        const def = moduleTypeId ? getModuleDef(moduleTypeId) : null;

        if (def) {
            slotDiv.innerHTML = `
                <div style="color:#88ccff;font-size:10px;margin-bottom:4px;">槽${index + 1}</div>
                <div style="font-size:11px;">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name}</div>
            `;
        } else {
            slotDiv.innerHTML = `
                <div style="color:#88ccff;font-size:10px;margin-bottom:4px;">槽${index + 1}</div>
                空
            `;
        }
        
        // TEMP: 飞船建造UI-占位 - 鼠标悬停样式
        slotDiv.addEventListener('mouseenter', () => {
            slotDiv.style.borderColor = '#88ccff';
            slotDiv.style.background = '#2a2a3a';
        });
        slotDiv.addEventListener('mouseleave', () => {
            slotDiv.style.borderColor = '#555';
            slotDiv.style.background = '#222';
        });
        
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
        window.showNotification('请先选择一艘飞船', 'warning');
        return;
    }

    // 获取起始天体数据
    const bodies = window.__celestialBodies || [];
    const homeworld = bodies.find(b => b.isHomeworld);
    if (!homeworld) {
        window.showNotification('找不到起始天体数据', 'error');
        return;
    }

    const defaultOrbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);

    // 弹出轨道高度输入框
    window.__createInputDialog(
        '选择轨道高度',
        '请输入绕 ' + homeworld.name + ' 的轨道半径（米）',
        String(defaultOrbitR),
        (radiusStr) => {
            const radius = parseFloat(radiusStr);
            if (isNaN(radius) || radius <= 0) {
                window.showNotification('请输入有效数字', 'error');
                return;
            }

            // 计算速度和位置（圆形轨道）
            const orbitalSpeed = Math.sqrt(homeworld.gm / radius);
            const vel = { x: 0, y: -orbitalSpeed };

            // 创建飞船实例
            const shipName = selectedShip.name + '号';
            const installedModules = selectedModules.filter(m => m !== null);
            const newShip = window.__shipSystem.createShip(selectedShip.id, shipName, installedModules);
            if (!newShip) {
                window.showNotification('飞船创建失败', 'error');
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
            window.showNotification('飞船建造完成，已发射！', 'success');
            sceneManager.switchTo('flight');
        },
        () => {
            window.showNotification('建造已取消', 'info');
        }
    );
}

// 飞船建造UI - 暴露函数到全局
window.__toggleShipCategory = toggleShipCategory;
window.__selectShip = selectShip;

// 飞船建造UI - 打开建造界面
window.openShipBuilder = function() {
    renderShipBuilderCategories();
    selectedShip = null;
    document.getElementById('shipBuilderStats').innerHTML = 
        '<div>选择飞船查看数据</div>';
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
