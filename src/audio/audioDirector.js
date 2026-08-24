'use strict';

import { eventBus, Events } from '../eventBus.js';
import { audioCore } from './audioCore.js';
import { getMenuMusicVariant, getRandomSfxId, getPanelOpenSfxId, isPanelCloseMuted, getUiClickPlayConfig, getScreenPositionRate, uiHoverConfig, getWarpSfxRate, warpSfxConfig } from './audioConfig.js';
import { getMusicTypeForSOI } from '../physics/physics.js';
import { gameState } from '../gameState.js';
import { sceneManager } from '../sceneManager.js';

// UI 关闭音效延迟窗口（毫秒）：双重作用
// 1) 去抖：窗口内多笔关闭事件（如场景切换批量 hidePanel）合并为一声
// 2) 切换抑制：关闭后紧接着打开面板（如 ESC→设置 互斥切换）时取消关闭音，只响打开音
const UI_CLOSE_SFX_DELAY_MS = 120;

// 场景切换静默窗口（毫秒）：切换瞬间起对面板关闭事件静默
// 场景切换引发的面板自动关闭（如 flightUI 批量 hidePanel）不响关闭音；用户主动开/关不受影响
const SCENE_SWITCH_SILENT_MS = 400;

// UI 点击音效延迟窗口（毫秒）：面板音让位机制
// 点击后窗口内触发面板开/关 → 取消点击音，只响面板音（方案 A）；纯按钮点击窗口到期播放点击音
const UI_CLICK_SFX_DELAY_MS = 80;

// AudioDirector 单例类 — 决策层
// 职责：订阅事件总线，将游戏事件映射为音频播放动作
// 只消费事件，不 emit 任何业务事件，与业务层完全解耦
class AudioDirector {
    constructor() {
        if (AudioDirector._instance) {
            return AudioDirector._instance;
        }
        AudioDirector._instance = this;
        this._closeSfxTimer = null; // 关闭音效延迟播放定时器（去抖 + 切换抑制共用）
        this._clickSfxTimer = null; // 点击音效延迟播放定时器（面板音让位共用）
        this._sceneSilentUntil = 0; // 场景切换静默截止时间戳（期间关闭事件静默）
        this._initSubscriptions();
    }

