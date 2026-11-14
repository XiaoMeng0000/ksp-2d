'use strict';

// 版本号常量
//
// 尝鲜版（`lite` 分支）使用**独立于游戏本体的版本号**，避免与 `main` 分支的发布版本冲突：
//   VERSION_TEXT = 基线游戏版本 + 尝鲜版迭代号 + 构建月份
//   例：v0.3.0-beta2-lite.1 (Build 202611)
//     · 基线游戏版本跟随 `main`（rebase 时同步）
//     · `lite.N` 是尝鲜版自己的迭代号：尝鲜版每次对外发布 +1，与游戏本体版本解耦
//
// 主菜单（menuScene 右下角）与 ESC 菜单（escMenuUI 底部）共用 VERSION_TEXT，避免两处漂移。

// ===== 发布版本 =====
export const GAME_VERSION = 'v0.3.0-beta2';   // 基线游戏版本（与 main 同步）
export const EDITION = 'lite';                 // 版本线标识：lite = 网页尝鲜版
export const EDITION_TEXT = '尝鲜版';           // 面向玩家的版本线名称（UI 展示用）
export const EDITION_VERSION = '1';            // 尝鲜版迭代号
export const BUILD_STAMP = '202611';           // 构建年月（YYYYMM）

export const VERSION_TEXT = GAME_VERSION + '-' + EDITION + '.' + EDITION_VERSION + ' (Build ' + BUILD_STAMP + ')';

// ===== 数据格式版本 =====
// 与上面的 VERSION_TEXT 语义分离：VERSION_TEXT 是**面向玩家的发布版本**（界面显示），
// 下面是**数据格式版本**，只写入存档/导出文件。
//
// SAVE_FORMAT_VERSION —— 存档配置格式基线：世界元数据 metadata.configVersion 的写入值。
//   尝鲜版与完整版存档结构不兼容（无货仓 / 无扫描 / 单星系 / 设施只剩船坞），
//   因此使用独立版本号；读档时版本不一致会被明确拒绝（见 saveManager.loadCheckpoint）。
export const SAVE_FORMAT_VERSION = 'lite-1.0';

// WORLD_EXPORT_FORMAT_VERSION —— 世界导出文件格式基线：exportWorldToFile 输出 JSON 顶层
//   version 字段（与 format: 'ksp2d_world_export' 配套）。
export const WORLD_EXPORT_FORMAT_VERSION = 'lite-1.0';
