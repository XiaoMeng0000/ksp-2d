'use strict';

// 纹理资源配置 —「无主」通用 UI 图标的集中声明（0.3.0 起资产分两层）
//
// 分层约定（详见 src/config/assets/assetManifest.js）：
//   1. 有实体归属的资产 → 就近声明在实体自己的配置里，本文件不再登记：
//        · 天体表面贴图   → src/config/systems/*.js         的 texture
//        · 飞船模块图标   → src/ship/moduleTypes.js         的 iconTexture
//        · 飞船能力图标   → src/ship/moduleTypes.js         的 CAPABILITY_TOOLBAR.iconTexture
//        · 设施/舱室图标  → src/facility/facilityTypes.js   的 iconTexture
//        · 飞船船体两态图 → src/ship/shipTemplates.js       的 textures
//   2. 无实体归属的通用 UI 图标 → 仍集中在本文件，key 为短标识
//
// 新增图片时先判断归属：能挂到某实体上的一律就近声明，只有纯 UI 装饰才加在这里。

export const textureConfig = {
    title: 'assets/images/menu/title.png',
    menu_bg: 'assets/images/menu/background.png',
    project_logo: 'assets/images/menu/ev.png',

    // 主菜单链接栏图标
    link_qq: 'assets/images/menu/link_icons/icon_qq.png',
    link_email: 'assets/images/menu/link_icons/icon_email.png',
    link_github: 'assets/images/menu/link_icons/github.gif',

    // 通用设施兜底图（轨道地图上无专属图时的设施绘制用）
    facility: 'assets/images/facilities/facility.png',

    // esc界面图标
    icon_continue: 'assets/images/ui/icon_escMenu/icon_continue.svg',
    icon_save: 'assets/images/ui/icon_escMenu/icon_save.svg',
    icon_load: 'assets/images/ui/icon_escMenu/icon_load.svg',
    icon_tracking_station: 'assets/images/ui/icon_escMenu/icon_trasta.svg',
    icon_back_to_ship: 'assets/images/ui/icon_escMenu/icon_back.svg',
    icon_wiki: 'assets/images/ui/icon_escMenu/icon_wiki.svg',
    icon_missions: 'assets/images/ui/icon_escMenu/icon_missions.svg',

    // SAS 底部按钮图标（SVG，占位版已入位，正式美术出图后覆盖同名文件即可，零代码改动）
    icon_sas: 'assets/images/sas/icon_sas.svg',
    icon_node: 'assets/images/sas/icon_node.svg',
    icon_target_plus: 'assets/images/sas/icon_target_plus.svg',
    icon_target_minus: 'assets/images/sas/icon_target_minus.svg',

    // 导航球方向图标（SVG；导航球标记与 SAS 圆盘按钮共用）
    dir_prograde: 'assets/images/sas/dir_prograde.svg',
    dir_retrograde: 'assets/images/sas/dir_retrograde.svg',
    dir_radial_in: 'assets/images/sas/dir_radial_in.svg',
    dir_radial_out: 'assets/images/sas/dir_radial_out.svg',

    // SOI 穿越标签图标（0.2.4，白色单色模板稿 PNG，进入/离开箭头；美术可覆盖同名文件）
    icon_soi_enter: 'assets/images/ui/icon_soi_enter.png',
    icon_soi_exit: 'assets/images/ui/icon_soi_exit.png',

    // 飞行状态卡引擎图标（0.2.4，白色单色 SVG 模板稿）
    icon_engine: 'assets/images/ui/icon_engine.svg',

    // tracking station
    icon_tracking_all: 'assets/images/ui/tracking_station/all.svg',
    icon_tracking_ship: 'assets/images/ui/tracking_station/ship_port.svg',

    // 飞船船体通用兜底图（模板未配置自有 textures 时使用，两态）
    ship_default_active: 'assets/images/ships/hulls/ship_default_active.png',
    ship_default_inactive: 'assets/images/ships/hulls/ship_default_inactive.png',

    // 时间加速 UI
    timewarp_pause: 'assets/images/ui/timewarp_pause.png',
    timewarp_play: 'assets/images/ui/timewarp_play.png',
    timewarp_cell_active: 'assets/images/ui/timewarp_cell_active.png',
    timewarp_cell_inactive: 'assets/images/ui/timewarp_cell_inactive.png',

    // 存档管理 UI
    ui_trash_can: 'assets/images/ui/trash_can.png',
};
