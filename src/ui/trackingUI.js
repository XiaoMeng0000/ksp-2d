'use strict'

import { eventBus, Events } from '../eventBus.js';
import { gameState } from '../gameState.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { renderIconHtml } from './uiComponents.js';
import { getFacilityType } from '../facility/facilityTypes.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { sceneManager } from '../sceneManager.js';
import { computeDeltaV, getTotalMass } from '../resources/resourceSystem.js';
import { getVisibleBodyResources } from '../resources/scanSystem.js';
import { getResourceType } from '../resources/resourceTypes.js';
import { isScansEnabled } from '../resources/modeRules.js';
import { t } from '../config/strings.js';
import { celestialBodies } from '../physics/physics.js';
import { ENCYCLOPEDIA } from '../config/encyclopediaConfig.js';
import { focusTrackingNode, setTrackingNavTab } from '../scenes/trackingScene.js';

// EventBus 迁移 — 缓存最近一帧的飞船渲染数据，供 UI 只读函数使用
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
});

// 信息面板当前节点与分组折叠状态（key = nodeId::sectionId，仅内存不持久化）
let _currentNode = null;
const collapsedSections = {};

// 物理常量（质量科学计数与密度计算用）
const GRAV_CONST = 6.674e-11;      // 万有引力常数 m³/(kg·s²)
const GAME_DAY_SECONDS = 21600;    // 游戏日 = 6 小时（与 scanSystem 约定一致）

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

// 追踪站 0.2.5 - 周期格式化（游戏日 6h，跨日显示 Xd Yh）
function formatPeriod(s) {
    if (s >= GAME_DAY_SECONDS) {
        const d = Math.floor(s / GAME_DAY_SECONDS);
        const h = Math.round((s % GAME_DAY_SECONDS) / 3600);
        return h > 0 ? d + 'd ' + h + 'h' : d + 'd';
    }
    return formatTime(s);
}

// 追踪站 0.2.5 - 质量科学计数（kg → 5.29 × 10^22 kg）
function formatMassSci(kg) {
    if (kg <= 0) return 'N/A';
    const exp = Math.floor(Math.log10(kg));
    const mant = (kg / Math.pow(10, exp)).toFixed(2);
    return `${mant} × 10<sup>${exp}</sup> kg`;
}

// 追踪站 0.2.5 - 百科"天体档案"按天体名查询介绍文本
function getSynopsis(bodyName) {
    const cat = ENCYCLOPEDIA.find(c => c.category === '天体档案');
    if (!cat) return null;
    const entry = cat.entries.find(e => e.title === bodyName);
    return entry ? entry.content : null;
}

// 追踪站 - 渲染辅助：两列 key-value 数据网格
function renderDataGrid(items) {
    let html = '<div class="tracking-grid">';
    for (const item of items) {
        html += `<div class="tracking-data-item">` +
            `<div class="tracking-data-label">${item.label}</div>` +
            `<div class="tracking-data-value">${item.value}</div>` +
            `</div>`;
    }
    html += '</div>';
    return html;
}

// 追踪站 - 渲染辅助：可折叠分组 Section
function renderSection(sectionId, title, contentHtml) {
    const collapsed = !!collapsedSections[`${_currentNode.id}::${sectionId}`];
    const toggleChar = collapsed ? '▶' : '▼';
    return `<div class="tracking-section">` +
        `<div class="tracking-section-header" data-action="toggle-section" data-section="${sectionId}">` +
        `<span class="tracking-section-toggle">${toggleChar}</span><span>${title}</span>` +
        `</div>` +
        (collapsed ? '' : `<div class="tracking-section-content">${contentHtml}</div>`) +
        `</div>`;
}

// 追踪站 - 类型小标签映射
function getTypeTag(type) {
    return {
        star: t('tracking.typeTagStar'),
        planet: t('tracking.typeTagPlanet'),
        moon: t('tracking.typeTagMoon'),
        ship: t('tracking.typeTagShip'),
        facility: t('tracking.typeTagFacility')
    }[type] || t('tracking.typeTagUnknown');
}

// 追踪站 - 创建信息窗口
const trackingInfo = document.createElement('div');
trackingInfo.id = 'trackingInfo';
trackingInfo.style.display = 'none';
document.body.appendChild(trackingInfo);

