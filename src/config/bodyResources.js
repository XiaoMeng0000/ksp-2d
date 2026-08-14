'use strict';

// 星球资源配置（0.2.0）— 按 bodyId 关联，与天体物理数据（solarSystem.js）分离
// surface:    地表矿（轨道飞船可挖），abundance 丰度系数 0~1，未列出 = 无
// orbitBands: 轨道资源带，仅 Dres 星环 / Jool 周边等特殊天体使用，其余一律空对象

export const BODY_RESOURCES = {
    kerbin: {
        surface: {
            waterIce: { abundance: 0.8 },
            metallicOre: { abundance: 0.6 },
            rareMetals: { abundance: 0.3 }
        },
        orbitBands: {}
    },
    mun: {
        surface: {
            metallicOre: { abundance: 0.9 },
            rareMetals: { abundance: 0.7 },
            fissileMaterials: { abundance: 0.2 },
            helium3: { abundance: 0.1 }
        },
        orbitBands: {}
    },
    kerbol: {
        surface: {},
        orbitBands: {}
    }
    // dres / jool 等天体加入时，在 orbitBands 里配置轨道资源带
};

// 获取天体资源配置（不存在时返回空结构，避免调用方判空）
// 0.2.0 阶段4：key 归一化 — 配置表用小写 id（kerbin），运行时传入的是天体 name（Kerbin）
export function getBodyResources(bodyId) {
    if (!bodyId) return { surface: {}, orbitBands: {} };
    const key = typeof bodyId === 'string' ? bodyId : String(bodyId);
    return BODY_RESOURCES[key] || BODY_RESOURCES[key.toLowerCase()] || { surface: {}, orbitBands: {} };
}
