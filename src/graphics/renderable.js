// 可渲染实体（Renderable）模块 — 预留特效接口
// 为未来的光晕、云层流动、星环等多层纹理叠加特效提供数据结构

class RenderableManager {
    constructor() {
        if (RenderableManager._instance) {
            return RenderableManager._instance;
        }
        RenderableManager._instance = this;
        this._registry = new Map();
    }

    // TODO: 注册一个可渲染实体配置
    // config 包含 layers 数组，每条 layer 定义纹理层和特效参数
    //
    // layer 数据结构：
    // {
    //     texture: string,      // textureConfig 中的 key
    //     alpha: number,        // 0~1 透明度
    //     blendMode: string,    // 'normal' | 'additive'（发光叠加）
    //     scale: number,        // 相对缩放倍率
    //     rotation: number,     // 旋转角度（弧度）
    //     uvOffset: {x, y},    // 纹理 UV 偏移（云层流动用）
    //     uvSpeed: {x, y}      // UV 偏移速度（云层流动用）
    // }
    //
    // 示例：
    // renderableManager.register('kerbol', {
    //     layers: [
    //         { texture: 'kerbol_base',  alpha: 1.0 },
    //         { texture: 'kerbol_glow',  alpha: 0.6, blendMode: 'additive', scale: 1.5 },
    //         { texture: 'kerbol_corona', alpha: 0.3, blendMode: 'additive', scale: 2.0 }
    //     ]
    // });
    // renderableManager.register('kerbin', {
    //     layers: [
    //         { texture: 'kerbin_surface' },
    //         { texture: 'kerbin_clouds', alpha: 0.4, uvSpeed: { x: 0.02, y: 0 } }
    //     ]
    // });
    register(key, config) {
        if (this._registry.has(key)) {
            console.warn(`[RenderableManager] 实体 ${key} 已注册，将被覆盖`);
        }
        this._registry.set(key, config);
    }

    // 返回注册的可渲染实体配置，不存在返回 null
    get(key) {
        return this._registry.get(key) || null;
    }

    // 返回 layers 数组，按 zIndex 排序，不存在返回 []
    getLayers(key) {
        const entity = this._registry.get(key);
        if (!entity || !entity.layers) return [];
        return [...entity.layers].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    }
}

export const renderableManager = new RenderableManager();

if (typeof window !== 'undefined') {
    window.__renderableManager = renderableManager;
    console.log('[RenderableManager] 单例已创建，可通过 window.__renderableManager 访问');
}
