'use strict';

// 资源槽（{ amount, capacity }）级操作 — 纯函数，无任何模块内依赖
//
// 存在意义：resourceSystem.js 与 cargoSystem.js 都需要"向一个资源槽写入并受容量钳制"
// 这一条底层逻辑。若其一来 import 其二的写入接口，就会形成
// resourceSystem ⇄ cargoSystem 导入环（曾有 1 个环，2026-10-10 验收打回后消除）。
// 故把槽级逻辑下沉到本叶子模块：两侧都依赖本模块，彼此不再互相依赖。
//
// 本模块只做"单个槽"的数值钳制，不关心 holder 形状、不读写 GameState、不发事件。
// 对外的统一语义入口仍是 resources/resourceSystem.js（资源写入一律经它）。

// 取槽：holder 为 { resources: { [resourceId]: slot } }
export function getSlot(holder, resourceId) {
    if (!holder || !holder.resources || !holder.resources[resourceId]) return null;
    return holder.resources[resourceId];
}

// 向槽内增加 amount，结果钳制到 [0, capacity]
// 容量判别：capacity 为数字（含 0）时按其钳制 —— 0 容量 = 不可存；
// 仅 capacity 缺失/非数字时视为无上限（玩家全局资源如科技点没有 capacity 字段）
export function addSlotAmount(slot, amount) {
    const cap = typeof slot.capacity === 'number' ? slot.capacity : Infinity;
    slot.amount = Math.max(0, Math.min(cap, slot.amount + amount));
}

// 按比例扣减槽内资源，返回实际扣减量（扣到余额为 0 为止，永不产生负值）
// 与"全有或全无"的原子扣减语义不同：本函数能扣多少扣多少，故燃料可恰好烧尽
export function drainSlotAmount(slot, amount) {
    if (!(amount > 0)) return 0;
    const drained = Math.min(Math.max(0, slot.amount), amount);
    slot.amount -= drained;
    return drained;
}