    // 订阅所有需要关注的游戏事件
    _initSubscriptions() {
        // 场景切换 → 场景音乐；切换瞬间开启静默窗口（自动关闭的面板不响关闭音）
        // 点击音不受场景切换影响（总监要求）：仅取消排队关闭音，不取消待播点击音
        eventBus.on(Events.SCENE_CHANGED, ({ from, to }) => {
            // 取消已排队的关闭音（紧邻切换前发生的面板关闭，如读档关闭开始游戏面板）
            this._cancelQueuedCloseSfx();
            this._sceneSilentUntil = Date.now() + SCENE_SWITCH_SILENT_MS;
            this._handleSceneChanged(from, to);
        });

        // SOI 变化 → 飞行中切换宿主天体音乐；当前控制飞船跨界时播放 SOI 切换音效
        eventBus.on(Events.SOI_CHANGED, ({ shipId }) => {
            if (sceneManager.getCurrentScene() !== 'flight') {
                return;
            }
            const ship = gameState.getActiveShip();
            if (ship && ship.id === shipId) {
                // 当前控制飞船发生 SOI 切换 → 随机播放两个变体之一
                audioCore.playSfx(getRandomSfxId('soi_change'));
            }
            this._playFlightMusic();
        });

        // UI 面板打开 → 查表播放（esc 专属打开音效，其余面板统一打开音效）
        // 打开前取消待播关闭音：互斥切换（关一个开一个）只响打开音
        // 打开前取消待播点击音：面板音让位（方案 A，点击伴随面板打开时只响面板音）
        eventBus.on(Events.UI_PANEL_OPENED, ({ panelId }) => {
            this._cancelQueuedCloseSfx();
            this._cancelQueuedClickSfx();
            audioCore.playSfx(getPanelOpenSfxId(panelId));
        });

        // UI 面板关闭 → 延迟播放统一关闭音（窗口内批量合并 / 紧接打开则取消）
        // 场景切换静默窗口内忽略：切场景引起的自动关闭不响，仅用户主动开/关有声
        // 静默清单内面板（如 ESC 菜单）关闭一律不发声（总监要求）
        // 注意：此处不取消点击音——让位判定推迟到点击音到期时检查关闭音是否仍在排队（方案 A 细化）
        eventBus.on(Events.UI_PANEL_CLOSED, ({ panelId }) => {
            if (isPanelCloseMuted(panelId)) {
                return;
            }
            if (Date.now() < this._sceneSilentUntil) {
                return;
            }
            this._queueCloseSfx();
        });

        // UI 点击 → 延迟播放点击音（80ms 窗口内出现面板开/关则取消，方案 A 面板音让位）
        // 音调 = 变体率 × 按钮位置变调（屏幕中间原调，越上越高越下越低，幅度 ±25%）
        eventBus.on(Events.UI_CLICKED, ({ variant, yRatio }) => {
            this._queueClickSfx(variant, yRatio);
        });

        // UI 悬停 → 立即播放悬停音（轻反馈，不延迟不让位）
        // 音调 = 位置变调（与点击音一致：屏幕中间原调，±25% 幅度）
        eventBus.on(Events.UI_HOVERED, ({ yRatio }) => {
            audioCore.playSfx('sfx:ui_hover', uiHoverConfig.volume, getScreenPositionRate(yRatio));
        });

        // 时间加速档位激活（点击档位格与键盘快捷键统一汇入 TIME_WARP_CHANGED）
        // 0x 进入暂停 → warp_pause 专属音（原调）；
        // 取消暂停（恢复）→ warp_resume 专属音，覆盖恢复档位（含 1x）的激活音；
        // 其他档位切换 → warp 激活音（按档位变调，1x=原调）
        eventBus.on(Events.TIME_WARP_CHANGED, ({ rate, paused, wasPaused }) => {
            if (paused) {
                audioCore.playSfx('sfx:warp_pause', warpSfxConfig.pause.volume, 1);
                return;
            }
            if (wasPaused) {
                // 取消暂停(恢复)→ 专属音，不再播恢复档位的激活音
                audioCore.playSfx('sfx:warp_resume', warpSfxConfig.resume.volume, 1);
                return;
            }
            audioCore.playSfx('sfx:warp', warpSfxConfig.activate.volume, getWarpSfxRate(rate));
        });

        // 时间加速档位格悬停 → 独立悬停音频（warp_hover），音调按档位映射（与激活音同映射规则）
        eventBus.on(Events.UI_WARP_HOVERED, ({ rate }) => {
            audioCore.playSfx('sfx:warp_hover', warpSfxConfig.hover.volume, getWarpSfxRate(rate));
        });
    }

    // 排队点击音效：窗口期内重触发重置（快速连点合并为最后一声）
    // 方案 A 细化让位（总监拍板）：到期时关闭音仍排队（将真实播放）→ 点击音让位；
    // 关闭音已被静默/取消（如场景切换吞掉）→ 点击音照播，不受切换影响
    _queueClickSfx(variant, yRatio) {
        if (this._clickSfxTimer) {
            clearTimeout(this._clickSfxTimer);
        }
        this._clickSfxTimer = setTimeout(() => {
            this._clickSfxTimer = null;
            if (this._closeSfxTimer) {
                return; // 关闭音将响 → 点击音让位
            }
            const cfg = getUiClickPlayConfig(variant);
            const rate = cfg.rate * getScreenPositionRate(yRatio);
            audioCore.playSfx('sfx:ui_click', cfg.volume, rate);
        }, UI_CLICK_SFX_DELAY_MS);
    }

    // 取消待播点击音（面板开/关或场景切换时调用：面板音/切换静默让位）
    _cancelQueuedClickSfx() {
        if (this._clickSfxTimer) {
            clearTimeout(this._clickSfxTimer);
            this._clickSfxTimer = null;
        }
    }

    // 排队关闭音效：窗口期内多笔关闭合并为一声，延迟播放在窗口结束时执行
    _queueCloseSfx() {
        if (this._closeSfxTimer) {
            clearTimeout(this._closeSfxTimer);
        }
        this._closeSfxTimer = setTimeout(() => {
            this._closeSfxTimer = null;
            audioCore.playSfx('sfx:ui_panel_close');
        }, UI_CLOSE_SFX_DELAY_MS);
    }

    // 取消待播关闭音（面板打开时调用：关+开切换只响打开音）
    _cancelQueuedCloseSfx() {
        if (this._closeSfxTimer) {
            clearTimeout(this._closeSfxTimer);
            this._closeSfxTimer = null;
        }
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
