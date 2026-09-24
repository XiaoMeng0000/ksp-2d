"use strict";

// ========== Tuun 星系(占位) ==========
// placeholder: true 表示占位星系(仅展示,无真实天体数据)
// distance/bearingDeg 描述该星系相对 homeworld 星系的方位:
//   distance: 距 homeworld 恒星的光年数(运行时换算为米)
//   bearingDeg: 方位角(度),以 homeworld 原点为基准,0° = +x 轴,逆时针为正
// 占位星系无恒星,不参与 SOI 重叠检测;实体化后由恒星固定在该位置

export const meta = {
    id: 'tuun',
    name: 'Tuun',
    description: 'Tuun 是坎巴拉天文台档案中的又一个遥远恒星系，关于它的信息少得可怜——只有几行零碎的观测记录和一张模糊的星图。没人知道它的历史，它的未来。',
    enabled: true,
    placeholder: true,
    distance: 7.2,
    bearingDeg: 215
};

export const bodies = [];
