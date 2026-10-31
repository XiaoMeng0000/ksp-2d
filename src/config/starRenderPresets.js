'use strict';

// 恒星视觉预设（数据驱动，唯一真源）。
//
// 观感路线：KSP 风格（总监 2026-10 定稿 V1「KSP 原味」，见 docs/恒星渲染方案.md §二十）。
// 颜色是**目标显示色**（sRGB hex），参照主游戏 kerbol.png；渲染器负责换算到 HDR 输入，
// 使显示映射后还原该颜色。这里不是物理量，不要按黑体温度去"校正"。
//
// 数据流：bodyId → 接入方查本表 → 预设 + screenRadiusPx 交给 starRenderer.setStar()。
// 渲染器内**没有**任何按 bodyId 的分支（约束 P2）；加一颗恒星 = 本表加一条。
//
// 单位约定：
//   · 带 Px 后缀的量是 **CSS 像素**，渲染器按 dpr 换成设备像素；
//   · screenRadiusPx（不在本表，接入方每帧给）是**设备像素**，与星球渲染器同口径。

export const STAR_RENDER_PRESETS = {
    kerbol: {
        surface: {
            baseColor: '#f59a1c',       // 盘面主色（橙）
            filamentColor: '#ffe04a',   // 丝缕亮纹（黄）
            rimColor: '#fff6b0',        // 临边泛光（黄白）
            filamentScale: 4.0,         // 丝缕基频（相对单位球）
            filamentThreshold: 0.46,    // ridged 噪声阈值：越高丝缕越稀越细
            filamentContrast: 1.0,
            cellDarkening: 0.10,        // 低频暗斑强度
            limbDarkening: 0.0,         // 0 = KSP 风格不做临边变暗
            rimPower: 2.4,
            rimStrength: 1.6,
            rotationRate: 0.015,        // 自转角速度（弧度 / 视觉秒）
            flowRate: 0.02,             // 丝缕平流速度（噪声空间单位 / 视觉秒）
        },
        halo: {
            enabled: true,
            color: '#ffa733',
            relativeWidth: 0.22,        // 光晕特征宽度 = 盘面半径 × 本值 + minWidthPx
            minWidthPx: 6,
            strength: 1.1,
            rayStrength: 0.85,          // 角向流光强度（0 = 无流光，退化为平滑光晕）
            rayCount: 9,                // 角向流光的频率尺度
            reach: 4.5,                 // 光晕截止距离（以特征宽度计；收尾窗在此处平滑归零）
            minReachPx: 95,             // 截止距离下限：小盘面时流光仍有足够长度
        },
        spikes: {
            enabled: true,
            color: '#fff2c8',
            lengthPx: 70,               // 主芒长度（CSS px）
            lengthPerRadius: 1.5,       // 主芒随盘面半径加长（14px 档的张力来自这里）
            widthPx: 0.9,
            strength: 2.2,
            fadeRadiusPx: 18,           // 盘面半径（CSS px）小于此值开始淡入星芒
            fadeCurve: 0.5,             // 淡入曲线指数：<1 让中等尺寸更早出芒
            diagonalStrength: 0.45,     // 斜向弱芒（0 = 只有十字主芒）
        },
        animation: {
            rate: 1,                    // 0 = 冻结（截图回归 / A-B 对照用）
            maxVisualDt: 0.05,          // 真实帧间隔限幅（S-3）
        },
        display: {
            exposure: 1.0,
        },
    },
};
