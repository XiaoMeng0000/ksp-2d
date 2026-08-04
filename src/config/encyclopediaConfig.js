'use strict';

const ENCYCLOPEDIA = [
    {
        category: '基础操作',
        entries: [
            { title: '移动视角', content: '占位：使用鼠标或键盘移动镜头视角。' },
            { title: '缩放', content: '占位：使用鼠标滚轮缩放画面。' },
            { title: '暂停 / 恢复', content: '占位：按下 Space 键暂停或恢复游戏。' },
            { title: '时间加速', content: '占位：按 L 键加速时间，按 K 键减速。' },
        ]
    },
    {
        category: '轨道飞行',
        entries: [
            { title: '轨道模式', content: '占位：飞船默认处于轨道模式，按开普勒轨道公式自动运行。' },
            { title: '推力模式', content: '占位：激活推力后进入推力模式，使用 RK4 积分实时计算轨道变化。' },
            { title: 'SAS 姿态稳定', content: '占位：SAS（姿态稳定系统）可保持飞船朝向，支持正向、反向、法向等多种模式。' },
            { title: '机动节点（规划中）', content: '占位：未来将支持在轨道上添加机动节点，精确规划轨道转移。' },
        ]
    },
    {
        category: '飞船系统',
        entries: [
            { title: '飞船建造', content: '占位：在轨道船坞中可建造飞船，选择模板并安装模块。' },
            { title: '模块安装', content: '占位：部分模块有占用槽位要求，建造完成后模块将被锁定。' },
            { title: '飞船切换', content: '占位：可通过追踪站或设施界面切换当前控制的飞船。' },
        ]
    },
    {
        category: '设施交互',
        entries: [
            { title: '停靠设施', content: '占位：飞船靠近设施进入交互范围后，可按 F 键停靠。' },
            { title: '补给系统', content: '占位：停靠后可进行燃料补给、模块更换等操作（规划中）。' },
            { title: '轨道船坞', content: '占位：轨道船坞支持飞船建造和模块安装。' },
        ]
    },
    {
        category: '存档系统',
        entries: [
            { title: '世界管理', content: '占位：支持多世界存档，每个世界独立保存游戏进度。' },
            { title: '检查点', content: '占位：可在飞行中创建检查点，方便快速恢复到关键节点。' },
            { title: '继续游戏', content: '占位：主菜单中"继续游戏"将自动加载所有世界中最近的检查点。' },
        ]
    },
];

export { ENCYCLOPEDIA };
