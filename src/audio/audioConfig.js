'use strict';

// 音频资源配置模块 — 数据驱动，所有音频内容在此声明
// 目录约定：音乐放 assets/audio/bgm/，音效放 assets/audio/sfx/

// 背景音乐总线增益（0~1）：总监定稿全曲目音量 = 默认的 3/4
// 注意：必须定义在 VOLUME_DEFAULTS 之前（其引用此常量）；设置面板音量调节复用 setMusicVolume 等接口
export const MUSIC_VOLUME = 0.75;

// 音乐映射表：场景音乐标识 → { loop, variants | byBodyType }
// variants 为同一场景可选配的音乐变体（如菜单可切换 KSP1 / KSP2 两首）
// byBodyType 为按宿主天体音乐分类选曲（飞行场景使用，key 与 CelestialBody.musicType 对应）
export const musicMap = {
    menu: {
        loop: true,
        variants: {
            ksp1: { path: 'assets/audio/bgm/menu1.ogg' },
            ksp2: { path: 'assets/audio/bgm/menu2.ogg' }
        }
    },
    // 飞行场景音乐：按宿主天体音乐分类选曲
    flight: {
        loop: true,
        byBodyType: {
            terrestrial: 'assets/audio/bgm/flight_terrestrial.ogg',
            mun: 'assets/audio/bgm/flight_mun.ogg',
            star: 'assets/audio/bgm/flight_star.ogg',
            rocky: 'assets/audio/bgm/flight_rocky.ogg',
            eve: 'assets/audio/bgm/flight_eve.ogg',
            duna: 'assets/audio/bgm/flight_duna.ogg',
            gas: 'assets/audio/bgm/flight_gas.ogg',
            ice: 'assets/audio/bgm/flight_ice.ogg'
        }
    },
    // 追踪站场景音乐
    tracking: {
        loop: true,
        path: 'assets/audio/bgm/tracking.ogg'
    }
};

// 音效映射表：音效标识 → { path } 或 { variants: { 变体: { path } } }
// variants 用于随机播放组（如 SOI 切换提示音两个变体随机播一个）
export const sfxMap = {
    // SOI 切换提示音：两个随机变体（当前控制飞船跨界时随机播一个）
    soi_change: {
        variants: {
            a: { path: 'assets/audio/sfx/soi_change_1.ogg' },
            b: { path: 'assets/audio/sfx/soi_change_2.ogg' }
        }
    },
    // UI 面板打开音效（除专属映射面板外统一使用）
    ui_panel_open: { path: 'assets/audio/sfx/ui_panel_open.ogg' },
    // UI 面板关闭音效（全部关闭路径统一使用）
    ui_panel_close: { path: 'assets/audio/sfx/ui_panel_close.ogg' },
    // ESC 菜单专属打开音效（panelOpenSfxMap 映射到 esc 面板）
    ui_esc_open: { path: 'assets/audio/sfx/ui_esc_open.ogg' },
    // UI 点击音效(普通/选中态变体通过 uiClickVariantConfig 变调变音量)
    ui_click: { path: 'assets/audio/sfx/ui_click.ogg' },
    // UI 悬停音效(音调走屏幕位置变调机制,见 getScreenPositionRate)
    ui_hover: { path: 'assets/audio/sfx/ui_hover.ogg' },
    // 时间加速档位激活音(点击/键盘切档;音调按档位映射见 getWarpSfxRate,1x=原调)
    warp: { path: 'assets/audio/sfx/warp.ogg' },
    // 时间加速档位悬停音(与激活音为独立文件;音调同样按档位映射)
    warp_hover: { path: 'assets/audio/sfx/warp_hover.ogg' },
    // 0x 暂停专属音效:进入暂停(激活)与取消暂停(恢复)各一,原调不变调
    warp_pause: { path: 'assets/audio/sfx/warp_pause.ogg' },
    warp_resume: { path: 'assets/audio/sfx/warp_resume.ogg' },
    // 机动节点提示音（0.3.0）：到达节点时刻 / 手动燃烧达成节点 Δv
    // （音频资产按《音频标准化流程》补充；文件缺失时 playSfx 静默跳过）
    maneuver_arrive: { path: 'assets/audio/sfx/maneuver_arrive.ogg' },
    maneuver_complete: { path: 'assets/audio/sfx/maneuver_complete.ogg' }
};

// 面板打开音效专属映射：面板 id → 音效 key
// 未映射的面板统一走 ui_panel_open；新增专属音效时在此加行
export const panelOpenSfxMap = {
    esc: 'ui_esc_open'
};

