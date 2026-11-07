'use strict';

// 部件系统 - 官方预设飞船蓝图（parts[] 格式，未来直接替代 shipTemplates.js）
// 所有坐标严格满足：子部件 position = 父节点世界坐标 - 子节点局部坐标（或径向圆柱贴合公式）。

import { getPartType } from './partTypes.js';

export const SHIP_PRESETS = [
    {
        id: 'preset_k2_standard',
        name: '坎星K2号·标准型',
        description: '经典三件套入轨飞船（Mk1 指挥舱 + FL-T400 燃料罐 + LV-909 引擎），适合验证基础轨道机动。',
        design: {
            name: '坎星K2号·标准型',
            nextSeq: 4,
            parts: [
                {
                    id: 'p1',
                    typeId: 'pod_mk1',
                    parentId: null,
                    attachMode: 'root',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, 0, 0],
                    rotationY: 0
                },
                {
                    id: 'p2',
                    typeId: 'tank_fl_t400',
                    parentId: 'p1',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -1.85, 0],
                    rotationY: 0
                },
                {
                    id: 'p3',
                    typeId: 'engine_lv909',
                    parentId: 'p2',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -3.35, 0],
                    rotationY: 0
                }
            ]
        }
    },

    {
        id: 'preset_deep_explorer',
        name: '深空探测者·对称助推型',
        description: '搭载 M700 资源扫描雷达（.obj 模型）、OKTO 无人核心与 2x 径向对称副油箱的长航程探测船。',
        design: {
            name: '深空探测者·对称助推型',
            nextSeq: 7,
            parts: [
                {
                    id: 'p1',
                    typeId: 'probe_okto',
                    parentId: null,
                    attachMode: 'root',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, 0, 0],
                    rotationY: 0
                },
                {
                    id: 'p2',
                    typeId: 'science_scanner_m700',
                    parentId: 'p1',
                    attachMode: 'node',
                    parentNodeId: 'top',
                    selfNodeId: 'bottom',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, 0.62, 0],
                    rotationY: 0
                },
                {
                    id: 'p3',
                    typeId: 'tank_fl_t400',
                    parentId: 'p1',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -1.25, 0],
                    rotationY: 0
                },
                {
                    id: 'p4',
                    typeId: 'tank_radial_r100',
                    parentId: 'p3',
                    attachMode: 'surface',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: 'sym_1',
                    symmetryCount: 2,
                    stage: 0,
                    position: [0.925, -1.25, 0],
                    rotationY: 0
                },
                {
                    id: 'p5',
                    typeId: 'tank_radial_r100',
                    parentId: 'p3',
                    attachMode: 'surface',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: 'sym_1',
                    symmetryCount: 2,
                    stage: 0,
                    position: [-0.925, -1.25, 0],
                    rotationY: Math.PI
                },
                {
                    id: 'p6',
                    typeId: 'engine_lv909',
                    parentId: 'p3',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -2.75, 0],
                    rotationY: 0
                }
            ]
        }
    },

    {
        id: 'preset_origin_assets',
        name: '原创资产验证船',
        description: '完全原创的 clean-room 部件（KS-1 真空引擎 + KT-1 低温贮箱），用旋转成型几何 + 程序化材质达到 KSP 档次质感。',
        design: {
            name: '原创资产验证船',
            nextSeq: 4,
            parts: [
                {
                    id: 'p1',
                    typeId: 'pod_mk1',
                    parentId: null,
                    attachMode: 'root',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, 0, 0],
                    rotationY: 0
                },
                {
                    id: 'p2',
                    typeId: 'origin_tank_1v_1x4',
                    parentId: 'p1',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -1.87, 0],
                    rotationY: 0
                },
                {
                    id: 'p3',
                    typeId: 'origin_engine_vac_1v',
                    parentId: 'p2',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -3.46, 0],
                    rotationY: 0
                }
            ]
        }
    },

    {
        id: 'preset_ksp2_assets',
        name: 'KSP2 官方资产验证船',
        description: '全部使用 KSP2 官方 OBJ + PBR 贴图资产（指挥舱 / 贮箱 / 真空引擎），用于评估真实资产管线与质感。',
        design: {
            name: 'KSP2 官方资产验证船',
            nextSeq: 4,
            parts: [
                {
                    id: 'p1',
                    typeId: 'ksp_pod_1v',
                    parentId: null,
                    attachMode: 'root',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, 0, 0],
                    rotationY: 0
                },
                {
                    id: 'p2',
                    typeId: 'ksp_tank_1v_1x2',
                    parentId: 'p1',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -0.9655, 0],
                    rotationY: 0
                },
                {
                    id: 'p3',
                    typeId: 'ksp_engine_terrier',
                    parentId: 'p2',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -1.8665, 0],
                    rotationY: 0
                }
            ]
        }
    },

    {
        id: 'preset_orbital_engineer',
        name: '轨道工程舰·全功能型',
        description: '集成轨道建设舱、2000kg 加压货仓、高扭矩动量轮、4x 径向副油箱与 LV-T30 主引擎的重型工程母舰。',
        design: {
            name: '轨道工程舰·全功能型',
            nextSeq: 11,
            parts: [
                {
                    id: 'p1',
                    typeId: 'pod_mk1',
                    parentId: null,
                    attachMode: 'root',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, 0, 0],
                    rotationY: 0
                },
                {
                    id: 'p2',
                    typeId: 'struct_reaction_wheel',
                    parentId: 'p1',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -1.12, 0],
                    rotationY: 0
                },
                {
                    id: 'p3',
                    typeId: 'utility_construction_bay',
                    parentId: 'p2',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -1.84, 0],
                    rotationY: 0
                },
                {
                    id: 'p4',
                    typeId: 'cargo_bay_mk2',
                    parentId: 'p3',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -2.99, 0],
                    rotationY: 0
                },
                {
                    id: 'p5',
                    typeId: 'tank_fl_t400',
                    parentId: 'p4',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -4.59, 0],
                    rotationY: 0
                },
                {
                    id: 'p6',
                    typeId: 'tank_radial_r100',
                    parentId: 'p5',
                    attachMode: 'surface',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: 'sym_eng_4',
                    symmetryCount: 4,
                    stage: 0,
                    position: [0.925, -4.59, 0],
                    rotationY: 0
                },
                {
                    id: 'p7',
                    typeId: 'tank_radial_r100',
                    parentId: 'p5',
                    attachMode: 'surface',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: 'sym_eng_4',
                    symmetryCount: 4,
                    stage: 0,
                    position: [0, -4.59, 0.925],
                    rotationY: -Math.PI / 2
                },
                {
                    id: 'p8',
                    typeId: 'tank_radial_r100',
                    parentId: 'p5',
                    attachMode: 'surface',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: 'sym_eng_4',
                    symmetryCount: 4,
                    stage: 0,
                    position: [-0.925, -4.59, 0],
                    rotationY: -Math.PI
                },
                {
                    id: 'p9',
                    typeId: 'tank_radial_r100',
                    parentId: 'p5',
                    attachMode: 'surface',
                    parentNodeId: null,
                    selfNodeId: null,
                    symmetryGroupId: 'sym_eng_4',
                    symmetryCount: 4,
                    stage: 0,
                    position: [0, -4.59, -0.925],
                    rotationY: -Math.PI * 1.5
                },
                {
                    id: 'p10',
                    typeId: 'engine_reliant',
                    parentId: 'p5',
                    attachMode: 'node',
                    parentNodeId: 'bottom',
                    selfNodeId: 'top',
                    symmetryGroupId: null,
                    symmetryCount: 1,
                    stage: 0,
                    position: [0, -6.29, 0],
                    rotationY: 0
                }
            ]
        }
    }
];

export function getShipPreset(presetId) {
    const found = SHIP_PRESETS.find(p => p.id === presetId) || SHIP_PRESETS[0];
    return JSON.parse(JSON.stringify(found));
}

export function getAllShipPresets() {
    return SHIP_PRESETS.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description
    }));
}

/**
 * 剔除引用了「已不存在的部件」的预设蓝图。
 * 典型场景：KSP2 官方资产不入库（见 .gitignore），本地未导入时
 * 相关预设会加载出空船 —— 直接把它从列表里摘掉，避免误导。
 * @returns {number} 被剔除的预设数
 */
export function prunePresetsWithMissingParts() {
    const before = SHIP_PRESETS.length;
    for (let i = SHIP_PRESETS.length - 1; i >= 0; i--) {
        const missing = SHIP_PRESETS[i].design.parts.some((p) => !getPartType(p.typeId));
        if (missing) SHIP_PRESETS.splice(i, 1);
    }
    return before - SHIP_PRESETS.length;
}
