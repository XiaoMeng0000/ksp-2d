'use strict';

// 资源系统 - 设施存储与补给（0.2.0 阶段5；尝鲜版裁剪）
//
// ⚠️ 尝鲜版裁剪（见 docs/尝鲜版方案.md 第四节）：
//   只保留「设施存储 + 补给」链路 —— 轨道船坞建造飞船、扣材料、给飞船加注推进剂都依赖它；
//   飞船货仓（cargo hold）、设施间调拨、自动物流骨架随对应系统一并移除。
//   完整版的货仓 / 调拨实现在 `main` 分支维护。
//
// 职责：
//   1. 设施存储：按类型 storageProfile 初始化（facility.storage），逐资源独立容量
//   2. 设施 → 飞船燃料罐补给（refuelFromStorage）
// 全局资源仅保留科技点（science）；材料套装等实体资源落位到设施存储

import { RESOURCE_TYPES } from '../config/entities/resourceTypes.js';
import { getFacilityType } from '../config/entities/facilityTypes.js';
import { isBalanceEnforced } from './modeRules.js';
import { addSlotAmount } from './resourceSlot.js';

// 可存储资源（科技点为全局资源，不入设施存储）
export const STORAGE_RESOURCE_IDS = RESOURCE_TYPES
    .filter(r => r.id !== 'science')
    .map(r => r.id);

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
    if (!facility || !facility.storage || !facility.storage[resourceId]) {
        return 0;
    }
    return facility.storage[resourceId].amount || 0;
}

// 设施存储增加（受该槽容量限制）；返回实际存入量（契约：恒 ≥ 0）
export function addStorage(facility, resourceId, amount) {
    if (!facility || amount <= 0) return 0;
    if (STORAGE_RESOURCE_IDS.indexOf(resourceId) < 0) return 0;
    if (!facility.storage) initFacilityStorage(facility);
    const slot = facility.storage[resourceId];
    if (!slot) return 0;
    // 容量缺失/非数字的槽视为"不可存"
    const cap = typeof slot.capacity === 'number' ? slot.capacity : 0;
    if (!(cap > 0)) return 0;
    const before = slot.amount || 0;
    // 越界脏值（amount > capacity）保持原样不动，避免返回值变负破坏"实际存入量"契约
    if (before > cap) return 0;
    addSlotAmount(slot, amount);
    return Math.max(0, (slot.amount || 0) - before);
}

// 设施存储消耗（余额不足返回 false 不扣；sandbox 兜底：有多少扣多少，扣到 0 仍成功）
export function consumeStorage(facility, resourceId, amount) {
    if (!facility || amount <= 0) return true;
    if (getStorageAmount(facility, resourceId) < amount) {
        // 0.2.0 阶段7：自由模式余额不足不拦截（无限资源兜底），扣到 0 操作照常成功
        if (!isBalanceEnforced()) {
            if (facility.storage && facility.storage[resourceId]) {
                facility.storage[resourceId].amount = 0;
            }
            return true;
        }
        return false;
    }
    facility.storage[resourceId].amount -= amount;
    return true;
}

// ========== 补给 ==========

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
        // 槽级钳制与 resourceSystem 共用 resources/resourceSlot.js（避免模块互相 import 成环）
        const tankBefore = tank.amount || 0;
        addSlotAmount(tank, supply);
        const accepted = Math.max(0, (tank.amount || 0) - tankBefore);
        if (accepted <= 0) continue;
        facility.storage[resId].amount -= accepted;
        transferred[resId] = accepted;
        total += accepted;
    }
    return { ok: total > 0, transferred };
}
