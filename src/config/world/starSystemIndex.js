'use strict';

// 星系索引（尝鲜版：单星系）
//
// ⚠️ 尝鲜版只开放 `kerbolar` 星系的 6 个天体（Kerbin 系 + Duna 系）。
//    多星系组合、星系选择与星系查看场景在完整版（`main` 分支）维护。
//
// 对外 API 形状与多星系版本保持一致（名字与返回结构不变），内部退化为单星系实现：
// 这样 saveManager / physics / 场景层的调用面无需改动，未来恢复多星系只改本文件。

import { meta as kerbolarMeta, bodies as kerbolarBodies } from './systems/kerbolarSystem.js';

// 光年换算常数:1 光年 = 9.4607304725808e15 米（保留给完整版的多星系方位计算）
export const LIGHT_YEAR_METERS = 9.4607304725808e15;

// 星系注册表（尝鲜版只有家园星系）
export const starSystemRegistry = [
    { meta: kerbolarMeta, bodies: kerbolarBodies }
];

// 按 id 查询星系
export function getSystemById(id) {
    return starSystemRegistry.find(s => s.meta.id === id) || null;
}

// 按星系 id 查询天体数组(直接引用)
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

// 默认组合:仅第一个 homeworld 星系
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

// 取星系根恒星(无 orbitParent 的天体)
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
// starSystemMeta:星系查看面板使用的元信息数组（尝鲜版无该场景，保留导出形状）
export const starSystemMeta = starSystemRegistry.map(s => s.meta);
// solarSystemData:全部星系天体聚合(physics.js 启动默认集合)
export const solarSystemData = starSystemRegistry.flatMap(s => s.bodies);
