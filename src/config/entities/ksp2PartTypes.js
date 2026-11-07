'use strict';

// KSP2 官方部件资产（OBJ + MTL + PBR 贴图）接入层
//
// 与 partTypes.js 的程序化部件并存：本文件只声明「资产从哪里来」+ 玩法数值，
// 几何完全由 assets/models/ksp2/<part>/*.obj 提供（不生成任何程序化形状）。
//
// 尺寸与节点口径（重要）：
//   KSP2 导出为 Y 轴向上、标准级直径 1.25m；加载器会把几何垂直居中到原点，
//   因此这里的 halfHeight / attachNodes 都按「居中后」的对称坐标书写。
//   数值来自各 OBJ 的实测包围盒（见 docs/部件实验室技术方案.md 附录 E）。
//
// 数值说明：mass / cost / thrust / isp 为**占位平衡值**，尚未按 KSP2 原始 cfg 标定，
// 待玩法数值确定后统一修订（不改资产管线）。

function ksp2Part(def) {
    return {
        source: 'ksp2',
        ksp2: {
            dir: 'assets/models/ksp2/' + def.asset,
            obj: def.asset + '.obj',
            mtl: def.asset + '.mtl'
        },
        visual: { modelPath: null, primitives: [] },
        // KSP2 部件没有程序化图元，几何指标必须显式给出
        metrics: {
            halfHeight: def.halfHeight,
            radius: def.radius,
            centroid: [0, 0, 0],
            unitMoiZ: def.unitMoiZ !== undefined ? def.unitMoiZ : 0.25
        },
        collider: {
            radius: def.radius,
            halfHeight: def.halfHeight,
            allowSurfaceAttach: def.allowSurfaceAttach === true,
            allowSurfaceChildren: def.allowSurfaceChildren !== false,
            srfAttachOffset: [def.radius, 0, 0]
        },
        attachNodes: [
            { id: 'top',    position: [0,  def.halfHeight, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -def.halfHeight, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: def.resources || null,
        engine: def.engine || null,
        reactionWheelTorque: def.reactionWheelTorque || 0,
        capability: def.capability || null,
        scanTier: def.scanTier || 0,
        cargoCapacity: def.cargoCapacity || 0,
        id: def.id,
        name: def.name,
        category: def.category,
        description: def.description,
        mass: def.mass,
        cost: def.cost
    };
}

export const KSP2_PART_TYPES = [
    ksp2Part({
        id: 'ksp_pod_1v',
        asset: 'pod_1v_conical_crew',
        name: 'Mk1 锥形指挥舱 (KSP2)',
        category: 'command',
        description: 'KSP2 官方 1 级锥形载人指令舱资产（含玻璃舷窗材质），自带基础动量轮。',
        mass: 840,
        cost: 80,
        halfHeight: 0.4815,
        radius: 0.625,
        unitMoiZ: 0.09,
        reactionWheelTorque: 12.0
    }),

    ksp2Part({
        id: 'ksp_tank_1v_1x2',
        asset: 'fueltank_1v_inline_methalox_1x2',
        name: '1v 甲烷/液氧贮箱 1x2 (KSP2)',
        category: 'tank',
        description: 'KSP2 官方标准级双组元贮箱（长度 1x2），带蒙皮细节与低温绝热贴图，可侧面径向挂载。',
        mass: 180,
        cost: 90,
        halfHeight: 0.484,
        radius: 0.625,
        unitMoiZ: 0.08,
        resources: {
            methane: { amount: 600, capacity: 600 },
            oxygen:  { amount: 2400, capacity: 2400 }
        }
    }),

    ksp2Part({
        id: 'ksp_engine_terrier',
        asset: 'engine_1v_methalox_terrier',
        name: 'LV-909 "小猎犬" 真空引擎 (KSP2)',
        category: 'engine',
        description: 'KSP2 官方真空级发动机资产（含燃烧室与喷管全细节、自发光贴图），高比冲轨道机动用。',
        mass: 400,
        cost: 120,
        halfHeight: 0.417,
        radius: 0.631,
        unitMoiZ: 0.10,
        engine: { engineType: 'methalox', maxThrust: 60000, isp: 345 }
    }),

    ksp2Part({
        id: 'ksp_engine_reliant',
        asset: 'engine_1v_methalox_reliant',
        name: 'LV-T30 "可靠" 主引擎 (KSP2)',
        category: 'engine',
        description: 'KSP2 官方 1 级主发动机资产（4 个子网格 / 22k 三角形，含整流罩与端盖材质），大推力起飞级。',
        mass: 1250,
        cost: 220,
        halfHeight: 0.971,
        radius: 0.639,
        unitMoiZ: 0.16,
        engine: { engineType: 'methalox', maxThrust: 240000, isp: 310 }
    }),

    ksp2Part({
        id: 'ksp_decoupler_1v',
        asset: 'decoupler_1v_inline',
        name: '1v 级间分离环 (KSP2)',
        category: 'structure',
        description: 'KSP2 官方标准级分离环资产，用于级间结构过渡与分级标记。',
        mass: 50,
        cost: 40,
        halfHeight: 0.08,
        radius: 0.625,
        unitMoiZ: 0.02,
        allowSurfaceChildren: false
    }),

    ksp2Part({
        id: 'ksp_reactionwheel_1v',
        asset: 'stabilizer_1v_reactionwheel',
        name: '1v 动量轮组 (KSP2)',
        category: 'structure',
        description: 'KSP2 官方标准级动量轮资产，提供姿态控制扭矩。',
        mass: 120,
        cost: 90,
        halfHeight: 0.1995,
        radius: 0.676,
        unitMoiZ: 0.05,
        reactionWheelTorque: 22.0
    })
];

export function getKsp2PartType(typeId) {
    return KSP2_PART_TYPES.find((p) => p.id === typeId) || null;
}

/**
 * 探测本地是否已导入 KSP2 资产包（仓库不包含这些资产，见 .gitignore）。
 * 未导入时，调用方应把带 `.ksp2` 标记的部件从部件表中剔除，
 * 避免车间里出现「点得动但看不见」的死格子。
 * @returns {Promise<boolean>}
 */
export function probeKsp2AssetsAvailable() {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    return fetch('assets/models/ksp2/index.json', { cache: 'no-store' })
        .then((r) => r.ok)
        .catch(() => false);
}
