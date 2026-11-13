'use strict';

// 设施系统 — 设施类型配置
// ⚠️ 尝鲜版只保留「轨道船坞」（开局预置在 Kerbin 轨道上的唯一建造设施）。
//    补给站 / 科研站与部署新设施功能随完整版保留，本分支不提供。

// 舱室定义（iconTexture: 0.3.0 起资产就近声明，路径相对项目根目录）
const COMPARTMENT_DEFS = {
    bridge:           { name: '指令舱',     icon: '🎛️', iconTexture: 'assets/images/facilities/compartments/bridge.png' },
    dock_hub:         { name: '对接枢纽',   icon: '🔗', iconTexture: 'assets/images/facilities/compartments/dock_hub.png' },
    supply_terminal:  { name: '补给终端',   icon: '⛽', iconTexture: 'assets/images/facilities/compartments/supply_terminal.png' },
    assembly_shop:    { name: '装配车间',   icon: '🔧', iconTexture: 'assets/images/facilities/compartments/assembly_shop.png' }
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
    { id: 'infrastructure', name: '基础设施' }
];

// 设施类型配置
// 0.2.0 阶段5 字段：
//   cost:           部署消耗的材料套装数（尝鲜版不提供部署，字段保留给完整版）
//   storageProfile: 存储配置 { base, modifiers }
//     base      — 每种资源的基准容量
//     modifiers — 资源容量倍率表 { resourceId: multiplier }，未列出的资源按 base
const FACILITY_TYPES = [
    {
        id: 'orbital_dockyard',
        name: '轨道船坞',
        category: 'infrastructure',
        description: '综合性轨道建造与维护平台，支持飞船装配、对接补给和改装作业',
        color: '#4488ff',
        icon: '🏭',
        iconTexture: 'assets/images/facilities/compartments/assembly_shop.png',
        baseDocks: 2,
        compartments: ['bridge', 'dock_hub', 'supply_terminal', 'assembly_shop'],
        services: ['dock', 'undock', 'refuel', 'refit', 'build_ship', 'switch_control'],
        cost: 100,
        storageProfile: { base: 1000, modifiers: { materialKits: 5 } }
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

// 返回全部舱室定义（资产清单聚合用；0.3.0）
export function getAllCompartments() {
    return Object.entries(COMPARTMENT_DEFS).map(([id, def]) => ({ id, ...def }));
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
