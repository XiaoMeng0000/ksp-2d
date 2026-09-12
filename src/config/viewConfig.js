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
    zoomMaxFocus: 10
};
