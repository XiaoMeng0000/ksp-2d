'use strict';

// 字体资源配置模块 — 数据驱动，所有字体在此声明
// key → 相对于项目根目录的字体文件路径（key 与 root.css 中 @font-face 的 font-family 一致）
//
// 尝鲜版档位（liteProfile.fontPreload = false）：清单清空 → fontManager 直接就绪，
// 界面回落到 root.css 里的系统等宽字体栈，不产生任何字体请求。

import { LITE_PROFILE } from './liteProfile.js';

const FULL_FONT_CONFIG = {
    'JetBrainsMono-Regular': 'assets/fonts/JetBrainsMapleMono/JetBrainsMapleMono-Regular.ttf',
    'JetBrainsMono-Bold': 'assets/fonts/JetBrainsMapleMono/JetBrainsMapleMono-Bold.ttf',
    'PixeledFont' : 'assets/fonts/Uranus_Pixel.ttf',
    'doto': 'assets/fonts/doto.ttf'
};

export const fontConfig = LITE_PROFILE.fontPreload ? FULL_FONT_CONFIG : {};
