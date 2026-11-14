'use strict';

// 主菜单按钮列表（尝鲜版 6 项）
//
// 尝鲜版主菜单原则：
//   · 只有「开始游戏」是玩法入口（一键开玩，无前置选择界面）；
//   · 「完整版内容」是把玩家导向桌面版完整游戏的唯一引导入口；
//   · 玩家可获取信息 / 调整的项（制作人员、版权声明、设置）保留；
//   · 部件装配车间（3D）、百科、已加载星系、游戏公告等被裁内容的入口全部移除
//     （其中百科在 ESC 菜单里仍保留入口，点击弹「下载完整版」提示）。
const MAIN_MENU = [
    { id: 'startGame',   label: '开始游戏',   action: 'callback:startGame' },
    { id: 'fullVersion', label: '完整版内容', action: 'callback:openFullVersion' },
    { id: 'credits',     label: '制作人员',   action: 'scene:credits' },
    { id: 'license',     label: '版权声明',   action: 'scene:license' },
    { id: 'settings',    label: '设置',       action: 'callback:openSettings' },
    { id: 'quit',        label: '退出',       action: 'callback:quitGame' },
];

// 主菜单链接栏（icon_key 对应 textureConfig.js 中的纹理 key，由 textureManager 统一加载）
const LINKS_ICONS = [
    {label: 'QQ群',  type: 'qgroup',  links: '1098073419', icon_key: 'link_qq' },
    {label: 'E-mail',  type: 'email',  links: 'mc1234com@163.com', icon_key: 'link_email' },
    {label: 'Github',  type: 'link',  links: 'https://github.com/XiaoMeng0000/ksp-2d', icon_key: 'link_github' },
    {label: 'Github Issues',  type: 'link',  links: 'https://github.com/XiaoMeng0000/ksp-2d/issues', icon_key: 'link_github' },
];

// 菜单查找表（尝鲜版只有一个层级，保留 MENUS 结构以便 menuScene 的渲染逻辑不变）
const MENUS = {
    main: MAIN_MENU
};

export { MAIN_MENU, MENUS, LINKS_ICONS };
