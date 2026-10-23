# VENDORED — 渲染层 vendored 来源记录

- 来源仓库：`D:\ksp-renderlab`（渲染层产地）
- 来源 commit：`9c8e59e`（完整 `9c8e59eb062468fb17a78572d6313bb6ce170828`）
  ⚠️ **本批含实验室未提交的工作树改动**（该批尚未 commit）：第三卷的 5 个文件
  `src/planet/cloudLayer.js`、`src/planet/meshRenderer.js`、
  `src/planet/shaders/cloudShaders.js`、`src/planet/shaders/planetShaders.js`、
  以及**新增** `src/config/cloudOptionalDefaults.js`。
  字节级自证靠下面的 sha16 全表（不是靠 commit）。
- 拷贝范围：`src/planet/**`、`src/glCore/**`、`src/geometry/**` → 本仓同名路径
  ★ **另加一个单文件**：`src/config/cloudOptionalDefaults.js`（**不在上面三个目录内**）。
  为什么必须带上它：`src/planet/cloudLayer.js` 会 `import '../config/cloudOptionalDefaults.js'`，
  它已**不再**由 cloudLayer 内部定义（2026-10-23 总监裁决：可选参数默认值入 `src/config/`）。
  漏拷这一个文件 ⇒ 模块解析失败 ⇒ **主菜单的云层整层挂掉**。以后从实验室 re-sync 时请把这条范围一起带上。
- 唯一允许改动：首行 `"use strict";` → `'use strict';`（本仓编码惯例，**等长字节替换** 13B→13B，其余内容与实验室逐字节一致，已校验）
- 校验方法（可复现）：对每个文件取实验室原文，仅把首行引号替换成单引号得到"期望字节"，
  与本仓文件做**逐字节比较**（必须全等）；再对两边分别算 SHA-256 前 16 位（sha16）对照。
  本批 23/23 文件全等（脚本：实验室 `data/out/vol3/_vendor2d.mjs`）。
- 更新方式：从实验室对应目录整目录覆盖后，仅改首行引号，并更新下方 sha16 清单（sha16 = 文件 SHA-256 前 16 位十六进制）

## 文件清单（sha16）

| 文件 | sha16 |
| --- | --- |
| src/planet/airMass.js | 837c1dfcfb5bb9fe |
| src/planet/atmosphereLayer.js | f18a9695df1a29ef |
| src/planet/atmosphereSpecies.js | 81eb03985f786c15 |
| src/planet/cloudLayer.js | 115568ba187706c4 |
| src/planet/cloudRecipe.js | 50f6f337ab696342 |
| src/planet/gasGiantBandTables.js | ef5dd327c4da5c9b |
| src/planet/gasGiantCloudRecipe.js | debbf3fed15d982d |
| src/planet/materials.js | eb0eef0472213301 |
| src/planet/meshRenderer.js | 218f35d4f82e93d2 |
| src/planet/shaders/atmosphereShaders.js | 35e77d8ed2176760 |
| src/planet/shaders/cloudFieldGLSL.js | 8f840c72e02d24f8 |
| src/planet/shaders/cloudShaders.js | 8cb5f9e3b1e1235b |
| src/planet/shaders/gasGiantCloudGLSL.js | f302bf9c092452fa |
| src/planet/shaders/planetShaders.js | 0f6ea8af859af550 |
| src/planet/sun.js | fb7ce1258c30e52d |
| src/glCore/context.js | b3ac56cb6494e91d |
| src/glCore/matrix.js | 5ae34698f6078e9c |
| src/glCore/mesh.js | 52fae66ec4e97244 |
| src/glCore/shader.js | d1413c81cd2531fd |
| src/glCore/texture.js | cb0637881ceeb4b0 |
| src/geometry/irregularMesh.js | 815c49db23e653b6 |
| src/geometry/sphereMesh.js | c11f1a9df6f705dd |
| src/config/cloudOptionalDefaults.js | c281d46ed413af3d |

## 增补记录

- 2026-10-17：`src/glCore/shader.js` 单独 re-sync，含「首帧云消失」修复（createUniformBlock 创建即按声明尺寸分配 UBO 存储并绑定——修云层首次绘制被 GL INVALID_OPERATION 静默拒绝）。来源为实验室工作树（基线 `56857f7`，修复当时尚未提交，组长提交实验室后可回填 commit）；游戏副本仅首行引号规范化，其余逐字节一致（sha16 `d1413c81cd2531fd` 为引号规范化后口径）。
- 2026-10-23（**第三卷：2 壳 + 云影**）：整批 re-sync。变更文件 4 个
  （`src/planet/cloudLayer.js` `115568ba187706c4`、`src/planet/meshRenderer.js` `218f35d4f82e93d2`、
  `src/planet/shaders/cloudShaders.js` `8cb5f9e3b1e1235b`、`src/planet/shaders/planetShaders.js` `0f6ea8af859af550`），
  **新增 1 个** `src/config/cloudOptionalDefaults.js` `c281d46ed413af3d`；其余 18 个文件字节未变（sha16 与上表一致）。
  行为变化：云层默认 `shells=2`（两层壳、每壳独立场 `shellShift=0.13`、云量补偿 `shellCoverageComp=0.7`、
  内层 `innerOctaves=1`）+ **云影默认开**（`shadowEnabled=true`、`shadowStrength=0.7`、512×256 等距柱状图）。
  ⇒ 主菜单星球会**自动**吃到新默认（`menuPlanetConfig.js` 的 `Object.assign({}, CLOUD_PRESETS.kerbin, …)`），
  这是预期，**不要去改 menuPlanetConfig 保旧观感**。
