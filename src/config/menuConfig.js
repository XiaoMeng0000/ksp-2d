'use strict';

// 一级菜单按钮列表
const MAIN_MENU = [
    { id: 'startGame',    label: '开始游戏',  action: 'submenu' },
    { id: 'encyclopedia', label: '游戏百科',  action: 'scene:encyclopedia' },
    { id: 'credits',      label: '制作人员',  action: 'scene:credits' },
    { id: 'feedback',     label: '反馈',      action: 'callback:openFeedback' },
    { id: 'settings',     label: '设置',      action: 'callback:openSettings' },
];

// 二级菜单（开始游戏子菜单）
const SUB_MENU = [
    { id: 'newFlight',  label: '开始飞行',  action: 'callback:startNewGame' },
    { id: 'continue',   label: '继续游戏',  action: 'callback:continueGame' },
    { id: 'loadGame',   label: '读取存档',  action: 'callback:openLoadMenu' },
    { id: 'archives',   label: '存档管理',  action: 'callback:openArchiveManager' },
    { id: 'back',       label: '返回',      action: 'back' },
];

// 菜单样式配置
const MENU_STYLE = {
    logoX: 30,
    logoY: 50,
    logoMaxWidth: 340,
    buttonX: 60,
    buttonStartY: 220,
    buttonSpacing: 48,
    buttonHeight: 36,
    buttonMinWidth: 200,
    fontSize: 20,
    fontFamily: 'monospace',
    textColor: 'rgba(255, 255, 255, 0.85)',
    hoverBg: 'rgba(80, 80, 160, 0.6)',
    hoverTextColor: 'rgba(255, 255, 255, 1.0)',
    versionX: -20,
    versionY: 20,
    versionFontSize: 11,
    versionColor: 'rgba(255, 255, 255, 0.3)',
};

export { MAIN_MENU, SUB_MENU, MENU_STYLE };
