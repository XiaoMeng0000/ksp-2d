'use strict';
// 模块系统 - 模块类型配置
//
// ⚠️ 尝鲜版裁剪（见 docs/尝鲜版方案.md 第四节）：
//   · 资源扫描仪（scanner_t1~t3）与货运模块（cargo_hold_t1~t3）随扫描 / 货仓系统移除；
//   · 能力工具栏（部署设施 / 货仓 / 扫描）全部移除 —— 尝鲜版不提供部署新设施入口；
//   · 保留两个与「质量 / 转动惯量」相关的结构模块，飞船属性聚合（shipSystem）仍按其计算。
//   完整版的模块体系在 `main` 分支维护。

const CATEGORY_NAMES = {
    structure: '结构增强',
    construction: '建设'
};

// capability → 飞行工具栏入口配置（数据驱动收敛）
// 尝鲜版：部署设施 / 货仓 / 资源扫描三个能力入口全部移除，工具栏不再出现能力图标。
const CAPABILITY_TOOLBAR = {};

const MODULE_TYPES = [
    {
        id: 'test_ballast',
        name: '测试压舱',
        category: 'structure',
        description: '增加干质量与转动惯量，使飞船转弯和加速更慢（测试用）',
        icon: '⚓',
        iconTexture: 'assets/images/ships/test_ballast.png',
        price: 0,
        capability: null,
        massBonus: 5.0,
        momentOfInertiaBonus: 10.0
    },
    {
        id: 'construction_package',
        name: '建设集成模块',
        category: 'construction',
        description: '建设作业组件（尝鲜版不提供设施部署，该模块仅作为配重与历史存档兼容保留）。',
        icon: '🏗️',
        iconTexture: 'assets/images/ships/construction_package.png',
        price: 100,
        capability: null,
        massBonus: 2.0,
        momentOfInertiaBonus: 3.0
    }
];

export function getModuleDef(moduleTypeId) {
    return MODULE_TYPES.find(m => m.id === moduleTypeId);
}

// 获取 capability 的飞行工具栏入口配置（未配置返回 null）
export function getCapabilityToolbar(capability) {
    return CAPABILITY_TOOLBAR[capability] || null;
}

// 返回全部能力工具栏配置（资产清单聚合用）
export function getAllCapabilityToolbars() {
    return Object.values(CAPABILITY_TOOLBAR);
}

export function getAllModules() {
    return [...MODULE_TYPES];
}

export function getModulesByCategory(category) {
    return MODULE_TYPES.filter(m => m.category === category);
}

export function getModuleCategories() {
    const seen = new Set();
    return MODULE_TYPES
        .map(m => m.category)
        .filter(cat => {
            if (seen.has(cat)) return false;
            seen.add(cat);
            return true;
        })
        .map(cat => ({
            id: cat,
            name: CATEGORY_NAMES[cat] || cat
        }));
}
