'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { eventBus, Events } from '../eventBus.js';
import { renderableManager } from '../graphics/renderable.js';
import { menuPlanetLayer } from '../graphics/menuPlanetLayer.js';
import { MENUS } from '../config/ui/menuConfig.js';
import { LINKS_ICONS } from '../config/ui/menuConfig.js'; // 1. 导入数据
import { VERSION_TEXT } from '../config/meta/version.js';
import { SETTINGS_ROWS } from '../config/gameplay/settingsConfig.js';

// 主菜单 — DOM 版（阶段 3：Canvas→DOM）
// - 数据驱动：menuConfig.js 的 MENUS 定义各菜单按钮（label/action）
// - 布局样式见 src/ui/styles/main_menu.css
// - 背景（星空 / 背景图）仍由 Canvas 绘制，仅菜单 UI（Logo/按钮/版本号）迁移为 DOM
// - 版本号常量与 ESC 菜单共享（src/config/version.js）

let _canvas = null;
let _currentMenu = 'main';
let _stars = [];
let _container = null;      // 主菜单 DOM 容器
let _onKeyDown = null;
let _texturesReadyHandler = null;
let _callbacks = {};
let _menuBgMode = 'style2';         // 菜单样式缓存（style1=纯星空 / style2=带星球；进场景读一次）
let _settingsClosedHandler = null;

// 读取菜单样式 —— 存储键取 settingsConfig 的定义（配置集中，不硬编码字面量）
// 旧值 stars/image（以及任何未知值）一律落到 style2；style1 为显式 opt-in
function _readMenuBgMode() {
    const row = (SETTINGS_ROWS.display || []).find(r => r.group === 'menuBg');
    if (!row) return 'style2';
    const raw = localStorage.getItem(row.storageKey);
    const legacy = row.legacyValues && row.legacyValues[raw];
    const value = legacy || raw || row.defaultValue;
    return value === 'style1' ? 'style1' : 'style2';
}

// 生成背景星空
function _generateStars() {
    const stars = [];
    for (let i = 0; i < 300; i++) {
        stars.push({
            x: Math.random() * _canvas.width,
            y: Math.random() * _canvas.height,
            r: Math.random() * 1.2 + 0.4,
            alpha: Math.random() * 0.4 + 0.15
        });
    }
    _stars = stars;
}

// 绘制星空背景（纯黑 + 随机星点）
function _drawStars(ctx) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, _canvas.width, _canvas.height);
    for (const star of _stars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + star.alpha + ')';
        ctx.fill();
    }
}

// 执行菜单动作（menuConfig action 协议：back / submenu:X / scene:X / callback:X）
function _executeAction(action) {
    if (action === 'back') {
        _currentMenu = 'main';
        _renderMenuButtons('main');
    } else if (action.startsWith('submenu:')) {
        const subMenuId = action.slice(8);
        if (MENUS[subMenuId]) {
            _currentMenu = subMenuId;
            _renderMenuButtons(subMenuId);
        }
    } else if (action.startsWith('scene:')) {
        const sceneId = action.slice(6);
        sceneManager.switchTo(sceneId);
    } else if (action.startsWith('callback:')) {
        const callbackName = action.slice(9);
        if (_callbacks[callbackName]) {
            _callbacks[callbackName]();
        }
    }
}

// 渲染当前菜单按钮到导航区（每次切换菜单重建，避免字符串 onclick）
function _renderMenuButtons(menuId) {
    const menu = MENUS[menuId] || MENUS.main;
    const nav = _container ? _container.querySelector('#mmNav') : null;
    if (!nav) return;
    nav.innerHTML = '';
    for (const item of menu) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mm-btn';
        btn.textContent = item.label;
        btn.addEventListener('click', () => _executeAction(item.action));
        nav.appendChild(btn);
    }
}

