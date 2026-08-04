"use strict";

import { CelestialBody } from '../physics/celestialBody.js';

// 天体驱动器 6.5步
// 临时太阳系数据（6.5步）
export const solarSystemData = [
    new CelestialBody({
        name: 'Kerbol',
        type: 'star',
        gm: 100000,
        soiRadius: 2000,
        displayRadius: 80,
        color: '#ffcc44',
        position: { x: 0, y: 0 }
    }),
    new CelestialBody({
        name: 'Kerbin',
        type: 'planet',
        gm: 10000,
        soiRadius: 400,
        displayRadius: 50,
        color: '#4488ff',
        orbitParent: 'Kerbol',
        orbitA: 500,
        orbitE: 0,
        orbitOmega: 0,
        orbitTheta0: 0,
        isHomeworld: true,
        defaultOrbitAltitude: 30,
        presetOrbits: { low: 30, mid: 90, high: 200 }
    }),
    new CelestialBody({
        name: 'Mun',
        type: 'moon',
        gm: 400,
        soiRadius: 60,
        displayRadius: 25,
        color: '#aaaaaa',
        orbitParent: 'Kerbin',
        orbitA: 300,
        orbitE: 0,
        orbitOmega: 0,
        orbitTheta0: 0,
        presetOrbits: { low: 10, mid: 20, high: 30 }
    })
];
