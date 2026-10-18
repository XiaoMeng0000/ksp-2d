'use strict';

// setPlanet 字段白名单的**额外键**（B2-fix，总监 2026-10-16 批准）。
//
// ★ 白名单的构成（单一真源，防止 §13.30 式的"手写第二份必然漂移"）★
//   白名单 = Object.keys(DEFAULT_RENDER_PARAMS)（src/planet/meshRenderer.js，
//   65 键，含逐键注释 —— 那里是渲染参数契约的本体）
//         ∪ 本文件的 RENDER_PARAM_EXTRA_KEYS（运行时动态字段）。
//   本文件只收"不在 DEFAULT 里、但渲染器运行时确实会读"的键，逐键注明依据；
//   主游戏接入时若要传 { displayRadius / radius / atmosphereHeight / hasAtmosphere }，
//   **不在白名单内 ⇒ setPlanet 显式报错** —— 接入方必须先换算成渲染参数（B2 根治）。
//
// 维护规则：给渲染器新增渲染参数时，默认值进 DEFAULT_RENDER_PARAMS（自动进白名单）；
// 只有"无默认值、纯运行时"的字段才需要在这里登记，并写明读取点（文件:行）。

/**
 * 运行时动态字段（不在 DEFAULT_RENDER_PARAMS 中，但渲染器会读）。
 * @type {string[]}
 */
export const RENDER_PARAM_EXTRA_KEYS = [
    // setCamera({cx, cy, zoom}) 写入的相机平移（meshRenderer.js buildViewProj 读
    // state.params.cameraX/cameraY；zoom 在 DEFAULT 里，这两个是纯运行时字段）
    'cameraX',
    'cameraY',
    // 显式半径通道（T1，2026-10-16）：render(dt) 读 state.params.screenRadiusPx，
    // 默认 undefined 走原路径 —— 通道按设计无默认条目，见 render() 处注释
    'screenRadiusPx',
    // 晨昏线陡化的漫反射坡道幂：drawSphere 以 Math.max(1, Number(...) || 1) 带兜底读取
    // （缺省 = 物理口径 1），面板 toRenderParams 每次都会传 —— 枚举调用方时发现的
    // "渲染器读但不设默认"的合法键（B2-fix 枚举，2026-10-16）
    'terminatorPow',
];
