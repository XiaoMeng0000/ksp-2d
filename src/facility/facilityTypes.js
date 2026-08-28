'use strict';

// 设施系统 — 设施类型配置

// 舱室定义
const COMPARTMENT_DEFS = {
    bridge:           { name: '指令舱',     icon: '🎛️' },
    dock_hub:         { name: '对接枢纽',   icon: '🔗' },
    supply_terminal:  { name: '补给终端',   icon: '⛽' },
    assembly_shop:    { name: '装配车间',   icon: '🔧' },
    laboratory:       { name: '实验室',     icon: '🔬' }
};

// 服务名称映射
const SERVICE_NAMES = {
    dock:             '对接',
    undock:           '分离',
    refuel:           '补给',
    refit:            '改装',
    build_ship:       '建造飞船',
    switch_control:   '切换控制',
    unlock_blueprint: '解锁蓝图'
};

// 设施分类定义
const FACILITY_CATEGORIES = [
    { id: 'infrastructure', name: '基础设施' },
    { id: 'logistics',      name: '后勤保障' },
    { id: 'science',        name: '科学研究' }
];

// 设施类型配置
// 0.2.0 阶段5 新增字段：
//   cost:           部署消耗的材料套装数（从部署飞船货仓扣除）
//   storageProfile: 存储配置 { base, modifiers }
//     base      — 每种资源的基准容量（所有设施类型统一）
//     modifiers — 资源容量倍率表 { resourceId: multiplier }，未列出的资源按 base
//     例：船坞 materialKits ×5、补给站氢氧 ×5、科研站无加成
const FACILITY_TYPES = [
    {
        id: 'orbital_dockyard',
        name: '轨道船坞',
        category: 'infrastructure',
        description: '综合性轨道建造与维护平台，支持飞船装配、对接补给和改装作业',
        color: '#4488ff',
        icon: '🏭',
        iconTextureKey: 'comp_assembly_shop',
        baseDocks: 2,
        compartments: ['bridge', 'dock_hub', 'supply_terminal', 'assembly_shop'],
        services: ['dock', 'undock', 'refuel', 'refit', 'build_ship', 'switch_control'],
        cost: 100,
        storageProfile: { base: 1000, modifiers: { materialKits: 5 } }
    },
    {
        id: 'supply_station',
        name: '补给站',
        category: 'logistics',
        description: '专用燃料与物资补给节点，为往来飞船提供推进剂加注服务',
        color: '#44cc88',
        icon: '⛽',
        iconTextureKey: 'comp_supply_terminal',
        baseDocks: 1,
        compartments: ['bridge', 'dock_hub', 'supply_terminal'],
        services: ['dock', 'undock', 'refuel'],
        cost: 150,
        storageProfile: { base: 1000, modifiers: { hydrogen: 5, oxygen: 5 } }
    },
    {
        id: 'research_station',
        name: '科研站',
        category: 'science',
        description: '轨道科学实验平台，配备先进实验室，可解锁新型蓝图技术',
        color: '#cc88ff',
        icon: '🔬',
        iconTextureKey: 'comp_laboratory',
        baseDocks: 1,
        compartments: ['bridge', 'dock_hub', 'supply_terminal', 'laboratory'],
        services: ['dock', 'undock', 'refuel', 'unlock_blueprint'],
        cost: 200,
        storageProfile: { base: 1000, modifiers: {} }
    }
];

// 根据 typeId 返回类型配置对象
export function getFacilityType(typeId) {
    return FACILITY_TYPES.find(t => t.id === typeId) || null;
}

// 返回所有类型配置的浅拷贝数组
export function getAllFacilityTypes() {
    return [...FACILITY_TYPES];
}

// 根据舱室 ID 返回舱室定义对象
export function getCompartmentDef(compartmentId) {
    return COMPARTMENT_DEFS[compartmentId] || null;
}

// 返回指定设施类型的舱室定义数组（已解析的完整舱室对象列表）
export function getFacilityCompartments(typeId) {
    const type = getFacilityType(typeId);
    if (!type) return [];
    return type.compartments
        .map(cid => {
            const def = getCompartmentDef(cid);
            return def ? { id: cid, ...def } : null;
        })
        .filter(c => c !== null);
}

// 返回所有设施分类
export function getFacilityCategories() {
    return [...FACILITY_CATEGORIES];
}

// 按分类返回设施类型列表
export function getFacilitiesByCategory(category) {
    return FACILITY_TYPES.filter(t => t.category === category);
}

// 根据服务 ID 返回服务名称
export function getServiceName(serviceId) {
    return SERVICE_NAMES[serviceId] || serviceId;
}
