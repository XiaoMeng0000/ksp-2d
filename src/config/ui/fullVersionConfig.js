'use strict';

// 「完整版内容一览」面板配置（尝鲜版）
//
// 用途：把所有被尝鲜版裁掉的内容集中展示，并把玩家导向桌面版完整游戏。
// 约定：
//   · 本文件是**内容数据**（标题/描述/条目），文案随内容维护；面板框架文案（标题、按钮）在 strings.js；
//   · 新增一整块完整版内容 → 这里加一条 section，面板零改动；
//   · 下载地址集中在此，改地址只改一个常量。

// 桌面版完整游戏下载地址（GitHub Releases）
export const FULL_VERSION_DOWNLOAD_URL = 'https://github.com/XiaoMeng0000/ksp-2d/releases';

// 分区清单（面板按此顺序渲染）
export const FULL_VERSION_SECTIONS = [
    {
        id: 'systems',
        icon: '🪐',
        title: '完整星系',
        desc: '尝鲜版只开放 Kerbin 系与 Duna 系（6 个天体）',
        items: [
            '全 17 个天体：Moho、Eve 与 Gilly、Dres、Jool 与四大卫星、Eeloo',
            '多星系组合与选择：可把不同星系一并载入同一宇宙',
            '完整的天体档案与轨道参数'
        ]
    },
    {
        id: 'render',
        icon: '🌈',
        title: '高清渲染层',
        desc: '尝鲜版为秒开而关闭，天体只画代表色圆盘',
        items: [
            '4096 级天体贴图与地形法线光照',
            '程序化云层与大气临边散射',
            '主菜单可自转的高清星球背景',
            'WebGL2 恒星渲染（星面纹理与光晕）'
        ]
    },
    {
        id: 'partlab',
        icon: '🔧',
        title: '3D 部件实验室',
        desc: 'KSP 原版 VAB 布局的三维装配车间',
        items: [
            '官方部件资产的 3D 展示与装配',
            '航天级 PBR 材质与模型贴图',
            '部件数值校核与预设保存'
        ]
    },
    {
        id: 'editor',
        icon: '🛠️',
        title: '飞船编辑器',
        desc: '尝鲜版只能从 3 套预设船中建造',
        items: [
            '自由拼装：引擎、燃料罐、指令舱、货舱自由组合',
            '模块化能力：扫描仪、货仓、建设模块',
            '蓝图保存 / 导入导出'
        ]
    },
    {
        id: 'facility',
        icon: '🏭',
        title: '资源与设施建造',
        desc: '尝鲜版只保留开局那一座轨道船坞',
        items: [
            '在稳定轨道上部署船坞、补给站、科研站',
            '设施独立仓储、货仓调拨与物资补给链',
            '多设施管理与控制权切换'
        ]
    },
    {
        id: 'scan',
        icon: '🔭',
        title: '星球资源扫描',
        desc: '尝鲜版不含扫描玩法与资源丰度数据',
        items: [
            '三级扫描仪：解锁天体资源分布',
            '资源丰度图与开采点评估',
            '生涯模式的科技解锁体系'
        ]
    },
    {
        id: 'content',
        icon: '📚',
        title: '内容与系统',
        desc: '尝鲜版为减负移除了在线内容与百科',
        items: [
            '游戏百科：天体档案、玩法词条',
            '游戏公告与在线「最新消息」',
            '调试面板与完整设置项'
        ]
    },
    {
        id: 'desktop',
        icon: '💾',
        title: '桌面版完整游戏',
        desc: '本地运行、无加载等待、全部内容解锁',
        items: [
            'Windows 客户端（安装包 / 便携版）',
            '全部高清资产与渲染层',
            '后续版本更新'
        ]
    }
];

// 被裁功能 → 弹窗标题文案 key（teaserModal 按 featureId 取）
export const TEASER_FEATURE_KEYS = {
    shipEditor: 'teaser.feature.shipEditor',
    encyclopedia: 'teaser.feature.encyclopedia',
    scan: 'teaser.feature.scan',
    facilityDeploy: 'teaser.feature.facilityDeploy',
    partLab: 'teaser.feature.partLab',
    multiSystem: 'teaser.feature.multiSystem'
};
