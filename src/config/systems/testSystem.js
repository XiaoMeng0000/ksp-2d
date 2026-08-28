"use strict";

import { CelestialBody } from '../../physics/celestialBody.js';

// ========== Testbolar 系(测试家园星系) ==========
// 原型:6.5 步「临时太阳系数据」(v0.2.3 根提交,缩放尺度)
// 用途:验证多星系 homeworld 切换;天体名带 (test) 后缀避免与 Kerbolar 系同名冲突
// 纹理:显式使用未注册 textureKey,渲染层回退纯色圆(不新增/复用任何纹理资源)
// homeworld 星系:选中时恒星固定在全局坐标原点 (0,0)
// 协议:与 Kerbolar 系互斥(恰好一个 homeworld),由 validateSystemSelection 保证

export const meta = {
    id: 'testbolar',
    name: 'Testbolar 系',
    description: '这是早期规划中的简化太阳系的复刻版——一颗明亮的恒星、一颗宜居的家园行星和它的卫星。所有天体均以「(test)」标记与正式天体区分，数据留白处由渲染回退纯色呈现。\n\n这里的一切都是为了测试：家园切换、轨道计算、存档兼容。请尽情折腾。',
    enabled: true,
    placeholder: false,
    // 仅在"本星系不作为 homeworld 时"用于摆放恒星位置;作为 homeworld 时忽略(固定原点)
    distance: 1.2,
    bearingDeg: 200
};

export const bodies = [
    new CelestialBody({
        name: 'Kerbol (test)',
        type: 'star',
        musicType: 'star',
        gm: 100000,
        soiRadius: 2000,
        radius: 80,
        displayRadius: 80,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#ffcc44',
        position: { x: 0, y: 0 },
        textureKey: 'testbolar_star'  // 未注册 → 渲染回退纯色圆
    }),
    new CelestialBody({
        name: 'Kerbin (test)',
        type: 'planet',
        musicType: 'terrestrial',
        gm: 10000,
        soiRadius: 400,
        radius: 50,
        displayRadius: 50,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#4488ff',
        orbitParent: 'Kerbol (test)',
        orbitA: 500,
        orbitE: 0,
        orbitOmega: 0,
        orbitTheta0: 0,
        isHomeworld: true,
        defaultOrbitAltitude: 30,
        presetOrbits: { low: 30, mid: 90, high: 200 },
        textureKey: 'testbolar_planet'  // 未注册 → 渲染回退纯色圆
    }),
    new CelestialBody({
        name: 'Mun (test)',
        type: 'moon',
        musicType: 'mun',
        gm: 400,
        soiRadius: 60,
        radius: 25,
        displayRadius: 25,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#aaaaaa',
        orbitParent: 'Kerbin (test)',
        orbitA: 300,
        orbitE: 0,
        orbitOmega: 0,
        orbitTheta0: 0,
        presetOrbits: { low: 10, mid: 20, high: 30 },
        textureKey: 'testbolar_moon'  // 未注册 → 渲染回退纯色圆
    })
];
