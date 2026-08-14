'use strict';

// 音频资源配置模块 — 数据驱动，所有音频内容在此声明
// 目录约定：音乐放 assets/audio/bgm/，音效放 assets/audio/sfx/

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
    }
};

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
