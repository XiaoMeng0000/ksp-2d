'use strict';

// 音频资源配置模块 — 数据驱动，所有音频内容在此声明
// 目录约定：音乐放 assets/audio/bgm/，音效放 assets/audio/sfx/

// 音乐映射表：场景音乐标识 → { loop, variants }
// variants 为同一场景可选配的音乐变体（如菜单可切换 KSP1 / KSP2 两首）
export const musicMap = {
    menu: {
        loop: true,
        variants: {
            ksp1: { path: 'assets/audio/bgm/menu1.ogg' },
            ksp2: { path: 'assets/audio/bgm/menu2.ogg' }
        }
    }
    // TODO: 后续扩展飞行场景音乐，如 flight_star / flight_planet / deep_space 等
};

// 音效映射表：音效标识 → { path }
// 首期未实现音效，预留空结构，后续 UI 统一音效任务填充
export const sfxMap = {
    // TODO: 后续任务填充，如 ui_click / ui_hover 等
};

// 菜单音乐选择的 localStorage 存储键（设置界面写入）
export const MENU_MUSIC_STORAGE_KEY = 'ksp2d.menuMusic';

// 读取当前菜单音乐变体（默认 ksp1，与 menu1.ogg 对应）
export function getMenuMusicVariant() {
    if (typeof localStorage === 'undefined') {
        return 'ksp1';
    }
    return localStorage.getItem(MENU_MUSIC_STORAGE_KEY) || 'ksp1';
}

// 将 musicMap / sfxMap 展平为"资源标识 → 路径"清单，供 audioCore 统一加载
// 资源标识格式：'music:<sceneKey>_<variantKey>'（有变体）或 'music:<sceneKey>'（无变体）
export function buildAudioManifest() {
    const manifest = {};
    for (const sceneKey in musicMap) {
        const entry = musicMap[sceneKey];
        if (entry.variants) {
            for (const variantKey in entry.variants) {
                manifest['music:' + sceneKey + '_' + variantKey] = entry.variants[variantKey].path;
            }
        } else {
            manifest['music:' + sceneKey] = entry.path;
        }
    }
    for (const key in sfxMap) {
        manifest['sfx:' + key] = sfxMap[key].path;
    }
    return manifest;
}
