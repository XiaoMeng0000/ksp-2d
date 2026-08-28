// 模块系统 - 模块类型配置

const CATEGORY_NAMES = {
    structure: '结构增强',
    construction: '建设',
    science: '资源扫描',
    logistics: '货运'
};

// capability → 飞行工具栏入口配置（数据驱动收敛）
// icon: 工具栏按钮图标（emoji fallback）；labelKey: strings.js 文案 key；
// iconId: 可选 DOM id（供事件委托/样式定位），无则 null
const CAPABILITY_TOOLBAR = {
    deploy_facility: { icon: '🔧', labelKey: 'facility.deploy', iconId: 'icon_deploy_facility' },
    cargo_hold:      { icon: '📦', labelKey: 'cargo.title',     iconId: 'icon_cargo_hold' },
    scan_resources:  { icon: '🔭', labelKey: 'scan.menuTitle',  iconId: 'icon_scan_resources' }
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
        iconTextureKey: 'icon_scan_resources',
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
        iconTextureKey: 'icon_scan_resources',
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
        iconTextureKey: 'icon_scan_resources',
        price: 0,
        capability: 'scan_resources',
        scanTier: 3,
        massBonus: 1.2,
        momentOfInertiaBonus: 1.2
    },

    // ========== 货运模块（0.2.0 阶段5） ==========
    // 扩展飞船货仓：可存储科技点以外的所有资源（推进剂/原料/材料套装）。
    // 货仓容量为共享总池（各资源共用），等级越高容量越大。
    // 注意：飞船自带燃料（fuelTanks → resources）不在货仓内，两者独立。
    {
        id: 'cargo_hold_t1',
        name: '通用货仓 Mk1',
        category: 'logistics',
        description: '扩展货仓（500 kg），可存放推进剂、原料与材料套装。飞船自带燃料不计入货仓。',
        icon: '📦',
        iconTextureKey: 'icon_cargo_hold',
        price: 20,
        capability: 'cargo_hold',
        cargoCapacity: 500,
        massBonus: 1.0,
        momentOfInertiaBonus: 1.5
    },
    {
        id: 'cargo_hold_t2',
        name: '通用货仓 Mk2',
        category: 'logistics',
        description: '扩展货仓（2000 kg），可存放推进剂、原料与材料套装。飞船自带燃料不计入货仓。',
        icon: '📦',
        iconTextureKey: 'icon_cargo_hold',
        price: 60,
        capability: 'cargo_hold',
        cargoCapacity: 2000,
        massBonus: 2.5,
        momentOfInertiaBonus: 4.0
    },
    {
        id: 'cargo_hold_t3',
        name: '通用货仓 Mk3',
        category: 'logistics',
        description: '扩展货仓（8000 kg），可存放推进剂、原料与材料套装。飞船自带燃料不计入货仓。',
        icon: '📦',
        iconTextureKey: 'icon_cargo_hold',
        price: 150,
        capability: 'cargo_hold',
        cargoCapacity: 8000,
        massBonus: 6.0,
        momentOfInertiaBonus: 10.0
    }
];

export function getModuleDef(moduleTypeId) {
    return MODULE_TYPES.find(m => m.id === moduleTypeId);
}

// 获取 capability 的飞行工具栏入口配置（未配置返回 null）
export function getCapabilityToolbar(capability) {
    return CAPABILITY_TOOLBAR[capability] || null;
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
