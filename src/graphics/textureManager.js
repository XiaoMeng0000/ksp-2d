import { eventBus, Events } from '../eventBus.js';
import { getTextureManifest } from '../config/assets/assetManifest.js';

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
        // 0.3.0：清单来源改为聚合层 —— 实体配置里的资产（路径即 key）+ 无主通用 UI 图标
        const manifest = getTextureManifest();
        const keys = Object.keys(manifest);
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
            const path = manifest[key];
            this._loadTexture(key, path);
        }

        return this;
    }

    // 加载单个纹理时用于展示的短名（路径条目只显示文件名，避免加载日志过长）
    _displayName(key, path) {
        return key === path ? path.split('/').pop() : key;
    }

    _loadTexture(key, path) {
        const img = new Image();
        const name = this._displayName(key, path);

        img.onload = () => {
            this._textures.set(key, img);
            eventBus.emit(Events.TEXTURE_PROGRESS, { key, name, loaded: this._completed + 1, total: this._total, success: true });
            this._completed++;
            console.log(`[TextureManager] 已加载: ${name} (${this._completed}/${this._total})`);
            this._checkAllDone();
        };

        img.onerror = () => {
            eventBus.emit(Events.TEXTURE_PROGRESS, { key, name, loaded: this._completed + 1, total: this._total, success: false });
            this._completed++;
            console.error(`[TextureManager] 加载失败: ${name} → ${path} (${this._completed}/${this._total})`);
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
