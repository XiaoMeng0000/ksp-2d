'use strict';

// 机动节点系统配置（0.3.0）— 全部可调参数集中于此，业务模块不硬编码
// 单位约定：秒 / 米 / CSS 像素 / m/s；颜色为 CSS 颜色字符串

export const MANEUVER_CONFIG = {
    // 燃烧弧积分步长（秒）— 与 integrateThrustArc / 物理引擎 RK4 子步上限同口径
    burnDt: 0.05,
    // 燃烧弧单次积分最大步数（防失控；步数上限 × dt = 最大可模拟燃烧时长）
    burnMaxSteps: 200000,
    // 燃烧弧 SOI 半径上限倍率（与 integrateThrustArc 的 soiRadiusLimit 同语义）
    burnSoiRadiusLimit: 1.5,
    // 燃料耗尽后的虚拟续烧段（预测专用，物理不可行）：恒定加速度 = 满油门推力 / 干质量
    ghostBurnEnabled: true,
    // 完成判定容差（m/s）：剩余 Δv ≤ 此值判为"已达成"
    completionTolerance: 0.5,
    // 绿色加速按钮的目标提前量（秒）：warp 到节点时刻前该秒数处
    warpLeadTime: 10,
    // 倒计时状态灯窗口（秒）：节点前 / 燃烧结束前 N 秒开始逐灯点亮（自上而下每秒一盏）
    ledWindowSeconds: 3,
    // 手柄拖拽灵敏度：CSS 像素位移 → Δv（m/s）
    handleDvPerPixel: 0.5,
    // 节点图标 / 手柄的命中半径（CSS 像素）
    nodeHitRadius: 12,
    handleHitRadius: 10,
    // 手柄相对节点图标中心的屏幕偏移（CSS 像素，四向对称）
    handleOffset: 34,
    // 加速计时器面板锚点：距视口左下角的 CSS 偏移
    panelLeft: 16,
    panelBottom: 132,
    // 燃烧弧颜色（真实段 / 虚拟续烧段略暗以区分）
    burnArcColor: 'rgba(255, 107, 94, 0.95)',
    burnArcGhostColor: 'rgba(184, 77, 69, 0.95)',
    // 节点图标颜色
    nodeIconColor: '#4FC3F7',
    nodeIconBorder: '#E3F2FD',
    // 手柄颜色：切向（顺/逆）/ 径向（内/外）
    handleProgradeColor: '#7CE38B',
    handleRadialColor: '#7DA6E8'
};
