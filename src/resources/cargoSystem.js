'use strict';

// 资源系统 - 货运与存储（0.2.0 阶段5）
// 职责：
//   1. 飞船货仓：货运模块扩展的共享容量池（ship.cargo），存放科技点以外的资源
//      注意：飞船自带燃料（ship.resources，来自模板 fuelTanks）不在货仓内，两者独立
//   2. 设施存储：所有设施按类型 storageProfile 初始化（facility.storage），逐资源独立容量
//   3. 资源转移：设施 ↔ 飞船货仓、设施 ↔ 设施（临时调拨菜单用）、设施 → 飞船燃料罐（补给）
//   4. 自动物流接口预留：后续在设施间自动传递资源（当前仅骨架）
// 全局资源仅保留科技点（science）；材料套装等实体资源全部落位到设施/飞船货仓

import { RESOURCE_TYPES, getResourceType } from './resourceTypes.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { getFacilityType } from '../facility/facilityTypes.js';
import { isBalanceEnforced } from './modeRules.js';

// 可存储资源（科技点为全局资源，不入货仓/设施存储）
export const STORAGE_RESOURCE_IDS = RESOURCE_TYPES
    .filter(r => r.id !== 'science')
    .map(r => r.id);

// ========== 飞船货仓 ==========

// 货仓总容量（全部货运模块 cargoCapacity 之和；无货运模块返回 0）
export function getCargoCapacity(ship) {
    if (!ship || !Array.isArray(ship.modules)) return 0;
    let total = 0;
    for (const mod of ship.modules) {
        const def = getModuleDef(mod.type);
        if (def && def.capability === 'cargo_hold' && typeof def.cargoCapacity === 'number') {
            total += def.cargoCapacity;
        }
    }
    return total;
}

// 货仓已用量（各资源 amount 之和，共享池）
export function getCargoUsed(ship) {
    if (!ship || !ship.cargo) return 0;
    let total = 0;
    for (const slot of Object.values(ship.cargo)) {
        if (slot && typeof slot.amount === 'number') total += slot.amount;
    }
    return total;
}

// 货仓剩余容量
export function getCargoFree(ship) {
    return Math.max(0, getCargoCapacity(ship) - getCargoUsed(ship));
}

// 飞船是否有货仓（至少一个货运模块）
export function hasCargoHold(ship) {
    return getCargoCapacity(ship) > 0;
}

// 货仓读取（无槽返回 0）
export function getCargoAmount(ship, resourceId) {
    if (!ship || !ship.cargo || !ship.cargo[resourceId]) return 0;
    return ship.cargo[resourceId].amount || 0;
}

// 货仓增加（受共享池剩余容量限制；不可存科技点）
// 返回实际存入量
export function addCargo(ship, resourceId, amount) {
    if (!ship || amount <= 0) return 0;
    if (!STORAGE_RESOURCE_IDS.includes(resourceId)) return 0;
    const accepted = Math.min(amount, getCargoFree(ship));
    if (accepted <= 0) return 0;
    if (!ship.cargo) ship.cargo = {};
    if (!ship.cargo[resourceId]) ship.cargo[resourceId] = { amount: 0 };
    ship.cargo[resourceId].amount += accepted;
    return accepted;
}

// 货仓消耗（余额不足返回 false 不扣；sandbox 兜底：有多少扣多少，扣到 0 仍成功）
export function consumeCargo(ship, resourceId, amount) {
    if (!ship || amount <= 0) return true;
    if (getCargoAmount(ship, resourceId) < amount) {
        // 0.2.0 阶段7：自由模式余额不足不拦截（无限资源兜底），扣到 0 操作照常成功
        if (!isBalanceEnforced()) {
            if (ship.cargo && ship.cargo[resourceId]) delete ship.cargo[resourceId];
            return true;
        }
        return false;
    }
    ship.cargo[resourceId].amount -= amount;
    if (ship.cargo[resourceId].amount <= 0) delete ship.cargo[resourceId];
    return true;
}

// ========== 设施存储 ==========

// 按 storageProfile 初始化设施存储槽（每种可存储资源一槽，容量 = base × 倍率）
export function initFacilityStorage(facility) {
    const type = getFacilityType(facility.typeId);
    const profile = (type && type.storageProfile) || { base: 0, modifiers: {} };
    const storage = {};
    for (const resId of STORAGE_RESOURCE_IDS) {
        const capacity = profile.base * ((profile.modifiers && profile.modifiers[resId]) || 1);
        storage[resId] = { amount: 0, capacity };
    }
    facility.storage = storage;
    return storage;
}

// 设施存储读取（无槽返回 0）
export function getStorageAmount(facility, resourceId) {
    if (!facility || !facility.storage || !facility.storage[resourceId]) return 0;
    return facility.storage[resourceId].amount || 0;
}

