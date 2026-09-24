'use strict';

// SAS系统 — 姿态稳定控制器参数配置
// 所有可调控制参数统一放在此处，避免在控制器代码中硬编码
// 控制律 = 时间最优 bang-bang（刹停距离判据）+ 双死区
// 方案依据：时间最优双积分器控制 + KSP 的按扭矩/MOI 自适应思想

export const SAS_CONTROL = {
    // 最大目标角速度（rad/s，约 115°/s）
    // 转向巡航阶段的速度上限；达到后维持不再加速
    maxAngularVelocity: 2.0,

    // 速度环死区（rad/s）
    // 用于巡航上限判定（|v| ≥ maxAngularVelocity−velocityDeadband 视为已达上限）；
    // 兼作 bang-bang 的切换容差，避免微小误差导致频繁输出
    velocityDeadband: 0.05,

    // 角度死区（rad，约 0.6°）：误差小于该值且角速度小于死区时停止输出，防到位抖动
    deadbandError: 0.01,

    // 角速度死区（rad/s）：配合角度死区判定完全停止；
    // 角度已到位但角速度未归零时持续全力刹车消除角速度
    deadbandVelocity: 0.02
};
