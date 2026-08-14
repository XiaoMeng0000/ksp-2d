'use strict';

// 资源系统 - 资源类型注册表（0.2.0）
// 命名规范：id 全小写驼峰，稳定不可变（进入存档，改名成本高）
// 分类：propellant 推进剂（飞船侧）/ raw 原料（星球开采）/ construction 建造（玩家）/ research 科研（玩家）
// tier 探测等级：仅可作为星球资源的资源需要（1 常见 / 2 稀有 / 3 隐藏）

export const RESOURCE_TYPES = [
    // ===== 推进剂（飞船侧） =====
    { id: 'hydrogen', name: '液氢', category: 'propellant', unit: 'kg' },
    { id: 'oxygen', name: '液氧', category: 'propellant', unit: 'kg' },
    { id: 'methane', name: '液态甲烷', category: 'propellant', unit: 'kg' },
    { id: 'monoprop', name: '单组元推进剂', category: 'propellant', unit: 'kg' },
    { id: 'metallicHydrogen', name: '金属氢', category: 'propellant', unit: 'kg' },
    { id: 'deuterium', name: '氘', category: 'propellant', unit: 'kg' },
    { id: 'tritium', name: '氚', category: 'propellant', unit: 'kg' },
    { id: 'helium3', name: '氦-3', category: 'propellant', unit: 'kg', tier: 3 },
    { id: 'nuclearSaltWater', name: '核盐水', category: 'propellant', unit: 'kg' },
    { id: 'fissionPellets', name: '裂变弹丸', category: 'propellant', unit: 'kg' },
    { id: 'xenon', name: '氙', category: 'propellant', unit: 'kg' },
    { id: 'antimatter', name: '反物质', category: 'propellant', unit: 'kg' },

    // ===== 星球原料（可由采矿模块获取） =====
    { id: 'waterIce', name: '水冰', category: 'raw', unit: 'kg', tier: 1 },
    { id: 'metallicOre', name: '金属矿石', category: 'raw', unit: 'kg', tier: 1 },
    { id: 'rareMetals', name: '稀土矿', category: 'raw', unit: 'kg', tier: 2 },
    { id: 'fissileMaterials', name: '裂变材料', category: 'raw', unit: 'kg', tier: 2 },

    // ===== 玩家全局 =====
    { id: 'rocketParts', name: '火箭零件', category: 'construction', unit: '个' },
    { id: 'science', name: '科技点', category: 'research', unit: '点' }
];

// 获取资源类型定义
export function getResourceType(resourceId) {
    return RESOURCE_TYPES.find(r => r.id === resourceId) || null;
}

// 获取指定分类的资源列表
export function getResourcesByCategory(category) {
    return RESOURCE_TYPES.filter(r => r.category === category);
}

// 判断资源是否为推进剂
export function isPropellant(resourceId) {
    const def = getResourceType(resourceId);
    return !!def && def.category === 'propellant';
}
