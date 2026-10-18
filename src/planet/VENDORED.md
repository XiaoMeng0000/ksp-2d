# VENDORED — 渲染层 vendored 来源记录

- 来源仓库：`D:\ksp-renderlab`（渲染层产地）
- 来源 commit：`3c4a848`（完整 `3c4a8487a9ee1409b8a13168c179ee3df1fce411`）
- 拷贝范围：`src/planet/**`、`src/glCore/**`、`src/geometry/**` → 本仓同名路径
- 唯一允许改动：首行 `"use strict";` → `'use strict';`（本仓编码惯例，等长字节替换，其余内容与实验室逐字节一致，已校验）
- 更新方式：从实验室对应目录整目录覆盖后，仅改首行引号，并更新下方 sha16 清单（sha16 = 文件 SHA-256 前 16 位十六进制）

## 文件清单（sha16）

| 文件 | sha16 |
| --- | --- |
| src/planet/airMass.js | 837c1dfcfb5bb9fe |
| src/planet/atmosphereLayer.js | f18a9695df1a29ef |
| src/planet/atmosphereSpecies.js | 81eb03985f786c15 |
| src/planet/cloudLayer.js | e183ef9ef2c49ae0 |
| src/planet/cloudRecipe.js | 50f6f337ab696342 |
| src/planet/gasGiantBandTables.js | ef5dd327c4da5c9b |
| src/planet/gasGiantCloudRecipe.js | debbf3fed15d982d |
| src/planet/materials.js | eb0eef0472213301 |
| src/planet/meshRenderer.js | c69a215876a73b52 |
| src/planet/sun.js | fb7ce1258c30e52d |
| src/planet/shaders/atmosphereShaders.js | 35e77d8ed2176760 |
| src/planet/shaders/cloudFieldGLSL.js | 8f840c72e02d24f8 |
| src/planet/shaders/cloudShaders.js | 83a28b9e55fddb0d |
| src/planet/shaders/gasGiantCloudGLSL.js | f302bf9c092452fa |
| src/planet/shaders/planetShaders.js | 489afb35a0483952 |
| src/glCore/context.js | b3ac56cb6494e91d |
| src/glCore/matrix.js | 5ae34698f6078e9c |
| src/glCore/mesh.js | 52fae66ec4e97244 |
| src/glCore/shader.js | d1413c81cd2531fd |
| src/glCore/texture.js | cb0637881ceeb4b0 |
| src/geometry/irregularMesh.js | 815c49db23e653b6 |
| src/geometry/sphereMesh.js | c11f1a9df6f705dd |

## 增补记录

- 2026-10-17：`src/glCore/shader.js` 单独 re-sync，含「首帧云消失」修复（createUniformBlock 创建即按声明尺寸分配 UBO 存储并绑定——修云层首次绘制被 GL INVALID_OPERATION 静默拒绝）。来源为实验室工作树（基线 `56857f7`，修复当时尚未提交，组长提交实验室后可回填 commit）；游戏副本仅首行引号规范化，其余逐字节一致（sha16 `d1413c81cd2531fd` 为引号规范化后口径）。
