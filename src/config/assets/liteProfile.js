'use strict';

// 尝鲜版（lite）资产档位 —— 只决定「加载什么」，不承载任何玩法逻辑。
//
// 全量版（默认）：全部开启，行为与引入本档位之前完全一致。
// 尝鲜版：`?profile=lite`（或构建期把 LITE_PROFILE_DEFAULT 改为 true）→ 关闭高清资产。
//
// 档位项：
//   menuStyle       菜单背景样式（null = 沿用设置面板里玩家的选择；'style1' = 强制纯星空）
//   bodyTextures    天体表面贴图（false = 渲染层走代表色纯色兜底，不加载任何天体贴图）
//   fontPreload     字体预加载（false = 不加载本地字体，改用系统等宽字体）
//   audioStartup    启动预载范围：'all' = 全量音频；'sfx' = 只预载音效，音乐按场景懒加载
//   musicWhitelist  音乐清单白名单（null = 全量；数组 = 只保留这些资源标识，其余从清单剔除）
//
// 约定：本文件只读，不写 GameState、不发事件、不碰 DOM。

const LITE_PROFILE_DEFAULT = false;

// 读取 URL 上的档位开关（`?profile=lite`）
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
    audioStartup: _enabled ? 'sfx' : 'all',
    // 尝鲜版只带菜单曲与飞行通用曲；追踪站复用飞行曲（路径重映射见 audioConfig.buildAudioManifest）
    musicWhitelist: _enabled
        ? ['music:menu_ksp1', 'music:flight_terrestrial', 'music:tracking']
        : null
};

// 是否处于尝鲜版档位
export function isLiteProfile() {
    return LITE_PROFILE.enabled;
}
