// 纹理资源配置 — 数据驱动的纹理清单
// key → 相对于项目根目录的图片路径
export const textureConfig = {
    title: 'assets/images/menu/title.png',
    menu_bg: 'assets/images/menu/background.png',
    project_logo: 'assets/images/menu/ev.png',

    // 主菜单链接栏图标
    link_qq: 'assets/images/menu/link_icons/icon_qq.png',
    link_email: 'assets/images/menu/link_icons/icon_email.png',
    link_github: 'assets/images/menu/link_icons/github.gif',
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

    // SOI 穿越标签图标（0.3.0，白色单色模板稿 PNG，进入/离开箭头；美术可覆盖同名文件）
    icon_soi_enter: 'assets/images/ui/icon_soi_enter.png',
    icon_soi_exit: 'assets/images/ui/icon_soi_exit.png',

    // tracking station
    icon_tracking_all: 'assets/images/ui/tracking_station/all.svg',
    icon_tracking_ship: 'assets/images/ui/tracking_station/ship_port.svg',

    // 设施舱室图标
    comp_bridge: 'assets/images/facilities/compartments/bridge.png',
    comp_dock_hub: 'assets/images/facilities/compartments/dock_hub.png',
    comp_supply_terminal: 'assets/images/facilities/compartments/supply_terminal.png',
    comp_assembly_shop: 'assets/images/facilities/compartments/assembly_shop.png',
    comp_laboratory: 'assets/images/facilities/compartments/laboratory.png',

    // 飞船能力图标
    icon_deploy_facility: 'assets/images/ships/assembly_shop(ship).png',

    // 飞船资源扫描/货运能力图标（0.2.0 阶段5：🔭/📦 的 PNG 替换，图片待美术补位）
    icon_scan_resources: 'assets/images/ships/scanner.png',
    icon_cargo_hold: 'assets/images/ships/cargo_hold.png',

    // 飞船模块图标
    mod_test_ballast: 'assets/images/ships/test_ballast.png',
    mod_construction_package: 'assets/images/ships/construction_package.png',

    // 飞船船体图标（飞行场景）
    ship_default_active: 'assets/images/ships/bodies/ship_default_active.png',
    ship_default_inactive: 'assets/images/ships/bodies/ship_default_inactive.png',

    // 天体贴图
    kerbin_surface: 'assets/images/bodies/kerbin.png',
    kerbol_surface: 'assets/images/bodies/kerbol.png',
    mun_surface: 'assets/images/bodies/mun.png',
    minmus_surface: 'assets/images/bodies/minmus.png',
    duna_surface: 'assets/images/bodies/duna.png',
    ike_surface: 'assets/images/bodies/ike.png',
    eve_surface: 'assets/images/bodies/eve.png',
    gilly_surface: 'assets/images/bodies/gilly.png',
    moho_surface: 'assets/images/bodies/moho.png',
    dres_surface: 'assets/images/bodies/dres.png',
    jool_surface: 'assets/images/bodies/jool.png',
    laythe_surface: 'assets/images/bodies/laythe.png',
    vall_surface: 'assets/images/bodies/vall.png',
    tylo_surface: 'assets/images/bodies/tylo.png',
    bop_surface: 'assets/images/bodies/bop.png',
    pol_surface: 'assets/images/bodies/pol.png',
    eeloo_surface: 'assets/images/bodies/eeloo.png',

    // 时间加速 UI
    timewarp_pause: 'assets/images/ui/timewarp_pause.png',
    timewarp_play: 'assets/images/ui/timewarp_play.png',
    timewarp_cell_active: 'assets/images/ui/timewarp_cell_active.png',
    timewarp_cell_inactive: 'assets/images/ui/timewarp_cell_inactive.png',

    // 存档管理 UI
    ui_trash_can: 'assets/images/ui/trash_can.png',
};
