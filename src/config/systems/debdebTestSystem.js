"use strict";

import { CelestialBody } from '../../physics/celestialBody.js';

// ========== Debdeb (test) 星系(实体测试星系) ==========
// 用途:验证跨星系航行、星系加载、SOI 重叠拒绝
// 组成:仅 1 个恒星(数据抄 Kerbol (test),缩放尺度)
// 方位:距 Testbolar 系 5km(@ bearingDeg 45° 右上方)
//   5km > SOI 和(2000+2000=4000) → 与 testbolar 可同时加载
//   若把 distance 改近(如 < 4km) → validateSystemSelection 应拒绝(负面测试)
// 纹理:未注册 textureKey,渲染回退纯色圆

export const meta = {
    id: 'debdeb_test',
    name: 'Debdeb (test)',
    description: 'Debdeb (test) 是一个仅含恒星的实体测试星系，驻扎在 Testbolar 系的右上方。它没有行星，没有卫星，只有一颗孤零零的恒星——为验证跨星系航行而生。\n\n把它与 Testbolar 系一起勾选，就可以驾驶飞船跨越深空，见证恒星从黄点变为大火球的全过程。',
    enabled: true,
    placeholder: false,
    // 5km 换算光年:5000 / 9.46073e15 ≈ 5.286e-13
    distance: 5.286e-13,
    bearingDeg: 45
};

export const bodies = [
    new CelestialBody({
        name: 'Debbol (test)',
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
        textureKey: 'debdeb_test_star'  // 未注册 → 渲染回退纯色圆
    })
];
