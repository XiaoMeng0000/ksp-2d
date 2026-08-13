'use strict'

import { eventBus, Events } from '../eventBus.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { renderIconHtml } from './uiComponents.js';
import { getFacilityType } from '../facility/facilityTypes.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { sceneManager } from '../sceneManager.js';
import { t } from '../config/strings.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

// 追踪站 - 数据格式化函数
function formatSpeed(vel) {
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (speed >= 1000) {
        return (speed / 1000).toFixed(2) + ' km/s';
    }
    return speed.toFixed(1) + ' m/s';
}

function formatDistance(m) {
    if (m >= 1000000) {
        return (m / 1000000).toFixed(2) + ' Mm';
    } else if (m >= 1000) {
        return (m / 1000).toFixed(1) + ' km';
    }
    return Math.round(m) + ' m';
}

function formatEccentricity(e) {
    if (e < 0.01) return t('tracking.eccCircular');
    if (e < 0.5) return t('tracking.eccEllipticalLow');
    if (e < 0.8) return t('tracking.eccElliptical');
    return t('tracking.eccHigh');
}

function formatTime(s) {
    if (s >= 3600) {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h + 'h ' + m + 'm';
    }
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + 'm ' + sec + 's';
}

// 说明：4 个格式化函数仅供模块内部使用，已随阶段 4 收敛（不再挂到 window）


// 追踪站 - 创建信息窗口
const trackingInfo = document.createElement('div');
trackingInfo.id = 'trackingInfo';
trackingInfo.style.display = 'none';
document.body.appendChild(trackingInfo);

