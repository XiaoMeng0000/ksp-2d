import { eventBus, Events } from '../eventBus.js';
import { textureConfig } from './textureConfig.js';

class TextureManager {
    constructor() {
        if (TextureManager._instance) {
            return TextureManager._instance;
        }
        TextureManager._instance = this;
        this._textures = new Map();
        this._total = 0;
        this._completed = 0;
        this._ready = false;
    }

    init() {
        const keys = Object.keys(textureConfig);
        this._total = keys.length;
        this._completed = 0;
        this._ready = false;

        if (this._total === 0) {
            this._ready = true;
            eventBus.emit(Events.TEXTURES_READY, { total: 0, loaded: 0, failed: 0 });
            console.log('[TextureManager] 无纹理需要加载');
            return this;
        }

        console.log(`[TextureManager] 开始加载 ${this._total} 个纹理...`);

        for (const key of keys) {
            const path = textureConfig[key];
            this._loadTexture(key, path);
        }

        return this;
    }

    _loadTexture(key, path) {
        const img = new Image();

        img.onload = () => {
            this._textures.set(key, img);
            eventBus.emit(Events.TEXTURE_PROGRESS, { key, loaded: this._completed + 1, total: this._total, success: true });
            this._completed++;
            console.log(`[TextureManager] 已加载: ${key} (${this._completed}/${this._total})`);
            this._checkAllDone();
        };

        img.onerror = () => {
            eventBus.emit(Events.TEXTURE_PROGRESS, { key, loaded: this._completed + 1, total: this._total, success: false });
            this._completed++;
            console.error(`[TextureManager] 加载失败: ${key} → ${path} (${this._completed}/${this._total})`);
            eventBus.emit(Events.TEXTURE_LOAD_ERROR, { key, path });
            this._checkAllDone();
        };

        img.src = path;
    }

    get(key) {
        return this._textures.get(key) || null;
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
            const loaded = this._textures.size;
            const failed = this._total - loaded;
            console.log(`[TextureManager] 全部完成 — 成功: ${loaded}, 失败: ${failed}`);
            eventBus.emit(Events.TEXTURES_READY, { total: this._total, loaded, failed });
        }
    }
}

export const textureManager = new TextureManager();

if (typeof window !== 'undefined') {
    window.__textureManager = textureManager;
    console.log('[TextureManager] 单例已创建，可通过 window.__textureManager 访问');
}
