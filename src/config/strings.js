'use strict';

// ============================================================
// 全局文本字典 — 所有 UI 展示文本集中管理（单语言）
// 约定：
// 1. key 按模块前缀命名：common.* / esc.* / archive.* / tracking.* /
//    dock.* / build.* / facility.* / sas.* / timewarp.* / settings.* ...
// 2. 值可为字符串，或函数（接收 params 对象，返回插值后文本）
// 3. 只放 UI 展示文本；数据配置文本（天体/模块/设施/百科名称与描述）
//    属于数据层，保留在各自 config 文件，不迁移到这里
// 4. 新增 key 时按前缀分组，保持可读性
// ============================================================

const STRINGS = {

    // ---------- 通用 ----------
    'common.none': '无',
    'common.unknown': '未知',
    'common.empty': '列表为空',
    'common.cancel': '取消',
    'common.confirm': '确定',
    'common.confirmDefault': '确认',
    'common.close': '关闭',
    'common.delete': '删除',
    'common.back': '返回',
    'common.settings': '设置',
    'common.noWorld': '没有当前世界',
    'common.checkpointName': (p) => `检查点 ${p.n}`,
    'common.unitCount': ' 个',

    // ---------- ESC 菜单 ----------
    'esc.menu': '菜单',
    'esc.currentWorld': (p) => `当前世界：${p.name}`,
    'esc.closeHint': '按 ESC 关闭',
    'esc.resume': '继续游戏',
    'esc.save': '存档',
    'esc.load': '读档',
    'esc.openTracking': '追踪站',
    'esc.backToFlight': '回到飞行器',
    'esc.quitToMenu': '退出到主菜单',
    'esc.blockedThrustTracking': '推力模式下无法进入追踪站！',
    'esc.noShip': '没有找到飞船',
    'esc.blockedThrustQuit': '推力模式下无法退出！',
    'esc.quitTitle': '退出到主菜单',
    'esc.quitMessage': '是否保存当前进度？未保存的数据将丢失。',
    'esc.saveAndQuit': '保存并退出',
    'esc.quitDirect': '直接退出',

    // ---------- 存档管理 ----------
    'archive.title': '存档管理',
    'archive.noWorlds': '没有存档世界',
    'archive.noCheckpoints': '没有找到检查点',
    'archive.noCheckpointsInWorld': '该世界没有检查点',
    'archive.backToList': '返回世界列表',
    'archive.selectCheckpoint': '选择检查点',
    'archive.saved': '存档成功！已保存检查点',
    'archive.savedCheckpoint': '✅ 已保存检查点',
    'archive.saveFailed': '存档失败',
    'archive.saveError': '存档异常',
    'archive.loaded': '✅ 读档成功！',
    'archive.loadFailed': '❌ 读档失败',
    'archive.worldDeleted': '✅ 世界已删除',
    'archive.checkpointDeleted': '✅ 检查点已删除',
    'archive.confirmDeleteTitle': '确认删除',
    'archive.confirmDeleteWorld': (p) => `确认删除世界 "${p.name}" 及其所有检查点？此操作不可恢复。`,
    'archive.confirmDeleteCheckpoint': (p) => `确认删除检查点 "${p.name}"？此操作不可恢复。`,
    'archive.checkpointSubtitle': (p) => `${new Date(p.ts).toLocaleString()} · 游戏时间 ${p.time}s`,
    'archive.checkpointSubtitleCn': (p) => `${new Date(p.ts).toLocaleString()} · 游戏时间 ${p.time}秒`,

    // ---------- 追踪站 ----------
    'tracking.typeLabel': '类型: ',
    'tracking.typeStar': '恒星',
    'tracking.typePlanet': '行星',
    'tracking.typeMoon': '卫星',
    'tracking.typeShip': '飞船',
    'tracking.typeFacility': '设施',
    'tracking.typeUnknown': '未知',
    'tracking.deepSpace': '深空',
    'tracking.modules': '模块:',
    'tracking.noModules': '无',
    'tracking.docksLabel': '对接口: ',
    'tracking.dockedShips': '停靠飞船:',
    'tracking.noDockedShips': '无停靠飞船',
    'tracking.control': '控制',
    'tracking.destroy': '摧毁',
    'tracking.keepAtLeastOneShip': '至少保留一艘飞船',
    'tracking.confirmDestroyTitle': '确认摧毁',
    'tracking.confirmDestroyMsg': '该操作无法撤销，是否继续摧毁？',
    'tracking.confirmDestroyFacilityMsg': '摧毁设施将释放所有停靠飞船，该操作无法撤销。是否继续？',
    'tracking.facilityDestroyed': '设施已摧毁',
    'tracking.shipDestroyed': '飞船已摧毁',
    'tracking.destroyCancelled': '已取消摧毁',
    'tracking.bodyList': '天体列表',
    'tracking.eccCircular': '圆形',
    'tracking.eccEllipticalLow': '椭圆形',
    'tracking.eccElliptical': '椭圆',
    'tracking.eccHigh': '高椭圆',
    'tracking.speedLabel': '速度: ',
    'tracking.fuelLabel': '燃料: ',
    'tracking.dryMassLabel': '干质量: ',
    'tracking.eccLabel': '离心率: ',

    // ---------- 设施舱室 ----------
    'facility.deploy': '部署设施',
    'facility.typeName': '设施',
    'facility.bridgeResearch': '蓝图研究功能开发中...',
    'facility.unknownCompartment': '未知舱室',
    'facility.nameLabel': '设施名称',
    'facility.typeLabel': '设施类型',
    'facility.dockLabel': '对接口',
    'facility.upgradeLabel': '升级等级',
    'facility.levelSuffix': ' 级',
    'facility.hostBody': '所属天体',
    'facility.interactionRange': '交互范围',
    'facility.rangeUnit': ' 单位',
    'facility.currentControl': '当前控制：',
    'facility.fuelLabel': '燃料',
    'facility.dryMassLabel': '干质量',
    'facility.modulesLabel': '模块',
    'facility.backToOverview': '返回设施总览',
    'facility.shipBuilt': '飞船已建造在设施附近',
    'facility.newShipName': '新建飞船',
    'facility.deployTitle': '部署设施',
    'facility.deployHint': '选择设施查看数据',
    'facility.deployBtn': '部署',
    'facility.noFacilities': '暂无设施',
    'facility.docksLabel': '对接位: ',
    'facility.compartmentsLabel': '舱室',
    'facility.servicesLabel': '服务',
    'facility.deploySelectFirst': '请先选择要部署的设施类型',
    'facility.deploying': '设施部署中...',

    // ---------- 对接 ----------
    'dock.dockCurrentShip': (p) => `对接当前飞船：${p.name}（剩余 ${p.free} 个对接口）`,
    'dock.docksFull': (p) => `⚠ 对接口已满（0/${p.max}）`,
    'dock.approachHint': '控制飞船靠近后可对接',
    'dock.noDockedShips': '暂无停靠飞船',
    'dock.dockedShips': (p) => `停靠飞船（${p.n} 艘）`,
    'dock.modulesCount': (p) => `模块: ${p.n} 个`,
    'dock.switchControl': '切换控制',
    'dock.takeoff': '起飞',
    'dock.noDockedShipsRefuel': '暂无停靠飞船可补给',
    'dock.refuelableShips': (p) => `可补给飞船（${p.n} 艘）`,
    'dock.refuel': '补给燃料',
    'dock.refuelCost': '消耗: 0 点数',
    'dock.refuelDone': '燃料补给完成',
    'dock.promptDock': '按 [B] 对接',
    'dock.promptBtn': '对接',

    // ---------- 飞船建造 ----------
    'build.title': '飞船建造',
    'build.selectHint': '选择飞船查看数据',
    'build.moduleSlots': '模块槽',
    'build.buildBtn': '建造！',
    'build.noShips': '暂无飞船',
    'build.dryMass': '干质量:',
    'build.thrust': '推力:',
    'build.dv': 'ΔV:',
    'build.fuel': '燃料:',
    'build.moi': '转动惯量:',
    'build.slots': '槽位:',
    'build.installed': '已安装: ',
    'build.bonusShort': (p) => `(+${p.mass}t +${p.moi}惯)`,
    'build.massBonus': (p) => `干质量加成: +${p.v} t`,
    'build.moiBonus': (p) => `转动惯量加成: +${p.v} kg·m²`,
    'build.uninstall': '卸载',
    'build.noSlots': '暂无模块槽',
    'build.slotIndex': (p) => `槽${p.i}`,
    'build.slotEmpty': '空',
    'build.selectShipFirst': '请先选择一艘飞船',
    'build.noHomeBody': '找不到起始天体数据',
    'build.chooseAltitude': '选择轨道高度',
    'build.altitudePrompt': (p) => `请输入绕 ${p.name} 的轨道半径（米）`,
    'build.invalidNumber': '请输入有效数字',
    'build.shipNameSuffix': (p) => `${p.name}号`,
    'build.createFailed': '飞船创建失败',
    'build.launched': '飞船建造完成，已发射！',
    'build.cancelled': '建造已取消',

    // ---------- SAS / 导航球 ----------
    'sas.prograde': '顺向',
    'sas.retrograde': '逆向',
    'sas.radialIn': '径向内',
    'sas.radialOut': '径向外',
    'sas.stability': '姿态保持',
    'sas.main': 'SAS',
    'sas.node': '节点',
    'sas.targetPlus': '目标+',
    'sas.targetMinus': '目标-',
    'sas.wip': '功能开发中',
    'sas.showFilter': '显示筛选',
    'sas.ships': '飞船',
    'sas.facilities': '设施',
    'sas.facilityRange': '设施范围',
    'sas.bodyOrbits': '天体轨道',

    // ---------- 飞船损毁报告 ----------
    'destroyed.reasonAtmosphere': '在大气层中坠毁',
    'destroyed.reasonSurface': '撞击天体表面',
    'destroyed.title': '💥 飞船损毁报告',
    'destroyed.ship': '飞船',
    'destroyed.reason': '损毁原因',
    'destroyed.body': '所在天体',
    'destroyed.altitude': '损毁高度',
    'destroyed.speed': '损毁速度',
    'destroyed.gameTime': '游戏时间',
    'destroyed.loadSave': '读取存档',
    'destroyed.goTracking': '前往追踪站',
    'destroyed.loadMenuMissing': '存档菜单未加载',

    // ---------- 时间加速 HUD ----------
    'timewarp.utTip': '点击切换时间显示模式（任务时间开发中）',
    'timewarp.pauseTip': '点击暂停/恢复时间加速',
    'timewarp.wip': '任务时间开发中',
    'timewarp.paused': '|| TIME PAUSED',
    'timewarp.active': '>> TIME WARP ACTIVE',
    'timewarp.normal': '>> NORMAL FLIGHT',
    'timewarp.label': (p) => `TIME WARP= ${p.rate}x`,

    // ---------- 设置场景 ----------
    'settings.title': '设置',
    'settings.tabDisplay': '显示',
    'settings.tabAudio': '音频',
    'settings.tabControl': '控制',
    'settings.tabGame': '游戏',
    'settings.descDisplay': '选择菜单背景显示模式。星空模式会透出游戏星空背景，图片模式会加载自定义背景图。',
    'settings.descAudio': '选择菜单背景音乐。KSP1 / KSP2 对应两首不同的菜单音乐。',
    'settings.descControl': '配置键盘映射、鼠标灵敏度等控制选项。（即将推出）',
    'settings.descGame': '调整游戏难度、时间加速倍率等玩法参数。（即将推出）',
    'settings.groupMenu': '菜单',
    'settings.menuBg': '菜单背景',
    'settings.bgStars': '星空',
    'settings.bgImage': '图片',
    'settings.groupMusic': '音乐',
    'settings.menuMusic': '菜单音乐',
    'settings.comingSoon': '即将推出',

    // ---------- 公测公告 ----------
    // 公告内容已清空（v0.2.4 稳定后填写新公告）
    'info.title': '',
    'info.body': '',

    // ---------- 启动画面 ----------
    'splash.text': '本游戏为个人学习项目，不用于商业用途',
    'splash.studio': '【逃逸速度】',

    // ---------- 设施部署(飞行场景) ----------
    'deploy.noModule': '未挂载建设集成模块',
    'deploy.needStableOrbit': '必须在稳定轨道上才能部署设施',
    'deploy.noEscapeTrajectory': '逃逸轨道上无法部署设施，需在椭圆/圆轨道上进行',
    'deploy.dangerZone': '无法在危险区域内部署设施（大气层/表面范围内）',
    'deploy.newName': (p) => `新建${p.name}`,
    'deploy.newFacility': '新建设施',
    'deploy.success': (p) => `${p.name} 部署成功`,
    'deploy.failed': '设施部署失败',
    'deploy.noTargetBody': '目标天体不存在',
    'deploy.altitudeOutOfRange': '轨道高度超出天体引力范围',
    'deploy.deployedAt': (p) => `已部署到 ${p.name} 轨道，高度 ${p.altitude}`,
    'dock.success': '对接成功',
    'dock.failFull': '对接失败（对接口已满或其他原因）',

    // ---------- 星系图场景 ----------
    'galaxies.star': '恒星',
    'galaxies.planet': '行星',
    'galaxies.moon': '卫星',
    'galaxies.notOpen': '✦ 遥远星系 · 尚未开放探索',
    'galaxies.loadedBodies': (p) => `已加载天体 (${p.n})  ${p.arrow}`,
    'galaxies.noBodies': '—— 该星系尚未开放，暂无已加载天体 ——',
    'galaxies.typeLabel': '类型: ',
    'galaxies.radiusLabel': ' · 半径: ',
    'galaxies.atmosphereLabel': ' · 大气: ',
    'galaxies.hasAtmosphere': '有',
    'galaxies.noAtmosphere': '无',
    'galaxies.back': '← 返回',
    'galaxies.title': '星系图',
    'galaxies.summary': (p) => `// 已加载 ${p.galaxies} 个星系 · ${p.bodies} 个天体`,

    // ---------- 追踪站场景 ----------
    'tracking.stationName': '追踪站',

    // ---------- 新游戏 / 读档 / 反馈(main.js) ----------
    'newgame.exception': (p) => `游戏发生异常: ${p.msg}`,
    'newgame.imgLoadFail': (p) => `${p.n} 张图片加载失败，部分界面可能异常`,
    'newgame.audioLoadFail': (p) => `${p.n} 个音频加载失败，相关声音可能缺失`,
    'newgame.worldNameTitle': '新世界名称',
    'newgame.worldNamePlaceholder': '输入世界名称',
    'newgame.worldNameDefault': '新世界',
    'newgame.defaultShip': '初始飞船',
    'newgame.startDockName': 'Kerbin 轨道船坞',
    'newgame.success': '新世界创建成功！',
    'newgame.nameExists': '世界名称已存在，请换一个',
    'newgame.uiNotLoaded': 'UI 组件未加载',
    'load.noSaveStartNew': '没有存档，开始新游戏吧',
    'load.noValidCheckpoint': '没有找到有效的检查点',
    'load.noSaves': '没有存档',
    'load.worldItem': (p) => `${p.name}  (${p.count} 个检查点)`,
    'load.selectWorld': '选择世界',
    'load.selectCheckpoint': '选择检查点',
    'feedback.title': '反馈渠道',
    'feedback.qq': 'QQ：1570447677',
    'feedback.email': '邮箱：mc1234com@163.com',

    // ---------- 存档 / 时间暂停通知 ----------
    'save.thrustBlocked': '推力模式下无法存档！',
    'timewarp.pausedNotice': '游戏已暂停',
    'timewarp.resumedNotice': '游戏已恢复',

    // ---------- 大气 / 表面危害 ----------
    'atmo.entering': (p) => `⚠ 警告：正在进入 ${p.name} 大气层！`,
    'atmo.destroyedAtmosphere': (p) => `💥 ${p.name} 在大气层中坠毁`,
    'atmo.destroyedSurface': (p) => `💥 ${p.name} 撞击天体表面`,
};

// 查询文本：key 缺失时返回 key 本身（便于定位），debug 模式下打印警告
function t(key, params) {
    const v = STRINGS[key];
    if (v === undefined) {
        if (typeof window !== 'undefined' && window.__DEBUG_STRINGS) {
            console.warn(`[strings] 缺失文本 key: ${key}`);
        }
        return key;
    }
    if (typeof v === 'function') {
        return v(params || {});
    }
    return v;
}

export { t };
