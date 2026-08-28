'use strict';

// 轨道点类型注册表（0.3.0）— 数据驱动：轨道标签/菜单的类型定义统一入库
// 约定：
//   id           类型 id（与 markers[].type / hoveredMarker.type 对应）
//   icon         锚点/标签图标字符（可空，空则只画圆点）
//   color        标签文字颜色（类型区分色；锚点/折线/边框统一 ORBIT_MARKER_COLOR）
//   labelKey     标签名称 key（strings.js，经 t() 取显示名；收起态显示）
//   labelFullKey 展开面板标题 key（strings.js，中文全称：远点/近点）
//   contextMenu  是否可展开右键菜单（false=纯显示不可展开；true=可展开，如 SOI 边界点）
//   labelStyle   本体放置策略（side: 'outside' = 轨道外侧，细节后续扩展）
// 新增类型只需加条目 + 在轨道点计算层补位置函数，不动其他层

// 锚点/折线/标签边框的统一颜色（KSP2 飞行界面紫，与 theme.css --toolbar-border 同值）
// 区分只体现在标签文字颜色（各类型的 color），边框/锚点/折线全系统一致
export const ORBIT_MARKER_COLOR = '#6153D0';

export const ORBIT_POINT_TYPES = {
    apoapsis: {
        id: 'apoapsis',
        icon: '▲',
        color: '#FFB74D',
        labelKey: 'orbitPoint.ap',
        labelFullKey: 'orbitPoint.apFull',
        contextMenu: false,
        labelStyle: { side: 'outside' }
    },
    periapsis: {
        id: 'periapsis',
        icon: '▼',
        color: '#81C784',
        labelKey: 'orbitPoint.pe',
        labelFullKey: 'orbitPoint.peFull',
        contextMenu: false,
        labelStyle: { side: 'outside' }
    },
    // SOI 穿越标签（0.3.0）：段尾=离开、段头=进入；青蓝系呼应 SOI 边界圆
    soi_exit: {
        id: 'soi_exit',
        icon: null,
        color: '#7DA6E8',
        labelKey: 'orbitPoint.soiLeave',
        labelFullKey: 'orbitPoint.soiLeave',
        contextMenu: false,
        labelStyle: { side: 'outside' }
    },
    soi_entry: {
        id: 'soi_entry',
        icon: null,
        color: '#7DA6E8',
        labelKey: 'orbitPoint.soiEnter',
        labelFullKey: 'orbitPoint.soiEnter',
        contextMenu: false,
        labelStyle: { side: 'outside' }
    }
};
