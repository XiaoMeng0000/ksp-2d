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
    // 完成判定最小有效 Δv（m/s）：计划 Δv 低于此值不自动判完成——
    // 防"点一下手柄注入 0.x m/s → 即判完成 → 节点灰态、手柄全消失"的假完成
    completionMinDv: 1,
    // 绿色加速按钮的目标提前量（秒）：warp 到节点时刻前该秒数处
    warpLeadTime: 10,
    // 倒计时状态灯窗口（秒）：节点前 / 燃烧结束前 N 秒开始逐灯点亮（自上而下每秒一盏）
    ledWindowSeconds: 3,
    // 手柄拖拽灵敏度：CSS 像素位移 → Δv（m/s）
    handleDvPerPixel: 0.5,
    // 手柄速率式拖拽（0.3.0 打磨）：拖拽距离（沿轴向，**从图标初始位置起算**）→ 每秒注入 Δv
    //   · handleDragRange（px）：最大拖拽程度 = 初始位置到圆心距离的 3 倍（handleOffset × 3 = 153px），
    //     拖满该距离 = 最大速率；图标绝对最远 = offset + range = 204px
    //   · handleMaxRate（m/s·s）：最大注入速率（拖满 153px 时 150 m/s/秒）
    //   · 只能向外拖（反向 clamp 0，无负速率）
    handleDragRange: 153,
    handleMaxRate: 150,
    // 节点图标 / 手柄的命中半径（CSS 像素）
    nodeHitRadius: 12,
    handleHitRadius: 15,
    // 手柄相对节点图标中心的屏幕偏移（CSS 像素，四向对称；0.3.0 打磨 1.5× 放大）
    handleOffset: 51,
    // 加速计时器面板锚点：时间加速面板（#timeWarpWrap 底部 12px 居中）正上方居中；
    // bottom 每帧按 warp 面板实测高度计算 = 12 + warpHeight + panelGap
    panelGap: 8,
    // 颜色（燃烧弧 / 机动后轨道）
    burnArcColor: 'rgba(255, 107, 94, 0.95)',
    burnArcGhostColor: 'rgba(184, 77, 69, 0.95)',
    // 机动后预测段：实线粉色（0.3.0 打磨，对照样式稿）
    postBurnColor: 'rgba(255, 74, 255, 0.95)',
    // 节点图标颜色
    nodeIconColor: '#4FC3F7',
    nodeIconBorder: '#E3F2FD',
    // 手柄图标配色（0.3.0 打磨：沿用方向罗盘/导航球色）
    //   顺向/逆向 = 导航球标记黄（与 sasUI.NAV_DIR_PROGRADE_COLOR 同值）
    //   径向内/外 = 导航球标记青（与 sasUI.NAV_DIR_RADIAL_COLOR 同值）
    handleProgradeColor: '#ffcc33',
    handleRadialColor: '#4fc3f7',
    // 手柄图标尺寸（CSS 像素；0.3.0 打磨定稿 25px = 初版 33px 的 3/4）
    handleIconSize: 25
};
