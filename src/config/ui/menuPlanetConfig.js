'use strict';

// 主菜单 WebGL 星球（v3）—— 构图对齐 assets/images/menu/background.png 的「巨球占右下 + 大气蓝边」。
// 所有可调项集中在此；场景层 menuPlanetLayer.js 只读本配置，不写魔法数。
//
// 尺寸口径：一律相对**主画布缓冲尺寸（设备像素）**；半径按外接球语义换算
// （physScreenR = screenRadiusPx × circumscribedRatio，球体 ratio = 1）。
// 盘心 y > 1 ⇒ 圆心在画布下方，只露出上缘巨球。
//
// v3：开启云层；大气在 kerbin 预设上降 intensity（默认 0.85）以减轻临边路径长导致的
//     地表雾化；受光面按总监要求加宽（保持左上亮、右下暗，ambient 仍为 0）。

import { ATMOSPHERE_PRESETS } from '../../planet/atmosphereLayer.js';
import { CLOUD_PRESETS } from '../../planet/cloudLayer.js';

export const MENU_PLANET_CONFIG = {
    // 天体 id（读 RENDER_ASSETS 的 albedo family；jool 缺 albedo，由层显式拦截）
    bodyId: 'kerbin',

    // 几何：R = radiusRatio × canvas.height；盘心 = (centerXRatio × W, centerYRatio × H)
    radiusRatio: 0.771,
    centerXRatio: 0.862,
    centerYRatio: 1.119,

    // 姿态与自转（v3 总监要求“动明显”：4–6°/s 档内取 5.0，原 2.0 太慢）
    tiltDeg: 23.4,
    spinDegPerSec: 5.0,

    // 大气：kerbin 预设 + 降 intensity（0.85 → 0.55）。保留蓝色临边，但减轻地表雾化。
    atmosphereEnabled: true,
    terminatorSoftDeg: 18.5,
    atmosphere: Object.assign({}, ATMOSPHERE_PRESETS.kerbin, { intensity: 0.55 }),

    // 云：kerbin 预设 + 适度覆盖率（默认 0.11 → 0.16），云可见但不盖满陆地
    cloudEnabled: true,
    clouds: Object.assign({}, CLOUD_PRESETS.kerbin, { coverage: 0.16, opacity: 0.62 }),
    cloudOrder: 'below',

    // 光照：对齐 background.png 的太阳位置（上缘偏左的临边）—— 亮面在可见面的左/上方，
    // 右侧/下方为暗面；环境光 0 ⇒ 暗面纯黑，只留亮面与大气临边。
    // 约定：x 正 = 屏幕右、y 正 = 屏幕上；[-0.7, 0.4, 0.30] = 左-上-略靠星球背面。
    // v3 最终用 z=0.30（受光面约占可见盘面 65%）；备选 C1 用 z=0.50（约 50%）。
    // 实测：z 取负/朝相机时整个可见面都会被照亮、晨昏线消失；z 取正才保留右下暗面。
    lighting: {
        ambient: 0,
        diffuse: 0.95,
        edgeDarkening: 0.05,
        nightLimbFade: 1,
        nightLimbFadeWidth: 0.55,
        sunDir: [-0.7, 0.4, 0.30],
    },

    // 地表起伏（卡2）：法线图强度，1.0 = 该天体 p95 坡度 45° 的归一口径；
    // 实际生效强度 = normalStrength × 逐群系 relief（relief 来自 src/config/biomeRelief.js，海洋/滨海 = 0），
    // 且仅当 menuPlanetLayer 成功挂上 normalMapPath 后生效（渲染器无图强制 0）。
    normalStrength: 1.0,

    // 地形法线图（不进 RENDER_ASSETS 校验链；缺文件只告警一次，菜单照常）
    normalMapPath: 'assets/images/celestial/kerbolar/render/kerbin.normal.png',

    // albedo 纹理选项（资产原样上传，不重编码/缩放；等距柱状 2:1）
    albedoTexture: {
        mipmap: true,
        filter: 'linear',
        repeatX: true,
        repeatY: false,
        flipY: false,
        anisotropy: 8,
    },
};