// 面板关闭音效静默映射：面板 id → true 表示该面板关闭不播放关闭音
// 总监要求：ESC 菜单关闭一律无声（手动关闭 / 伴随场景切换 / 互斥切换均静默）
export const panelCloseMuteMap = {
    esc: true
};

// 返回指定面板的打开音效完整资源标识（如 'sfx:ui_esc_open'）
// 未命中映射返回统一打开音效 'sfx:ui_panel_open'；供 audioDirector 查表播放
// 注意：与 getRandomSfxId 一致，返回值含 'sfx:' 前缀（manifest 键格式）
export function getPanelOpenSfxId(panelId) {
    return 'sfx:' + (panelOpenSfxMap[panelId] || 'ui_panel_open');
}

// 指定面板的关闭音效是否静默（true = 不播放关闭音）；供 audioDirector 查表
export function isPanelCloseMuted(panelId) {
    return !!panelCloseMuteMap[panelId];
}

// UI 点击音效变体配置：variant → { volume, rate }
// normal = 普通点击（原调全音量）；selected = 已被选中的选项再次点击（闷一点、小声一点）
// rate < 1 降调变闷（并同时变速，短音效无感知）
// 总监定稿：点击音效整体音量 = 默认的 3/4（normal 1.0→0.75，selected 0.6→0.45）
export const uiClickVariantConfig = {
    normal: { volume: 0.75, rate: 1 },
    selected: { volume: 0.45, rate: 0.85 }
};

// 返回点击音效变体播放参数（未知变体兜底 normal）
export function getUiClickPlayConfig(variant) {
    return uiClickVariantConfig[variant] || uiClickVariantConfig.normal;
}

// UI 悬停音效播放参数：悬停属背景性轻反馈；音调由位置变调机制决定
// 总监定稿：悬停音音量 = 初版(0.5)的 0.7 倍 → 0.35
export const uiHoverConfig = {
    volume: 0.35
};

// === 屏幕位置变调机制（正式引入：按钮从下到上的位置关系 → 音调高低） ===
// 供点击音效使用，后续按钮悬停音直接复用
// 规则：yRatio = 按钮中心 y / 视口高度（0=顶部，1=底部）
//       屏幕中间(0.5) = 1.0 原调，越往上越高、越往下越低（线性）
// 幅度约束：相对原调变化不超过 ±25% → rate ∈ [0.75, 1.25]
export const SCREEN_POSITION_RATE_MIN = 0.75;
export const SCREEN_POSITION_RATE_MAX = 1.25;

// 计算屏幕位置变调 rate（yRatio 越接近 0 越高、越接近 1 越低，中心恰为 1.0）
export function getScreenPositionRate(yRatio) {
    const r = Math.max(0, Math.min(1, yRatio));
    return SCREEN_POSITION_RATE_MAX - (SCREEN_POSITION_RATE_MAX - SCREEN_POSITION_RATE_MIN) * r;
}

// === 时间加速档位音效（激活 + 悬停共用映射，音调按档位倍率） ===
// 总监约定：1x（最左格）= 文件原调（rate 1.0）；向右（高倍率档）每格线性升高；
// 最右格（10,000,000x）= +50%（1.5）。总监定稿：初始 ±25% 区分度不足，改为 +50%
export const WARP_RATE_MAX = 1.5; // 最高档音调（相对原调 +50%）

// 档位序列（与 timeWarp.PANEL_RATES 一致）：1x 在最左，最高档在最右（第三格 = 4x）
export const WARP_RATE_VALUES = [1, 2, 4, 10, 50, 100, 1000, 10000, 100000, 1000000, 10000000];

// 档位变调映射：rateValue（档位倍率）→ 播放速率（按格序线性，1x=1.0 原调）
// 不在档位序列中的值（如 0x 暂停档）兜底原调
export function getWarpSfxRate(rateValue) {
    const idx = WARP_RATE_VALUES.indexOf(rateValue);
    if (idx < 0 || WARP_RATE_VALUES.length <= 1) {
        return 1;
    }
    return 1 + (idx / (WARP_RATE_VALUES.length - 1)) * (WARP_RATE_MAX - 1);
}

// 档位音效音量：激活（点击/键盘切换档位，含暂停/恢复）与悬停分开配置
// 0x 暂停/恢复使用专属音效（warp_pause / warp_resume，原调不变调）
export const warpSfxConfig = {
    activate: { volume: 0.75 }, // 激活反馈音量（与 UI 点击 normal 一致）
    hover: { volume: 0.35 },    // 悬停音量（与 UI 悬停音一致）
    pause: { volume: 0.75 },    // 进入暂停（0x 激活）专属音音量
    resume: { volume: 0.75 }    // 取消暂停（恢复）专属音音量（覆盖恢复档位激活音）
};

