'use strict';

// 一级菜单按钮列表
const MAIN_MENU = [
    { id: 'startGame',    label: '开始游戏',  action: 'submenu:game' },
    { id: 'encyclopedia', label: '游戏百科',  action: 'scene:encyclopedia' },
    { id: 'extra',        label: '额外内容',  action: 'submenu:extra' },
    { id: 'feedback',     label: '反馈',      action: 'callback:openFeedback' },
    { id: 'settings',     label: '设置',      action: 'callback:openSettings' },
];

// 二级菜单（开始游戏子菜单）
const GAME_SUB_MENU = [
    { id: 'newFlight',  label: '开始飞行',  action: 'callback:startNewGame' },
    { id: 'continue',   label: '继续游戏',  action: 'callback:continueGame' },
    { id: 'loadGame',   label: '读取存档',  action: 'callback:openLoadMenu' },
    { id: 'archives',   label: '存档管理',  action: 'callback:openArchiveManager' },
    { id: 'back',       label: '返回',      action: 'back' },
];

// 二级菜单（额外内容子菜单）
const EXTRA_MENU = [
    { id: 'galaxies', label: '已加载星系',  action: 'scene:galaxies' },
    { id: 'credits',  label: '制作人员',  action: 'scene:credits' },
    { id: 'license',  label: '版权声明',  action: 'scene:license' },
    { id: 'back',     label: '返回',      action: 'back' },
];

// 菜单查找表：主菜单 + 各二级菜单
const MENUS = {
    main: MAIN_MENU,
    game: GAME_SUB_MENU,
    extra: EXTRA_MENU,
};

// 说明：主菜单布局样式（Logo/按钮/版本号）已随阶段 3 迁移至
// src/ui/styles/main_menu.css，原 MENU_STYLE 布局常量已废弃移除
export { MAIN_MENU, GAME_SUB_MENU, EXTRA_MENU, MENUS };
