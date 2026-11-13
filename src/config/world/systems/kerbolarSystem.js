'use strict';

import { CelestialBody } from '../../../physics/celestialBody.js';

// ========== Kerbolar 系(家园星系) ==========
// 尝鲜版裁剪(见 docs/尝鲜版方案.md 第三节):只保留 Kerbin 系与 Duna 系,共 6 个天体
//   恒星 Kerbol / 行星 Kerbin(家园)+ 卫星 Mun、Minmus / 行星 Duna + 卫星 Ike
// 已移除:Moho、Eve、Gilly、Dres、Jool、Laythe、Vall、Tylo、Bop、Pol、Eeloo
//
// 尝鲜版不加载任何天体贴图(texture 字段一律为 null),渲染层走代表色纯色圆盘;
// 恒星 Kerbol 由 bodyRenderables 的程序光晕层绘制。
// textureKey 保留:渲染例外表(程序层)与天体图标染色仍按它查表。
//
// homeworld 星系:恒星固定在全局坐标原点 (0,0)
// distance/bearingDeg 仅在本星系不作为 homeworld 时使用(未来多 homeworld 候选预留)

export const meta = {
    id: 'kerbolar',
    name: 'Kerbolar 系',
    description: 'Kerbolar 系的家园部分:恒星 Kerbol,以及 Kerbin 与 Duna 两个行星系。尝鲜版只开放这一片区域,Moho、Eve、Dres、Jool 与 Eeloo 等天体在完整版中开放。',
    enabled: true,
    placeholder: false,
    distance: 0,
    bearingDeg: 0
};

export const bodies = [
    new CelestialBody({
        name: 'Kerbol',
        type: 'star',
        musicType: 'star',
        gm: 1.1723328e18,
        soiRadius: 1e13,
        radius: 261600000,
        atmosphereHeight: 600000,
        hasAtmosphere: true,
        color: '#ffcc44',
        position: { x: 0, y: 0 },
        textureKey: 'kerbol',
        texture: null
    }),
    new CelestialBody({
        name: 'Kerbin',
        type: 'planet',
        musicType: 'terrestrial',
        gm: 3.5316e12,
        soiRadius: 84159286,
        radius: 600000,
        atmosphereHeight: 70000,
        hasAtmosphere: true,
        color: '#4488ff',
        orbitParent: 'Kerbol',
        orbitA: 13599840256,
        orbitE: 0,
        orbitOmega: 0,
        orbitTheta0: 0,
        isHomeworld: true,
        defaultOrbitAltitude: 300000,
        presetOrbits: { low: 80000, mid: 250000, high: 600000 },
        textureKey: 'kerbin',
        texture: null
    }),
    new CelestialBody({
        name: 'Mun',
        type: 'moon',
        musicType: 'mun',
        gm: 6.5138398e10,
        soiRadius: 2429559.1,
        radius: 200000,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#b4b4b4',
        orbitParent: 'Kerbin',
        orbitA: 12000000,
        orbitE: 0,
        orbitOmega: 0,
        orbitTheta0: 1.7,
        textureKey: 'mun',
        texture: null
    }),
    new CelestialBody({
        name: 'Minmus',
        type: 'moon',
        musicType: 'ice',
        gm: 1.7658e9,
        soiRadius: 2247428.3,
        radius: 60000,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#aad7ff',
        orbitParent: 'Kerbin',
        orbitA: 47000000,
        orbitE: 0,
        orbitOmega: Math.PI * 38 / 180,  // 保留官方近点幅角数据 38°（单位统一为弧度）
        orbitTheta0: 0.9,  // 官方初始平近点角
        textureKey: 'minmus',
        texture: null
    }),
    new CelestialBody({
        name: 'Duna',
        type: 'planet',
        musicType: 'duna',
        gm: 3.01363211975098e11,
        soiRadius: 47921949,
        radius: 320000,
        atmosphereHeight: 50000,
        hasAtmosphere: true,
        color: '#ad3713',
        orbitParent: 'Kerbol',
        orbitA: 20726155264,
        orbitE: 0.051,
        orbitOmega: 0,
        orbitTheta0: 3.14,
        textureKey: 'duna',
        texture: null
    }),
    new CelestialBody({
        name: 'Ike',
        type: 'moon',
        musicType: 'rocky',
        gm: 1.85683685731441e10,
        soiRadius: 1049598.9,
        radius: 130000,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#919191',
        orbitParent: 'Duna',
        orbitA: 3200000,
        orbitE: 0.03,
        orbitOmega: 0,
        orbitTheta0: 1.7,
        textureKey: 'ike',
        texture: null
    })
];
