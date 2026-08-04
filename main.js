<<<<<<< HEAD
// GameState 加载
import { gameState } from './src/gameState.js';

// SaveManager - 加载存档管理器
import './src/saveManager.js';

// SceneManager - 导入场景管理器
import { sceneManager } from './src/sceneManager.js';
// 飞船系统 - 导入飞船系统核心模块
import { shipSystem } from './src/ship/shipSystem.js';
import { facilitySystem } from './src/facility/facilitySystem.js';
// UI加载 - UI 模块必须尽早加载，确保菜单按钮点击时函数已就绪
import './src/ui/trackingUI.js';
import './src/ui/menuUI.js';
import './src/ui/shipBuilderUI.js';
import './src/ui/facilityDeployUI.js';
import './src/ui/flightUI.js';
// 图形系统 - 纹理管理器
import { textureManager } from './src/graphics/textureManager.js';

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
    createStars();
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
            window.showNotification('游戏发生异常: ' + e.message, 'error', 5000);
        }
    }

    requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', resize);
initCamera();
resize();

// SceneManager - 注册 splash / info / menu / encyclopedia / credits 场景
registerSplashScene();
registerInfoScene();
registerMenuScene({
    startNewGame: () => window.startNewGame(),
    continueGame: () => window.continueGame(),
    openLoadMenu: () => window.openLoadMenu(),
    openArchiveManager: () => window.openArchiveManager(),
    openSettings: () => window.openSettings(),
    openFeedback: () => window.openFeedback()
});
registerEncyclopediaScene();
registerCreditsScene();

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

// SceneManager - 启动加载画面：纹理就绪后才进入场景链
if (textureManager.isReady()) {
    // 纹理已缓存（二次访问），跳过加载画面
    sceneManager.switchTo('splash');
} else {
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingLogContent = document.getElementById('loadingLogContent');
    const loadingLogBox = document.getElementById('loadingLogBox');
    const loadingProgressBarInner = document.getElementById('loadingProgressBarInner');
    const loadingProgressText = document.getElementById('loadingProgressText');

    loadingScreen.style.display = 'flex';

    // 注册进度事件处理
    const onProgress = ({ key, loaded, total, success }) => {
        const line = document.createElement('div');
        line.textContent = (success ? '[OK] ' : '[FAIL] ') + key + '.png';
        line.className = success ? 'loading-log-ok' : 'loading-log-fail';
        loadingLogContent.appendChild(line);

        const pct = Math.round(loaded / total * 100);
        loadingProgressBarInner.style.width = (loaded / total * 100) + '%';
        loadingProgressText.textContent = loaded + '/' + total + ' (' + pct + '%)';

        loadingLogBox.scrollTop = loadingLogBox.scrollHeight;
    };

    // 注册完成事件处理
    const onReady = ({ loaded, failed }) => {
        eventBus.off(Events.TEXTURE_PROGRESS, onProgress);
        eventBus.off(Events.TEXTURES_READY, onReady);

        setTimeout(() => {
            loadingScreen.style.display = 'none';
            sceneManager.switchTo('splash');
        }, 300);

        if (failed > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(failed + ' 张图片加载失败，部分界面可能异常', 'warning', 4000);
            }
        }
    };

    eventBus.on(Events.TEXTURE_PROGRESS, onProgress);
    eventBus.on(Events.TEXTURES_READY, onReady);

    textureManager.init();
}

// 启动游戏循环
requestAnimationFrame(gameLoop);

// 追踪站 — 桥接 exports 供 ui.js 使用（飞船建造/摧毁刷新追踪树依赖）
window.__celestialBodies = celestialBodies;
window.buildTrackingTree = buildTrackingTree;
window.renderTrackingNav = renderTrackingNav;
window.trackingCollapsed = trackingCollapsed;

// 场景就绪时重置 lastTime，防止读档后 dt 异常大
eventBus.on(Events.SCENE_READY, () => { lastTime = 0; });

