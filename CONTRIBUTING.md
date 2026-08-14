# 贡献指南（KSP 2D）

感谢参与 KSP 2D 的维护与贡献。本文件说明 Issue 规则与开发约定，请先阅读。

## Issue 规则

### 提交前
- 先在已有 issue 中搜索是否已报告过同类问题，避免重复（重复会被标记 `duplicate`）。
- 查阅 [KNOWN_ISSUES.md](KNOWN_ISSUES.md) 的待处理问题清单，已登记的问题请在 issue 中引用对应条目。

### Bug 报告
- 必须使用 `.github/ISSUE_TEMPLATE/01_bug_report.yml` 模板，完整填写复现步骤、预期行为与实际行为。
- 标题格式：`[模块] 一句话描述`，例如 `[physics] Jool/Eeloo SOI 重叠导致轨道预测抖动`。
- 依赖特定初始相位 / 存档 / 时间加速档位的，请列出触发条件（参考 KNOWN_ISSUES.md 的写法）。

### 功能建议
- 使用 `.github/ISSUE_TEMPLATE/02_feature_request.yml` 模板，说明需求背景、期望效果与关联模块。
- 需要新增或修改配置的，说明数据落在哪个配置文件。

### 关闭与状态
- 问题解决后由提交者关闭 issue，并在评论中注明对应 KNOWN_ISSUES.md 状态：`resolved`（已解决）或 `wontfix`（不处理）。

## 标签说明

- 类型：`bug` / `feature` / `question`
- 模块（与 `src/` 目录对应）：`physics` / `rendering` / `ship` / `facility` / `ui` / `audio` / `save` / `timewarp` / `config` / `docs`
- 优先级：`priority-high` / `priority-medium` / `priority-low`
- 状态：`duplicate` / `wontfix` / `help-wanted` / `good-first-issue`

## 开发约定

- 语言：原生 JavaScript（ES Modules），首行 `"use strict"`，4 空格缩进，字符串用单引号。
- 渲染：HTML5 Canvas 2D。
- 状态管理：`GameState` 单例；模块间通信走 `EventBus` 发布订阅。
- 物理：轨道力学用开普勒解析解，推力积分用 RK4。
- 数据：所有配置放在 `src/config/`；天体数据定义在 `solarSystem.js`，天体须按父天体在前的数组顺序排列。
- 飞船相关文件集中在 `src/ship/`；模块配置在 `src/ship/moduleTypes.js`。
- 增量实现 + 独立验证阶段：大功能拆分为可单独验证的小步。
- 临时代码标注 `// TEMP:`；不确定处标注 `// TODO:`。

## 提交信息风格

参考仓库现有提交记录，使用简洁的动词开头（如 `add:` / `fix:` / `refactor:` / `docs:`），一句话说明改动意图。
