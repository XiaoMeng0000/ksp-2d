'use strict';

// 引擎类型表（0.2.0）
// 燃料配方定义在引擎上（KSP 风格：每个引擎自带 propellant 列表与比例）
// stage: 'now' 本期实现 / 'later' 占位（等对应引擎玩法扩展）

export const ENGINE_TYPES = [
    { id: 'chemical', props: [{ id: 'hydrogen', ratio: 1 }, { id: 'oxygen', ratio: 8 }], stage: 'now' },
    { id: 'metallicH', props: [{ id: 'metallicHydrogen', ratio: 1 }], stage: 'later' },
    { id: 'fusion', props: [{ id: 'deuterium', ratio: 1 }, { id: 'helium3', ratio: 1 }], stage: 'later' },
    { id: 'nswr', props: [{ id: 'nuclearSaltWater', ratio: 1 }], stage: 'later' },
    { id: 'orion', props: [{ id: 'fissionPellets', ratio: 1 }], stage: 'later' },
    { id: 'ion', props: [{ id: 'xenon', ratio: 1 }], stage: 'later' },
    { id: 'antimatter', props: [{ id: 'antimatter', ratio: 1 }], stage: 'later' }
];

// 获取引擎类型定义
export function getEngineType(engineId) {
    return ENGINE_TYPES.find(e => e.id === engineId) || null;
}