window.updateTrackingInfo = function(node) {
    trackingInfo.style.display = 'block';
    let html = `<div class="tracking-name">${node.name}</div>`;
    html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0 8px 0;">';
    const typeText = {
        star: t('tracking.typeStar'),
        planet: t('tracking.typePlanet'),
        moon: t('tracking.typeMoon'),
        ship: t('tracking.typeShip'),
        facility: t('tracking.typeFacility')
    }[node.type] || t('tracking.typeUnknown');
    html += `<div>${t('tracking.typeLabel')}${typeText}</div>`;
    
    if (node.type === 'ship') {
        // 追踪站 - 用真实 ID 获取具体飞船（而非总是活动飞船）
        const ship = (window.__shipSystem && node.id) 
            ? window.__shipSystem.getShip(node.id) 
            : (_cachedShipData && _cachedShipData.exists
                ? { vel: _cachedShipData.vel, currentSOI: _cachedShipData.currentSOI,
                    fuel: _cachedShipData.fuel, dryMass: _cachedShipData.dryMass,
                    kepler: _cachedShipData.kepler, currentGM: _cachedShipData.currentGM,
                    pos: _cachedShipData.pos }
                : null);
        if (ship) {
            html += `<div>${t('tracking.speedLabel')}${formatSpeed(ship.vel)}</div>`;
            html += `<div>SOI: ${ship.currentSOI || t('tracking.deepSpace')}</div>`;
            // 追踪站 - 扩展显示燃料、质量、Δv
            const fuel = ship.fuel !== undefined ? ship.fuel : 'N/A';
            const maxFuel = ship.maxFuel !== undefined ? ship.maxFuel : 'N/A';
            html += `<div>${t('tracking.fuelLabel')}${fuel} / ${maxFuel}</div>`;
            // 使用 dryMass，单位改为 t
            const mass = ship.dryMass !== undefined ? ship.dryMass : 'N/A';
            html += `<div>${t('tracking.dryMassLabel')}${mass} t</div>`;
            // 追踪站 - 计算 Δv
            let dv = 'N/A';
            if (ship.kepler && ship.currentGM !== undefined) {
                const gm = ship.currentGM;
                const a = ship.kepler.a;
                const v = Math.sqrt(gm * (2 / Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y) - 1 / a));
                dv = formatSpeed({ x: v, y: 0 });
            }
            html += `<div>Δv: ${dv}</div>`;
            if (ship.kepler) {
                html += `<div>${t('tracking.eccLabel')}${formatEccentricity(ship.kepler.e)}</div>`;
            }

            // 模块系统 - 追踪站显示飞船模块
            const modules = ship.modules || [];
            html += '<hr style="border:none;border-top:1px solid #444;margin:8px 0;">';
            html += '<div style="color:#666;font-size:11px;margin-bottom:4px;">' + t('tracking.modules') + '</div>';
            if (modules.length === 0) {
                html += '<div style="color:#555;font-size:10px;margin-bottom:4px;">' + t('tracking.noModules') + '</div>';
            } else {
                const counts = {};
                for (const mod of modules) {
                    counts[mod.type] = (counts[mod.type] || 0) + 1;
                }
                for (const [typeId, count] of Object.entries(counts)) {
                    const def = getModuleDef(typeId);
                    if (def) {
                        html += `<div class="tracking-module-row">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name} (×${count})</div>`;
                    }
                }
            }

            // 追踪站 - 添加控制/摧毁按钮（统一带边框样式，等高等宽）
            html += `<div class="tracking-btn-row">
                <button id="trackingControlBtn" class="tracking-control-btn">${t('tracking.control')}</button>
                <button id="trackingDestroyBtn" class="tracking-destroy-btn">${t('tracking.destroy')}</button>
            </div>`;
        }
    } else if (node.type === 'facility') {
        html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0 8px 0;">';
        const typeCfg = node.facilityTypeId ? getFacilityType(node.facilityTypeId) : null;
        html += '<div>' + t('tracking.typeLabel') + (typeCfg ? typeCfg.name : t('tracking.typeFacility')) + '</div>';
        html += '<div>' + t('tracking.docksLabel') + (node.usedDocks ?? 0) + ' / ' + (node.maxDocks ?? 0) + '</div>';
        
        // 停靠飞船列表
        const fac = node.id ? facilitySystem.getFacility(node.id) : null;
        if (fac && fac.dockedShips && fac.dockedShips.length > 0) {
            html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0;">';
            html += '<div style="color:#666;font-size:11px;margin-bottom:4px;">' + t('tracking.dockedShips') + '</div>';
            for (const s of fac.dockedShips) {
                html += '<div class="tracking-module-row">' + renderIconHtml('ship_default_active', '🚀', 12) + ' ' + (s.displayName || s.id) + '</div>';
            }
        } else {
            html += '<div style="color:#555;font-size:10px;margin-top:4px;">' + t('tracking.noDockedShips') + '</div>';
        }
        
        // 设施控制 + 摧毁按钮
        html += '<div class="tracking-btn-row">' +
            '<button id="trackingControlBtn" class="tracking-control-btn">' + t('tracking.control') + '</button>' +
            '<button id="trackingDestroyBtn" class="tracking-destroy-btn">' + t('tracking.destroy') + '</button>' +
            '</div>';
    }
    
    trackingInfo.innerHTML = html;
    
    // 追踪站 - 控制按钮点击事件（飞船和设施共用）
    const controlBtn = document.getElementById('trackingControlBtn');
    if (controlBtn) {
        controlBtn.addEventListener('click', function onControlClick() {
            if (node.type === 'ship') {
                const activeShip = window.__shipSystem?.getActiveShip();
                if (node.id && node.id !== activeShip?.id && typeof window.__shipSystem !== 'undefined') {
                    window.__shipSystem.switchShip(node.id);
                }
            }
            // 设施类型：传递 ID 给飞行场景聚焦
            if (node.type === 'facility') {
                window.__pendingFacilityId = node.id;
            }
            // 切换到飞行场景（设施也走这里，飞行场景会处理聚焦）
            if (typeof sceneManager !== 'undefined') {
                sceneManager.switchTo('flight');
            }
        }, { once: true });
    }
    
    // 追踪站 - 摧毁按钮点击事件（带二次确认，防止误操作）
    const destroyBtn = document.getElementById('trackingDestroyBtn');
    if (destroyBtn) {
        destroyBtn.addEventListener('click', function onDestroyClick() {
            // 飞船最小保留检查（仅飞船类型）
            if (node.type === 'ship') {
                const allShips = window.__shipSystem?.getAllShips() || [];
                if (allShips.length <= 1) {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(t('tracking.keepAtLeastOneShip'), 'warning');
                    }
                    return;
                }
            }
            // 弹出确认对话框
            window.__createConfirmDialog(
                t('tracking.confirmDestroyTitle'),
                node.type === 'facility' ? t('tracking.confirmDestroyFacilityMsg') : t('tracking.confirmDestroyMsg'),
                () => {
                    if (typeof node.delete === 'function') {
                        node.delete();
                    }
                    window.hideTrackingInfo();
                    if (typeof window.buildTrackingTree === 'function') {
                        const newTree = window.buildTrackingTree();
                        if (typeof window.renderTrackingNav === 'function') {
                            window.renderTrackingNav(newTree);
                        }
                    }
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(node.type === 'facility' ? t('tracking.facilityDestroyed') : t('tracking.shipDestroyed'), 'info');
                    }
                },
                () => {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(t('tracking.destroyCancelled'), 'info');
                    }
                },
                t('tracking.destroy'),
                t('common.cancel')
            );
        }, { once: true });
    }
};

window.hideTrackingInfo = function() {
    trackingInfo.style.display = 'none';
};

// 追踪站 - 导航栏
const trackingNav = document.createElement('div');
trackingNav.id = 'trackingNav';
trackingNav.innerHTML = `
    <div class="tracking-nav-title">${t('tracking.bodyList')}</div>
    <div id="trackingTree"></div>
`;
document.body.appendChild(trackingNav);

// 追踪站 - 场景切换时显示/隐藏导航栏
eventBus.on(Events.SCENE_CHANGED, (data) => {
    if (data.to === 'tracking') {
        trackingNav.style.display = 'flex';
    } else {
        trackingNav.style.display = 'none';
    }
});
