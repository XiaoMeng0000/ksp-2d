'use strict';

// 玩法系统开关（可选系统注册化）
//
// 目的：让 main.js 的「可选系统」按开关装载，未装载时静默跳过（不报错、不留半截 UI、不发外域请求）。
// 全量版所有开关为 true → 行为与引入本文件之前完全一致。
// 尝鲜版关闭被砍系统（见 docs/尝鲜版方案.md 第四节）。
//
// 约定：
//   1. 开关只决定「是否装载」，不承载玩法逻辑；
//   2. 关闭的系统必须能从入口处整体跳过（动态 import + 惰性回调），不做「装载了再隐藏」；
//   3. 核心系统（物理 / 时间加速 / 飞行 / 追踪站 / 设施建造）不设开关。

import { isLiteProfile } from './assets/liteProfile.js';

const FULL = !isLiteProfile();

export const FEATURE_FLAGS = {
    // 设施系统（轨道船坞：建造 / 补给）—— 尝鲜版保留
    facility: true,
    // 飞船编辑器外壳（shipBuilderUI）—— 尝鲜版以预设船建造选单替代
    shipBuilder: FULL,
    // 飞船货仓
    cargo: FULL,
    // 星球扫描
    scan: FULL,
    // 3D 部件实验室场景
    partLab: FULL,
    // 在线「最新消息」弹窗与启动拉取
    latestNews: FULL,
    // 游戏百科
    encyclopedia: FULL,
    // 游戏公告
    announcement: FULL,
    // 多战役 / 星系组合选择（开始游戏面板 + 创建战役对话框 + 星系选择）
    campaign: FULL,
    // 部署新设施
    facilityDeploy: FULL,
    // 已加载星系场景
    galaxies: FULL,
    // 调试面板（ESC 菜单内的调试入口）
    debugPanel: FULL
};
