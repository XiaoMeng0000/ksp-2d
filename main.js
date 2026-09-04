// GameState 加载
import { gameState } from './src/gameState.js';
import { t } from './src/config/strings.js';

// SaveManager - 加载存档管理器
import './src/saveManager.js';

// TimeWarp - 时间加速/暂停（模块加载即安装全局按键监听）
import './src/timeWarp.js';
// TimeWarpUI - 时间加速面板（KSP2 风格常驻 HUD，与 timeWarp 并列引入）
import './src/ui/timeWarpUI.js';

// SceneManager - 导入场景管理器
import { sceneManager } from './src/sceneManager.js';
// 飞船系统 - 导入飞船系统核心模块
import { shipSystem } from './src/ship/shipSystem.js';
import { facilitySystem } from './src/facility/facilitySystem.js';
// UI加载 - UI 模块必须尽早加载，确保菜单按钮点击时函数已就绪
import './src/ui/trackingUI.js';
import './src/ui/menuUI.js';
// 0.2.5 ESC 菜单 — 独立组件（KSP2 控制台风格，自 menuUI 抽离）
import './src/ui/escMenuUI.js';
import './src/ui/shipBuilderUI.js';
// 0.2.5 开始游戏流程 — 左侧综合面板 + 创建新战役对话框
import { openStartGamePanel } from './src/ui/startGamePanel.js';
import './src/ui/newCampaignDialog.js';
// 0.2.5 设置面板 — 从 scene 抽离为覆盖式 UI 面板
import { openSettings as openSettingsUI } from './src/ui/settingsUI.js';
// 0.2.7 游戏百科 — 同样从 scene 抽离为覆盖式 UI 面板（import 即完成 uiManager 注册）
import { openEncyclopedia as openEncyclopediaUI } from './src/ui/encyclopediaUI.js';
// 0.2.8 游戏公告 — 同模式面板化（启动进主菜单自动打开 / 额外内容入口）
import { openAnnouncement as openAnnouncementUI } from './src/ui/announcementUI.js';
import './src/ui/facilityDeployUI.js';
// UI 点击音效采集（document 捕获阶段委托，import 即生效）
import './src/ui/uiClickSfx.js';
import './src/ui/flightUI.js';
import './src/ui/shipDestroyedUI.js';
// 玩家资源 HUD（0.2.0 阶段4）— 右上角常驻模式 + 材料套装/科技点显示
import './src/ui/resourceHUD.js';
// 飞行状态 HUD（0.3.0）— 右下角燃料卡 + 总 ΔV 卡
import './src/ui/shipStatusUI.js';
// 图形系统 - 纹理管理器
import { textureManager } from './src/graphics/textureManager.js';
import { fontManager } from './src/graphics/fontManager.js';
import { registerBodyRenderables } from './src/graphics/bodyRenderables.js';

import { initCamera } from './src/camera.js';
import { createStars } from './src/renderer.js';
import { updateCelestialBodies, celestialBodies, setActiveSystems } from './src/physics/physics.js';
import { getDefaultSystemIds, validateSystemSelection } from './src/config/starSystemIndex.js';
import { stateToKepler } from './src/physics/orbitalMechanics.js';
import { eventBus, Events } from './src/eventBus.js';
import { registerFlightScene } from './src/scenes/flightScene.js';
import { registerTrackingScene, buildTrackingTree, renderTrackingNav, trackingCollapsed } from './src/scenes/trackingScene.js';
import { registerSplashScene } from './src/scenes/splashScene.js';
import { registerMenuScene } from './src/scenes/menuScene.js';
import { registerCreditsScene } from './src/scenes/creditsScene.js';
import { registerLicenseScene } from './src/scenes/licenseScene.js';
import { registerGalaxiesScene } from './src/scenes/galaxiesScene.js';

// 音频系统 - 底层引擎与决策层（import 即完成事件订阅）
import { audioCore } from './src/audio/audioCore.js';
import { audioDirector } from './src/audio/audioDirector.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// SOI边界诊断开关 — 发布前设为 false，供 renderer.js 及 physicsUpdate.js 使用
window._soiDiag = false;

// 游戏时间（秒），模块级单例，唯一写入入口
let _celestialTime = 0;

// 接收时间重置事件（读档时 saveManager 会 emit dt=0 的时间设置）
eventBus.on(Events.CELESTIAL_TIME_UPDATED, ({ time, dt }) => {
    if (dt === 0) {
        _celestialTime = time;
        updateCelestialBodies(time);
    }
});


let lastTime = 0;
let frameCount = 0;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // 星空为屏幕空间天空盒，需按画布尺寸重新铺满
    createStars(canvas.width, canvas.height);
}

