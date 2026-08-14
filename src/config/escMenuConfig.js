'use strict';

// ESC 菜单配置（数据驱动）— 0.2.5 大型重构，学习 KSP2 风格
// 行顺序即渲染顺序，行号（0 起）按渲染顺序自动生成。
// 字段说明：
//   id        行唯一标识（DOM 无依赖，仅注释/调试用）
//   section   分组：'main' 主操作 | 'facilities' 设施 | 'footer' 底部工具
//   labelKey  文案 key（strings.js）；追踪站场景下 tracking 行由 UI 层动态替换为"回到飞行器"
//   labelKey2 可选，标签第二段（白色，与 labelKey 形成"动作词彩色 + 名词白色"双色结构）
//   icon      行内小图标（仅 tone != 'plain' 的行显示；footer 行为 plain 不渲染图标）
//   tone      配色语义：accent 蓝 | success 绿 | facility 绿 | plain 白（无装饰）
//   action    事件委托 key（escMenuUI.js 统一分发）
//   disabled  true 时灰显占位，点击仅提示"功能尚未开放"
// 示例图无 Campaign Statistics / Report Redux Bug / Quit Game 概念，不列入

export const ESC_ACTIONS = [
    // --- main: 主操作（动作词彩色 + "游戏"白色） ---
    { id: 'resume',       section: 'main',       labelKey: 'esc.resume',  labelKey2: 'esc.gameWord', icon: '▶',  tone: 'accent',   action: 'esc-resume' },
    { id: 'save',         section: 'main',       labelKey: 'esc.save',    labelKey2: 'esc.gameWord', icon: '💾', tone: 'success',  action: 'esc-save' },
    { id: 'load',         section: 'main',       labelKey: 'esc.load',    labelKey2: 'esc.gameWord', icon: '📂', tone: 'accent',   action: 'esc-load' },

    // --- facilities: 设施组 ---
    { id: 'tracking',     section: 'facilities', labelKey: 'esc.openTracking', icon: '🛰', tone: 'facility', action: 'esc-tracking' },
    // TODO: 百科场景（encyclopediaScene）的返回目标当前固定为主菜单，
    // 从飞行/追踪场景进入会导致流程断裂，待其支持返回原场景后启用
    { id: 'encyclopedia', section: 'facilities', labelKey: 'esc.encyclopedia', icon: '📖', tone: 'facility', action: 'esc-encyclopedia', disabled: true },
    // TODO: 生涯模式任务中心，暂未实现
    { id: 'missions',     section: 'facilities', labelKey: 'esc.missions',     icon: '🎯', tone: 'facility', action: 'esc-missions', disabled: true },

    // --- footer: 底部工具（无图标、无色调，与示例图一致） ---
    { id: 'settings',     section: 'footer',     labelKey: 'common.settings',  icon: null, tone: 'plain',    action: 'esc-settings' },
    { id: 'quitToMenu',   section: 'footer',     labelKey: 'esc.quitToMenu',   icon: null, tone: 'plain',    action: 'esc-quit' }
];

// 分组元信息：
//   titleKey       分组标题（如 "## FACILITIES"），标题本身占一个行号
//   emptyRowsAfter 该分组渲染完后插入的空行数（带行号，仅作视觉分组分隔）
//                  footer 组开始前由 escMenuUI.js 插入 .esc-fill 弹性空白（CSS flex:1），
//                  把 设置/退出/版本号 整体压到面板底部，适配任意屏高
export const ESC_SECTIONS = {
    main:       { titleKey: null,                 emptyRowsAfter: 1 },
    facilities: { titleKey: 'esc.sectionFacilities', emptyRowsAfter: 8 },
    footer:     { titleKey: null,                 emptyRowsAfter: 0 }
};
