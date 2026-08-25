'use strict';

import { sceneManager } from '../sceneManager.js';
import { eventBus, Events } from '../eventBus.js';
import { textureManager } from '../graphics/textureManager.js';
import { t } from '../config/strings.js';

const LOGO_SEQUENCE = [
    { type: 'image', textureKey: 'project_logo', maxWidthRatio: 0.45, fadeIn: 0.8, hold: 1.5, fadeOut: 0.8 },
    { type: 'text', text: t('splash.text'), fontSize: 24, fadeIn: 0.8, hold: 1.5, fadeOut: 0.8 }
];

let _canvas = null;
let _currentLogoIndex = 0;
let _phase = 'waitTexture';
let _elapsed = 0;
let _cleanupListeners = null;
let _texturesHandler = null;
let _hasSkipped = false;

function _skipSplash() {
    _hasSkipped = true;
    _cleanup();
    // 0.2.8：公告面板化后启动链直达主菜单；仅启动路径自动打开公告面板
    sceneManager.switchTo('menu');
    if (typeof window.openAnnouncement === 'function') {
        window.openAnnouncement();
    }
}

function _cleanup() {
    if (_cleanupListeners) {
        document.removeEventListener('keydown', _cleanupListeners);
        document.removeEventListener('click', _cleanupListeners);
        _cleanupListeners = null;
    }
    if (_texturesHandler) {
        eventBus.off(Events.TEXTURES_READY, _texturesHandler);
        _texturesHandler = null;
    }
}

function _startSequence() {
    _currentLogoIndex = 0;
    _phase = 'fadeIn';
    _elapsed = 0;
}

function _getCurrentConfig() {
    return LOGO_SEQUENCE[_currentLogoIndex];
}

function _advancePhase() {
    _elapsed = 0;

    if (_phase === 'fadeIn') {
        _phase = 'hold';
    } else if (_phase === 'hold') {
        _phase = 'fadeOut';
    } else if (_phase === 'fadeOut') {
        _currentLogoIndex++;
        if (_currentLogoIndex >= LOGO_SEQUENCE.length) {
            _phase = 'blackScreen';
            _elapsed = 0;
        } else {
            _phase = 'fadeIn';
        }
    } else if (_phase === 'blackScreen') {
        // 0.2.8：公告面板化后启动链直达主菜单；仅启动路径自动打开公告面板
        //（其他场景返回主菜单不经此路径 → 不自动打开）
        sceneManager.switchTo('menu');
        if (typeof window.openAnnouncement === 'function') {
            window.openAnnouncement();
        }
    }
}

function _getAlpha() {
    const config = _getCurrentConfig();
    if (_phase === 'fadeIn') {
        return _elapsed / config.fadeIn;
    } else if (_phase === 'hold') {
        return 1;
    } else if (_phase === 'fadeOut') {
        return 1 - (_elapsed / config.fadeOut);
    }
    return 0;
}

function _drawImageLogo(ctx, config, alpha) {
    const img = textureManager.get(config.textureKey);
    if (!img) {
        // 图片未加载时，文字 fallback
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '40px monospace';
        ctx.fillText(t('splash.studio'), _canvas.width / 2, _canvas.height / 2);
        return;
    }

    const maxWidth = _canvas.width * config.maxWidthRatio;
    let drawW = img.width;
    let drawH = img.height;

    if (drawW > maxWidth) {
        const scale = maxWidth / drawW;
        drawW = maxWidth;
        drawH = img.height * scale;
    }

    const x = (_canvas.width - drawW) / 2;
    const y = (_canvas.height - drawH) / 2;

    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, y, drawW, drawH);
    ctx.globalAlpha = 1;
}

function registerSplashScene() {
    sceneManager.registerScene('splash', {
        enter() {
            _canvas = document.getElementById('canvas');
            _hasSkipped = false;

            // 跳过监听 — 任意键/点击跳过全部
            _cleanupListeners = () => {
                _skipSplash();
            };
            document.addEventListener('keydown', _cleanupListeners, { once: true });
            document.addEventListener('click', _cleanupListeners, { once: true });

            // 等待纹理加载
            if (textureManager.isReady()) {
                _startSequence();
            } else {
                _phase = 'waitTexture';
                _elapsed = 0;

                _texturesHandler = () => {
                    if (!_hasSkipped) {
                        _startSequence();
                    }
                };
                eventBus.on(Events.TEXTURES_READY, _texturesHandler);
            }
        },

        update(dt) {
            if (_phase === 'waitTexture') {
                return;
            }

            _elapsed += dt;

            let timeout = null;
            if (_phase === 'fadeIn') {
                timeout = _getCurrentConfig().fadeIn;
            } else if (_phase === 'hold') {
                timeout = _getCurrentConfig().hold;
            } else if (_phase === 'fadeOut') {
                timeout = _getCurrentConfig().fadeOut;
            } else if (_phase === 'blackScreen') {
                timeout = 0.3;
            }

            if (timeout !== null && _elapsed >= timeout) {
                _advancePhase();
            }
        },

        render(ctx) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, _canvas.width, _canvas.height);

            if (_phase === 'waitTexture' || _phase === 'blackScreen') {
                return;
            }

            const config = _getCurrentConfig();
            const alpha = _getAlpha();

            if (config.type === 'image') {
                _drawImageLogo(ctx, config, alpha);
            } else {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = 'white';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = config.fontSize + 'px monospace';
                ctx.fillText(config.text, _canvas.width / 2, _canvas.height / 2);
                ctx.globalAlpha = 1;
            }
        },

        exit() {
            _cleanup();
        }
    });
}

export { registerSplashScene };
