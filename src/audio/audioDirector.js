'use strict';

import { eventBus, Events } from '../eventBus.js';
import { audioCore } from './audioCore.js';
import { getMenuMusicVariant } from './audioConfig.js';

// AudioDirector 单例类 — 决策层
// 职责：订阅事件总线，将游戏事件映射为音频播放动作
// 只消费事件，不 emit 任何业务事件，与业务层完全解耦
class AudioDirector {
    constructor() {
        if (AudioDirector._instance) {
            return AudioDirector._instance;
        }
        AudioDirector._instance = this;
        this._initSubscriptions();
    }

    // 订阅所有需要关注的游戏事件
    _initSubscriptions() {
        // 场景切换 → 场景音乐
        eventBus.on(Events.SCENE_CHANGED, ({ from, to }) => {
            this._handleSceneChanged(from, to);
        });
    }

    // 场景切换处理：进入菜单播 BGM，离开菜单停止
    // TODO: 后续扩展其他场景/天体类型音乐，如 flight 场景按宿主天体 type 分曲
    _handleSceneChanged(from, to) {
        if (to === 'menu') {
            // 读取设置界面选择的菜单音乐变体（KSP1 / KSP2）
            audioCore.playMusic('menu', getMenuMusicVariant());
        } else if (from === 'menu') {
            audioCore.stopMusic();
        }
    }
}

// 导出单例实例
export const audioDirector = new AudioDirector();

// 在控制台暴露 audioDirector，方便调试
if (typeof window !== 'undefined') {
    window.__audioDirector = audioDirector;
    console.log('[AudioDirector] 单例已创建，可通过 window.__audioDirector 访问');
}
