// 飞船系统 - 飞船模板配置
import { SHIP_CATEGORIES } from './shipCategories.js';

export const SHIP_TEMPLATES = [
    // ========== 调试专用 ==========
    {
        id: 'debug_behemoth',
        name: '测试巨兽',
        category: SHIP_CATEGORIES.interplanetary.id,
        description: '第一次体验这个游戏?担心数值不够用？那就试试这个数值乱填的飞船吧！（仅供测试使用',
        dryMass: 1.0,
        // 0.2.0：燃料改为按引擎配方的储罐表（旧 fuelCapacity 废弃）
        fuelTanks: { hydrogen: 111111, oxygen: 888888 },   // 总容量 999999，按 1:8 拆
        isp: 9999,
        // 0.2.0 阶段2：数值校准 — 推力 1e7 使 TWR≈1.0（原 99999 N 过弱几乎无法加速）
        maxThrust: 10000000,
        moduleSlots: 30,
        unlockCondition: '__debug__',
        // 0.2.0：模板升级体系字段
        family: 'debug',
        tier: 1,
        engineType: 'chemical',
        cost: 0,
        scienceCost: 0,
        // 转动惯量与动量轮扭矩
        momentOfInertia: 10.0,        // 转动惯量（kg·m²），越大转得越慢
        reactionWheelTorque: 20.0     // 动量轮最大扭矩（N·m），越大转得越快
    },

    // ========== 正式飞船 ==========
    {
        id: 'rex01_genesis_ark',
        name: '测试巨兽promax',
        category: SHIP_CATEGORIES.interplanetary.id,
        description: '更高的数值！更狠的测试巨兽！！',
        dryMass: 420000000,
        // 0.2.0：燃料改为按引擎配方的储罐表（旧 fuelCapacity 废弃）
        fuelTanks: { hydrogen: 46666667, oxygen: 373333333 },   // 总容量 420000000，按 1:8 拆
        isp: 200000,
        // 0.2.0 阶段2：数值校准 — 推力 1e10 使满质量 TWR≈1.21（原 5e9 N 时 TWR≈0.6，无法起飞）
        maxThrust: 10000000000,
        moduleSlots: 25,
        unlockCondition: 'always',
        // 0.2.0：模板升级体系字段
        family: 'genesis',
        tier: 1,
        engineType: 'chemical',
        cost: 9999,
        scienceCost: 0,
        momentOfInertia: 500000,
        reactionWheelTorque: 10000
    },

    // ========== 正式模板：家族分代体系（0.2.0 阶段2） ==========
    // 储备坎巴拉K2号 — 探测级首舰（化学引擎），满燃料 ΔV≈2800 m/s，TWR≈1.60，专为 Mun/Minmus 往返设计，ΔV 不足以直飞 Duna
    {
        id: 'kanxing-1',
        name: '储备坎巴拉K2号',
        category: SHIP_CATEGORIES.probe.id,
        description: 'K2 火箭的目的，是为了抵达 Mun 或 Minmus，然后安全地回家。',
        dryMass: 2000,
        fuelTanks: { hydrogen: 280, oxygen: 2240 },   // 总燃料 2520 kg，按 1:8 拆（ΔV≈2800 m/s）
        isp: 350,
        maxThrust: 70000,
        moduleSlots: 4,
        unlockCondition: 'always',
        // 模板升级体系字段
        family: 'kanxing',
        tier: 1,
        engineType: 'chemical',
        cost: 50,
        scienceCost: 0,
        momentOfInertia: 500,
        reactionWheelTorque: 10
    },

    // ========== 正式模板（占位，后续填充） ==========
    // { id: 'kanxing-1', name: '坎星号', category: 'probe', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'yuanhangzhe', name: '远航者号', category: 'probe', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'deep_pioneer', name: '深空先锋号', category: 'deep_space', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'daedalus', name: '代达罗斯级', category: 'interplanetary', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'hermes', name: '赫尔墨斯号', category: 'interplanetary', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
];