// 追踪站 - 内部渲染（节点点击 / 分组折叠时重绘）
function renderInfo(node) {
    let html = `<div class="tracking-name">${node.name}</div>`;
    html += `<div class="tracking-type-tag">${getTypeTag(node.type)}</div>`;

    if (node.type === 'ship') {
        html += renderShipSections(node);
    } else if (node.type === 'facility') {
        html += renderFacilitySections(node);
    } else if (node.type === 'star' || node.type === 'planet' || node.type === 'moon') {
        html += renderBodySections(node);
    }

    trackingInfo.innerHTML = html;
}

// 追踪站 - 飞船分组（飞行状态 / 模块）
function renderShipSections(node) {
    // 追踪站 - 用真实 ID 获取具体飞船（而非总是活动飞船）
    const ship = (window.__shipSystem && node.id)
        ? window.__shipSystem.getShip(node.id)
        : (_cachedShipData && _cachedShipData.exists
            ? { vel: _cachedShipData.vel, currentSOI: _cachedShipData.currentSOI,
                dryMass: _cachedShipData.dryMass, isp: _cachedShipData.isp,
                resources: _cachedShipData.resources,
                kepler: _cachedShipData.kepler, currentGM: _cachedShipData.currentGM,
                pos: _cachedShipData.pos }
            : null);
    if (!ship) return '';

    // 高度：ship.pos 为相对 SOI 宿主坐标，减去宿主半径得轨道高度
    let altitude = 'N/A';
    const host = ship.currentSOI
        ? celestialBodies.find(b => b.name === ship.currentSOI)
        : null;
    if (host && ship.pos) {
        const dist = Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y);
        altitude = formatDistance(Math.max(dist - host.radius, 0));
    }

    // 剩余 ΔV（KSP 式：从当前燃料烧到耗尽）
    const dv = computeDeltaV(ship);
    const totalMass = getTotalMass(ship);

    // 飞行状态分组（两列网格）
    const flightGrid = renderDataGrid([
        { label: t('tracking.trajType'), value: ship.kepler ? formatEccentricity(ship.kepler.e) : 'N/A' },
        { label: t('tracking.altitude'), value: altitude },
        { label: t('tracking.velocity'), value: formatSpeed(ship.vel) },
        { label: t('tracking.deltaV'), value: dv > 0 ? formatSpeed({ x: dv, y: 0 }) : 'N/A' },
        { label: t('tracking.soiLabel'), value: ship.currentSOI || t('tracking.deepSpace') },
        { label: t('tracking.eccValue'), value: ship.kepler ? ship.kepler.e.toFixed(3) : 'N/A' },
        { label: t('tracking.dryMassShort'), value: (ship.dryMass ?? 'N/A') + ' t' },
        { label: t('tracking.totalMass'), value: totalMass > 0 ? totalMass.toFixed(2) + ' t' : 'N/A' }
    ]);

    // 模块分组
    const modules = ship.modules || [];
    let moduleHtml = '';
    if (modules.length === 0) {
        moduleHtml = `<div class="tracking-list-empty">${t('tracking.noModules')}</div>`;
    } else {
        const counts = {};
        for (const mod of modules) {
            counts[mod.type] = (counts[mod.type] || 0) + 1;
        }
        for (const [typeId, count] of Object.entries(counts)) {
            const def = getModuleDef(typeId);
            if (def) {
                moduleHtml += `<div class="tracking-module-row">${renderIconHtml(def.iconTextureKey, def.icon)} ${def.name} ×${count}</div>`;
            }
        }
    }

    // 操作按钮：聚焦 / 控制 / 摧毁
    const btns = `<div class="tracking-btn-grid">` +
        `<button class="tracking-control-btn" data-action="focus-node">${t('tracking.focus')}</button>` +
        `<button class="tracking-control-btn" data-action="control-node">${t('tracking.control')}</button>` +
        `<button class="tracking-destroy-btn" data-action="destroy-node">${t('tracking.destroy')}</button>` +
        `</div>`;

    return btns + renderSection('flight', t('tracking.secFlight'), flightGrid)
        + renderSection('modules', t('tracking.secModules'), moduleHtml);
}

