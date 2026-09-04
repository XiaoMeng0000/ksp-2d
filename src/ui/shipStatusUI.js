'use strict';

// 飞行状态 HUD（0.3.0）— 屏幕右下角两卡
//   燃料卡（上）：活动飞船全部推进剂槽余量（绿条 + 吨数），可展开显示
//                推重比（宿主天体表面重力口径）/ 燃烧时间（满推力）/ 初始质量
//   总 ΔV 卡（下，贴底）：绿底黑字大数字；燃料耗尽/engineOut 时整体切红
// 数据源：RENDER_DATA 每帧广播（节流 200ms 写 DOM）+ 活动飞船引用算总质量/ΔV
// 布局与样式：flight.css（#shipStatusPanel / .ss-*）

import { eventBus, Events } from '../eventBus.js';
import { t } from '../config/strings.js';
import { getTotalMass, computeDeltaV, G0 } from '../resources/resourceSystem.js';
import { getResourceType } from '../resources/resourceTypes.js';
import { celestialBodies } from '../physics/physics.js';

// DOM 写入节流间隔（ms）— 燃烧/时间加速下数字跟手即可
const UPDATE_MIN_INTERVAL = 200;

const container = document.createElement('div');
container.id = 'shipStatusPanel';
container.style.display = 'none';
document.body.appendChild(container);

// 燃料卡（静态骨架 + 每节流周期更新内部两个子区）
const fuelCard = document.createElement('div');
fuelCard.className = 'ss-card ss-fuel-card';
fuelCard.innerHTML =
    '<button class="ss-expand-btn" data-action="toggle-expand" title="' + t('hud.expandHint') + '">▼</button>' +
    '<div class="ss-fuel-card-body">' +
    '<div class="ss-details"></div>' +
    '<div class="ss-fuel-rows"></div>' +
    // 0.3.0 打磨：样板右端引擎图标（原图未画，emoji 灰化占位）
    '<div class="ss-engine-icon">🚀</div>' +
    '</div>';

// 总 ΔV 卡（静态骨架）
const dvCard = document.createElement('div');
dvCard.className = 'ss-card ss-dv-card';
dvCard.innerHTML =
    '<div class="ss-dv-label">' + t('hud.dvLabel') + '</div>' +
    '<div class="ss-dv-value">0 m/s</div>';

container.appendChild(fuelCard);
container.appendChild(dvCard);

let _expanded = false;
let _lastUpdate = 0;

// 展开/收起（折叠仅隐藏附加信息列，燃料行常显）
fuelCard.querySelector('[data-action="toggle-expand"]').addEventListener('click', () => {
    _expanded = !_expanded;
    fuelCard.classList.toggle('expanded', _expanded);
});

// 千克 → 吨（样板单位口径，两位小数）
function fmtTons(kg) {
    if (kg === null || kg === undefined || !isFinite(kg)) return '--';
    return (kg / 1000).toFixed(2) + ' t';
}

// 燃烧时间格式化："1m:24s"
function fmtBurnTime(sec) {
    if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return '--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + 'm:' + String(s).padStart(2, '0') + 's';
}

// 渲染燃料卡行（遍历全部推进剂槽，混合燃料天然支持）
// 条内文字统一黑色：满油黑字在绿块上、低油/0 量黑字在灰白空槽上（打磨 v11，无切白切换）
function renderFuelRows(ship) {
    let html = '';
    if (ship && ship.resources) {
        for (const [resId, slot] of Object.entries(ship.resources)) {
            if (!slot || typeof slot.capacity !== 'number') continue;
            const amount = slot.amount || 0;
            const capacity = slot.capacity || 0;
            const pct = capacity > 0 ? Math.min(100, Math.max(0, amount / capacity * 100)) : 0;
            if (_expanded) {
                // 展开态：纯条（参考图：条内无数据）
                html += '<div class="ss-fuel-row"><span class="ss-fuel-fill" style="width:' + pct + '%;"></span></div>';
                continue;
            }
            const def = getResourceType(resId);
            const name = def ? def.name : resId;
            html += '<div class="ss-fuel-row">' +
                '<span class="ss-fuel-fill" style="width:' + pct + '%;"></span>' +
                '<span class="ss-fuel-name">' + name + '</span>' +
                '<span class="ss-fuel-val">' + fmtTons(amount) + ' / ' + fmtTons(capacity) + '</span>' +
                '</div>';
        }
    }
    fuelCard.querySelector('.ss-fuel-rows').innerHTML = html;
}

// 渲染展开附加列（推重比 / 燃烧时间；0.3.0 打磨：初始质量已删，燃料余量展开态隐藏）
function renderDetails(ship) {
    let html = '';
    if (ship) {
        const totalMass = getTotalMass(ship);

        // 推重比 = 满推力 / (总质量 × 宿主天体表面重力)；无宿主或异常显示 --
        let twr = '--';
        const host = ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
        if (host && host.radius > 0) {
            const g = host.gm / (host.radius * host.radius);
            if (g > 0 && totalMass > 0) {
                twr = (ship.maxThrust / (totalMass * g)).toFixed(2);
            }
        }

        // 燃烧时间 = 全部推进剂存量 / 满推力质量流量
        let burnTime = '--';
        if (ship.maxThrust > 0 && ship.isp > 0) {
            let fuelMass = 0;
            if (ship.resources) {
                for (const slot of Object.values(ship.resources)) {
                    if (slot && typeof slot.amount === 'number') fuelMass += slot.amount;
                }
            }
            const massFlow = ship.maxThrust / (ship.isp * G0);
            if (massFlow > 0) burnTime = fmtBurnTime(fuelMass / massFlow);
        }

        html = '<div class="ss-detail-row"><span class="ss-detail-label">' + t('hud.twr') + '</span>' +
            '<span class="ss-detail-val">' + twr + '</span></div>' +
            '<div class="ss-detail-row"><span class="ss-detail-label">' + t('hud.burnTime') + '</span>' +
            '<span class="ss-detail-val">' + burnTime + '</span></div>';
    }
    fuelCard.querySelector('.ss-details').innerHTML = html;
}

// 渲染总 ΔV 卡（归零/engineOut 整体切红）
function renderDeltaVCard(ship) {
    const dv = ship ? computeDeltaV(ship) : 0;
    const depleted = !ship || !!ship.engineOut || dv <= 0;
    dvCard.classList.toggle('depleted', depleted);
    const dvText = Math.round(dv).toLocaleString('en-US') + ' m/s';
    const valueEl = dvCard.querySelector('.ss-dv-value');
    valueEl.textContent = dvText;
    // 打磨 v13：数字超长（≥12 字符，如 250,000 m/s 起）降档 11px，防 22px 溢出
    valueEl.classList.toggle('compact', dvText.length > 11);
}

function render(ship) {
    renderFuelRows(ship);
    renderDetails(ship);
    renderDeltaVCard(ship);
}

// 每帧数据广播 → 节流写 DOM（RENDER_DATA 仅飞行场景发射）
eventBus.on(Events.RENDER_DATA, () => {
    const now = performance.now();
    if (now - _lastUpdate < UPDATE_MIN_INTERVAL) return;

    const ship = window.__shipSystem?.getActiveShip?.() || null;
    if (!ship) {
        container.style.display = 'none';
        return;
    }
    _lastUpdate = now;
    container.style.display = 'flex';
    render(ship);
});

// 离开飞行场景隐藏（防最后帧数据残留）
eventBus.on(Events.SCENE_CHANGED, (data) => {
    if (data && data.to !== 'flight') {
        container.style.display = 'none';
    }
});
