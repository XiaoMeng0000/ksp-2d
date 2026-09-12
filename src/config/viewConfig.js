'use strict';

// 飞行视图档位配置（0.3.0）
// 普通聚焦视图 ↔ 轨道机动视图：切换键、fit 边距、缩放上下限集中配置
// 说明：机动视图的"聚焦中心候选"与 fit 半径由天体层级数据驱动推导（见 flightView.js），
//       不在此处写死任何天体名。

export const VIEW_IDS = Object.freeze({
    FOCUS: 'focus',          // 普通聚焦视图（跟随飞船，现有行为）
    MANEUVER: 'maneuver'     // 轨道机动视图（聚焦所选中心天体 + 限制放大上限 + 打开规划面板）
});

export const VIEW_CONFIG = {
    // 循环切换键（InputManager code）
    cycleKey: 'KeyV',
    // 进入飞行场景的默认视图
    defaultView: VIEW_IDS.FOCUS,
    // fit 边距系数：放大上限 = fitMargin × min(屏宽,屏高) / 2 ÷ fit半径
    fitMargin: 0.9,
    // 全局缩放下限（两种视图一致：可继续缩小到星系全貌）
    zoomMin: 1e-12,
    // 普通聚焦视图的放大上限（现有口径）
    zoomMaxFocus: 10,
    // 机动视图"局部放大图"（面板上块）的动态缩放口径（总监定稿 0.3.0）：
    //   · 按**当前轨道**动态计算参照半径 R = 当前轨道在 SOI 内的最大半径
    //     （预测线/燃烧弧不参与参照，可能暂时冲出该区域，但仍按 SOI 截断）
    //   · 轨道逃逸/超出 SOI（无有限最外点）→ R 退化为当前 SOI 半径（"极限缩到 SOI 程度"）
    //   · 绘图区面积占板块面积 insetAreaRatio（2/3，边长 √(2/3)≈81.6%）：
    //     四周留出约 9% 余量，供节点手柄使用（手柄/拖拽一律夹在整个面板边界内）
    insetAreaRatio: 2 / 3,
    // 放大图内节点手柄几何（面板专用，主视图手柄参数不受影响）：
    //   · 偏移/拖拽延伸按放大图尺寸等比缩放（k = clamp(边长/400, 0.5, 1)）
    //   · 手柄/拖拽一律夹在整个 HUD 面板边界内（不越出面板）
    insetHandleOffset: 26,       // 静止偏移（CSS px @k=1）
    insetHandleDragRange: 64     // 最大拖拽延伸（CSS px @k=1）
};
