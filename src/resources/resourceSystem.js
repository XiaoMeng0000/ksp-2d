'use strict';

// 资源系统 - 资源读写工具函数（0.2.0）
// 所有模块只经本模块读写资源，杜绝裸字段操作。
// holder 结构：{ resources: { resourceId: { amount, capacity } } }

import { gameState } from '../gameState.js';

// 获取资源槽（{amount, capacity}），不存在返回 null
export function getResource(holder, resourceId) {
    if (!holder || !holder.resources || !holder.resources[resourceId]) return null;
    return holder.resources[resourceId];
}

// 设置资源存量（amount 自动截断到 [0, capacity]）
export function setResource(holder, resourceId, amount) {
    const slot = getResource(holder, resourceId);
    if (!slot) return false;
    const cap = typeof slot.capacity === 'number' && slot.capacity > 0 ? slot.capacity : Infinity;
    slot.amount = Math.max(0, Math.min(cap, amount));
    return true;
}

// 增加资源存量（不超容量）
export function addResource(holder, resourceId, amount) {
    const slot = getResource(holder, resourceId);
    if (!slot) return false;
    slot.amount += amount;
    if (typeof slot.capacity === 'number' && slot.capacity > 0) {
        slot.amount = Math.min(slot.amount, slot.capacity);
    }
    return true;
}

// 消耗资源，余额不足返回 false（不扣款）
export function consumeResource(holder, resourceId, amount) {
    const slot = getResource(holder, resourceId);
    if (!slot || slot.amount < amount) return false;
    slot.amount -= amount;
    return true;
}

// 获取飞船总质量（干质量 + 全部推进剂存量；兼容旧 fuel 字段）
export function getTotalMass(ship) {
    if (!ship) return 0;
    let fuelMass = 0;
    if (ship.resources) {
        for (const key of Object.keys(ship.resources)) {
            const slot = ship.resources[key];
            if (slot && typeof slot.amount === 'number') fuelMass += slot.amount;
        }
    } else if (typeof ship.fuel === 'number') {
        // 迁移期兼容：无 resources 时回退旧 fuel 字段
        fuelMass = ship.fuel;
    }
    return (ship.dryMass || 0) + fuelMass;
}

// 获取推进剂总存量（迁移期兼容：有 resources 时汇总，否则回退旧 fuel 字段）
export function getFuelAmount(ship) {
    if (!ship) return 0;
    if (ship.resources) {
        let total = 0;
        for (const key of Object.keys(ship.resources)) {
            const slot = ship.resources[key];
            if (slot && typeof slot.amount === 'number') total += slot.amount;
        }
        return total;
    }
    return ship.fuel ?? 0;
}

// 获取推进剂总容量（迁移期兼容：有 resources 时汇总，否则回退旧 fuelCapacity 字段）
export function getFuelCapacity(ship) {
    if (!ship) return 0;
    if (ship.resources) {
        let total = 0;
        for (const key of Object.keys(ship.resources)) {
            const slot = ship.resources[key];
            if (slot && typeof slot.capacity === 'number') total += slot.capacity;
        }
        return total;
    }
    return ship.fuelCapacity ?? 0;
}

// 获取玩家全局资源存量（简化入口）
export function getPlayerResource(resourceId) {
    const player = gameState.getState().player;
    return player.resources && player.resources[resourceId] ? player.resources[resourceId].amount : 0;
}

// 标准重力加速度（m/s²）
export const G0 = 9.81;

// 计算飞船当前可用的 ΔV（KSP 方式：从当前状态烧到燃料耗尽）
// ΔV = isp × g0 × ln(当前总质量 / 燃料耗尽后质量)
// 注意：多推进剂引擎下"先耗尽的那种燃料"决定实际 ΔV，双燃料按引擎配方精算在阶段 2 实现
export function computeDeltaV(ship) {
    if (!ship || !ship.isp) return 0;
    const currentMass = getTotalMass(ship);
    const dryMass = ship.dryMass || 0;
    if (dryMass <= 0 || currentMass <= dryMass) return 0;
    return ship.isp * G0 * Math.log(currentMass / dryMass);
}
