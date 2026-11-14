'use strict';

// 部件装配车间（PartLab / KSP VAB）相机、光照、拾取与对称吸附配置

export const PART_LAB_CONFIG = {
    editor: { historyLimit: 50, dragThresholdPx: 3 },
    camera: {
        fovYDeg: 38,
        near: 0.1,
        far: 200,
        distance: 9.2,
        minDistance: 2.5,
        maxDistance: 45,
        theta: 0.45,
        phi: Math.PI / 2 - 0.22,
        phiMin: 0.08,
        phiMax: Math.PI - 0.08,
        rotateSpeed: 0.0055,
        panSpeed: 0.008,
        zoomPerPixel: 0.001
    },
    lighting: {
        dir: [0.55, 0.65, 0.52],
        ambient: 0.26,
        diffuse: 0.82,
        specular: 0.68,
        shininess: 48
    },
    backgrounds: [
        { id: 'hangar', label: 'VAB 车间灰蓝', css: '#151b26' },
        { id: 'space',  label: '深空轨检黑',   css: '#06080e' },
        { id: 'blueprint', label: '工程制图蓝', css: '#0d2137' }
    ],
    picking: {
        partRadiusMinPx: 10,
        nodeSnapPx: 42
    },
    symmetryModes: [1, 2, 3, 4, 6, 8],
    mesh: {
        segments: 32,
        sphereRings: 16
    }
};