// TEMP: 第二阶段-SceneManager - 设置功能占位
window.openSettings = function() {
    window.showNotification('设置功能暂不开放', 'info');
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
        window.__createInputDialog('新世界名称', '输入世界名称', '新世界', (name) => {
            // 飞船系统 - 使用 shipSystem 创建飞船实例
            const newShip = shipSystem.createShip('debug_behemoth', '初始飞船', ['construction_package']);
            if (!newShip) {
                window.showNotification('飞船创建失败', 'error');
                return;
            }

            // 飞船系统 - 设置初始位置和轨道
            const homeworld = celestialBodies.find(b => b.isHomeworld);
            if (!homeworld) {
                console.warn('[startNewGame] 找不到起始天体数据，使用硬编码默认值');
                newShip.pos = { x: 580, y: 0 };
                newShip.vel = { x: 0, y: -Math.sqrt(10000 / 80) };
                newShip.currentGM = 10000;
                newShip.currentHostPos = { x: 500, y: 0 };
                newShip.kepler = stateToKepler({ x: 80, y: 0 }, newShip.vel, 10000);
            } else {
                const orbitR = homeworld.displayRadius + (homeworld.defaultOrbitAltitude || 0);
                newShip.pos = { x: homeworld.position.x + orbitR, y: homeworld.position.y };
                const orbitalSpeed = Math.sqrt(homeworld.gm / orbitR);
                newShip.vel = { x: 0, y: -orbitalSpeed };
                newShip.currentGM = homeworld.gm;
                newShip.currentHostPos = { x: homeworld.position.x, y: homeworld.position.y };
                const relPos = { x: orbitR, y: 0 };
                newShip.kepler = stateToKepler(relPos, newShip.vel, homeworld.gm);
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
                const dockyardOrbitR = 70;
                const dockyardPos = {
                    x: homeworld.position.x + dockyardOrbitR,
                    y: homeworld.position.y
                };
                const dockyardVel = {
                    x: 0,
                    y: -Math.sqrt(homeworld.gm / dockyardOrbitR)
                };
                facilitySystem.createFacility(
                    'orbital_dockyard',
                    'Kerbin 轨道船坞',
                    dockyardPos,
                    dockyardVel,
                    homeworld.name
                );
            }

            // 先创建世界（含名称冲突检测），成功后再切场景
            window.currentWorldId = window.__saveManager.createWorld(name);
            if (window.currentWorldId) {
                sceneManager.switchTo('flight');
                window.showNotification('新世界创建成功！', 'success');
            } else {
                // 名称冲突 — 回滚已创建的飞船/设施，不切场景
                gameState.reset();
                window.showNotification('世界名称已存在，请换一个', 'error');
            }
        });
    } else {
        window.showNotification('UI 组件未加载', 'error');
    }
};

