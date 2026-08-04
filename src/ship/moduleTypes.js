// 模块系统 - 模块类型配置

const CATEGORY_NAMES = {
    structure: '结构增强',
    construction: '建设'
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
