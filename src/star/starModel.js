'use strict';

// 恒星渲染的纯计算模块（无 GL 依赖，可在 Node 里单测）。
//
// 职责：参数白名单校验、颜色换算、视觉时间推进、包围盒尺寸、uniform 求解。
// 渲染器（starRenderer.js）只负责 GL 资源与绘制，所有"算什么"都在这里，
// 这样验收工具不开浏览器也能断言参数契约与失败路径。

/**
 * 参数结构（setStar 的子块）。类型码：
 *   color    —— '#rrggbb' 字符串
 *   positive —— 有限数且 > 0
 *   nonneg   —— 有限数且 ≥ 0
 *   unit     —— 有限数且在 [0, 1]
 *   number   —— 任意有限数
 *   boolean  —— true / false
 */
export const STAR_BLOCK_SCHEMA = {
    surface: {
        baseColor: 'color',
        filamentColor: 'color',
        rimColor: 'color',
        filamentScale: 'positive',
        filamentThreshold: 'unit',
        filamentContrast: 'nonneg',
        cellDarkening: 'unit',
        limbDarkening: 'unit',
        rimPower: 'positive',
        rimStrength: 'nonneg',
        rotationRate: 'number',
        flowRate: 'number',
    },
    halo: {
        enabled: 'boolean',
        color: 'color',
        relativeWidth: 'nonneg',
        minWidthPx: 'nonneg',
        strength: 'nonneg',
        rayStrength: 'nonneg',
        rayCount: 'positive',
        reach: 'positive',
        minReachPx: 'nonneg',
    },
    spikes: {
        enabled: 'boolean',
        color: 'color',
        lengthPx: 'nonneg',
        lengthPerRadius: 'nonneg',
        widthPx: 'positive',
        strength: 'nonneg',
        fadeRadiusPx: 'positive',
        fadeCurve: 'positive',
        diagonalStrength: 'nonneg',
    },
    animation: {
        rate: 'nonneg',
        maxVisualDt: 'positive',
    },
    display: {
        exposure: 'positive',
    },
};

/** 外观子块名（换恒星时必须全部给齐） */
export const STAR_BLOCK_NAMES = Object.keys(STAR_BLOCK_SCHEMA);

/** setStar 顶层可接受的全部字段 */
export const STAR_TOP_KEYS = ['screenRadiusPx', 'occlusion'].concat(STAR_BLOCK_NAMES);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** 显示伽马（与着色器输出编码同值；颜色换算与输出必须互逆） */
export const DISPLAY_GAMMA = 2.2;

/** 目标色换算 HDR 时的线性上限：1 − exp(−x) 永远到不了 1，需要封顶 */
const HDR_LINEAR_CAP = 0.985;

function checkValue(type, value) {
    switch (type) {
        case 'color':
            return typeof value === 'string' && HEX_COLOR.test(value);
        case 'positive':
            return typeof value === 'number' && Number.isFinite(value) && value > 0;
        case 'nonneg':
            return typeof value === 'number' && Number.isFinite(value) && value >= 0;
        case 'unit':
            return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        default:
            return false;
    }
}

/**
 * 校验一个外观子块：缺字段 / 不认字段 / 类型错 一律显式报错（不静默、不补默认）。
 * @param {string} name 子块名（surface / halo / ...）
 * @param {object} block
 * @returns {object} 冻结的浅拷贝
 */
export function validateStarBlock(name, block) {
    const schema = STAR_BLOCK_SCHEMA[name];
    if (!schema) {
        throw new Error('setStar: 未知子块 "' + name + '"，可用子块: ' + STAR_BLOCK_NAMES.join(', '));
    }
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
        throw new Error('setStar: 子块 ' + name + ' 必须是对象（收到 ' + JSON.stringify(block) + '）');
    }
    const unknown = Object.keys(block).filter((key) => !(key in schema));
    if (unknown.length > 0) {
        throw new Error('setStar: 子块 ' + name + ' 收到不认的字段: ' + unknown.join(', ')
            + ' —— 可用字段: ' + Object.keys(schema).join(', '));
    }
    const missing = Object.keys(schema).filter((key) => !(key in block));
    if (missing.length > 0) {
        throw new Error('setStar: 子块 ' + name + ' 缺字段: ' + missing.join(', ')
            + ' —— 恒星参数不补默认值，请从预设完整传入');
    }
    Object.keys(schema).forEach((key) => {
        if (!checkValue(schema[key], block[key])) {
            throw new Error('setStar: ' + name + '.' + key + ' 非法（期望 ' + schema[key]
                + '，收到 ' + JSON.stringify(block[key]) + '）');
        }
    });
    return Object.freeze(Object.assign({}, block));
}

/**
 * 校验屏幕半径（设备像素）：必须是有限正数。
 * @param {number} value
 * @returns {number}
 */