// 设施存储增加（受该槽容量限制）；返回实际存入量
export function addStorage(facility, resourceId, amount) {
    if (!facility || amount <= 0) return 0;
    if (!STORAGE_RESOURCE_IDS.includes(resourceId)) return 0;
    if (!facility.storage) initFacilityStorage(facility);
    const slot = facility.storage[resourceId];
    if (!slot) return 0;
    const cap = typeof slot.capacity === 'number' ? slot.capacity : 0;
    const accepted = Math.min(amount, Math.max(0, cap - (slot.amount || 0)));
    slot.amount = (slot.amount || 0) + accepted;
    return accepted;
}

// 设施存储消耗（余额不足返回 false 不扣；sandbox 兜底：有多少扣多少，扣到 0 仍成功）
export function consumeStorage(facility, resourceId, amount) {
    if (!facility || amount <= 0) return true;
    if (getStorageAmount(facility, resourceId) < amount) {
        // 0.2.0 阶段7：自由模式余额不足不拦截（无限资源兜底），扣到 0 操作照常成功
        if (!isBalanceEnforced()) {
            if (facility.storage && facility.storage[resourceId]) facility.storage[resourceId].amount = 0;
            return true;
        }
        return false;
    }
    facility.storage[resourceId].amount -= amount;
    return true;
}

// ========== 资源转移（手动调拨） ==========

// 设施存储 → 飞船货仓（受源余额与目标货仓剩余容量限制）
// 返回实际转移量
export function transferStorageToCargo(facility, ship, resourceId, amount) {
    if (!facility || !ship || amount <= 0) return 0;
    const available = Math.min(amount, getStorageAmount(facility, resourceId));
    const accepted = addCargo(ship, resourceId, available);
    if (accepted > 0) facility.storage[resourceId].amount -= accepted;
    return accepted;
}

// 飞船货仓 → 设施存储（受源余额与目标槽容量限制）
// 返回实际转移量
export function transferCargoToStorage(ship, facility, resourceId, amount) {
    if (!facility || !ship || amount <= 0) return 0;
    const available = Math.min(amount, getCargoAmount(ship, resourceId));
    const accepted = addStorage(facility, resourceId, available);
    if (accepted > 0) {
        ship.cargo[resourceId].amount -= accepted;
        if (ship.cargo[resourceId].amount <= 0) delete ship.cargo[resourceId];
    }
    return accepted;
}

// 设施 → 设施（临时调拨菜单：在不同设施间转移资源）
// 返回实际转移量
export function transferBetweenFacilities(fromFacility, toFacility, resourceId, amount) {
    if (!fromFacility || !toFacility || amount <= 0) return 0;
    const available = Math.min(amount, getStorageAmount(fromFacility, resourceId));
    const accepted = addStorage(toFacility, resourceId, available);
    if (accepted > 0) fromFacility.storage[resourceId].amount -= accepted;
    return accepted;
}

// 设施存储 → 飞船燃料罐（补给终端：按飞船缺口补满氢氧，受设施存量限制）
// 返回 { ok, transferred: { resourceId: amount } }；完全无货时 ok=false
export function refuelFromStorage(facility, ship) {
    if (!facility || !ship || !ship.resources) return { ok: false, transferred: {} };
    const transferred = {};
    let total = 0;
    for (const resId of ['hydrogen', 'oxygen']) {
        const tank = ship.resources[resId];
        if (!tank) continue;
        const need = Math.max(0, (tank.capacity || 0) - (tank.amount || 0));
        if (need <= 0) continue;
        const supply = Math.min(need, getStorageAmount(facility, resId));
        if (supply <= 0) continue;
        tank.amount += supply;
        facility.storage[resId].amount -= supply;
        transferred[resId] = supply;
        total += supply;
    }
    return { ok: total > 0, transferred };
}

// ========== 自动物流（接口预留，后置实现） ==========
// 设计：物流任务在设施间按周期自动转移资源（如 Mun 矿站 → Kerbin 船坞）。
// 当前仅注册任务结构与调度骨架，执行逻辑待后置阶段实现。

export const AUTO_LOGISTICS_JOBS = [];

/**
 * 注册自动物流任务（接口预留）
 * @param {Object} job 任务描述 { id, fromFacilityId, toFacilityId, resourceId, amountPerTrip, interval（秒）, enabled }
 */
export function scheduleAutoLogistics(job) {
    // TODO: 后置阶段实现 — 周期调度、运力校验（需货运飞船航线）、事件通知
    AUTO_LOGISTICS_JOBS.push({ enabled: true, ...job });
}

// 自动物流调度入口（由主循环/场景调用；当前空实现）
export function updateAutoLogistics() {
    // TODO: 后置阶段实现
}
