'use strict';

import { eventBus, Events } from '../eventBus.js';
import { buildAudioManifest } from './audioConfig.js';

// 音乐淡入/淡出时长（秒）
const FADE_DURATION = 0.4;

// AudioCore 单例类 — 底层音频引擎
// 职责：AudioContext 管理、音频资源加载解码、音乐播放（循环+淡入淡出）、音量总线
class AudioCore {
    constructor() {
        if (AudioCore._instance) {
            return AudioCore._instance;
        }
        AudioCore._instance = this;

        this._ctx = null;            // AudioContext（懒创建，首次用户交互后 resume）
        this._buffers = new Map();   // 资源标识 → AudioBuffer
        this._total = 0;
        this._completed = 0;
        this._ready = false;

        // 音量总线：master → music / sfx（sfx 预留，供后续音效任务使用）
        this._masterGain = null;
        this._musicGain = null;
        this._sfxGain = null;

        // 当前音乐播放状态
        this._currentMusicKey = null;
        this._musicSource = null;
        this._musicGainNode = null;

        this._initContext();
        this._initUnlock();
    }

    // 创建 AudioContext 与音量总线
    _initContext() {
        if (this._ctx) {
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
            console.warn('[AudioCore] 当前浏览器不支持 Web Audio API，音频功能禁用');
            return;
        }
        this._ctx = new AC();

        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = 1.0;
        this._masterGain.connect(this._ctx.destination);

        this._musicGain = this._ctx.createGain();
        this._musicGain.gain.value = 1.0;
        this._musicGain.connect(this._masterGain);

        this._sfxGain = this._ctx.createGain();
        this._sfxGain.gain.value = 1.0;
        this._sfxGain.connect(this._masterGain);
    }

    // 浏览器自动播放策略：首次用户交互（点击/按键）时恢复 AudioContext
    _initUnlock() {
        const unlock = () => {
            if (this._ctx && this._ctx.state === 'suspended') {
                this._ctx.resume().catch((e) => {
                    console.warn('[AudioCore] AudioContext resume 失败:', e);
                });
            }
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('keydown', unlock);
    }

    // 开始加载并解码所有音频资源（与 textureManager.init 同构）
    init() {
        // 不支持 Web Audio API 时直接就绪，不阻塞加载流程
        if (!this._ctx) {
            this._ready = true;
            eventBus.emit(Events.AUDIO_READY, { total: 0, loaded: 0, failed: 0 });
            return this;
        }

        const manifest = buildAudioManifest();
        this._total = Object.keys(manifest).length;
        this._completed = 0;
        this._ready = false;

        if (this._total === 0) {
            this._ready = true;
            eventBus.emit(Events.AUDIO_READY, { total: 0, loaded: 0, failed: 0 });
            console.log('[AudioCore] 无音频资源需要加载');
            return this;
        }

        console.log('[AudioCore] 开始加载 ' + this._total + ' 个音频资源...');

        for (const id in manifest) {
            this._loadBuffer(id, manifest[id]);
        }

        return this;
    }

    // 加载并解码单个音频资源
    async _loadBuffer(id, path) {
        try {
            const res = await fetch(path);
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            const arrayBuffer = await res.arrayBuffer();
            const buffer = await this._ctx.decodeAudioData(arrayBuffer);
            this._buffers.set(id, buffer);
            this._completed++;
            console.log('[AudioCore] 已加载: ' + id + ' (' + this._completed + '/' + this._total + ')');
            eventBus.emit(Events.AUDIO_PROGRESS, {
                key: id,
                loaded: this._completed,
                total: this._total,
                success: true
            });
        } catch (e) {
            this._completed++;
            console.error('[AudioCore] 加载失败: ' + id + ' → ' + path, e);
            eventBus.emit(Events.AUDIO_LOAD_ERROR, { key: id, path });
            eventBus.emit(Events.AUDIO_PROGRESS, {
                key: id,
                loaded: this._completed,
                total: this._total,
                success: false
            });
        } finally {
            this._checkAllDone();
        }
    }

    // 全部加载完成检查
    _checkAllDone() {
        if (this._completed >= this._total) {
            this._ready = true;
            const loaded = this._buffers.size;
            const failed = this._total - loaded;
            console.log('[AudioCore] 全部完成 — 成功: ' + loaded + ', 失败: ' + failed);
            eventBus.emit(Events.AUDIO_READY, { total: this._total, loaded, failed });
        }
    }

    // 播放音乐：key 变化时先淡出旧曲再淡入新曲，无爆音切换
    // sceneKey 为音乐场景标识（如 'menu'），variantKey 为可选变体（如 'ksp1'/'ksp2'）
    playMusic(sceneKey, variantKey) {
        if (!this._ctx || !this._ready) {
            return; // 未就绪时静默跳过
        }
        const id = variantKey
            ? 'music:' + sceneKey + '_' + variantKey
            : 'music:' + sceneKey;
        if (id === this._currentMusicKey) {
            return; // 同一首音乐不重复切换
        }

        const buffer = this._buffers.get(id);
        if (!buffer) {
            console.warn('[AudioCore] 音乐资源未找到: ' + id);
            return;
        }

        // 停止旧曲
        this._stopMusicInternal();

        // 创建新曲播放节点
        const source = this._ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        // 独立增益节点，用于淡入淡出
        const gainNode = this._ctx.createGain();
        gainNode.gain.value = 0;
        gainNode.connect(this._musicGain);

        source.connect(gainNode);
        source.start();

        this._currentMusicKey = id;
        this._musicSource = source;
        this._musicGainNode = gainNode;

        // 淡入
        const now = this._ctx.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + FADE_DURATION);
    }

    // 停止音乐（淡出后停止）
    stopMusic() {
        this._stopMusicInternal();
    }

    // 内部实现：淡出并停止当前音乐
    _stopMusicInternal() {
        const source = this._musicSource;
        const gainNode = this._musicGainNode;

        if (source && gainNode) {
            const now = this._ctx.currentTime;
            try {
                gainNode.gain.cancelScheduledValues(now);
                gainNode.gain.setValueAtTime(gainNode.gain.value, now);
                gainNode.gain.linearRampToValueAtTime(0, now + FADE_DURATION);
            } catch (e) {
                // 忽略增益调度异常
            }
            setTimeout(() => {
                try {
                    source.stop();
                } catch (e) {
                    // 已停止时忽略
                }
                source.disconnect();
                gainNode.disconnect();
            }, FADE_DURATION * 1000 + 50);
        }

        this._currentMusicKey = null;
        this._musicSource = null;
        this._musicGainNode = null;
    }

    // === 音量设置（供后续设置面板调用，本次仅提供接口） ===

    setMasterVolume(v) {
        if (this._masterGain) {
            this._masterGain.gain.value = Math.max(0, Math.min(1, v));
        }
    }

    setMusicVolume(v) {
        if (this._musicGain) {
            this._musicGain.gain.value = Math.max(0, Math.min(1, v));
        }
    }

    setSfxVolume(v) {
        if (this._sfxGain) {
            this._sfxGain.gain.value = Math.max(0, Math.min(1, v));
        }
    }

    // === 查询 ===

    isReady() {
        return this._ready;
    }

    getProgress() {
        return { loaded: this._completed, total: this._total };
    }
}

// 导出单例实例
export const audioCore = new AudioCore();

// 在控制台暴露 audioCore，方便调试
if (typeof window !== 'undefined') {
    window.__audioCore = audioCore;
    console.log('[AudioCore] 单例已创建，可通过 window.__audioCore 访问');
}
