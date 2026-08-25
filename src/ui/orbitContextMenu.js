'use strict';

// 轨道右键菜单（0.3.0 骨架 — 功能体待填）
// 入口：flightScene onContextMenu 在 SAS 右键处理之前，命中轨道线 / Ap/Pe 标记时调用本函数
// 交互数据来源：renderer.getLastOrbitSegments() / getLastOrbitMarkers()（本帧已绘制的轨道几何，
// 由 renderer 在 renderOrbit / renderOrbitMarkers 中写入，交互层只读，不与预测引擎直接耦合）
//
// 菜单项规划（亡星余孤"不超过 3 选项"原则）：
//   轨道点右键：
//     1. 时间加速至此   → timeWarp.warpToTime(当前时刻 + 段内偏移 t)；t 取自命中点 relPoints[i].t
//                        （t 为自段起点 anchorTime 起的游戏秒偏移，绝对时刻 = anchorTime + t）
//     2. 创建机动节点   → TODO: 机动节点功能开发中（与 renderManeuverOrbits 的 TODO 同源）
//     3. 复制轨道坐标   → navigator.clipboard.writeText('{x: 1234.5, y: -678.9}') + 通知反馈
//   Ap/Pe 标记右键：额外显示"跳转至 Ap/Pe"（= 时间加速到 info.tToAp / info.tToPe）
//
// 视觉与关闭模式：固定定位浮动面板，复用 ksp2_panels.css 面板风格，
// 点击面板外部 / Esc 关闭（参考 uiComponents.js showModuleSelectorPopup 的 closePopup 模式）

/**
 * 显示轨道右键菜单（骨架期仅建立接口，菜单 DOM 与菜单项动作待填）
 * @param {number} clientX - 触发点 clientX（DOM 像素）
 * @param {number} clientY - 触发点 clientY（DOM 像素）
 * @param {Object} data - 命中上下文，两种形态：
 *   轨道点命中：{ worldX, worldY, soiName, isCurrentSoi, timeOffset }
 *   标记命中：  { markerType: 'ap' | 'pe', worldX, worldY, tToNext }
 */
export function showOrbitContextMenu(clientX, clientY, data) {
    // TODO: 骨架期占位，菜单 DOM 与菜单项动作待填（结构规划见文件头注释）
}
