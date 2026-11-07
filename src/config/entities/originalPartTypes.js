'use strict';

// 原创部件资产（clean-room 设计，不参考任何原作模型）
//
// 目标：在「不复制任何现有 IP 资产」的前提下，用参数化几何 + 程序化航天材质
// 达到 KSP 系部件同档次的**质感与风格**（stockalike：干净的硬表面、克制的配色、
// 清晰的倒角与高光层次）。
//
// 关键手段是 lathe（旋转成型）：钟形喷管、穹顶封头、带倒角的法兰都靠它，
// 而不是拿直锥去近似 —— 这是「硬表面感」和「塑料感」的分水岭。

function round(v, d = 4) {
    return Number(v.toFixed(d));
}

/**
 * 钟形喷管剖面（Rao 近似）：r(t) = rThroat + (rExit - rThroat) · t^n
 * 返回从上到下的 [半径, 高度] 点列。
 */
function bellOutline(rThroat, rExit, len, yTop, n = 2.4, steps = 22) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        out.push([round(rThroat + (rExit - rThroat) * Math.pow(t, n)), round(yTop - len * t)]);
    }
    return out;
}

/**
 * 闭合的薄壁钟形喷管剖面：外壁向下 → 唇口内收 → 内壁向上 → 回到起点。
 */
function bellShell(rThroat, rExit, len, yTop, wall = 0.022, n = 2.4, steps = 22) {
    const outer = bellOutline(rThroat, rExit, len, yTop, n, steps);
    const inner = bellOutline(
        Math.max(0.04, rThroat - wall),
        Math.max(0.08, rExit - wall),
        len,
        yTop,
        n,
        steps
    ).reverse();
    const yBot = yTop - len;
    const profile = outer.concat([[round(rExit - wall), round(yBot)]], inner);
    return profile;
}

/**
 * 椭圆穹顶剖面点（从顶点 r=0 到赤道 r=R）。
 * @param {number} R 赤道半径
 * @param {number} domeH 穹顶高度
 * @param {number} yEquator 赤道高度
 * @param {number} steps 分段
 * @param {number} dir +1 = 顶点在上（顶封头），-1 = 顶点在下（底封头）
 */
function domeProfile(R, domeH, yEquator, steps = 10, dir = 1) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI / 2;
        out.push([
            round(R * Math.sin(a)),
            round(yEquator + dir * domeH * Math.cos(a))
        ]);
    }
    return out;
}

// ==================== 1. KS-1 真空引擎 ====================
const KS1_TOP = 0.32;
const KS1_NOZZLE_LEN = 0.66;
const KS1_NOZZLE_SHELL = bellShell(0.135, 0.52, KS1_NOZZLE_LEN, KS1_TOP, 0.024, 2.5, 24);

// 燃烧室 + 喉部收敛段（开放剖面，从上到下）
const KS1_CHAMBER = [
    [0.285, 0.62],
    [0.285, 0.47],
    [0.225, 0.42],
    [0.175, 0.38],
    [0.165, 0.345],
    [0.145, KS1_TOP + 0.005]
];

