'use strict';

// 设置面板配置（数据驱动）— 0.2.5 从 settingsUI.js 提取
// 分类/设置行/选项集中于此定义，UI 只读渲染，文案一律引用 strings.js 的 key。
// 新增设置项：在 SETTINGS_ROWS 对应分类下加一行即可，无需改渲染逻辑。

// 分类定义（enabled=false 时 UI 显示为灰色占位）
export const SETTINGS_CATEGORIES = [
    { id: 'display', labelKey: 'settings.tabDisplay', descKey: 'settings.descDisplay', enabled: true },
    { id: 'audio',   labelKey: 'settings.tabAudio',   descKey: 'settings.descAudio',   enabled: true },
    { id: 'control', labelKey: 'settings.tabControl', descKey: 'settings.descControl', enabled: false },
    { id: 'game',    labelKey: 'settings.tabGame',    descKey: 'settings.descGame',    enabled: false },
];

// 每个分类下的设置行列表
// row 结构：
//   group      分段按钮组标识（事件分发用，需全局唯一）
//   labelKey   行标签（strings.js key）
//   storageKey localStorage 存储键
//   defaultValue 无存档时的默认值
//   options    分段选项；option.labelKey 引用 strings.js，缺省时用 option.label 字面量（如 KSP1/KSP2）
//   afterChange 可选：切换后回调（main.js 注入前不在此处引用音频）
export const SETTINGS_ROWS = {
    display: [
        {
            group: 'menuBg',
            labelKey: 'settings.menuBg',
            storageKey: 'ksp2d.menuBg',
            defaultValue: 'stars',
            options: [
                { value: 'stars', labelKey: 'settings.bgStars' },
                { value: 'image', labelKey: 'settings.bgImage' },
            ]
        }
    ],
    audio: [
        {
            group: 'menuMusic',
            labelKey: 'settings.menuMusic',
            storageKey: 'ksp2d.menuMusic',
            defaultValue: 'ksp2',
            options: [
                { value: 'ksp1', label: 'KSP1' },
                { value: 'ksp2', label: 'KSP2' },
            ]
        }
    ]
};

// 分类 → 分组标题文案 key（未启用分类无分组，跳过）
export const SETTINGS_GROUP_LABELS = {
    display: 'settings.groupMenu',
    audio: 'settings.groupMusic'
};