export function validateScreenRadius(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error('setStar: screenRadiusPx 必须是有限正数（设备像素），收到 ' + JSON.stringify(value)
            + ' —— 恒星太小不该画时由接入侧不调用 render，而不是传 0');
    }
    return value;
}

/**
 * 校验遮挡系数：0 = 完全可见，1 = 完全遮住。
 * @param {number} value
 * @returns {number}
 */
export function validateOcclusion(value) {
    if (!checkValue('unit', value)) {
        throw new Error('setStar: occlusion 必须在 [0, 1]，收到 ' + JSON.stringify(value));
    }
    return value;
}

/**
 * 把 setStar 的入参合并进当前状态（合并语义：只更新给出的顶层字段）。
 * 子块整块替换、整块校验；第一次 setStar 必须给齐全部外观子块。
 * @param {object|null} current 当前状态（null = 还没有恒星）
 * @param {object} incoming setStar 入参
 * @returns {object} 新状态（不修改 current）
 */
export function mergeStarState(current, incoming) {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        throw new Error('setStar: 参数必须是对象');
    }
    const unknown = Object.keys(incoming).filter((key) => STAR_TOP_KEYS.indexOf(key) < 0);
    if (unknown.length > 0) {
        throw new Error('setStar 收到渲染器不认的字段: ' + unknown.join(', ')
            + ' —— 可用字段: ' + STAR_TOP_KEYS.join(', '));
    }
    if (!current) {
        const missing = STAR_BLOCK_NAMES.filter((name) => !(name in incoming));
        if (missing.length > 0) {
            throw new Error('setStar: 首次设置恒星必须给齐外观子块，缺: ' + missing.join(', '));
        }
    }
    const next = Object.assign({ screenRadiusPx: null, occlusion: 0 }, current || {});
    STAR_BLOCK_NAMES.forEach((name) => {
        if (name in incoming) {
            next[name] = validateStarBlock(name, incoming[name]);
        }
    });
    if ('screenRadiusPx' in incoming) {
        next.screenRadiusPx = validateScreenRadius(incoming.screenRadiusPx);
    }
    if ('occlusion' in incoming) {
        next.occlusion = validateOcclusion(incoming.occlusion);
    }
    return Object.freeze(next);
}

/**
 * '#rrggbb' → sRGB 分量 [0, 1]。
 * @param {string} hex
 * @returns {number[]}
 */
export function parseHexColor(hex) {
    if (!checkValue('color', hex)) {
        throw new Error('颜色必须是 #rrggbb，收到 ' + JSON.stringify(hex));
    }
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
}

/**
 * 目标色 → 线性光（与着色器输出的 pow(x, 1/2.2) 互逆）。
 * @param {string} hex
 * @returns {number[]}
 */
export function colorToLinear(hex) {
    return parseHexColor(hex).map((c) => Math.pow(c, DISPLAY_GAMMA));
}

/**
 * 目标色 → HDR 输入：使显示映射 1 − exp(−x) 后正好还原目标色。
 * 用于"本身就是最终颜色"的盘面主色/丝缕色；光晕、临边这类叠加光用 colorToLinear。
 * @param {string} hex
 * @returns {number[]}
 */
export function colorToHdr(hex) {
    return colorToLinear(hex).map((c) => -Math.log(1 - Math.min(c, HDR_LINEAR_CAP)));
}

/**
 * 推进视觉时间（S-3：用真实帧间隔、限幅，不跟随物理时间加速）。
 * dt 非法（NaN / 无穷 / 负数）⇒ 显式报错（Q4 定案：报错，不按 0 吞掉）。
 * @param {number} visualTime 当前视觉时间（秒）
 * @param {number} dt 真实帧间隔（秒）
 * @param {object} animation { rate, maxVisualDt }
 * @returns {number}
 */
export function advanceVisualTime(visualTime, dt, animation) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
        throw new Error('render(dt): dt 必须是 ≥ 0 的有限数（秒，真实帧间隔），收到 ' + JSON.stringify(dt));
    }
    return visualTime + Math.min(dt, animation.maxVisualDt) * animation.rate;
}

/**
 * 星芒权重：盘面半径（CSS px）小于 fadeRadiusPx 时淡入。
 * @param {number} radiusCss
 * @param {object} spikes
 * @returns {number} [0, 1]
 */
export function spikeWeight(radiusCss, spikes) {
    if (!spikes.enabled) {
        return 0;
    }
    const lo = spikes.fadeRadiusPx * 0.4;
    const hi = spikes.fadeRadiusPx;
    const t = Math.min(Math.max((radiusCss - lo) / (hi - lo), 0), 1);
    const s = 1 - t * t * (3 - 2 * t);
    return s > 0 ? Math.pow(s, spikes.fadeCurve) : 0;
}