function gameLoop(timestamp) {
    try {
        const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
        lastTime = timestamp;

        // 通过场景管理器调用 update 和 render
        if (!sceneManager.isPaused()) {
            sceneManager.update(dt);
        }
        sceneManager.render(ctx);
    } catch (e) {
        console.error('[GameLoop] 异常:', e);
        if (typeof window.showNotification === 'function') {
            window.showNotification(t('newgame.exception', { msg: e.message }), 'error', 5000);
        }
    }

    requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', resize);
initCamera();
resize();

// 天体渲染配置（数据驱动）— 在任何场景渲染前注册到 RenderableManager
registerBodyRenderables();

// SceneManager - 注册 splash / menu / encyclopedia / credits 场景（公告已面板化）
registerSplashScene();
registerMenuScene({
    // 0.2.5：开始游戏/读档/存档管理整合为左侧"开始游戏"综合面板
    openStartGamePanel: () => openStartGamePanel(),
    openSettings: () => window.openSettings(),
    openEncyclopedia: () => window.openEncyclopedia(),
    // 0.2.8：公告入口（主菜单额外内容子菜单）
    openAnnouncement: () => window.openAnnouncement(),
});
registerCreditsScene();
registerLicenseScene();
registerGalaxiesScene();

// 注册飞行场景（注入 main.js 持有的模块级依赖）
registerFlightScene({
    throttleRate: 1.0,
    getTime: () => _celestialTime,
    setTime: (time) => { _celestialTime = time; },
    canvas: canvas
});


// 注册追踪站场景（注入 main.js 持有的模块级依赖）
registerTrackingScene({
    getTime: () => _celestialTime,
    setTime: (time) => { _celestialTime = time; },
    canvas: canvas
});

// SceneManager - 启动加载画面：纹理、音频与字体都就绪后才进入场景链
const loadingScreen = document.getElementById('loadingScreen');
const loadingLogContent = document.getElementById('loadingLogContent');
const loadingLogBox = document.getElementById('loadingLogBox');
const loadingProgressBarInner = document.getElementById('loadingProgressBarInner');
const loadingProgressText = document.getElementById('loadingProgressText');
const audioProgressBarInner = document.getElementById('loadingAudioProgressBarInner');
const audioProgressText = document.getElementById('loadingAudioProgressText');
const fontProgressBarInner = document.getElementById('loadingFontProgressBarInner');
const fontProgressText = document.getElementById('loadingFontProgressText');

// 加载完成状态标记（纹理 / 音频 / 字体三路都就绪后才放行）
// 已就绪的一路初始化为 true，避免缓存命中时该路事件不触发导致状态卡死
const _loadState = {
    textures: textureManager.isReady(),
    audio: audioCore.isReady(),
    fonts: fontManager.isReady()
};

// 三路加载全部完成 → 隐藏加载画面并进入 splash
function _finishLoading() {
    if (_loadState.textures && _loadState.audio && _loadState.fonts) {
        setTimeout(() => {
            loadingScreen.style.display = 'none';
            sceneManager.switchTo('splash');
        }, 300);
    }
}

if (textureManager.isReady() && audioCore.isReady() && fontManager.isReady()) {
    // 纹理 / 音频 / 字体均已就绪（二次访问），跳过加载画面
    sceneManager.switchTo('splash');
} else {
    loadingScreen.style.display = 'flex';

    // === 纹理加载进度与完成 ===
    const onTextureProgress = ({ key, loaded, total, success }) => {
        const line = document.createElement('div');
        line.textContent = (success ? '[OK] ' : '[FAIL] ') + key + '.png';
        line.className = success ? 'loading-log-ok' : 'loading-log-fail';
        loadingLogContent.appendChild(line);

        const pct = Math.round(loaded / total * 100);
        loadingProgressBarInner.style.width = (loaded / total * 100) + '%';
        loadingProgressText.textContent = loaded + '/' + total + ' (' + pct + '%)';

        loadingLogBox.scrollTop = loadingLogBox.scrollHeight;
    };
    const onTexturesReady = ({ loaded, failed }) => {
        eventBus.off(Events.TEXTURE_PROGRESS, onTextureProgress);
        eventBus.off(Events.TEXTURES_READY, onTexturesReady);
        _loadState.textures = true;
        _finishLoading();

        if (failed > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('newgame.imgLoadFail', { n: failed }), 'warning', 4000);
            }
        }
    };

    // === 音频加载进度与完成 ===
    const onAudioProgress = ({ key, loaded, total, success }) => {
        // 与纹理加载一致，在信息栏中逐行记录加载情况
        const line = document.createElement('div');
        line.textContent = (success ? '[OK] ' : '[FAIL] ') + key;
        line.className = success ? 'loading-log-ok' : 'loading-log-fail';
        loadingLogContent.appendChild(line);

        const pct = total > 0 ? Math.round(loaded / total * 100) : 100;
        audioProgressBarInner.style.width = pct + '%';
        audioProgressText.textContent = loaded + '/' + total + ' (' + pct + '%)';

        loadingLogBox.scrollTop = loadingLogBox.scrollHeight;
    };
    const onAudioReady = ({ loaded, failed }) => {
        eventBus.off(Events.AUDIO_PROGRESS, onAudioProgress);
        eventBus.off(Events.AUDIO_READY, onAudioReady);
        _loadState.audio = true;
        _finishLoading();

        if (failed > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('newgame.audioLoadFail', { n: failed }), 'warning', 4000);
            }
        }
    };

    // === 字体加载进度与完成 ===
    const onFontProgress = ({ key, loaded, total, success }) => {
        // 与纹理 / 音频加载一致，在信息栏中逐行记录加载情况
        const line = document.createElement('div');
        line.textContent = (success ? '[OK] ' : '[FAIL] ') + key;
        line.className = success ? 'loading-log-ok' : 'loading-log-fail';
        loadingLogContent.appendChild(line);

        const pct = Math.round(loaded / total * 100);
        fontProgressBarInner.style.width = (loaded / total * 100) + '%';
        fontProgressText.textContent = loaded + '/' + total + ' (' + pct + '%)';

        loadingLogBox.scrollTop = loadingLogBox.scrollHeight;
    };
    const onFontsReady = ({ loaded, failed }) => {
        eventBus.off(Events.FONT_PROGRESS, onFontProgress);
        eventBus.off(Events.FONTS_READY, onFontsReady);
        _loadState.fonts = true;
        _finishLoading();

        if (failed > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(t('newgame.fontLoadFail', { n: failed }), 'warning', 4000);
            }
        }
    };

    // 分别注册并启动未就绪的一路：纹理、音频与字体三路并行加载，互不阻塞
    if (!_loadState.textures) {
        eventBus.on(Events.TEXTURE_PROGRESS, onTextureProgress);
        eventBus.on(Events.TEXTURES_READY, onTexturesReady);
        textureManager.init();
    }
    if (!_loadState.audio) {
        eventBus.on(Events.AUDIO_PROGRESS, onAudioProgress);
        eventBus.on(Events.AUDIO_READY, onAudioReady);
        audioCore.init();
    }
    if (!_loadState.fonts) {
        eventBus.on(Events.FONT_PROGRESS, onFontProgress);
        eventBus.on(Events.FONTS_READY, onFontsReady);
        fontManager.init();
    }
}

