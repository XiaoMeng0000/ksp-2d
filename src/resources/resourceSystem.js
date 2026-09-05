'use strict';

// 资源系统 - 资源读写工具函数（0.2.0）
// 所有模块只经本模块读写资源，杜绝裸字段操作。
// holder 结构：{ resources: { resourceId: { amount, capacity } } }

import { gameState } from '../gameState.js';
import { isResourceFree } from './modeRules.js';
import { getCargoUsed } from './cargoSystem.js';

// 获取资源槽（{amount, capacity}），不存在返回 null
export function getResource(holder, resourceId) {
    if (!holder || !holder.resources || !holder.resources[resourceId]) return null;
    return holder.resources[resourceId];
}

// 设置资源存量（amount 自动截断到 [0, capacity]）
// 0.2.5（M13）：容量为数字（含 0）时按其钳制 —— 0 容量槽 = 不可存，与 addResource 一致；
// 仅容量字段缺失/非数字时视为无上限（玩家全局资源如科技点没有 capacity 字段）
export function setResource(holder, resourceId, amount) {
    const slot = getResource(holder, resourceId);
    if (!slot) return false;
    const cap = typeof slot.capacity === 'number' ? slot.capacity : Infinity;
    slot.amount = Math.max(0, Math.min(cap, amount));
    return true;
}

// 增加资源存量（不超容量；0.2.5 M13：负值入账被下限钳制，容量 0 时不可存）
export function addResource(holder, resourceId, amount) {
    const slot = getResource(holder, resourceId);
    if (!slot) return false;
    const cap = typeof slot.capacity === 'number' ? slot.capacity : Infinity;
    slot.amount = Math.max(0, Math.min(cap, slot.amount + amount));
    return true;
}

// 消耗资源，余额不足返回 false（不扣款）
export function consumeResource(holder, resourceId, amount) {
    const slot = getResource(holder, resourceId);
    if (!slot || slot.amount < amount) return false;
    slot.amount -= amount;
    return true;
}

// 获取飞船总质量（干质量 + 全部推进剂存量 + 货仓货物；兼容旧 fuel 字段）
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
    // 0.2.0 阶段5：货仓货物计入总质量（影响推力加速度与 ΔV）
    const cargoMass = getCargoUsed(ship);
    return (ship.dryMass || 0) + fuelMass + cargoMass;
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

// 玩家全局资源 - 增加存量
export function addPlayerResource(resourceId, amount) {
    const state = gameState.getState();
    const player = state.player;
    if (!player.resources) player.resources = {};
    if (!player.resources[resourceId]) player.resources[resourceId] = { amount: 0 };
    player.resources[resourceId].amount += amount;
    gameState.setState({ player });
    return true;
}

// 玩家全局资源 - 尝试消耗（当前仅科技点；实体资源已迁至设施存储/飞船货仓，见 cargoSystem.js）
// 0.2.0 阶段7：自由模式下科技点免扣（isResourceFree，蓝图全解锁）；其余资源严格扣费，
// 余额不足返回 false 且不扣款。注意：实体资源的"余额不足不拦截"兜底在 cargoSystem 层。
export function consumePlayerResource(resourceId, amount) {
    if (isResourceFree(resourceId)) return true;   // 自由模式科技点免扣
    const state = gameState.getState();
    const player = state.player;
    const slot = player.resources && player.resources[resourceId];
    if (!slot || slot.amount < amount) return false;
    slot.amount -= amount;
    gameState.setState({ player });
    return true;
}

// 标准重力加速度（m/s²）
export const G0 = 9.81;

// 计算飞船当前可用的 ΔV（KSP 方式：从当前状态烧到燃料耗尽）
// ΔV = isp × g0 × ln(当前总质量 / 燃料耗尽后质量)
// 0.2.0 阶段5：货物不参与燃烧，末质量 = 干质量 + 货仓货物（载荷越重 ΔV 越低）
// 注意：多推进剂引擎下"先耗尽的那种燃料"决定实际 ΔV，双燃料按引擎配方精算在阶段 2 实现
export function computeDeltaV(ship) {
    if (!ship || !ship.isp) return 0;
    const currentMass = getTotalMass(ship);
    const endMass = (ship.dryMass || 0) + getCargoUsed(ship);
    if (endMass <= 0 || currentMass <= endMass) return 0;
    return ship.isp * G0 * Math.log(currentMass / endMass);
}