const KS1_ENGINE = {
    id: 'origin_engine_vac_1v',
    name: 'KS-1 真空引擎',
    category: 'engine',
    description: '原创 1.25m 级真空发动机：旋转成型的薄壁钟形喷管 + 再生冷却歧管 + 双液压摆动杆，比冲 352 s。',
    mass: 460,
    cost: 130,
    collider: {
        radius: 0.625,
        halfHeight: 0.62,
        allowSurfaceAttach: false,
        allowSurfaceChildren: false,
        srfAttachOffset: [0, 0, 0]
    },
    visual: {
        modelPath: null,
        primitives: [
            // 顶部安装法兰（带倒角的圆盘：用剖面画出来，边缘有真实高光）
            {
                type: 'lathe',
                profile: [
                    [0.500, 0.620], [0.612, 0.620], [0.625, 0.610],
                    [0.625, 0.578], [0.610, 0.566], [0.286, 0.566]
                ],
                capTop: false, capBottom: false,
                color: [0.40, 0.43, 0.48], mat: 'METAL_RING', emissive: 0
            },
            // 燃烧室 + 收敛段
            {
                type: 'lathe', profile: KS1_CHAMBER,
                color: [0.46, 0.40, 0.34], mat: 'METAL_RING', emissive: 0
            },
            // 再生冷却歧管（两道环，带圆角）
            {
                type: 'lathe',
                profile: [[0.315, 0.545], [0.345, 0.540], [0.345, 0.505], [0.315, 0.500]],
                closed: true,
                color: [0.52, 0.47, 0.40], mat: 'METAL_RING', emissive: 0
            },
            {
                type: 'lathe',
                profile: [[0.300, 0.455], [0.330, 0.450], [0.330, 0.420], [0.300, 0.415]],
                closed: true,
                color: [0.52, 0.47, 0.40], mat: 'METAL_RING', emissive: 0
            },
            // 主喷管（薄壁钟形：外壁 / 唇口 / 内壁一体成型）
            {
                type: 'lathe', profile: KS1_NOZZLE_SHELL, closed: true,
                color: [0.30, 0.33, 0.38], mat: 'NOZZLE_BELL', emissive: 0
            },
            // 喷管外壁加强箍（两道，略微外凸）
            {
                type: 'lathe',
                profile: [[0.315, 0.070], [0.336, 0.068], [0.336, 0.038], [0.318, 0.036]],
                closed: true,
                color: [0.62, 0.55, 0.44], mat: 'METAL_RING', emissive: 0
            },
            {
                type: 'lathe',
                profile: [[0.408, -0.155], [0.430, -0.158], [0.430, -0.188], [0.410, -0.190]],
                closed: true,
                color: [0.62, 0.55, 0.44], mat: 'METAL_RING', emissive: 0
            },
            // 涡轮泵组（侧置）
            { type: 'box', width: 0.20, height: 0.26, depth: 0.17, offset: [0.30, 0.47, 0.05], color: [0.52, 0.46, 0.38], mat: 'METAL_RING', emissive: 0 },
            // 涡轮排气管
            { type: 'cylinder', radius: 0.045, height: 0.36, offset: [0.43, 0.36, 0.16], color: [0.36, 0.32, 0.30], mat: 'METAL_RING', emissive: 0 },
            // 双液压摆动杆（× 2，X 轴两侧）
            { type: 'box', width: 0.10, height: 0.20, depth: 0.10, offset: [0.24, 0.66, 0], color: [0.55, 0.58, 0.64], mat: 'METAL_RING', emissive: 0 },
            { type: 'box', width: 0.10, height: 0.20, depth: 0.10, offset: [-0.24, 0.66, 0], color: [0.55, 0.58, 0.64], mat: 'METAL_RING', emissive: 0 },
            // 顶部暖金色污染控制环（点缀色，打破全灰）
            {
                type: 'lathe',
                profile: [[0.288, 0.640], [0.300, 0.640], [0.300, 0.620], [0.288, 0.620]],
                closed: true,
                color: [0.86, 0.68, 0.24], mat: 'METAL_RING', emissive: 0
            }
        ]
    },
    attachNodes: [
        { id: 'top',    position: [0,  0.62, 0], direction: [0,  1, 0], size: 1 },
        { id: 'bottom', position: [0, -0.62, 0], direction: [0, -1, 0], size: 1 }
    ],
    resources: null,
    engine: { engineType: 'chemical', maxThrust: 62000, isp: 352 },
    reactionWheelTorque: 0,
    capability: null,
    scanTier: 0,
    cargoCapacity: 0
};

// ==================== 2. KT-1 低温贮箱 ====================
const KT1_R = 0.625;
const KT1_HALF = 0.97;
const KT1_DOME = 0.155;

const KT1_PROFILE = [].concat(
    // 顶穹顶：从顶点 r=0 到赤道
    domeProfile(KT1_R, KT1_DOME, KT1_HALF - KT1_DOME, 10, 1),
    // 柱段
    [[KT1_R, round(0.20)], [KT1_R, round(-0.20)]],
    // 底穹顶：从赤道到顶点 r=0
    domeProfile(KT1_R, KT1_DOME, -(KT1_HALF - KT1_DOME), 10, -1)
);