/**
 * 远景盘面提亮：盘面小到要出星芒时，盘面颜色向星芒核心色收敛，
 * 保证小盘面读作"亮星"而不是暗橙点。窗口比星芒淡入更宽（到 1.5 × fadeRadiusPx）。
 * 星芒关闭时为 0（关闭零残留）。
 * @param {number} radiusCss
 * @param {object} spikes
 * @returns {number} [0, 1]
 */
export function farDiskBlend(radiusCss, spikes) {
    if (!spikes.enabled) {
        return 0;
    }
    const lo = spikes.fadeRadiusPx * 0.4;
    const hi = spikes.fadeRadiusPx * 1.5;
    const t = Math.min(Math.max((radiusCss - lo) / (hi - lo), 0), 1);
    return 1 - t * t * (3 - 2 * t);
}

/**
 * 光晕特征宽度与截止距离（设备像素）。
 * @param {number} radiusPx 盘面半径（设备像素）
 * @param {object} halo
 * @param {number} dpr
 * @returns {{scalePx:number, reachPx:number}}
 */
export function haloMetrics(radiusPx, halo, dpr) {
    const scalePx = radiusPx * halo.relativeWidth + halo.minWidthPx * dpr;
    const reachPx = Math.max(scalePx * halo.reach, halo.minReachPx * dpr);
    return { scalePx, reachPx };
}

/**
 * 主芒长度（设备像素）。
 * @param {number} radiusPx 盘面半径（设备像素）
 * @param {object} spikes
 * @param {number} dpr
 * @returns {number}
 */
export function spikeLengthPx(radiusPx, spikes, dpr) {
    return spikes.lengthPx * dpr + radiusPx * spikes.lengthPerRadius;
}

/**
 * 恒星局部画布需要的**半边长**（设备像素，向上取整）：盘面 + 光晕截止 + 星芒，取最大。
 * 接入方据此决定局部画布尺寸（2 × 返回值），恒星画在中心。
 * @param {object} star mergeStarState 的结果（需含 screenRadiusPx）
 * @param {number} dpr
 * @returns {number}
 */
export function computeStarExtentPx(star, dpr) {
    const r = validateScreenRadius(star.screenRadiusPx);
    let extent = r + 1;
    if (star.halo.enabled) {
        extent = Math.max(extent, r + haloMetrics(r, star.halo, dpr).reachPx);
    }
    if (spikeWeight(r / dpr, star.spikes) > 0) {
        extent = Math.max(extent, spikeLengthPx(r, star.spikes, dpr));
    }
    return Math.ceil(extent) + 1;
}

/**
 * 求解一帧的 uniform 值（纯函数：同输入 ⇒ 同输出，复现性的基础）。
 * @param {object} star mergeStarState 的结果
 * @param {object} frame { width, height, dpr, cx, cy, visualTime, transparent }
 * @returns {object} { uniform 名: 值 }
 */
export function buildStarUniforms(star, frame) {
    const dpr = frame.dpr;
    const r = validateScreenRadius(star.screenRadiusPx);
    const s = star.surface;
    const h = star.halo;
    const k = star.spikes;
    const halo = haloMetrics(r, h, dpr);
    return {
        // 屏幕坐标：cx/cy 是相对画布中心的偏移（设备像素，y 向下）；GL 坐标原点在左下
        uCenter: [frame.width / 2 + frame.cx, frame.height / 2 - frame.cy],
        uRadius: r,
        uDpr: dpr,
        uTime: frame.visualTime,
        uBaseColor: colorToHdr(s.baseColor),
        uFilamentColor: colorToHdr(s.filamentColor),
        uRimColor: colorToLinear(s.rimColor),
        uFilamentScale: s.filamentScale,
        uFilamentThreshold: s.filamentThreshold,
        uFilamentContrast: s.filamentContrast,
        uCellDarkening: s.cellDarkening,
        uLimbDarkening: s.limbDarkening,
        uRimPower: s.rimPower,
        uRimStrength: s.rimStrength,
        uRotationRate: s.rotationRate,
        uFlowRate: s.flowRate,
        uHaloColor: colorToLinear(h.color),
        uHaloStrength: h.enabled ? h.strength : 0,
        uHaloScale: halo.scalePx,
        uHaloReach: halo.reachPx,
        uRayStrength: h.rayStrength,
        uRayCount: h.rayCount,
        uSpikeColor: colorToLinear(k.color),
        uSpikeWeight: spikeWeight(r / dpr, k),
        uSpikeLength: spikeLengthPx(r, k, dpr),
        uSpikeWidth: k.widthPx * dpr,
        uSpikeStrength: k.strength,
        uFarBlend: farDiskBlend(r / dpr, k),
        uDiagonalStrength: k.diagonalStrength,
        uExposure: star.display.exposure,
        uVisibility: 1 - star.occlusion,
        uTransparent: frame.transparent ? 1 : 0,
    };
}