// 追踪站 - 设施分组（设施信息 / 停靠飞船）
function renderFacilitySections(node) {
    const typeCfg = node.facilityTypeId ? getFacilityType(node.facilityTypeId) : null;

    const infoGrid = renderDataGrid([
        { label: t('tracking.typeShort'), value: typeCfg ? typeCfg.name : t('tracking.typeFacility') },
        { label: t('tracking.docksShort'), value: (node.usedDocks ?? 0) + ' / ' + (node.maxDocks ?? 0) }
    ]);

    // 停靠飞船列表
    const fac = node.id ? facilitySystem.getFacility(node.id) : null;
    let dockHtml = '';
    if (fac && fac.dockedShips && fac.dockedShips.length > 0) {
        for (const s of fac.dockedShips) {
            dockHtml += `<div class="tracking-module-row">${renderIconHtml('ship_default_active', '◈', 12)} ${s.displayName || s.id}</div>`;
        }
    } else {
        dockHtml = `<div class="tracking-list-empty">${t('tracking.noDockedShips')}</div>`;
    }

    // 操作按钮：聚焦 / 控制 / 摧毁
    const btns = `<div class="tracking-btn-grid">` +
        `<button class="tracking-control-btn" data-action="focus-node">${t('tracking.focus')}</button>` +
        `<button class="tracking-control-btn" data-action="control-node">${t('tracking.control')}</button>` +
        `<button class="tracking-destroy-btn" data-action="destroy-node">${t('tracking.destroy')}</button>` +
        `</div>`;

    return btns + renderSection('facility', t('tracking.secFacility'), infoGrid)
        + renderSection('docked', t('tracking.secDockedShips'), dockHtml);
}

// 追踪站 - 天体分组（档案 / 轨道参数 / 物理特性 / 资源丰度）
function renderBodySections(node) {
    const body = celestialBodies.find(b => b.name === node.name);
    if (!body) return '';

    let html = '';

    // 操作按钮：聚焦
    html += `<div class="tracking-btn-grid">` +
        `<button class="tracking-control-btn" data-action="focus-node">${t('tracking.focus')}</button>` +
        `</div>`;

    // 天体档案（百科"天体档案"栏目现成介绍文本）
    const synopsis = getSynopsis(body.name);
    const synopsisHtml = synopsis
        ? `<div class="tracking-synopsis">${synopsis}</div>`
        : `<div class="tracking-synopsis-empty">${t('tracking.noSynopsis')}</div>`;
    html += renderSection('synopsis', t('tracking.secSynopsis'), synopsisHtml);

    // 轨道参数（恒星无环绕天体，跳过）
    if (body.orbitParent && body.orbitA > 0) {
        const parent = celestialBodies.find(b => b.name === body.orbitParent);
        let period = 'N/A';
        let avgVel = 'N/A';
        if (parent && parent.gm > 0) {
            period = formatPeriod(2 * Math.PI * Math.sqrt(Math.pow(body.orbitA, 3) / parent.gm));
            avgVel = formatSpeed({ x: 2 * Math.PI * body.orbitA / (2 * Math.PI * Math.sqrt(Math.pow(body.orbitA, 3) / parent.gm)), y: 0 });
        }
        const orbitGrid = renderDataGrid([
            { label: t('tracking.parentBody'), value: body.orbitParent },
            { label: t('tracking.semimajorAxis'), value: formatDistance(body.orbitA) },
            { label: t('tracking.eccValue'), value: body.orbitE.toFixed(3) },
            { label: t('tracking.orbitPeriod'), value: period },
            { label: t('tracking.orbitVelocity'), value: avgVel },
            { label: t('tracking.argPeriapsis'), value: Math.round(body.orbitOmega * 180 / Math.PI) + '°' }
        ]);
        html += renderSection('orbit', t('tracking.secOrbit'), orbitGrid);
    }

    // 物理特性
    const massKg = body.gm / GRAV_CONST;
    const gravity = body.radius > 0 ? body.gm / (body.radius * body.radius) : 0;
    const density = body.radius > 0 ? massKg / ((4 / 3) * Math.PI * Math.pow(body.radius, 3)) / 1000 : 0;
    const physicalGrid = renderDataGrid([
        { label: t('tracking.gravity'), value: gravity.toFixed(2) + ' m/s²' },
        { label: t('tracking.bodyRadius'), value: formatDistance(body.radius) },
        { label: t('tracking.circumference'), value: formatDistance(2 * Math.PI * body.radius) },
        { label: t('tracking.soiRadius'), value: formatDistance(body.soiRadius) },
        { label: t('tracking.bodyMass'), value: formatMassSci(massKg) },
        { label: t('tracking.density'), value: density > 0 ? density.toFixed(2) + ' g/cm³' : 'N/A' },
        { label: t('tracking.atmosphere'), value: body.hasAtmosphere ? t('tracking.atmHeight', { h: formatDistance(body.atmosphereHeight) }) : t('tracking.atmNone') }
    ]);
    html += renderSection('physical', t('tracking.secPhysical'), physicalGrid);

    // 资源丰度（sandbox 直接可见；career 按扫描等级过滤）
    const visible = getVisibleBodyResources(node.name);
    let resHtml = '';
    const entries = Object.entries(visible);
    if (entries.length === 0) {
        resHtml = `<div class="tracking-list-empty">${t('tracking.noResources')}</div>`;
    } else {
        for (const [resId, info] of entries) {
            const def = getResourceType(resId);
            const name = def ? def.name : resId;
            const pct = Math.round((info.abundance ?? 0) * 100);
            resHtml += `<div class="tracking-res-row">` +
                `<span class="tracking-res-name">${name}</span>` +
                `<span class="tracking-res-bar"><span class="tracking-res-fill" style="width:${pct}%"></span></span>` +
                `<span class="tracking-res-pct">${pct}%</span>` +
                `</div>`;
        }
    }
    html += renderSection('resources', t('tracking.secResources'), resHtml);

    // career 模式显示扫描状态注脚
    if (!isScansEnabled()) {
        const scanned = gameState.getState().player.scannedBodies?.[node.name]?.tiersScanned || 0;
        html += `<div class="tracking-scan-note">${t('tracking.scanStatus', { tier: scanned })}</div>`;
    }

    return html;
}

