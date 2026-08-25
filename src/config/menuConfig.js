'use strict';

// 一级菜单按钮列表
const MAIN_MENU = [
    // 0.2.5：开始游戏不再进入子菜单，直接打开左侧"开始游戏"综合面板
    { id: 'startGame',    label: '开始游戏',  action: 'callback:openStartGamePanel' },
    // 0.2.7：百科由 scene 改为覆盖式面板（不切场景/不中断 BGM），入口协议与设置一致
    { id: 'encyclopedia', label: '百科',  action: 'callback:openEncyclopedia' },
    { id: 'extra',        label: '额外内容',  action: 'submenu:extra' },
    { id: 'settings',     label: '设置',      action: 'callback:openSettings' },
];

// 二级菜单（额外内容子菜单）
const EXTRA_MENU = [
    { id: 'announcement', label: '游戏公告',  action: 'callback:openAnnouncement' },
    { id: 'galaxies', label: '已加载星系',  action: 'scene:galaxies' },
    { id: 'credits',  label: '制作人员',  action: 'scene:credits' },
    { id: 'license',  label: '版权声明',  action: 'scene:license' },
    { id: 'back',     label: '返回',      action: 'back' },
];

// 主菜单链接栏（icon_key 对应 textureConfig.js 中的纹理 key，由 textureManager 统一加载）
const LINKS_ICONS = [
    {label: 'QQ群',  type: 'qgroup',  links: '1098073419', icon_key: 'link_qq' },
    {label: 'E-mail',  type: 'email',  links: 'mc1234com@163.com', icon_key: 'link_email' },
    {label: 'Github',  type: 'link',  links: 'https://github.com/XiaoMeng0000/ksp-2d', icon_key: 'link_github' },
    {label: 'Github Issues',  type: 'link',  links: 'https://github.com/XiaoMeng0000/ksp-2d/issues', icon_key: 'link_github' },
];

// 菜单查找表：主菜单 + 各二级菜单
// 0.2.5：原 game 子菜单（开始飞行/继续游戏/读取存档/存档管理）已整合进
// 左侧"开始游戏"综合面板（startGamePanel.js），此处不再维护 game 菜单
const MENUS = {
    main: MAIN_MENU,
    extra: EXTRA_MENU,
};

// 说明：主菜单布局样式（Logo/按钮/版本号）已随阶段 3 迁移至
// src/ui/styles/main_menu.css，原 MENU_STYLE 布局常量已废弃移除
export { MAIN_MENU, EXTRA_MENU, MENUS, LINKS_ICONS };