// 刷新 Logo：纹理就绪显示图片，否则文字 fallback
function _updateLogo() {
    const img = document.getElementById('mmLogo');
    const text = document.getElementById('mmLogoText');
    if (!img || !text) return;
    const tex = textureManager.get('title');
    if (tex && tex.complete && tex.naturalWidth > 0) {
        img.src = tex.src;
        img.style.display = 'block';
        text.style.display = 'none';
    } else {
        img.style.display = 'none';
        text.style.display = 'block';
    }
}

// 刷新链接栏图标：从 textureManager 取图回填 src（与 Logo fallback 机制一致）
function _updateLinkIcons() {
    const linksWrap = _container ? _container.querySelector('#mmLinks') : null;
    if (!linksWrap) return;
    for (const item of LINKS_ICONS) {
        const img = linksWrap.querySelector('img[data-icon-key="' + item.icon_key + '"]');
        if (!img) continue;
        const tex = textureManager.get(item.icon_key);
        if (tex && tex.complete && tex.naturalWidth > 0) {
            img.src = tex.src;
            img.style.visibility = 'visible';
        }
    }
}

// ========== 2. 固定链接点击处理逻辑（完整版） ==========
function _handleLinkClick(item) {
    const { type, links } = item;
    switch (type) {
        case 'qgroup':
            if (navigator.clipboard) {
                navigator.clipboard.writeText(links).then(() => {
                    window.showNotification('Copied: ' + links);
                }).catch(() => {
                    _fallbackCopy(links);
                });
            } else {
                _fallbackCopy(links);
            }
            break;
        case 'email':
            window.location.href = 'mailto:' + links;
            break;
        case 'link':
            window.open(links, '_blank');
            break;
        default:
            break;
    }
}

// 复制降级方案
function _fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        alert('QQ群号已复制：' + text);
    } catch (e) {
        alert('复制失败，请手动复制：' + text);
    }
    document.body.removeChild(input);
}
// =================================================

// 构建主菜单 DOM 骨架（进入场景时执行一次）
function _buildMenuDOM() {
    const container = document.createElement('div');
    container.id = 'mainMenuContainer';
    container.className = 'main-menu';

    // Logo（图片优先，未就绪时文字 fallback）
    const logoWrap = document.createElement('div');
    logoWrap.className = 'mm-logo';
    const logoImg = document.createElement('img');
    logoImg.id = 'mmLogo';
    logoImg.alt = 'KSP 2D';
    const logoText = document.createElement('div');
    logoText.id = 'mmLogoText';
    logoText.className = 'mm-logo-text';
    logoText.textContent = 'KSP 2D';
    logoWrap.appendChild(logoImg);
    logoWrap.appendChild(logoText);

    // 导航按钮列
    const nav = document.createElement('nav');
    nav.id = 'mmNav';
    nav.className = 'mm-nav';

    // ========== 3. 固定链接栏（带图标，完整循环） ==========
    const linksWrap = document.createElement('div');
    linksWrap.id = 'mmLinks';
    linksWrap.className = 'mm-links';
    for (const item of LINKS_ICONS) {
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'mm-link-btn';
        
        const img = document.createElement('img');
        img.alt = item.label;
        img.title = item.label;          // 悬停显示文字
        img.className = 'mm-link-icon';
        img.dataset.iconKey = item.icon_key;  // 纹理就绪后由 _updateLinkIcons 回填
        // 纹理已加载则直接使用缓存图片，否则先隐藏待 TEXTURES_READY 回填
        const tex = textureManager.get(item.icon_key);
        if (tex && tex.complete && tex.naturalWidth > 0) {
            img.src = tex.src;
        } else {
            img.style.visibility = 'hidden';
        }
        
        linkBtn.appendChild(img);
        linkBtn.addEventListener('click', () => _handleLinkClick(item));
        linksWrap.appendChild(linkBtn);
    }
    // ================================================

    // 版本号（右上角：背景图右下为巨球）
    const version = document.createElement('div');
    version.className = 'mm-version';
    version.textContent = VERSION_TEXT;

    container.appendChild(logoWrap);
    container.appendChild(nav);
    container.appendChild(linksWrap);   // 固定链接在导航与版本号之间
    container.appendChild(version);
    document.body.appendChild(container);

    _updateLogo();
    _updateLinkIcons();
    return container;
}