// 读取存档菜单 - 继续游戏（加载最近检查点）
// 继续游戏优化 - 加载所有世界中最新保存的检查点
window.continueGame = function() {
    const worldList = window.__saveManager.getWorldList();
    if (worldList.length === 0) {
        window.showNotification('没有存档，开始新游戏吧', 'info');
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
        window.showNotification('没有找到有效的检查点', 'info');
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
        window.showNotification('没有存档', 'info');
        return;
    }

    const worldItems = worldList.map(w => ({
        id: w.id,
        name: `${w.name}  (${w.checkpointCount} 个检查点)`,
        subtitle: `${new Date(w.createdAt).toLocaleString()}`
    }));

    window.__createDialog('选择世界', worldItems, (worldId) => {
        const checkpoints = window.__saveManager.getCheckpointList(worldId);
        if (checkpoints.length === 0) {
            window.showNotification('该世界没有检查点', 'info');
            return;
        }
        const cpItems = checkpoints.map(c => ({
            id: c.id,
            name: c.name,
            subtitle: `${new Date(c.timestamp).toLocaleString()} · 游戏时间 ${c.gameTime.toFixed(1)}s`
        }));
        window.__createDialog('选择检查点', cpItems, (checkpointId) => {
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
        if (typeof window.__renderWorldList === 'function') {
            window.__renderWorldList();
        }
    } else {
        console.warn('[Archive] archiveManagerPanel 未找到');
    }
};

// 反馈入口 - 显示联系方式对话框
window.openFeedback = function() {
    const overlay = document.createElement('div');
    overlay.style.cssText = ''
        + 'position:fixed;inset:0;background:rgba(0,0,0,0.8);'
        + 'display:flex;align-items:center;justify-content:center;'
        + 'z-index:10000;';

    const panel = document.createElement('div');
    panel.style.cssText = ''
        + 'background:rgba(0,0,0,0.85);border:1px solid #555;'
        + 'border-radius:5px;padding:20px;min-width:300px;'
        + 'max-width:360px;font-family:monospace;color:white;';

    // 标题
    const title = document.createElement('h3');
    title.textContent = '反馈渠道';
    title.style.cssText = 'color:#88ccff;margin:0 0 16px 0;border-bottom:1px solid #444;padding-bottom:8px;';

    // 图标辅助函数
    function renderIcon(texKey, emoji) {
        const container = document.createElement('span');
        container.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-right:10px;flex-shrink:0;';

        const tex = textureManager.get(texKey);
        if (tex && tex.complete) {
            const img = document.createElement('img');
            img.src = tex.src;
            img.style.cssText = 'width:24px;height:24px;object-fit:contain;';
            container.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.style.cssText = 'font-size:18px;text-align:center;';
            container.appendChild(span);
        }
        return container;
    }

    // QQ 行
    const qqRow = document.createElement('div');
    qqRow.style.cssText = 'display:flex;align-items:center;margin-bottom:14px;';
    qqRow.appendChild(renderIcon('icon_qq', '\u{1F4F1}'));
    const qqText = document.createElement('span');
    qqText.textContent = 'QQ\uFF1A1570447677';
    qqText.style.cssText = 'color:#ddd;font-size:13px;';
    qqRow.appendChild(qqText);

    // 邮箱行
    const emailRow = document.createElement('div');
    emailRow.style.cssText = 'display:flex;align-items:center;margin-bottom:18px;';
    emailRow.appendChild(renderIcon('icon_email', '\u{1F4E7}'));
    const emailText = document.createElement('span');
    emailText.textContent = '\u90AE\u7BB1\uFF1Amc1234com@163.com';
    emailText.style.cssText = 'color:#ddd;font-size:13px;';
    emailRow.appendChild(emailText);

    // 关闭按钮
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u5173\u95ED';
    closeBtn.style.cssText = ''
        + 'padding:5px 16px;background:#333;color:#ddd;'
        + 'border:1px solid #555;border-radius:3px;'
        + 'font-family:monospace;font-size:12px;cursor:pointer;';

    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'rgba(136,204,255,0.15)';
        closeBtn.style.color = '#88ccff';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = '#333';
        closeBtn.style.color = '#ddd';
    });

    btnRow.appendChild(closeBtn);

    panel.appendChild(title);
    panel.appendChild(qqRow);
    panel.appendChild(emailRow);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => {
        if (e.key === 'Escape') close();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', escHandler);
};
=======
// GameState 加载
import { gameState } from './src/gameState.js';

// SaveManager - 加载存档管理器
import './src/saveManager.js';

// SceneManager - 导入场景管理器
import { sceneManager } from './src/sceneManager.js';
// 飞船系统 - 导入飞船系统核心模块
import { shipSystem } from './src/ship/shipSystem.js';
import { facilitySystem } from './src/facility/facilitySystem.js';
// UI加载 - UI 模块必须尽早加载，确保菜单按钮点击时函数已就绪
import './src/ui/ui.js';
// 图形系统 - 纹理管理器
import { textureManager } from './src/graphics/textureManager.js';

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
    createStars();
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
            window.showNotification('游戏发生异常: ' + e.message, 'error', 5000);
        }
    }

    requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', resize);
initCamera();
resize();

// SceneManager - 注册 splash / info / menu / encyclopedia / credits 场景
registerSplashScene();
registerInfoScene();
registerMenuScene({
    startNewGame: () => window.startNewGame(),
    continueGame: () => window.continueGame(),
    openLoadMenu: () => window.openLoadMenu(),
    openArchiveManager: () => window.openArchiveManager(),
    openSettings: () => window.openSettings(),
    openFeedback: () => window.openFeedback()
});
registerEncyclopediaScene();
registerCreditsScene();

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

