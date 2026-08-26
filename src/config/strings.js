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
    // ---------- 通用补充（数据驱动收敛） ----------
    'common.free': '免费',
    'common.fuel': '燃料',
    'common.modeSandbox': '自由模式',
    'common.modeCareer': '生涯模式',

    // ---------- 开始游戏面板（左侧滑出综合面板，替代原 game 子菜单/读档/存档管理） ----------
    'startgame.title': '开始游戏',
    'startgame.close': '关闭',
    'startgame.newCampaign': '创建新战役',
    'startgame.worlds': '战役',
    'startgame.games': '游戏',
    'startgame.worldCount': (p) => `${p.n} 个战役`,
    'startgame.noWorlds': '暂无战役，点击「创建新战役」开始',
    'startgame.noCheckpoints': '该战役暂无存档',
    'startgame.worldItem': (p) => `${p.name}（${p.count} 个存档）`,
    'startgame.gameCount': (p) => `${p.n} 个存档`,
    'startgame.loadGame': '加载游戏',
    'startgame.deleteGame': '删除',
    'startgame.deleteWorld': '删除战役',
    'startgame.confirmDeleteWorld': (p) => `确认删除战役「${p.name}」及其所有存档？此操作不可恢复。`,
    'startgame.confirmDeleteCheckpoint': (p) => `确认删除存档「${p.name}」？此操作不可恢复。`,
    'startgame.selectWorldHint': '请先选择左侧的战役',
    'startgame.metaLastPlayed': '最近游玩',
    'startgame.metaGameTime': '游戏时间',
    'startgame.metaGameMode': '游戏模式',

    // ---------- 创建新战役对话框 ----------
    'newcampaign.title': '创建新战役',
    'newcampaign.gameMode': '游戏模式',
    'newcampaign.campaignName': '战役名称',
    'newcampaign.namePlaceholder': '输入战役名称',
    'newcampaign.nameDefault': '新世界',
    'newcampaign.modeDescSandbox': '无资源消耗限制，自由建造、部署与探索，适合快速体验。',
    'newcampaign.modeDescCareer': '包含资源消耗、科技解锁与扫描探测的完整生涯流程。',
    'newcampaign.modeNotReady': '生涯模式尚未完成，请先体验自由模式。',
    'newcampaign.cancel': '取消',
    'newcampaign.start': '开始新战役',
    // 0.2.5 星系配置(创建时选择,创建后不可更改)
    'newcampaign.systemConfig': '星系配置（测试功能）',
    'newcampaign.systemConfigHint': '选择本战役加载的星系组合（创建后不可更改）',
    'newcampaign.systemInvalid': '星系组合无效，无法创建新战役',

    // ---------- 星系选择面板 ----------
    'systemselect.title': '星系配置（测试功能）',
    'systemselect.homeworldSection': '家园星系（单选，必选）',
    'systemselect.optionalSection': '可选星系（复选）',
    'systemselect.placeholderSection': '未探索星系（不可选择）',
    'systemselect.homeworldTag': '家园星系',
    'systemselect.placeholderTag': '未探索',
    'systemselect.distanceLabel': (p) => `距 homeworld ${p.d} 光年`,
    'systemselect.chartCenter': 'homeworld',
    'systemselect.chartHint': '示意图为归一化尺度，非真实光年比例',
    'systemselect.invalidTitle': '星系组合无效',
    'systemselect.invalidCombo': '当前星系组合不合法：缺少家园星系、SOI 重叠或包含不可选择星系。请调整勾选后重试。',
    'systemselect.cancel': '取消',
    'systemselect.confirm': '确定',

    // ---------- ESC 菜单 ----------
    'esc.menu': '菜单',
    'esc.currentWorld': (p) => `当前世界：${p.name}`,
    'esc.closeHint': '按 ESC 关闭',
    'esc.resume': '继续',
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
    // 0.2.5 ESC 菜单改版（独立组件 escMenuUI）
    'esc.facilities': '设施',
    'esc.universeTime': 'UNIVERSE TIME  ',
    'esc.gameMode': 'GAME MODE',
    'esc.encyclopedia': '百科',
    'esc.missions': '任务中心',
    'esc.notReady': '功能尚未开放',
    'esc.sectionFacilities': 'FACILITIES',
    'esc.agencyTitle': '坎巴拉航天局',
    'esc.gameWord': '游戏',

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
    'tracking.typeShip': '飞船',
    'tracking.typeFacility': '设施',
    'tracking.deepSpace': '深空',
    'tracking.noModules': '无',
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
    'tracking.eccCircular': '圆形',
    'tracking.eccEllipticalLow': '椭圆形',
    'tracking.eccElliptical': '椭圆',
    'tracking.eccHigh': '高椭圆',

    // ---------- 追踪站信息面板（分组卡片式改版） ----------
    'tracking.focus': '聚焦',
    'tracking.secFlight': '飞行状态',
    'tracking.secModules': '模块',
    'tracking.secSynopsis': '天体档案',
    'tracking.secOrbit': '轨道参数',
    'tracking.secPhysical': '物理特性',
    'tracking.secResources': '资源丰度',
    'tracking.secFacility': '设施信息',
    'tracking.secDockedShips': '停靠飞船',
    'tracking.trajType': '轨道类型',
    'tracking.trajLanded': '环绕中',
    'tracking.altitude': '高度',
    'tracking.velocity': '速度',
    'tracking.deltaV': '剩余 Δv',
    'tracking.totalMass': '总质量',
    'tracking.soiLabel': 'SOI',
    'tracking.eccValue': '离心率',
    'tracking.parentBody': '环绕天体',
    'tracking.semimajorAxis': '半长轴',
    'tracking.orbitPeriod': '公转周期',
    'tracking.orbitVelocity': '平均轨道速度',
    'tracking.argPeriapsis': '近点幅角',
    'tracking.gravity': '表面重力',
    'tracking.bodyRadius': '半径',
    'tracking.circumference': '周长',
    'tracking.soiRadius': 'SOI 半径',
    'tracking.bodyMass': '质量',
    'tracking.density': '密度',
    'tracking.atmosphere': '大气',
    'tracking.atmHeight': (p) => `有（${p.h}）`,
    'tracking.atmNone': '无',
    'tracking.typeTagStar': '恒星 STAR',
    'tracking.typeTagPlanet': '行星 PLANET',
    'tracking.typeTagMoon': '卫星 MOON',
    'tracking.typeTagShip': '飞船 VESSEL',
    'tracking.typeTagFacility': '设施 FACILITY',
    'tracking.typeTagUnknown': '未知 UNKNOWN',
    'tracking.noSynopsis': '暂无档案记录。',
    'tracking.typeShort': '类型',
    'tracking.dryMassShort': '干质量',
    'tracking.docksShort': '对接口',
    'tracking.tabAll': '完整列表',
    'tracking.tabVessels': '航天器与聚落',
    'tracking.groupVessels': '航天器',
    'tracking.groupFacilities': '太空聚落',
    'tracking.noVessels': '暂无飞船',
    'tracking.noFacilities': '暂无设施',

    // ---------- 设施舱室 ----------
    'facility.deploy': '部署设施',
    'facility.typeName': '设施',
    'facility.bridgeResearch': '蓝图研究功能开发中...',
    'facility.unknownCompartment': '未知舱室',
    'facility.infoSection': '设施信息',
    'facility.storageSection': '存储',
    'facility.controlSection': '当前控制',
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
    'dock.modulesCount': (p) => `模块: ${p.n} 个`,
    'dock.switchControl': '切换控制',
    'dock.takeoff': '起飞',
    'dock.noDockedShipsRefuel': '暂无停靠飞船可补给',
    'dock.refuel': '补给燃料',
    'dock.refuelCost': '消耗设施存储的氢/氧燃料',
    'dock.refuelDone': '燃料补给完成',
    'dock.promptDock': '按 [B] 对接',
    'dock.promptBtn': '对接',
    'dock.engineOut': '⚠ 引擎已停机（燃料耗尽）',

    // ---------- 轨道类型 HUD（数据驱动收敛，renderer.js） ----------
    'orbit.type.circular': '圆轨',
    'orbit.type.elliptical': '椭圆轨',
    'orbit.type.suborbital': '亚轨道',
    'orbit.type.escape': '逃逸',
    'orbit.type.deepSpace': '深空',

    // ---------- 轨道点标签（0.3.0：Ap/Pe 标记） ----------
    'orbitPoint.ap': 'Ap',
    'orbitPoint.pe': 'Pe',
    'orbitPoint.apFull': '远点',
    'orbitPoint.peFull': '近点',
    // SOI 穿越标签（0.3.0：段尾=离开 / 段头=进入）
    'orbitPoint.soiLeave': (p) => `离开 ${p.name}`,
    'orbitPoint.soiEnter': (p) => `进入 ${p.name}`,
    // SOI 标签展开面板状态行（替代高度行）
    'orbitPoint.soiLeaving': (p) => `正在离开 ${p.name}`,
    'orbitPoint.soiEncounter': (p) => `正在遭遇 ${p.name}`,
    // 可见性筛选：SOI 切换标签开关
    'sas.soiLabels': 'SOI 切换标签',

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
    // 建造补充（数据驱动收敛）
    'build.costIncludesModules': (p) => `（含模块 ${p.cost} 套）`,
    'build.modulePriceSuffix': (p) => ` · ${p.price}套`,
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
    'settings.descAudio': '调节总音量、音乐、UI 音效与通讯音，并选择菜单背景音乐。KSP1 / KSP2 对应两首不同的菜单音乐。',
    'settings.descControl': '配置键盘映射、鼠标灵敏度等控制选项。（即将推出）',
    'settings.descGame': '调整时间加速保护等玩法参数。',
    'settings.groupMenu': '菜单',
    'settings.menuBg': '菜单背景',
    'settings.bgStars': '星空',
    'settings.bgImage': '图片',
    'settings.groupMusic': '音乐',
    'settings.menuMusic': '菜单音乐',
    'settings.groupVolume': '音量',
    'settings.volMaster': '总音量',
    'settings.volMusic': '音乐',
    'settings.volUi': 'UI 音效',
    'settings.volComms': '通讯音',
    'settings.comingSoon': '即将推出',
    'settings.groupWarp': '时间加速',
    'settings.soiWarpProtect': 'SOI 切换时间保护',
    'settings.on': '开',
    'settings.off': '关',

    // ---------- 游戏公告（0.2.8 面板化） ----------
    // 公告内容数据移至 src/config/announcementConfig.js（多版本公告）
    'info.title': '游戏公告',

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

    // ---------- 游戏百科(0.2.7 KSP2 重构) ----------
    'encyclopedia.title': '游戏百科',
    'encyclopedia.close': '关闭',

    // ---------- 制作人员(0.2.7 v2 参考图样式) ----------
    'credits.pageTitle': '《坎巴拉2D》制作人员',

    // ---------- 追踪站场景 ----------
    'tracking.stationName': '追踪站',

    // ---------- 新游戏 / 反馈(main.js) ----------
    // 0.2.5：worldName* 与 load.* 已整合进"开始游戏"面板（startgame.* / newcampaign.*），此处删除
    'newgame.exception': (p) => `游戏发生异常: ${p.msg}`,
    'newgame.imgLoadFail': (p) => `${p.n} 张图片加载失败，部分界面可能异常`,
    'newgame.audioLoadFail': (p) => `${p.n} 个音频加载失败，相关声音可能缺失`,
    'newgame.fontLoadFail': (p) => `${p.n} 个字体加载失败，部分文字可能使用系统字体`,
    'newgame.defaultShip': '初始飞船',
    'newgame.startDockName': 'Kerbin 轨道船坞',
    'newgame.success': '新世界创建成功！',
    'newgame.nameExists': '世界名称已存在，请换一个',
    'newgame.uiNotLoaded': 'UI 组件未加载',
    'feedback.title': '反馈渠道',
    'feedback.qq': 'QQ：1570447677',
    'feedback.email': '邮箱：mc1234com@163.com',

    // ---------- 存档 / 时间暂停通知 ----------
    'save.thrustBlocked': '推力模式下无法存档！',
    // 0.2.5 星系组合兼容性(读档校验)
    'save.systemIncompatibleTitle': '无法加载存档',
    'save.systemIncompatible': '该存档的星系配置与当前版本不兼容，无法加载。',
    'timewarp.pausedNotice': '游戏已暂停',
    'timewarp.resumedNotice': '游戏已恢复',

    // ---------- 大气 / 表面危害 ----------
    'atmo.entering': (p) => `⚠ 警告：正在进入 ${p.name} 大气层！`,
    'atmo.destroyedAtmosphere': (p) => `💥 ${p.name} 在大气层中坠毁`,
    'atmo.destroyedSurface': (p) => `💥 ${p.name} 撞击天体表面`,

    // ---------- 经济 / 扫描（0.2.0 阶段3） ----------
    'economy.insufficientKits': '材料套装不足，无法完成该操作！',
    'economy.buildCost': (p) => `建造耗材: ${p.cost} 套`,

    // ---------- 扫描菜单（0.2.0 阶段6：主动扫描模型；0.2.7 分区布局） ----------
    'scan.menuTitle': '资源扫描',
    'scan.targetSection': '扫描目标',
    'scan.resourcesSection': '资源探测',
    'scan.cardDesc': '对目标天体进行资源扫描，以探测可开采资源及其丰度，帮助规划采集行动。',
    'scan.deepSpace': '深空无宿主天体，无法扫描',
    'scan.scannerTier': (p) => `扫描仪等级: tier ${p.tier}`,
    'scan.noResources': '该天体未探测到可开采资源',
    'scan.startBtn': (p) => `开始扫描（约 ${p.d} 天）`,
    'scan.inProgress': (p) => `正在扫描（tier ${p.tier}）...`,
    'scan.daysLeft': (p) => `剩余 ${p.d} 天`,
    'scan.cancel': '取消扫描',
    'scan.knownTier': (p) => `当前已知资源等级: tier ${p.tier}（更高级扫描仪可探测更多）`,
    'scan.completed': (p) => `${p.name} 扫描完成（tier ${p.tier}），资源丰度已更新`,
    'scan.aborted': (p) => `扫描任务中断：已离开 ${p.name}`,
    'scan.reason.invalid': '参数无效',
    'scan.reason.noScanner': '当前飞船未安装扫描仪',
    'scan.reason.notInSOI': '必须处于目标天体的引力范围内',
    'scan.reason.busy': '已有扫描任务进行中（扫描仪单通道）',
    'scan.reason.alreadyKnown': (p) => `该天体资源丰度已知（当前扫描仪 tier ${p.tier} 无新发现），需更高级扫描仪`,
    'scan.reason.noDuration': '无法计算扫描时长',

    // ---------- 追踪站天体资源（0.2.0 阶段4） ----------
    'tracking.bodyResources': '资源丰度:',
    'tracking.noResources': '未探测到可开采资源',
    'tracking.scanStatus': (p) => `扫描等级: tier ${p.tier}（需扫描仪探测更多资源）`,

    // ---------- 货运 / 存储（0.2.0 阶段5；0.2.7 分区布局） ----------
    'cargo.title': '货仓',
    'cargo.capacity': '货仓容量（共享池）',
    'cargo.sectionCapacity': '货仓容量',
    'cargo.sectionCargo': '货物清单',
    'cargo.transferSection': '传输资源',
    'cargo.capacityShort': '容量:',
    'cargo.empty': '货仓为空',
    'cargo.fuelNote': '※ 飞船自带燃料（燃料罐）不计入货仓',
    'cargo.loadAmount': (p) => `装入 ${p.name} 到飞船货仓（可用 ${p.max}）`,
    'cargo.unloadAmount': (p) => `卸出 ${p.name} 到设施存储（船上 ${p.max}）`,
    'cargo.transferred': (p) => `已转移 ${p.n}`,
    'cargo.transferFailed': '转移失败（容量不足或数量无效）',
    'cargo.facToShip': (p) => `${p.fac} → 船 ${p.ship}`,

    // ---------- 资源分类名（0.2.7 存储/货仓分组标题） ----------
    'cat.propellant': '推进剂',
    'cat.raw': '星球原料',
    'cat.construction': '建造材料',
    'cat.research': '科研',

    'facility.storage': '货物储备',
    'facility.storageHint': '设施存储的全部资源（含行内调拨到其他设施）',
    'facility.transfer': '调拨',
    'facility.transferTarget': '选择目标设施',
    'facility.transferAmount': (p) => `转移 ${p.name}：${p.from} → ${p.to}（可用 ${p.max}）`,
    'facility.noOtherFacilities': '没有其他设施可调拨',
    'build.noFacility': '未找到所属设施，无法建造',

    'dock.moduleManage': '模块管理',
    'dock.moduleManageHint': '改装停靠飞船的模块（消耗/返还设施存储的材料套装）',
    'dock.dockActionSection': '对接操作',
    'dock.dockedSection': '停靠飞船',
    'dock.shipSection': '飞船信息',
    'dock.slotsSection': '模块槽位',
    'dock.slotsCount': (p) => `槽位 ${p.n}`,
    'dock.refuelSection': '可补给飞船',
    'dock.installModule': '安装',
    'dock.moduleInstalled': (p) => `已安装 ${p.name}`,
    'dock.moduleRemoved': '模块已卸载（材料已返还设施）',
    'dock.cargoHold': '货仓调拨',
    'dock.cargoShip': (p) => `飞船：${p.name}`,

    'economy.kitsUnit': ' 套',
    'economy.noFuelStorage': '设施无可用燃料存储，无法补给！',
    'deploy.noKits': '飞船货仓材料套装不足，无法部署设施',
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
