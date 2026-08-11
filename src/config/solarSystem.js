"use strict";

import { CelestialBody } from '../physics/celestialBody.js';

// 天体驱动器 6.5步
// Kerbol 系天体数据 — 真实 KSP 尺度（第一阶段：仅 Kerbol + Kerbin + Mun）
export const solarSystemData = [
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
        textureKey: 'kerbol'
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
        defaultOrbitAltitude: 80000,
        presetOrbits: { low: 80000, mid: 250000, high: 600000 },
        textureKey: 'kerbin'
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
        textureKey: 'mun'
    }),
    new CelestialBody({
        name: 'Minmus',
        type: 'moon',
        musicType: 'rocky',
        gm: 1.7658e9,
        soiRadius: 2247428.3,
        radius: 60000,
        atmosphereHeight: 0,
        hasAtmosphere: false,
        color: '#aad7ff',
        orbitParent: 'Kerbin',
        orbitA: 47000000,
        orbitE: 0,
        orbitOmega: 38,    // 保留官方近点幅角数据（e=0 时无实际影响）
        orbitTheta0: 0.9,  // 官方初始平近点角
        textureKey: 'minmus'
    })
];

// ========== 星系元数据（数据驱动） ==========
// 星系级信息独立存放，不混入天体数据本体
// 数组结构为将来多星系加载预留扩展点；当前仅 Kerbolar 系一个星系
// description 采用游戏百科"天体档案"文风（温暖叙事 + 幽默点睛）
export const starSystemMeta = [
    {
        id: 'kerbolar',
        name: 'Kerbolar 系',
        description: '恒星 Kerbol 高悬于 Kerbolar 星系正中，以近乎炫耀的亮度与引力维系着整个家族的运转。环绕它的天体各司其职：Kerbin 以湛蓝的海洋和柔软的大气欢迎每一位到访者，Mun 与 Minmus 则安静地陪在它身旁——一个布满撞击坑，一个光滑得令人怀疑人生。坎巴拉航天中心在此温馨提醒：无论恒星多么璀璨，直视前请先确认面罩已经拉好。',
        enabled: true
    }
];
