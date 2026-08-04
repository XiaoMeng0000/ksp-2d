'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { eventBus, Events } from '../eventBus.js';
import { renderableManager } from '../graphics/renderable.js';
import { MAIN_MENU, SUB_MENU, MENU_STYLE } from '../config/menuConfig.js';

let _canvas = null;
let _currentMenu = 'main';
let _hoverIndex = -1;
let _buttonRects = [];
let _stars = [];
let _logoHeight = 0;
let _onMouseMove = null;
let _onClick = null;
let _onKeyDown = null;
let _texturesReadyHandler = null;
let _callbacks = {};

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

function _buildButtonRects(buttonStartY) {
    const yStart = buttonStartY || MENU_STYLE.buttonStartY;
    const menu = _currentMenu === 'main' ? MAIN_MENU : SUB_MENU;
    const rects = [];
    for (let i = 0; i < menu.length; i++) {
        rects.push({
            x: MENU_STYLE.buttonX,
            y: yStart + i * MENU_STYLE.buttonSpacing,
            w: MENU_STYLE.buttonMinWidth,
            h: MENU_STYLE.buttonHeight,
            action: menu[i].action,
            label: menu[i].label
        });
    }
    _buttonRects = rects;
}

function _getHoverIndex(mx, my) {
    for (let i = 0; i < _buttonRects.length; i++) {
        const r = _buttonRects[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
            return i;
        }
    }
    return -1;
}