// SceneManager - 启动加载画面：纹理就绪后才进入场景链
if (textureManager.isReady()) {
    // 纹理已缓存（二次访问），跳过加载画面
    sceneManager.switchTo('splash');
} else {
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingLogContent = document.getElementById('loadingLogContent');
    const loadingLogBox = document.getElementById('loadingLogBox');
    const loadingProgressBarInner = document.getElementById('loadingProgressBarInner');
    const loadingProgressText = document.getElementById('loadingProgressText');

    loadingScreen.style.display = 'flex';

    // 注册进度事件处理
    const onProgress = ({ key, loaded, total, success }) => {
        const line = document.createElement('div');
        line.textContent = (success ? '[OK] ' : '[FAIL] ') + key + '.png';
        line.className = success ? 'loading-log-ok' : 'loading-log-fail';
        loadingLogContent.appendChild(line);

        const pct = Math.round(loaded / total * 100);
        loadingProgressBarInner.style.width = (loaded / total * 100) + '%';
        loadingProgressText.textContent = loaded + '/' + total + ' (' + pct + '%)';

        loadingLogBox.scrollTop = loadingLogBox.scrollHeight;
    };

    // 注册完成事件处理
    const onReady = ({ loaded, failed }) => {
        eventBus.off(Events.TEXTURE_PROGRESS, onProgress);
        eventBus.off(Events.TEXTURES_READY, onReady);

        setTimeout(() => {
            loadingScreen.style.display = 'none';
            sceneManager.switchTo('splash');
        }, 300);

        if (failed > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(failed + ' 张图片加载失败，部分界面可能异常', 'warning', 4000);
            }
        }
    };

    eventBus.on(Events.TEXTURE_PROGRESS, onProgress);
    eventBus.on(Events.TEXTURES_READY, onReady);

    textureManager.init();
}

// 启动游戏循环
requestAnimationFrame(gameLoop);

// 追踪站 — 桥接 exports 供 ui.js 使用（飞船建造/摧毁刷新追踪树依赖）
window.__celestialBodies = celestialBodies;
window.buildTrackingTree = buildTrackingTree;
window.renderTrackingNav = renderTrackingNav;
window.trackingCollapsed = trackingCollapsed;

// 场景就绪时重置 lastTime，防止读档后 dt 异常大
eventBus.on(Events.SCENE_READY, () => { lastTime = 0; });

// TEMP: 第二阶段-SceneManager - 设置功能占位
window.openSettings = function() {
    window.showNotification('设置功能暂不开放', 'info');
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
        window.__createInputDialog('新世界名称', '输入世界名称', '新世界', (name) => {
            // 飞船系统 - 使用 shipSystem 创建飞船实例
            const newShip = shipSystem.createShip('debug_behemoth', '初始飞船', ['construction_package']);
            if (!newShip) {
                window.showNotification('飞船创建失败', 'error');
                return;
            }

            // 飞船系统 - 设置初始位置和轨道
            const homeworld = celestialBodies.find(b => b.isHomeworld);
            if (!homeworld) {
                console.warn('[startNewGame] 找不到起始天体数据，使用硬编码默认值');
                newShip.pos = { x: 580, y: 0 };
                newShip.vel = { x: 0, y: -Math.sqrt(10000 / 80) };
                newShip.currentGM = 10000;
                newShip.currentHostPos = { x: 500, y: 0 };
                newShip.kepler = stateToKepler({ x: 80, y: 0 }, newShip.vel, 10000);
            } else {
                const orbitR = homeworld.displayRadius + (homeworld.defaultOrbitAltitude || 0);
                newShip.pos = { x: homeworld.position.x + orbitR, y: homeworld.position.y };
                const orbitalSpeed = Math.sqrt(homeworld.gm / orbitR);
                newShip.vel = { x: 0, y: -orbitalSpeed };
                newShip.currentGM = homeworld.gm;
                newShip.currentHostPos = { x: homeworld.position.x, y: homeworld.position.y };
                const relPos = { x: orbitR, y: 0 };
                newShip.kepler = stateToKepler(relPos, newShip.vel, homeworld.gm);
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
                const dockyardOrbitR = 70;
                const dockyardPos = {
                    x: homeworld.position.x + dockyardOrbitR,
                    y: homeworld.position.y
                };
                const dockyardVel = {
                    x: 0,
                    y: -Math.sqrt(homeworld.gm / dockyardOrbitR)
                };
                facilitySystem.createFacility(
                    'orbital_dockyard',
                    'Kerbin 轨道船坞',
                    dockyardPos,
                    dockyardVel,
                    homeworld.name
                );
            }

            // 先创建世界（含名称冲突检测），成功后再切场景
            window.currentWorldId = window.__saveManager.createWorld(name);
            if (window.currentWorldId) {
                sceneManager.switchTo('flight');
                window.showNotification('新世界创建成功！', 'success');
            } else {
                // 名称冲突 — 回滚已创建的飞船/设施，不切场景
                gameState.reset();
                window.showNotification('世界名称已存在，请换一个', 'error');
            }
        });
    } else {
        window.showNotification('UI 组件未加载', 'error');
    }
};

