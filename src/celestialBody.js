<<<<<<< HEAD
"use strict";

export class CelestialBody {
    constructor(options) {
        const {
            name = '',
            gm = 0,
            soiRadius = 0,
            position = { x: 0, y: 0 },
            color = '#888888',
            displayRadius = 10,
            // TEMP: 天体驱动器 6.5步
            type = 'planet',
            orbitParent = null,
            orbitA = 0,
            orbitE = 0,
            orbitOmega = 0,
            orbitTheta0 = 0
        } = options;

        this.name = name;
        this.gm = gm;
        this.soiRadius = soiRadius;
        this.position = position;
        this.color = color;
        this.displayRadius = displayRadius;

        // TEMP: 天体驱动器 6.5步
        this.type = type;
        this.orbitParent = orbitParent;
        this.orbitA = orbitA;
        this.orbitE = orbitE;
        this.orbitOmega = orbitOmega;
        this.orbitTheta0 = orbitTheta0;

        // TEMP: 第六阶段-SOI速度修复 — 天体在星系参考系中的绝对速度
        this.velocity = { x: 0, y: 0 };
    }
}
=======
"use strict";

export class CelestialBody {
    constructor(options) {
        const {
            name = '',
            gm = 0,
            soiRadius = 0,
            position = { x: 0, y: 0 },
            color = '#888888',
            displayRadius = 10,
            // TEMP: 天体驱动器 6.5步
            type = 'planet',
            orbitParent = null,
            orbitA = 0,
            orbitE = 0,
            orbitOmega = 0,
            orbitTheta0 = 0
        } = options;

        this.name = name;
        this.gm = gm;
        this.soiRadius = soiRadius;
        this.position = position;
        this.color = color;
        this.displayRadius = displayRadius;

        // TEMP: 天体驱动器 6.5步
        this.type = type;
        this.orbitParent = orbitParent;
        this.orbitA = orbitA;
        this.orbitE = orbitE;
        this.orbitOmega = orbitOmega;
        this.orbitTheta0 = orbitTheta0;

        // TEMP: 第六阶段-SOI速度修复 — 天体在星系参考系中的绝对速度
        this.velocity = { x: 0, y: 0 };
    }
}
>>>>>>> 55f6279aebd46ce585c067f1d4da2d8791092413
