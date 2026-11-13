'use strict';

// 尝鲜版（lite）资产档位 —— 只决定「加载什么」，不承载任何玩法逻辑。
//
// ⚠️ 本分支（`lite`）默认即为尝鲜版：LITE_PROFILE_DEFAULT = true。
//    全量版（含高清贴图、WebGL 渲染层、本地字体、全部 BGM）在 `main` 分支维护。
//
// 档位项：
//   menuStyle       菜单背景样式（null = 沿用设置面板里玩家的选择；'style1' = 强制纯星空）
//   bodyTextures    天体表面贴图（false = 渲染层走代表色纯色兜底，不加载任何天体贴图）
//   fontPreload     字体预加载（false = 不加载本地字体，改用系统等宽字体）
//   audioStartup    启动预载范围：'all' = 全量音频；'sfx' = 只预载音效，音乐按场景懒加载
//
// 约定：本文件只读，不写 GameState、不发事件、不碰 DOM。

const LITE_PROFILE_DEFAULT = true;

// 读取 URL 上的档位开关（`?profile=lite` 亦可显式开启，便于本地对照）
function _readUrlProfile() {
    if (typeof window === 'undefined' || !window.location) {
        return false;
    }
    const value = new URLSearchParams(window.location.search).get('profile');
    return value === 'lite';
}

const _enabled = LITE_PROFILE_DEFAULT || _readUrlProfile();

export const LITE_PROFILE = {
    enabled: _enabled,
    menuStyle: _enabled ? 'style1' : null,
    bodyTextures: !_enabled,
    fontPreload: !_enabled,
    audioStartup: _enabled ? 'sfx' : 'all'
};

// 是否处于尝鲜版档位
export function isLiteProfile() {
    return LITE_PROFILE.enabled;
}
