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
import { renderWorldList } from './src/ui/menuUI.js';
import './src/ui/shipBuilderUI.js';
import './src/ui/facilityDeployUI.js';
import './src/ui/flightUI.js';
import './src/ui/shipDestroyedUI.js';
// 图形系统 - 纹理管理器
import { textureManager } from './src/graphics/textureManager.js';
import { fontManager } from './src/graphics/fontManager.js';
import { registerBodyRenderables } from './src/graphics/bodyRenderables.js';

import { initCamera } from './src/camera.js';
import { createStars } from './src/renderer.js';
import { updateCelestialBodies, celestialBodies } from './src/physics/physics.js';
import { stateToKepler } from './src/physics/orbitalMechanics.js';
import { eventBus, Events } from './src/eventBus.js';
import { registerFlightScene } from './src/scenes/flightScene.js';
import { registerTrackingScene, buildTrackingTree, renderTrackingNav, trackingCollapsed } from './src/scenes/trackingScene.js';
import { registerSplashScene } from './src/scenes/splashScene.js';
import { registerInfoScene } from './src/scenes/infoScene.js';
import { registerMenuScene } from './src/scenes/menuScene.js';
import { registerEncyclopediaScene } from './src/scenes/encyclopediaScene.js';
import { registerCreditsScene } from './src/scenes/creditsScene.js';
import { registerLicenseScene } from './src/scenes/licenseScene.js';
import { registerGalaxiesScene } from './src/scenes/galaxiesScene.js';
import { registerSettingsScene } from './src/scenes/settingsScene.js';
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

// SceneManager - 注册 splash / info / menu / encyclopedia / credits 场景
registerSplashScene();
registerInfoScene();
registerMenuScene({
    startNewGame: () => window.startNewGame(),
    continueGame: () => window.continueGame(),
    openLoadMenu: () => window.openLoadMenu(),
    openArchiveManager: () => window.openArchiveManager(),
    openSettings: () => window.openSettings(),
});
registerEncyclopediaScene();
registerCreditsScene();
registerLicenseScene();
registerGalaxiesScene();
registerSettingsScene();

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

// 设置场景入口
window.openSettings = function() {
    sceneManager.switchTo('settings');
};

// 层级存档 - 当前世界 ID
window.currentWorldId = null;

// 层级存档 - 开始新游戏（创建新世界）
window.startNewGame = function() {
    // Bug修复 — 新游戏前清空旧飞船，防止跨世界飞船泄漏
    gameState.reset();

    // 轨道修复 — 在创建飞船前重置时间并更新天体到零点，防止上一局 Kerbin 位置污染初始轨道
    _celestialTime = 0;
    updateCelestialBodies(0);
    eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: 0, dt: 0 });
    
    if (typeof window.__createInputDialog === 'function') {
        window.__createInputDialog(t('newgame.worldNameTitle'), t('newgame.worldNamePlaceholder'), t('newgame.worldNameDefault'), (name) => {
            // 飞船系统 - 使用 shipSystem 创建飞船实例
            const newShip = shipSystem.createShip('debug_behemoth', t('newgame.defaultShip'), ['construction_package']);
            if (!newShip) {
                window.showNotification(t('build.createFailed'), 'error');
                return;
            }

            // 飞船系统 - 设置初始位置和轨道（pos 为相对宿主坐标）
            const homeworld = celestialBodies.find(b => b.isHomeworld);
            if (!homeworld) {
                console.warn('[startNewGame] 找不到起始天体数据，使用硬编码默认值');
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
            }

            // 先创建世界（含名称冲突检测），成功后再切场景
            window.currentWorldId = window.__saveManager.createWorld(name);
            if (window.currentWorldId) {
                sceneManager.switchTo('flight');
                window.showNotification(t('newgame.success'), 'success');
            } else {
                // 名称冲突 — 回滚已创建的飞船/设施，不切场景
                gameState.reset();
                window.showNotification(t('newgame.nameExists'), 'error');
            }
        });
    } else {
        window.showNotification(t('newgame.uiNotLoaded'), 'error');
    }
};

// 读取存档菜单 - 继续游戏（加载最近检查点）
// 继续游戏优化 - 加载所有世界中最新保存的检查点
window.continueGame = function() {
    const worldList = window.__saveManager.getWorldList();
    if (worldList.length === 0) {
        window.showNotification(t('load.noSaveStartNew'), 'info');
        return;
    }

    // 遍历所有世界，收集所有检查点，按 timestamp 排序取最新
    let latestCheckpoint = null;
    let latestWorldId = null;

    for (const world of worldList) {
        const checkpoints = window.__saveManager.getCheckpointList(world.id);
        for (const cp of checkpoints) {
            if (!latestCheckpoint || cp.timestamp > latestCheckpoint.timestamp) {
                latestCheckpoint = cp;
                latestWorldId = world.id;
            }
        }
    }

    if (!latestCheckpoint || !latestWorldId) {
        window.showNotification(t('load.noValidCheckpoint'), 'info');
        return;
    }

    window.currentWorldId = latestWorldId;
    window.__saveManager.loadCheckpoint(latestWorldId, latestCheckpoint.id);
    sceneManager.switchTo('flight');
};

// 读取存档菜单 - 读取存档（两级菜单）
window.openLoadMenu = function() {
    const worldList = window.__saveManager.getWorldList();
    if (worldList.length === 0) {
        window.showNotification(t('load.noSaves'), 'info');
        return;
    }

    const worldItems = worldList.map(w => ({
        id: w.id,
        name: t('load.worldItem', { name: w.name, count: w.checkpointCount }),
        subtitle: `${new Date(w.createdAt).toLocaleString()}`
    }));

    window.__createDialog(t('load.selectWorld'), worldItems, (worldId) => {
        const checkpoints = window.__saveManager.getCheckpointList(worldId);
        if (checkpoints.length === 0) {
            window.showNotification(t('archive.noCheckpointsInWorld'), 'info');
            return;
        }
        const cpItems = checkpoints.map(c => ({
            id: c.id,
            name: c.name,
            subtitle: t('archive.checkpointSubtitle', { ts: c.timestamp, time: c.gameTime.toFixed(1) })
        }));
        window.__createDialog(t('load.selectCheckpoint'), cpItems, (checkpointId) => {
            window.currentWorldId = worldId;
            window.__saveManager.loadCheckpoint(worldId, checkpointId);
            sceneManager.switchTo('flight');
        });
    });
};

// 存档管理 - 打开存档管理面板
window.openArchiveManager = function() {
    const panel = document.getElementById('archiveManagerPanel');
    if (panel) {
        panel.style.display = 'flex';
        renderWorldList();
    } else {
        console.warn('[Archive] archiveManagerPanel 未找到');
    }
};