// 读取存档菜单 - 继续游戏（加载最近检查点）
// 继续游戏优化 - 加载所有世界中最新保存的检查点
window.continueGame = function() {
    const worldList = window.__saveManager.getWorldList();
    if (worldList.length === 0) {
        window.showNotification('没有存档，开始新游戏吧', 'info');
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
        window.showNotification('没有找到有效的检查点', 'info');
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
        window.showNotification('没有存档', 'info');
        return;
    }

    const worldItems = worldList.map(w => ({
        id: w.id,
        name: `${w.name}  (${w.checkpointCount} 个检查点)`,
        subtitle: `${new Date(w.createdAt).toLocaleString()}`
    }));

    window.__createDialog('选择世界', worldItems, (worldId) => {
        const checkpoints = window.__saveManager.getCheckpointList(worldId);
        if (checkpoints.length === 0) {
            window.showNotification('该世界没有检查点', 'info');
            return;
        }
        const cpItems = checkpoints.map(c => ({
            id: c.id,
            name: c.name,
            subtitle: `${new Date(c.timestamp).toLocaleString()} · 游戏时间 ${c.gameTime.toFixed(1)}s`
        }));
        window.__createDialog('选择检查点', cpItems, (checkpointId) => {
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
        if (typeof window.__renderWorldList === 'function') {
            window.__renderWorldList();
        }
    } else {
        console.warn('[Archive] archiveManagerPanel 未找到');
    }
};

// 反馈入口 - 显示联系方式对话框
window.openFeedback = function() {
    const overlay = document.createElement('div');
    overlay.style.cssText = ''
        + 'position:fixed;inset:0;background:rgba(0,0,0,0.8);'
        + 'display:flex;align-items:center;justify-content:center;'
        + 'z-index:10000;';

    const panel = document.createElement('div');
    panel.style.cssText = ''
        + 'background:rgba(0,0,0,0.85);border:1px solid #555;'
        + 'border-radius:5px;padding:20px;min-width:300px;'
        + 'max-width:360px;font-family:monospace;color:white;';

    // 标题
    const title = document.createElement('h3');
    title.textContent = '反馈渠道';
    title.style.cssText = 'color:#88ccff;margin:0 0 16px 0;border-bottom:1px solid #444;padding-bottom:8px;';

    // 图标辅助函数
    function renderIcon(texKey, emoji) {
        const container = document.createElement('span');
        container.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-right:10px;flex-shrink:0;';

        const tex = textureManager.get(texKey);
        if (tex && tex.complete) {
            const img = document.createElement('img');
            img.src = tex.src;
            img.style.cssText = 'width:24px;height:24px;object-fit:contain;';
            container.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.style.cssText = 'font-size:18px;text-align:center;';
            container.appendChild(span);
        }
        return container;
    }

    // QQ 行
    const qqRow = document.createElement('div');
    qqRow.style.cssText = 'display:flex;align-items:center;margin-bottom:14px;';
    qqRow.appendChild(renderIcon('icon_qq', '\u{1F4F1}'));
    const qqText = document.createElement('span');
    qqText.textContent = 'QQ\uFF1A1570447677';
    qqText.style.cssText = 'color:#ddd;font-size:13px;';
    qqRow.appendChild(qqText);

    // 邮箱行
    const emailRow = document.createElement('div');
    emailRow.style.cssText = 'display:flex;align-items:center;margin-bottom:18px;';
    emailRow.appendChild(renderIcon('icon_email', '\u{1F4E7}'));
    const emailText = document.createElement('span');
    emailText.textContent = '\u90AE\u7BB1\uFF1Amc1234com@163.com';
    emailText.style.cssText = 'color:#ddd;font-size:13px;';
    emailRow.appendChild(emailText);

    // 关闭按钮
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u5173\u95ED';
    closeBtn.style.cssText = ''
        + 'padding:5px 16px;background:#333;color:#ddd;'
        + 'border:1px solid #555;border-radius:3px;'
        + 'font-family:monospace;font-size:12px;cursor:pointer;';

    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'rgba(136,204,255,0.15)';
        closeBtn.style.color = '#88ccff';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = '#333';
        closeBtn.style.color = '#ddd';
    });

    btnRow.appendChild(closeBtn);

    panel.appendChild(title);
    panel.appendChild(qqRow);
    panel.appendChild(emailRow);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => {
        if (e.key === 'Escape') close();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', escHandler);
};
>>>>>>> 55f6279aebd46ce585c067f1d4da2d8791092413