const KT1_TANK = {
    id: 'origin_tank_1v_1x4',
    name: 'KT-1 低温贮箱 (1x4)',
    category: 'tank',
    description: '原创 1.25m 级低温双组元贮箱：椭圆穹顶封头 + 三道结构加强箍 + 外置增压管路，支持径向挂载。',
    mass: 210,
    cost: 95,
    collider: {
        radius: 0.625,
        halfHeight: 0.97,
        allowSurfaceAttach: false,
        allowSurfaceChildren: true,
        srfAttachOffset: [0, 0, 0]
    },
    visual: {
        modelPath: null,
        primitives: [
            // 主壳体（穹顶 + 柱段一体旋转成型）
            {
                type: 'lathe', profile: KT1_PROFILE,
                color: [0.88, 0.90, 0.93], mat: 'HULL_PAINTED', emissive: 0
            },
            // 三道结构加强箍（带圆角的外凸环）
            {
                type: 'lathe',
                profile: [[0.625, 0.560], [0.645, 0.556], [0.645, 0.500], [0.625, 0.496]],
                closed: true, color: [0.42, 0.45, 0.50], mat: 'METAL_RING', emissive: 0
            },
            {
                type: 'lathe',
                profile: [[0.625, 0.080], [0.645, 0.076], [0.645, 0.020], [0.625, 0.016]],
                closed: true, color: [0.42, 0.45, 0.50], mat: 'METAL_RING', emissive: 0
            },
            {
                type: 'lathe',
                profile: [[0.625, -0.400], [0.645, -0.404], [0.645, -0.460], [0.625, -0.464]],
                closed: true, color: [0.42, 0.45, 0.50], mat: 'METAL_RING', emissive: 0
            },
            // 中段低温橙色绝热带
            {
                type: 'lathe',
                profile: [[0.625, 0.430], [0.640, 0.430], [0.640, -0.030], [0.625, -0.030]],
                color: [0.88, 0.47, 0.15], mat: 'CRYO_FOAM', emissive: 0
            },
            // 上下对接法兰（带真实倒角）
            {
                type: 'lathe',
                profile: [[0.42, 0.970], [0.612, 0.968], [0.625, 0.956], [0.625, 0.930], [0.612, 0.918], [0.42, 0.916]],
                capTop: false, capBottom: false,
                color: [0.46, 0.49, 0.54], mat: 'METAL_RING', emissive: 0
            },
            {
                type: 'lathe',
                profile: [[0.42, -0.916], [0.612, -0.918], [0.625, -0.930], [0.625, -0.956], [0.612, -0.968], [0.42, -0.970]],
                capTop: false, capBottom: false,
                color: [0.46, 0.49, 0.54], mat: 'METAL_RING', emissive: 0
            },
            // 外置增压管路 + 三道管卡
            { type: 'cylinder', radius: 0.032, height: 1.68, offset: [0.645, 0, 0], color: [0.60, 0.64, 0.70], mat: 'METAL_RING', emissive: 0 },
            { type: 'box', width: 0.075, height: 0.055, depth: 0.10, offset: [0.645, 0.52, 0], color: [0.34, 0.37, 0.42], mat: 'METAL_RING', emissive: 0 },
            { type: 'box', width: 0.075, height: 0.055, depth: 0.10, offset: [0.645, 0.00, 0], color: [0.34, 0.37, 0.42], mat: 'METAL_RING', emissive: 0 },
            { type: 'box', width: 0.075, height: 0.055, depth: 0.10, offset: [0.645, -0.52, 0], color: [0.34, 0.37, 0.42], mat: 'METAL_RING', emissive: 0 }
        ]
    },
    attachNodes: [
        { id: 'top',    position: [0,  0.97, 0], direction: [0,  1, 0], size: 1 },
        { id: 'bottom', position: [0, -0.97, 0], direction: [0, -1, 0], size: 1 }
    ],
    resources: {
        hydrogen: { amount: 240, capacity: 240 },
        oxygen:   { amount: 1920, capacity: 1920 }
    },
    engine: null,
    reactionWheelTorque: 0,
    capability: null,
    scanTier: 0,
    cargoCapacity: 0
};

export const ORIGINAL_PART_TYPES = [KS1_ENGINE, KT1_TANK];
