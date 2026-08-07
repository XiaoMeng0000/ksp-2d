"use strict";

import { CelestialBody } from '../physics/celestialBody.js';

// 天体驱动器 6.5步
// Kerbol 系天体数据 — 真实 KSP 尺度（第一阶段：仅 Kerbol + Kerbin）
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
    })
];
