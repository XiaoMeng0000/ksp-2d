'use strict';

// ============================================================
// 场景级加载界面配置（数据驱动）
// 适用：进入需要大规模准备（如 WebGL 起点初始化、大贴图上传）的场景时，
//       显示背景 + 进度条，直到所有准备项结算且目标场景首帧可见。
// 不含：游戏启动阶段的纹理 / 音频 / 字体加载（见 main.js 的启动加载画面）。
//
// 约定：
// 1. 背景图为正式海报（1920×1154，约 5:3）；显示时等比例铺满（cover），允许裁边、不拉伸。
//    换图只替换本文件路径与图片文件，不改加载流程。
// 2. 阶段权重合计 100；其中 firstFrame 槽位由 SceneManager 在目标场景首帧后结算，
//    因此场景自身的 prepare 阶段最高只上报 0.95。
// 3. 进度是「阶段进度」，不是下载字节百分比：WebGL 上下文创建 / 着色器编译 /
//    GPU 纹理上传多为同步调用，其内部无法刷新界面。
// ============================================================

export const SCENE_LOADING_CONFIG = {
    // 加载层最短可见时间（毫秒）：从加载层真正绘制到屏幕后开始计时
    minVisibleMs: 800,

    // 加载完成后淡出时长（毫秒）：先淡出到透明，再从文档流中隐藏
    fadeOutMs: 280,

    // 加载背景海报：尝鲜版移除（切场景近乎瞬时，海报 149KB 属纯负担），
    // null = 只用 fallbackColor 纯色兜底。完整版在 main 分支保留海报。
    backgroundPath: null,
    fallbackColor: '#1B3166',

    // 显示加载层后先等待的帧数：确保加载层已绘制，再执行可能阻塞主线程的准备
    waitFrames: 2,

    // 单帧等待的定时器兜底（毫秒）：窗口隐藏/遮挡时 rAF 会被浏览器暂停，
    // 该值保证过渡不会因此永久卡在加载界面
    frameFallbackMs: 60,

    // 首帧兜底超时：目标场景 render 未完成时强制结束，避免加载界面卡死
    firstFrameTimeoutMs: 10000
};

// 菜单 WebGL 星球层准备阶段（权重合计 100；firstFrame 由 SceneManager 结算）
export const MENU_PLANET_STAGES = [
    { id: 'webgl', weight: 15, label: 'loading.stage.webgl' },
    { id: 'albedoLoad', weight: 25, label: 'loading.stage.albedoLoad' },
    { id: 'albedoUpload', weight: 15, label: 'loading.stage.albedoUpload' },
    { id: 'detailLoad', weight: 20, label: 'loading.stage.detailLoad' },
    { id: 'detailUpload', weight: 10, label: 'loading.stage.detailUpload' },
    { id: 'normal', weight: 10, label: 'loading.stage.normal' },
    { id: 'firstFrame', weight: 5, label: 'loading.stage.firstFrame' }
];

// 权重分母（含首帧槽位）
export const MENU_PLANET_STAGE_TOTAL = MENU_PLANET_STAGES.reduce((sum, stage) => sum + stage.weight, 0);
