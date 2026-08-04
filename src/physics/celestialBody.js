const PHYSICAL_TO_DISPLAY_SCALE = 1;

export class CelestialBody {
    constructor(options) {
        const {
            name = '',
            gm = 0,
            soiRadius = 0,
            position = { x: 0, y: 0 },
            color = '#888888',
            displayRadius = null,
            // 天体驱动器 6.5步
            type = 'planet',
            orbitParent = null,
            orbitA = 0,
            orbitE = 0,
            orbitOmega = 0,
            orbitTheta0 = 0,
            isHomeworld = false,
            defaultOrbitAltitude = null,
            // 第一阶段：大气引爆与纹理支持
            radius = 0,
            atmosphereHeight = 0,
            hasAtmosphere = false,
            textureKey = null
        } = options;

        this.name = name;
        this.gm = gm;
        this.soiRadius = soiRadius;
        this.position = position;
        this.color = color;
        this.displayRadius = displayRadius !== null
            ? displayRadius
            : Math.round(radius * PHYSICAL_TO_DISPLAY_SCALE);

        // 天体驱动器 6.5步
        this.type = type;
        this.orbitParent = orbitParent;
        this.orbitA = orbitA;
        this.orbitE = orbitE;
        this.orbitOmega = orbitOmega;
        this.orbitTheta0 = orbitTheta0;
        this.isHomeworld = isHomeworld;
        this.defaultOrbitAltitude = defaultOrbitAltitude;

        // 第一阶段：大气引爆与纹理支持
        this.radius = radius;
        this.atmosphereHeight = atmosphereHeight;
        this.hasAtmosphere = hasAtmosphere;
        this.textureKey = textureKey || name.toLowerCase();

        // 天体在星系参考系中的绝对速度
        this.velocity = { x: 0, y: 0 };
    }
}