// 启动游戏循环
requestAnimationFrame(gameLoop);

// 追踪站 — 桥接 exports 供 UI 模块使用（飞船建造/摧毁刷新追踪树依赖）
window.__celestialBodies = celestialBodies;
window.buildTrackingTree = buildTrackingTree;
window.renderTrackingNav = renderTrackingNav;
window.trackingCollapsed = trackingCollapsed;

// 场景就绪时重置 lastTime，防止读档后 dt 异常大
eventBus.on(Events.SCENE_READY, () => { lastTime = 0; });

// 0.2.5 设置面板入口（从 scene 抽离为覆盖式 UI 面板，不切换场景/不中断音乐）
window.openSettings = function() {
    openSettingsUI();
};

// 0.2.7 游戏百科入口（场景 → 覆盖式面板，同设置面板模式）
window.openEncyclopedia = function() {
    openEncyclopediaUI();
};

// 0.2.8 游戏公告入口（启动自动打开 / 主菜单额外内容；面板由 announcementUI 注册）
window.openAnnouncement = function() {
    openAnnouncementUI();
};

// 层级存档 - 当前世界 ID
window.currentWorldId = null;

// 0.2.5 创建新战役核心逻辑（供"创建新战役"对话框调用）
// name: 战役名称; starSystems: 星系组合 id 数组(创建时绑定,创建后不可更改)
// 返回创建成功的世界 ID；名称冲突等失败时返回 null 并已回滚
window.applyNewGameCreation = function(name, starSystems) {
    // 星系组合:显式传入优先,否则用默认组合(仅 homeworld 星系)
    const systemIds = Array.isArray(starSystems) && starSystems.length > 0
        ? [...starSystems]
        : getDefaultSystemIds();
    const validation = validateSystemSelection(systemIds);
    if (!validation.ok) {
        window.showNotification(t('newcampaign.systemInvalid'), 'error');
        console.warn('[applyNewGameCreation] 星系组合校验失败:', validation.reason);
        return null;
    }

    // Bug修复 — 新游戏前清空旧飞船，防止跨世界飞船泄漏
    gameState.reset();

    // 激活星系组合(重建天体集合),再重置时间更新天体位置
    setActiveSystems(systemIds);
    gameState.setState({ starSystems: systemIds });

    // 轨道修复 — 在创建飞船前重置时间并更新天体到零点，防止上一局 Kerbin 位置污染初始轨道
    _celestialTime = 0;
    updateCelestialBodies(0);
    eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: 0, dt: 0 });

    // 飞船系统 - 使用 shipSystem 创建飞船实例
    const newShip = shipSystem.createShip('debug_behemoth', t('newgame.defaultShip'), ['construction_package']);
    if (!newShip) {
        window.showNotification(t('build.createFailed'), 'error');
        return null;
    }

    // 飞船系统 - 设置初始位置和轨道（pos 为相对宿主坐标）
    const homeworld = celestialBodies.find(b => b.isHomeworld);
    if (!homeworld) {
        console.warn('[applyNewGameCreation] 找不到起始天体数据，使用硬编码默认值');
        newShip.pos = { x: 580, y: 0 };
        newShip.vel = { x: 0, y: Math.sqrt(10000 / 80) };  // 顺行：pos 在 +x 时速度沿 +y
        newShip.currentGM = 10000;
        newShip.kepler = stateToKepler({ x: 80, y: 0 }, newShip.vel, 10000);
    } else {
        const orbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);
        newShip.pos = { x: orbitR, y: 0 };
        const orbitalSpeed = Math.sqrt(homeworld.gm / orbitR);
        // 顺行（逆时针，与天体公转同向）：pos 在 +x 时速度应沿 +y
        newShip.vel = { x: 0, y: orbitalSpeed };
        newShip.currentGM = homeworld.gm;
        newShip.kepler = stateToKepler(newShip.pos, newShip.vel, homeworld.gm);
    }
    newShip.currentSOI = homeworld ? homeworld.name : null;
    newShip.orbitTime = 0;
    newShip.mode = 'on_rails';

    // 飞船系统 - 持久化到 GameState（createShip 返回的是原始对象，需手动写入）
    shipSystem.persistShip(newShip);
    // 飞船系统 - 设为活动飞船并同步 GameState
    shipSystem.switchShip(newShip.id);

    // 预置 Kerbin 轨道船坞
    if (homeworld) {
        // Bug修复 — 船坞与初始飞船使用同一轨道半径，避免旧硬编码 70m 使船坞埋在行星内部
        const dockyardOrbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);
        const dockyardPos = {
            x: homeworld.position.x + dockyardOrbitR,
            y: homeworld.position.y
        };
        const dockyardVel = {
            x: 0,
            y: Math.sqrt(homeworld.gm / dockyardOrbitR)  // 顺行：pos 在 +x 时速度沿 +y
        };
        facilitySystem.createFacility(
            'orbital_dockyard',
            t('newgame.startDockName'),
            dockyardPos,
            dockyardVel,
            homeworld.name
        );
        // 0.2.0 阶段5：起始船坞预填初始物资（全局资源已退场，实体资源落位设施存储）
        // 注意：预填量必须 ≤ 槽容量，否则 amount 超 capacity 导致 UI 进度条 >100%
        const startDock = facilitySystem.getAllFacilities()[0];
        if (startDock && startDock.storage) {
            if (startDock.storage.materialKits) {
                startDock.storage.materialKits.amount = 500;
                startDock.storage.materialKits.capacity = Math.max(startDock.storage.materialKits.capacity, 500);
            }
            if (startDock.storage.hydrogen) {
                startDock.storage.hydrogen.amount = 1000;
                startDock.storage.hydrogen.capacity = Math.max(startDock.storage.hydrogen.capacity, 1000);
            }
            if (startDock.storage.oxygen) {
                startDock.storage.oxygen.amount = 8000;
                startDock.storage.oxygen.capacity = Math.max(startDock.storage.oxygen.capacity, 8000);
            }
        }
    }

    // 先创建世界（含名称冲突检测），成功后再切场景
    const worldId = window.__saveManager.createWorld(name, systemIds);
    if (worldId) {
        window.currentWorldId = worldId;
        sceneManager.switchTo('flight');
        window.showNotification(t('newgame.success'), 'success');
    } else {
        // 名称冲突 — 回滚已创建的飞船/设施，不切场景
        gameState.reset();
        window.showNotification(t('newgame.nameExists'), 'error');
    }
    return worldId;
};

// 0.2.5 读取存档：重定向到左侧"开始游戏"综合面板（原两级对话框已整合进面板）
// 飞船损毁结算界面仍通过 window.openLoadMenu 进入读档流程
window.openLoadMenu = function() {
    openStartGamePanel();
};