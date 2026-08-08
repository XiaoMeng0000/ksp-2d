'use strict';

// SAS系统 — 姿态稳定控制器参数配置
// 所有可调控制参数统一放在此处，避免在控制器代码中硬编码

export const SAS_CONTROL = {
    // 最大目标角速度（rad/s，约 115°/s）
    // 级联外环限制最大旋转速度，从根源杜绝刹车不及导致的震荡
    maxAngularVelocity: 2.0,

    // 角度误差全速阈值（rad，约 46°）
    // 外环比例增益推导：KP_POS = maxAngularVelocity / positionErrorFullSpeed
    // 即角度误差达到该值时，期望角速度输出满速
    positionErrorFullSpeed: 0.8
};
