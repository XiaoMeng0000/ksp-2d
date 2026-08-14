// 模块系统 - 模块类型配置

const CATEGORY_NAMES = {
    structure: '结构增强',
    construction: '建设',
    science: '资源扫描'
};

const MODULE_TYPES = [
    {
        id: 'test_ballast',
        name: '测试压舱',
        category: 'structure',
        description: '增加干质量与转动惯量，使飞船转弯和加速更慢（测试用）',
        icon: '⚓',
        iconTextureKey: 'mod_test_ballast',
        price: 0,
        capability: null,
        massBonus: 5.0,
        momentOfInertiaBonus: 10.0
    },
    {
        id: 'construction_package',
        name: '建设集成模块',
        category: 'construction',
        description: '部署设施的必要组件。飞船进入目标天体圆轨道后可部署设施，部署后此模块被消耗。（该模块仅供测试使用！',
        icon: '🏗️',
        iconTextureKey: 'mod_construction_package',
        price: 100,
        capability: 'deploy_facility',
        massBonus: 2.0,
        momentOfInertiaBonus: 3.0
    },

    // ========== 资源扫描仪（0.2.0） ==========
    // 探测天体资源丰度。测试期 price=0、直接可选装，科技解锁后置。
    {
        id: 'scanner_t1',
        name: '资源扫描仪 Mk1',
        category: 'science',
        description: '探测天体 tier1 级资源分布（水冰、金属矿石）。',
        icon: '🔭',
        iconTextureKey: null,
        price: 0,
        capability: 'scan_resources',
        scanTier: 1,
        massBonus: 0.5,
        momentOfInertiaBonus: 0.5
    },
    {
        id: 'scanner_t2',
        name: '资源扫描仪 Mk2',
        category: 'science',
        description: '探测天体 tier1~2 级资源分布（含稀土矿、裂变材料）。',
        icon: '🔭',
        iconTextureKey: null,
        price: 0,
        capability: 'scan_resources',
        scanTier: 2,
        massBonus: 0.8,
        momentOfInertiaBonus: 0.8
    },
    {
        id: 'scanner_t3',
        name: '资源扫描仪 Mk3',
        category: 'science',
        description: '探测天体全部资源分布（含氦-3 等隐藏资源）。',
        icon: '🔭',
        iconTextureKey: null,
        price: 0,
        capability: 'scan_resources',
        scanTier: 3,
        massBonus: 1.2,
        momentOfInertiaBonus: 1.2
    }
];

export function getModuleDef(moduleTypeId) {
    return MODULE_TYPES.find(m => m.id === moduleTypeId);
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