// ESC：从二级菜单返回主菜单
function _handleKeyDown(event) {
    if (event.key === 'Escape') {
        if (_currentMenu !== 'main') {
            _currentMenu = 'main';
            _renderMenuButtons('main');
        }
    }
}

function registerMenuScene(options) {
    _callbacks = {
        // 0.2.5：开始游戏/读档/存档管理整合为左侧"开始游戏"综合面板
        openStartGamePanel: options.openStartGamePanel,
        openSettings: options.openSettings,
        openFeedback: options.openFeedback,
        // 0.2.7：百科面板化（scene → uiManager 面板，入口协议同设置）
        openEncyclopedia: options.openEncyclopedia,
        // 0.2.8：公告面板化（scene → uiManager 面板，入口协议同设置）
        openAnnouncement: options.openAnnouncement
    };

    sceneManager.registerScene('menu', {
        enter() {
            _canvas = document.getElementById('canvas');
            _currentMenu = 'main';
            _generateStars();

            // 菜单样式：进场景读一次并缓存（渲染路径不再触碰 localStorage）
            _menuBgMode = _readMenuBgMode();
            // style2 才初始化星球层；style1 保持原版纯星空，不创建 WebGL 资源
            if (_menuBgMode === 'style2') menuPlanetLayer.enter(_canvas);

            // 设置面板化后可在主菜单内直接改背景（不切场景），故在设置面板关闭时刷新缓存；
            // 复用 uiManager 既有的 UI_PANEL_CLOSED 事件，不新增事件、不轮询
            // 守卫：enter 可能被重复调用（场景重入/显式调用），避免重复订阅导致 exit 只注销得掉最后一个
            if (!_settingsClosedHandler) {
                _settingsClosedHandler = ({ panelId }) => {
                    if (panelId !== 'settings') return;
                    const next = _readMenuBgMode();
                    if (next === 'style2' && _menuBgMode !== 'style2') {
                        menuPlanetLayer.enter(_canvas);
                    } else if (next === 'style1' && _menuBgMode === 'style2') {
                        menuPlanetLayer.exit();
                    }
                    _menuBgMode = next;
                };
                eventBus.on(Events.UI_PANEL_CLOSED, _settingsClosedHandler);
            }

            _container = _buildMenuDOM();
            _renderMenuButtons('main');

            _onKeyDown = (e) => _handleKeyDown(e);
            document.addEventListener('keydown', _onKeyDown);

            _texturesReadyHandler = () => {
                renderableManager.register('facility', {
                    layers: [
                        { texture: 'facility', alpha: 1.0 }
                    ]
                });
                _updateLogo();
                _updateLinkIcons();
            };
            eventBus.on(Events.TEXTURES_READY, _texturesReadyHandler);

            if (textureManager.isReady()) {
                _texturesReadyHandler();
            }
        },

        update(dt) {
            // 仅 style2 更新星球层（style1 = 原版纯星空）
            if (_menuBgMode === 'style2') {
                menuPlanetLayer.update(dt);
            }
        },

        render(ctx) {
            // 两种样式都先画星空；style2 再叠加星球层（唯一的合成调用点）
            _drawStars(ctx);
            if (_menuBgMode === 'style2') {
                menuPlanetLayer.render(ctx);
            }
        },

        exit() {
            if (_onKeyDown) {
                document.removeEventListener('keydown', _onKeyDown);
                _onKeyDown = null;
            }
            if (_settingsClosedHandler) {
                eventBus.off(Events.UI_PANEL_CLOSED, _settingsClosedHandler);
                _settingsClosedHandler = null;
            }
            if (_texturesReadyHandler) {
                eventBus.off(Events.TEXTURES_READY, _texturesReadyHandler);
                _texturesReadyHandler = null;
            }
            if (_container && _container.parentNode) {
                _container.parentNode.removeChild(_container);
            }
            _container = null;
            if (_canvas) {
                _canvas.style.cursor = '';
            }
            menuPlanetLayer.exit();
        }
    });
}

export { registerMenuScene };