// === 音效通道映射（音量设置分类） ===
// sfx key → 音量通道：'ui'（UI 音效）/ 'comms'（坎巴拉人通讯音）
// 未来新分类（环境音/语音等）在此登记新通道，并在 audioCore 建对应总线
export const sfxChannelMap = {
    // UI 音效（点击/悬停/面板开关/时间加速档位）
    ui_panel_open: 'ui', ui_panel_close: 'ui', ui_esc_open: 'ui',
    ui_click: 'ui', ui_hover: 'ui',
    warp: 'ui', warp_hover: 'ui', warp_pause: 'ui', warp_resume: 'ui',
    // 坎巴拉人通讯音（SOI 切换提示 / 机动节点到达与完成提示等，后续事件通报/轨道警报均归此类）
    soi_change: 'comms',
    maneuver_arrive: 'comms',
    maneuver_complete: 'comms'
};

// 返回音效所属通道（未登记默认 'ui'）
export function getSfxChannel(key) {
    return sfxChannelMap[key] || 'ui';
}

// === 音量通道默认值与存储键（audioCore 启动应用 / 设置面板读写共用） ===
// 默认值：总 100% / 音乐 75%（既有 MUSIC_VOLUME）/ UI 100% / 通讯 100%（总监确认）
export const VOLUME_DEFAULTS = {
    master: 1,
    music: MUSIC_VOLUME,
    ui: 1,
    comms: 1
};

export const VOLUME_STORAGE_KEYS = {
    master: 'ksp2d.volume.master',
    music: 'ksp2d.volume.music',
    ui: 'ksp2d.volume.ui',
    comms: 'ksp2d.volume.comms'
};

// 读取指定通道的存储音量（0~1）；无存档/非法值回退默认值
export function getStoredVolume(channel) {
    const storageKey = VOLUME_STORAGE_KEYS[channel];
    const def = VOLUME_DEFAULTS[channel];
    if (typeof localStorage === 'undefined' || !storageKey) {
        return def;
    }
    const raw = localStorage.getItem(storageKey);
    if (raw === null) {
        return def;
    }
    const v = parseFloat(raw);
    return isNaN(v) ? def : Math.max(0, Math.min(1, v));
}

// 菜单音乐选择的 localStorage 存储键（设置界面写入）
export const MENU_MUSIC_STORAGE_KEY = 'ksp2d.menuMusic';

// 读取当前菜单音乐变体（默认 ksp2，与 menu2.ogg 对应）
export function getMenuMusicVariant() {
    if (typeof localStorage === 'undefined') {
        return 'ksp2';
    }
    return localStorage.getItem(MENU_MUSIC_STORAGE_KEY) || 'ksp2';
}

// 将 musicMap / sfxMap 展平为"资源标识 → 路径"清单，供 audioCore 统一加载
// 资源标识格式：'music:<sceneKey>_<variantKey>'（variants 或 byBodyType）或 'music:<sceneKey>'（无子项）
export function buildAudioManifest() {
    const manifest = {};
    for (const sceneKey in musicMap) {
        const entry = musicMap[sceneKey];
        if (entry.byBodyType) {
            // 按天体音乐分类选曲（飞行场景）
            for (const bodyType in entry.byBodyType) {
                const path = entry.byBodyType[bodyType];
                if (path) {
                    manifest['music:' + sceneKey + '_' + bodyType] = path;
                }
            }
        } else if (entry.variants) {
            // 可选音乐变体（菜单等场景）
            for (const variantKey in entry.variants) {
                manifest['music:' + sceneKey + '_' + variantKey] = entry.variants[variantKey].path;
            }
        } else {
            manifest['music:' + sceneKey] = entry.path;
        }
    }
    for (const key in sfxMap) {
        const entry = sfxMap[key];
        if (entry.variants) {
            // 多变体音效（如随机播放组）：sfx:<key>_<variant>
            for (const variantKey in entry.variants) {
                manifest['sfx:' + key + '_' + variantKey] = entry.variants[variantKey].path;
            }
        } else {
            manifest['sfx:' + key] = entry.path;
        }
    }
    return manifest;
}

// 返回指定音效的随机变体资源标识（如 'sfx:soi_change_a'）
// 无变体音效直接返回 'sfx:<key>'；供 audioDirector 随机选曲时使用
export function getRandomSfxId(key) {
    const entry = sfxMap[key];
    if (!entry || !entry.variants) {
        return 'sfx:' + key;
    }
    const variantKeys = Object.keys(entry.variants);
    const pick = variantKeys[Math.floor(Math.random() * variantKeys.length)];
    return 'sfx:' + key + '_' + pick;
}
