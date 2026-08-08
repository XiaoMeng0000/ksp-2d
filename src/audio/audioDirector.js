'use strict';

import { eventBus, Events } from '../eventBus.js';
import { audioCore } from './audioCore.js';
import { getMenuMusicVariant } from './audioConfig.js';
import { getMusicTypeForSOI } from '../physics/physics.js';
import { gameState } from '../gameState.js';
import { sceneManager } from '../sceneManager.js';

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

        // SOI 变化 → 飞行中切换宿主天体音乐
        eventBus.on(Events.SOI_CHANGED, ({ to }) => {
            if (sceneManager.getCurrentScene() === 'flight') {
                this._playFlightMusic();
            }
        });
    }

    // 场景切换处理：进入菜单播 BGM，进入飞行按天体类型播，进入追踪站播追踪音乐
    _handleSceneChanged(from, to) {
        if (to === 'menu') {
            // 读取设置界面选择的菜单音乐变体（KSP1 / KSP2）
            audioCore.playMusic('menu', getMenuMusicVariant());
        } else if (to === 'flight') {
            // 进入飞行：按宿主天体音乐分类播放
            this._playFlightMusic();
        } else if (to === 'tracking') {
            // 进入追踪站：播放追踪站音乐
            audioCore.playMusic('tracking');
        } else if (from === 'menu' || from === 'flight' || from === 'tracking') {
            // 离开需要音乐的场景 → 停止
            audioCore.stopMusic();
        }
    }

    // 飞行场景音乐：查询当前焦点物体（活动飞船优先，其次活动设施）宿主天体的音乐分类并播放
    // 设施模式下 activeShipId 为 null，需回退到 activeFacilityId 的宿主天体
    // 深空或暂无素材的分类会静默跳过（audioCore 已有容错）
    _playFlightMusic() {
        const ship = gameState.getActiveShip();
        let soiName = null;
        if (ship) {
            soiName = ship.currentSOI;
        } else {
            const fac = gameState.getActiveFacility();
            if (fac) {
                soiName = fac.currentSOI;
            }
        }
        if (!soiName) {
            audioCore.stopMusic();
            return;
        }
        const musicType = getMusicTypeForSOI(soiName);
        audioCore.playMusic('flight', musicType);
    }
}

// 导出单例实例
export const audioDirector = new AudioDirector();

// 在控制台暴露 audioDirector，方便调试
if (typeof window !== 'undefined') {
    window.__audioDirector = audioDirector;
    console.log('[AudioDirector] 单例已创建，可通过 window.__audioDirector 访问');
}