// 追踪站 - 信息面板事件委托（toggle-section / focus / control / destroy）
trackingInfo.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || !_currentNode) return;
    const node = _currentNode;

    switch (target.dataset.action) {
        case 'toggle-section': {
            const key = `${node.id}::${target.dataset.section}`;
            collapsedSections[key] = !collapsedSections[key];
            renderInfo(node);
            break;
        }
        case 'focus-node': {
            focusTrackingNode(node);
            break;
        }
        case 'control-node': {
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
            break;
        }
        case 'destroy-node': {
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
            break;
        }
    }
});

window.updateTrackingInfo = function(node) {
    _currentNode = node;
    trackingInfo.style.display = 'block';
    renderInfo(node);
};

window.hideTrackingInfo = function() {
    _currentNode = null;
    trackingInfo.style.display = 'none';
};

// 追踪站 - 导航栏（标题 + 顶部横向分类 Tab + 树容器）
const trackingNav = document.createElement('div');
trackingNav.id = 'trackingNav';
trackingNav.innerHTML = `
    <div class="tracking-nav-title">${t('tracking.stationName')}</div>
    <div class="tracking-tabs">
        <button class="tracking-tab tracking-tab-active" data-nav-tab="all">${t('tracking.tabAll')}</button>
        <button class="tracking-tab" data-nav-tab="vessels">${t('tracking.tabVessels')}</button>
    </div>
    <div id="trackingTree"></div>
`;
document.body.appendChild(trackingNav);

// 追踪站 - 导航栏 Tab 切换（事件委托；激活态按钮由本模块同步）
trackingNav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav-tab]');
    if (!btn) return;
    setTrackingNavTab(btn.dataset.navTab);
    trackingNav.querySelectorAll('[data-nav-tab]').forEach(b => {
        b.classList.toggle('tracking-tab-active', b === btn);
    });
});

// 追踪站 - 场景切换时显示/隐藏导航栏
eventBus.on(Events.SCENE_CHANGED, (data) => {
    if (data.to === 'tracking') {
        trackingNav.style.display = 'flex';
    } else {
        trackingNav.style.display = 'none';
    }
});
