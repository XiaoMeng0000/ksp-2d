'use strict';

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
            // 音乐分类（音频层使用，与物理 type 解耦）
            // 取值：terrestrial / icy / rocky / gas / eve / duna / mun / star 等，null 表示未分类
            musicType = null,
            orbitParent = null,
            orbitA = 0,
            orbitE = 0,
            orbitOmega = 0,
            orbitTheta0 = 0,
            isHomeworld = false,
            defaultOrbitAltitude = null,
            // 预设轨道高度档位（debugUI 部署窗口使用，如 { low, mid, high }）
            presetOrbits = null,
            // 第一阶段：大气引爆与纹理支持
            radius = 0,
            atmosphereHeight = 0,
            hasAtmosphere = false,
            // 渲染查找键（renderableManager 的注册键，允许自定义，如测试星系的 'testbolar_star'）
            textureKey = null,
            // 0.3.0：天体表面贴图路径（就地声明在天体配置里；null = 无贴图，走代表色纯色兜底）
            texture = null
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
        this.musicType = musicType;
        this.orbitParent = orbitParent;
        this.orbitA = orbitA;
        this.orbitE = orbitE;
        this.orbitOmega = orbitOmega;
        this.orbitTheta0 = orbitTheta0;
        this.isHomeworld = isHomeworld;
        this.defaultOrbitAltitude = defaultOrbitAltitude;
        this.presetOrbits = presetOrbits;

        // 第一阶段：大气引爆与纹理支持
        this.radius = radius;
        this.atmosphereHeight = atmosphereHeight;
        this.hasAtmosphere = hasAtmosphere;
        this.textureKey = textureKey || name.toLowerCase();
        // 0.3.0：注意必须显式透传 —— 切换星系时天体经 structuredClone 克隆，只保留自有属性
        this.texture = texture;

        // 天体在星系参考系中的绝对速度
        this.velocity = { x: 0, y: 0 };
    }
}
