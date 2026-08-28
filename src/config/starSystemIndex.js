"use strict";

import { meta as kerbolarMeta, bodies as kerbolarBodies } from './systems/kerbolarSystem.js';
import { meta as testbolarMeta, bodies as testbolarBodies } from './systems/testSystem.js';
import { meta as debdebTestMeta, bodies as debdebTestBodies } from './systems/debdebTestSystem.js';
import { meta as debdebMeta, bodies as debdebBodies } from './systems/debdebSystem.js';
import { meta as tuunMeta, bodies as tuunBodies } from './systems/tuunSystem.js';

// ========== 星系总配置(数据驱动) ==========
// 所有星系在此注册;新增星系步骤:
//   1. 在 src/config/systems/ 下新建 <id>System.js,导出 { meta, bodies }
//   2. 在本文件 starSystemRegistry 中登记
// 约定:
//   - meta.id 为星系唯一标识(存档绑定,一经发布不可变更)
//   - placeholder: true 表示占位星系(仅展示,无真实天体数据,不可选择加载)
//   - distance/bearingDeg 描述星系相对 homeworld 原点的方位(光年/度)
//   - 恒星(无 orbitParent 的天体)位置固定;homeworld 星系恒星固定在 (0,0)

// 光年换算常数:1 光年 = 9.4607304725808e15 米
export const LIGHT_YEAR_METERS = 9.4607304725808e15;

// 星系注册表(注册顺序即展示顺序)
export const starSystemRegistry = [
    { meta: kerbolarMeta, bodies: kerbolarBodies },
    { meta: testbolarMeta, bodies: testbolarBodies },
    { meta: debdebTestMeta, bodies: debdebTestBodies },
    { meta: debdebMeta, bodies: debdebBodies },
    { meta: tuunMeta, bodies: tuunBodies }
];

// 按 id 查询星系
export function getSystemById(id) {
    return starSystemRegistry.find(s => s.meta.id === id) || null;
}

// 按星系 id 查询天体数组(直接引用;占位星系为空数组)
export function getSystemBodiesById(id) {
    const system = getSystemById(id);
    return system ? system.bodies : [];
}

// 星系是否为 homeworld 星系(其天体列表中存在 isHomeworld 天体)
export function isHomeworldSystem(id) {
    const system = getSystemById(id);
    return !!(system && system.bodies.some(b => b.isHomeworld));
}

// 组合中的 homeworld 星系 id(约定恰好一个;多则返回第一个)
export function getHomeworldSystemId(ids) {
    return (ids || []).find(id => isHomeworldSystem(id)) || null;
}

// 默认组合:仅第一个 homeworld 星系(与历史行为等价)
export function getDefaultSystemIds() {
    const homeworld = starSystemRegistry.find(s => isHomeworldSystem(s.meta.id));
    return homeworld ? [homeworld.meta.id] : [];
}

// 计算星系恒星绝对位置(homeworld 星系固定在原点)
export function computeSystemPosition(meta, homeworldId) {
    if (meta.id === homeworldId) {
        return { x: 0, y: 0 };
    }
    const dist = (meta.distance || 0) * LIGHT_YEAR_METERS;
    const angle = (meta.bearingDeg || 0) * Math.PI / 180;
    return {
        x: dist * Math.cos(angle),
        y: dist * Math.sin(angle)
    };
}

// 取星系根恒星(无 orbitParent 的天体;占位星系无恒星返回 null)
export function getStarBody(id) {
    const system = getSystemById(id);
    if (!system) return null;
    return system.bodies.find(b => !b.orbitParent) || null;
}

// 校验星系组合合法性(创建新存档与读档共用)
// 返回 { ok, reason, id? }
// reason 取值:'empty' | 'unknown' | 'placeholder' | 'disabled' | 'no-homeworld' | 'multi-homeworld' | 'soi-overlap'
export function validateSystemSelection(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: false, reason: 'empty' };
    }
    // 重复 id 检测(重复星系会导致天体重复克隆)
    if (new Set(ids).size !== ids.length) {
        return { ok: false, reason: 'duplicate' };
    }
    for (const id of ids) {
        const system = getSystemById(id);
        if (!system) return { ok: false, reason: 'unknown', id };
        if (system.meta.placeholder) return { ok: false, reason: 'placeholder', id };
        if (!system.meta.enabled) return { ok: false, reason: 'disabled', id };
    }

    const homeworldIds = ids.filter(id => isHomeworldSystem(id));
    if (homeworldIds.length === 0) return { ok: false, reason: 'no-homeworld' };
    if (homeworldIds.length > 1) return { ok: false, reason: 'multi-homeworld' };

    // 恒星 SOI 重叠检测:恒星位置固定,两两圆心距 < SOI 半径和即重叠
    const homeworldId = homeworldIds[0];
    const stars = [];
    for (const id of ids) {
        const system = getSystemById(id);
        const star = system.bodies.find(b => !b.orbitParent);
        if (star) {
            stars.push({
                id,
                star,
                pos: computeSystemPosition(system.meta, homeworldId)
            });
        }
    }
    for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
            const a = stars[i];
            const b = stars[j];
            const dx = a.pos.x - b.pos.x;
            const dy = a.pos.y - b.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < a.star.soiRadius + b.star.soiRadius) {
                return { ok: false, reason: 'soi-overlap', ids: [a.id, b.id] };
            }
        }
    }

    return { ok: true, reason: null };
}

// ========== 兼容旧名聚合导出 ==========
// starSystemMeta:solarSystem.js 旧导出名,星系查看面板使用
export const starSystemMeta = starSystemRegistry.map(s => s.meta);
// solarSystemData:全部星系天体聚合(physics.js 启动默认集合)
export const solarSystemData = starSystemRegistry.flatMap(s => s.bodies);
