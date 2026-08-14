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
        maxThrust: 99999,
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
        maxThrust: 5000000000,
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

    // ========== 正式模板（占位，后续填充） ==========
    // { id: 'kanxing-1', name: '坎星号', category: 'probe', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'yuanhangzhe', name: '远航者号', category: 'probe', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'deep_pioneer', name: '深空先锋号', category: 'deep_space', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'daedalus', name: '代达罗斯级', category: 'interplanetary', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'hermes', name: '赫尔墨斯号', category: 'interplanetary', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
];
