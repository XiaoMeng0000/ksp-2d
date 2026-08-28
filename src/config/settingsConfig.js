'use strict';

// 设置面板配置（数据驱动）— 0.2.5 从 settingsUI.js 提取
// 分类/设置行/选项集中于此定义，UI 只读渲染，文案一律引用 strings.js 的 key。
// 新增设置项：在 SETTINGS_ROWS 对应分类下加一行即可，无需改渲染逻辑。

import { VOLUME_STORAGE_KEYS, VOLUME_DEFAULTS } from '../audio/audioConfig.js';

// ==== SOI 切换时间保护开关（设置面板行 + 飞行/追踪场景读取共用同一存储键，默认启用） ====
export const SOI_PROTECT_STORAGE_KEY = 'ksp2d.soiWarpProtect';
const SOI_PROTECT_DEFAULT = 'on';

// 读取当前开关状态（true=启用保护；默认启用；仅显式 'off' 视为关闭，异常值兜底启用）
export function getSOIWarpProtectEnabled() {
    return (localStorage.getItem(SOI_PROTECT_STORAGE_KEY) || SOI_PROTECT_DEFAULT) !== 'off';
}

// 分类定义（enabled=false 时 UI 显示为灰色占位）
export const SETTINGS_CATEGORIES = [
    { id: 'display', labelKey: 'settings.tabDisplay', descKey: 'settings.descDisplay', enabled: true },
    { id: 'audio',   labelKey: 'settings.tabAudio',   descKey: 'settings.descAudio',   enabled: true },
    { id: 'control', labelKey: 'settings.tabControl', descKey: 'settings.descControl', enabled: false },
    { id: 'game',    labelKey: 'settings.tabGame',    descKey: 'settings.descGame',    enabled: true },
];

// 每个分类下的设置行列表
// row 结构：
//   group           分段按钮组/滑条标识（事件分发用，需全局唯一）
//   labelKey        行标签（strings.js key）
//   storageKey      localStorage 存储键
//   defaultValue    无存档时的默认值
//   options         分段选项；option.labelKey 引用 strings.js，缺省时用 option.label 字面量（如 KSP1/KSP2）
//   control         'slider' = 滑条控件（0~100 显示，存储 0~1）；缺省 = 分段按钮组
//   sectionLabelKey 可选：行级分组标题（同分类内多分组用，如"音乐"之后接"音量"）
//   afterChange     可选：切换后回调（main.js 注入前不在此处引用音频）
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
        },
        // 音量通道：总音量 / 音乐 / UI 音效 / 坎巴拉人通讯音（滑条，存储 0~1，显示 0~100%）
        // 默认值与 audioCore 一致（VOLUME_DEFAULTS，音乐 0.75 与 MUSIC_VOLUME 对齐）
        {
            group: 'volMaster',
            labelKey: 'settings.volMaster',
            storageKey: VOLUME_STORAGE_KEYS.master,
            defaultValue: String(VOLUME_DEFAULTS.master),
            control: 'slider',
            sectionLabelKey: 'settings.groupVolume'
        },
        {
            group: 'volMusic',
            labelKey: 'settings.volMusic',
            storageKey: VOLUME_STORAGE_KEYS.music,
            defaultValue: String(VOLUME_DEFAULTS.music),
            control: 'slider'
        },
        {
            group: 'volUi',
            labelKey: 'settings.volUi',
            storageKey: VOLUME_STORAGE_KEYS.ui,
            defaultValue: String(VOLUME_DEFAULTS.ui),
            control: 'slider'
        },
        {
            group: 'volComms',
            labelKey: 'settings.volComms',
            storageKey: VOLUME_STORAGE_KEYS.comms,
            defaultValue: String(VOLUME_DEFAULTS.comms),
            control: 'slider'
        }
    ],
    game: [
        // SOI 切换时间保护开关：靠近 SOI 切换时按"到切换剩余时间"自动限制时间加速档位
        // （保护最高档 = ≤剩余时间 的最大档位；关闭后放开全部档位，物理加速/RK4 兜底限档不受影响）
        {
            group: 'soiWarpProtect',
            labelKey: 'settings.soiWarpProtect',
            storageKey: SOI_PROTECT_STORAGE_KEY,
            defaultValue: SOI_PROTECT_DEFAULT,
            options: [
                { value: 'on', labelKey: 'settings.on' },
                { value: 'off', labelKey: 'settings.off' },
            ]
        }
    ]
};

// 分类 → 分组标题文案 key（未启用分类无分组，跳过）
export const SETTINGS_GROUP_LABELS = {
    display: 'settings.groupMenu',
    audio: 'settings.groupMusic',
    game: 'settings.groupWarp'
};
