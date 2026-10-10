'use strict';

// 版本号常量 — 0.2.5 提取为共享配置
// 格式:正式版为主版本号(如 v0.2.6);预发布版追加后缀与构建日期(如 v0.3.0-beta1 (Build 202610) 表示 2026 年 10 月构建)
// 主菜单（menuScene 右下角）与 ESC 菜单（escMenuUI 底部）共用，避免两处维护漂移
// 提示:公告栏按版本段比较（忽略 -beta1 等后缀与 Build 号）；当前尚无 v0.3.0 公告条目，
//      公告列表回退为按版本升序（详见 docs/公告编写规范.md 第四章排序规则）。
export const VERSION_TEXT = 'v0.3.0-beta1 (Build 202610)';

// ===== 数据格式版本 =====
// 与上面的 VERSION_TEXT 语义分离：VERSION_TEXT 是**面向玩家的发布版本**（界面显示 + 公告排序），
// 下面两个常量是**数据格式版本**，只写入存档/导出文件，不参与任何界面显示。两者互相独立。
//
// SAVE_FORMAT_VERSION —— 存档配置格式基线：世界元数据 metadata.configVersion 的写入值。
//   历史存档中该值为 '0.2.0'（旧代码直接取 state.version）；全项目无分支/判断读取该值
//   （仅 getWorldList() 原样透出，无消费方），故不做迁移，允许新旧值并存。
export const SAVE_FORMAT_VERSION = '1.0';

// WORLD_EXPORT_FORMAT_VERSION —— 世界导出文件格式基线：exportWorldToFile 输出 JSON 顶层
//   version 字段（与 format: 'ksp2d_world_export' 配套；导入侧当前不校验该字段）。
export const WORLD_EXPORT_FORMAT_VERSION = '1.0';
