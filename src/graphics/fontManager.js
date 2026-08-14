'use strict';

import { eventBus, Events } from '../eventBus.js';
import { fontConfig } from './fontConfig.js';

// FontManager 单例类 — 字体预加载管理
// 职责：通过 FontFace API 主动加载字体并注册到 document.fonts，
// 与 textureManager / audioCore 同构（init / get / isReady / 进度与完成事件），
// 使字体与图片、音频一起参与启动加载流程，避免懒加载导致的字体跳变
class FontManager {
    constructor() {
        if (FontManager._instance) {
            return FontManager._instance;
        }
        FontManager._instance = this;
        this._faces = new Map();   // 字体标识 → FontFace
        this._total = 0;
        this._completed = 0;
        this._ready = false;
    }

    init() {
        const keys = Object.keys(fontConfig);
        this._total = keys.length;
        this._completed = 0;
        this._ready = false;

        if (this._total === 0) {
            this._ready = true;
            eventBus.emit(Events.FONTS_READY, { total: 0, loaded: 0, failed: 0 });
            console.log('[FontManager] 无字体需要加载');
            return this;
        }

        console.log(`[FontManager] 开始加载 ${this._total} 个字体...`);

        for (const key of keys) {
            this._loadFont(key, fontConfig[key]);
        }

        return this;
    }

    async _loadFont(key, path) {
        // 与 root.css 中 @font-face 相同 family 名，加载成功后字体族即就绪
        const face = new FontFace(key, 'url(' + path + ')');
        try {
            const loaded = await face.load();
            document.fonts.add(loaded);
            this._faces.set(key, loaded);
            this._completed++;
            console.log(`[FontManager] 已加载: ${key} (${this._completed}/${this._total})`);
            eventBus.emit(Events.FONT_PROGRESS, { key, loaded: this._completed, total: this._total, success: true });
        } catch (e) {
            this._completed++;
            console.error(`[FontManager] 加载失败: ${key} → ${path}`, e);
            eventBus.emit(Events.FONT_PROGRESS, { key, loaded: this._completed, total: this._total, success: false });
            eventBus.emit(Events.FONT_LOAD_ERROR, { key, path });
        }
        this._checkAllDone();
    }

    get(key) {
        return this._faces.get(key) || null;
    }

    isReady() {
        return this._ready;
    }

    getProgress() {
        return { loaded: this._completed, total: this._total };
    }

    _checkAllDone() {
        if (this._completed >= this._total) {
            this._ready = true;
            const loaded = this._faces.size;
            const failed = this._total - loaded;
            console.log(`[FontManager] 全部完成 — 成功: ${loaded}, 失败: ${failed}`);
            eventBus.emit(Events.FONTS_READY, { total: this._total, loaded, failed });
        }
    }
}

export const fontManager = new FontManager();

if (typeof window !== 'undefined') {
    window.__fontManager = fontManager;
    console.log('[FontManager] 单例已创建，可通过 window.__fontManager 访问');
}
