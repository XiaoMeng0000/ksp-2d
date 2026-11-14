'use strict';
// 飞船系统 - 飞船模板配置
//
// ⚠️ 尝鲜版：只保留 3 艘经过数值设计的预设船（无飞船编辑器，玩家在轨道船坞按预设建造）。
//   原 debug_behemoth / rex01_genesis_ark 两艘"数值乱填"的调试船已移除 ——
//   它们会让轨道物理体验直接失真（开局即可飞到任何地方）。
//
// 数值口径（ΔV = isp × g0 × ln(m0 / 干质量)，g0 = 9.81）：
//   ① 入门练习船  干 2000 / 燃料 837  / isp 350 → ΔV≈1200, TWR≈1.40（够入轨与机动，去不了 Mun）
//   ② 储备坎巴拉K2号 干 2000 / 燃料 2520 / isp 350 → ΔV≈2800, TWR≈1.58（Mun / Minmus 往返）
//   ③ 杜纳往返船   干 6000 / 燃料 12510 / isp 380 → ΔV≈4200, TWR≈1.42（Duna 系往返）
//
// textures（可选）：船体图两态，缺省则用 textureConfig 的通用兜底图。

import { SHIP_CATEGORIES } from './shipCategories.js';

export const SHIP_TEMPLATES = [
    // ========== ① 入门练习船（开局默认船） ==========
    {
        id: 'trainer-1',
        name: '入门练习船',
        category: SHIP_CATEGORIES.probe.id,
        description: '第一次飞?这艘船够你入轨、练习机动节点与轨道转移。ΔV 约 1200 m/s —— 到得了 Mun 附近，但回不来。想走远，去轨道船坞造一艘。',
        dryMass: 2000,
        fuelTanks: { hydrogen: 93, oxygen: 744 },   // 总燃料 837 kg（ΔV≈1200 m/s）
        isp: 350,
        maxThrust: 39000,                            // TWR≈1.40（满燃料）
        moduleSlots: 2,
        unlockCondition: 'always',
        family: 'trainer',
        tier: 1,
        engineType: 'chemical',
        cost: 20,
        scienceCost: 0,
        momentOfInertia: 400,
        reactionWheelTorque: 8
    },

    // ========== ② 储备坎巴拉K2号（Mun / Minmus 往返） ==========
    {
        id: 'kanxing-1',
        name: '储备坎巴拉K2号',
        category: SHIP_CATEGORIES.probe.id,
        description: 'K2 火箭的目的，是为了抵达 Mun 或 Minmus，然后安全地回家。ΔV 约 2800 m/s、TWR 约 1.6。',
        dryMass: 2000,
        fuelTanks: { hydrogen: 280, oxygen: 2240 },   // 总燃料 2520 kg（ΔV≈2800 m/s）
        isp: 350,
        maxThrust: 70000,
        moduleSlots: 4,
        unlockCondition: 'always',
        family: 'kanxing',
        tier: 1,
        engineType: 'chemical',
        cost: 50,
        scienceCost: 0,
        momentOfInertia: 500,
        reactionWheelTorque: 10
    },

    // ========== ③ 杜纳往返船（深空） ==========
    {
        id: 'duna_return',
        name: '杜纳往返船',
        category: SHIP_CATEGORIES.interplanetary.id,
        description: '为 Duna 系往返设计的深空船：ΔV 约 4200 m/s、TWR 约 1.42。转移窗口需要时间加速，别急着点油门。',
        dryMass: 6000,
        fuelTanks: { hydrogen: 1390, oxygen: 11120 },  // 总燃料 12510 kg（ΔV≈4200 m/s）
        isp: 380,
        maxThrust: 258000,
        moduleSlots: 6,
        unlockCondition: 'always',
        family: 'duna',
        tier: 1,
        engineType: 'chemical',
        cost: 120,
        scienceCost: 0,
        momentOfInertia: 1500,
        reactionWheelTorque: 30
    }
];

// 取飞船模板的船体图路径（0.3.0：按 templateId 实时解析，不随建船快照，老存档飞船同样生效）
// isActive: 是否受控（决定取 active / inactive 态）
// 返回 null 表示模板未配置自有船体图，调用方回退通用兜底图
export function getShipBodyTexture(templateId, isActive) {
    const template = SHIP_TEMPLATES.find(t => t.id === templateId);
    const textures = template && template.textures;
    if (!textures) return null;
    return (isActive ? textures.active : textures.inactive)
        || textures.active
        || textures.inactive
        || null;
}
