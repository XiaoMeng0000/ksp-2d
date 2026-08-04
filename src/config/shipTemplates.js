// TEMP: 飞船系统 - 飞船模板配置
import { SHIP_CATEGORIES } from './shipCategories.js';

export const SHIP_TEMPLATES = [
    // ========== 调试专用 ==========
    {
        id: 'debug_behemoth',
        name: '测试巨兽',
        category: SHIP_CATEGORIES.interplanetary.id,
        description: '30槽位、20万Δv，调试专用',
        dryMass: 1.0,
        fuelCapacity: 999999,
        isp: 9999,
        maxThrust: 99999,
        moduleSlots: 30,
        initialDeltaV: 200000,
        unlockCondition: '__debug__',
        // TEMP: 第六阶段-物理旋转 — 转动惯量与动量轮扭矩
        momentOfInertia: 10.0,        // 转动惯量（kg·m²），越大转得越慢
        reactionWheelTorque: 20.0     // 动量轮最大扭矩（N·m），越大转得越快
    },

    // ========== 正式模板（占位，后续填充） ==========
    // { id: 'kanxing-1', name: '坎星号', category: 'probe', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'yuanhangzhe', name: '远航者号', category: 'probe', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'deep_pioneer', name: '深空先锋号', category: 'deep_space', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'daedalus', name: '代达罗斯级', category: 'interplanetary', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
    // { id: 'hermes', name: '赫尔墨斯号', category: 'interplanetary', momentOfInertia: 10.0, reactionWheelTorque: 20.0, ... },
];