function _executeAction(action) {
    if (action === 'back') {
        _currentMenu = 'main';
        _hoverIndex = -1;
        _buildButtonRects(MENU_STYLE.buttonStartY);
    } else if (action === 'submenu') {
        _currentMenu = 'sub';
        _hoverIndex = -1;
        _buildButtonRects(MENU_STYLE.buttonStartY);
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

function _drawLogo(ctx) {
    if (textureManager.isReady()) {
        const img = textureManager.get('title');
        if (img) {
            const maxWidth = MENU_STYLE.logoMaxWidth;
            let drawW = img.width;
            let drawH = img.height;
            if (drawW > maxWidth) {
                const scale = maxWidth / drawW;
                drawW = maxWidth;
                drawH = img.height * scale;
            }
            ctx.drawImage(img, MENU_STYLE.logoX, MENU_STYLE.logoY, drawW, drawH);
            return drawH;
        }
    }

    // 文字 fallback
    ctx.fillStyle = '#A04040';
    ctx.font = '48px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('KSP 2D', MENU_STYLE.logoX, MENU_STYLE.logoY);
    return 58;
}

function _drawVersion(ctx) {
    const versionText = 'v0.2.3-alpha (Build 202608)';
    ctx.font = MENU_STYLE.versionFontSize + 'px ' + MENU_STYLE.fontFamily;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = MENU_STYLE.versionColor;
    ctx.fillText(
        versionText,
        _canvas.width + MENU_STYLE.versionX,
        _canvas.height - MENU_STYLE.versionY
    );
}

function _drawButtons(ctx, buttonStartY) {
    const yStart = buttonStartY || MENU_STYLE.buttonStartY;
    const menu = _currentMenu === 'main' ? MAIN_MENU : SUB_MENU;

    for (let i = 0; i < menu.length; i++) {
        const bx = MENU_STYLE.buttonX;
        const by = yStart + i * MENU_STYLE.buttonSpacing;
        const bw = MENU_STYLE.buttonMinWidth;
        const bh = MENU_STYLE.buttonHeight;

        // hover 背景高亮条
        if (i === _hoverIndex) {
            ctx.fillStyle = MENU_STYLE.hoverBg;
            const padX = 12;
            const padY = 4;
            ctx.fillRect(bx - padX, by - padY, bw + padX * 2, bh + padY * 2);
            ctx.fillStyle = MENU_STYLE.hoverTextColor;
        } else {
            ctx.fillStyle = MENU_STYLE.textColor;
        }

        ctx.font = MENU_STYLE.fontSize + 'px ' + MENU_STYLE.fontFamily;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(menu[i].label, bx, by + bh / 2);
    }
}

function _handleMouseMove(event) {
    const rect = _canvas.getBoundingClientRect();
    const scaleX = _canvas.width / rect.width;
    const scaleY = _canvas.height / rect.height;
    const mx = (event.clientX - rect.left) * scaleX;
    const my = (event.clientY - rect.top) * scaleY;

    const newHover = _getHoverIndex(mx, my);
    if (newHover !== _hoverIndex) {
        _hoverIndex = newHover;
        _canvas.style.cursor = _hoverIndex >= 0 ? 'pointer' : 'default';
    }
}

function _handleClick(event) {
    if (_hoverIndex >= 0 && _hoverIndex < _buttonRects.length) {
        _executeAction(_buttonRects[_hoverIndex].action);
    }
}

function _handleKeyDown(event) {
    if (event.key === 'Escape') {
        if (_currentMenu === 'sub') {
            _currentMenu = 'main';
            _hoverIndex = -1;
            _buildButtonRects(MENU_STYLE.buttonStartY);
        }
    }
}

function registerMenuScene(options) {
    _callbacks = {
        startNewGame: options.startNewGame,
        continueGame: options.continueGame,
        openLoadMenu: options.openLoadMenu,
        openArchiveManager: options.openArchiveManager,
        openSettings: options.openSettings,
        openFeedback: options.openFeedback
    };

    sceneManager.registerScene('menu', {
        enter() {
            _canvas = document.getElementById('canvas');
            _currentMenu = 'main';
            _hoverIndex = -1;

            _generateStars();

            _onMouseMove = (e) => _handleMouseMove(e);
            _onClick = (e) => _handleClick(e);
            _onKeyDown = (e) => _handleKeyDown(e);

            document.addEventListener('mousemove', _onMouseMove);
            document.addEventListener('click', _onClick);
            document.addEventListener('keydown', _onKeyDown);

            _canvas.style.cursor = 'default';

            // 纹理就绪后注册 facility renderable
            _texturesReadyHandler = () => {
                renderableManager.register('facility', {
                    layers: [
                        { texture: 'facility', alpha: 1.0 }
                    ]
                });
            };
            eventBus.on(Events.TEXTURES_READY, _texturesReadyHandler);

            if (textureManager.isReady()) {
                _texturesReadyHandler();
            }
        },

        update() {
            // 无业务逻辑
        },

        render(ctx) {
            // 读取菜单背景设置
            const menuBgMode = localStorage.getItem('ksp2d.menuBg') || 'stars';

            if (menuBgMode === 'image') {
                // 图片模式：优先用背景图，加载失败则退回星空
                const bg = textureManager.get('menu_bg');
                if (bg) {
                    ctx.drawImage(bg, 0, 0, _canvas.width, _canvas.height);
                } else {
                    // 背景图未加载，fallback 到星空
                    ctx.fillStyle = 'black';
                    ctx.fillRect(0, 0, _canvas.width, _canvas.height);
                    for (const star of _stars) {
                        ctx.beginPath();
                        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(255, 255, 255, ' + star.alpha + ')';
                        ctx.fill();
                    }
                }
            } else {
                // 星空模式：纯黑 + 星空
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, _canvas.width, _canvas.height);
                for (const star of _stars) {
                    ctx.beginPath();
                    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255, 255, 255, ' + star.alpha + ')';
                    ctx.fill();
                }
            }

            // Logo — 返回实际高度用于动态布局
            _logoHeight = _drawLogo(ctx);

            // 按钮起始 Y = logo 底部 + 间距
            const buttonStartY = MENU_STYLE.logoY + _logoHeight + 40;

            // 每次 render 重建 hit area（适配窗口 resize 和动态布局）
            // TODO: 只在 resize 或菜单切换时重建以优化性能
            _buildButtonRects(buttonStartY);

            // 按钮
            _drawButtons(ctx, buttonStartY);

            // 版本号
            _drawVersion(ctx);
        },

        exit() {
            if (_onMouseMove) {
                document.removeEventListener('mousemove', _onMouseMove);
                _onMouseMove = null;
            }
            if (_onClick) {
                document.removeEventListener('click', _onClick);
                _onClick = null;
            }
            if (_onKeyDown) {
                document.removeEventListener('keydown', _onKeyDown);
                _onKeyDown = null;
            }
            if (_texturesReadyHandler) {
                eventBus.off(Events.TEXTURES_READY, _texturesReadyHandler);
                _texturesReadyHandler = null;
            }
            _canvas.style.cursor = '';
        }
    });
}

export { registerMenuScene };
