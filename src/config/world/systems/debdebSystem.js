"use strict";

// ========== Debdeb 星系(占位) ==========
// placeholder: true 表示占位星系(仅展示,无真实天体数据)
// distance/bearingDeg 描述该星系相对 homeworld 星系的方位:
//   distance: 距 homeworld 恒星的光年数(运行时换算为米)
//   bearingDeg: 方位角(度),以 homeworld 原点为基准,0° = +x 轴,逆时针为正
// 占位星系无恒星,不参与 SOI 重叠检测;实体化后由恒星固定在该位置

export const meta = {
    id: 'debdeb',
    name: 'Debdeb',
    description: 'Debdeb 是坎巴拉天文台在深空巡天中捕捉到的一个遥远星系，它的星光要走过漫长的岁月才能抵达 Kerbolar 系。目前我们只能确认那里有一颗明亮的恒星，其余的一切都笼罩在星尘与未知之中。观测望远镜已经对准了那片天空——敬请期待未来的开拓者。',
    enabled: true,
    placeholder: true,
    distance: 4.5,
    bearingDeg: 45
};

export const bodies = [];
