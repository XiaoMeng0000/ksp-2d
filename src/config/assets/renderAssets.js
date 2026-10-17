'use strict';

// ★★★ 本文件由 tools/importRenderAssets.mjs 生成 —— 禁止手改 ★★★
//
// 渲染资产配置（游戏侧消费端）。**按 family 泛化**：
//   · `families` 描述**每一类渲染资产**（kind / projection / ratio / suffix / tier）；
//   · `bodies[bodyId].families[famName]` 挂该类资产的**实际条目** —— 不写死 albedo，
//     将来加 biome / height / detail 只是多一条 family，**结构不用改**。
//
// ★ 半径语义：`screenRadiusPx` **一律按「外接球半径」解释** ★
//   球体 `circumscribedRatio = 1`；不规则体取 `src/config/world/bodyRenderShape.js`
//   里的 `circumscribedRatio`。换算：`physScreenR = screenRadiusPx × ratio`。
//   （不规则体没有单一屏幕半径 ⇒ 取外接球的上界才好做池准入与三段式归属。）
//
// ★ 形状参数**不在这里**：形状与资产分离，见 `src/config/world/bodyRenderShape.js`。
//   本文件**不得**出现 harmonics / segments / rings 等几何参数。

/**
 * family 声明表（每类资产的**元信息**，与具体天体无关）。
 * 加一类资产 ⇒ 这里多一条 + `bodies` 里多一条，**不改任何既有结构**。
 */
export const ASSET_FAMILIES = {
    "albedo": {
        "kind": "image",
        "projection": "equirect",
        "ratio": 2,
        "suffix": ".albedo.png",
        "tier": "w×h（实际像素，见条目）"
    }
};

/**
 * 按天体挂资产条目。
 * image family 条目：`{ path, w, h, sha256, tier }`
 * data  family 条目：`{ params, provenance }`
 */
export const RENDER_ASSETS = {
    "kerbin": {
        "families": {
            "albedo": {
                "path": "assets/images/celestial/kerbolar/render/kerbin.albedo.png",
                "w": 2048,
                "h": 1024,
                "sha256": "sha256:ea02fd8b7aaa5f501529922b188944a1abd53d77f6876679c56a935f49918035",
                "tier": "2048×1024"
            }
        }
    },
    "mun": {
        "families": {
            "albedo": {
                "path": "assets/images/celestial/kerbolar/render/mun.albedo.png",
                "w": 2048,
                "h": 1024,
                "sha256": "sha256:99d575969dedf6e73b71d0c742b07d648dd01a092bb55ff4f9bd403100f0c26b",
                "tier": "2048×1024"
            }
        }
    },
    "jool": {
        "families": {}
    }
};

/**
 * **缺资产**清单（显式）：每条含 bodyId + family + reason。
 * 消费方必须据此把该天体**排除出 WebGL 渲染**（不得静默、不得拿 null 冒充"有"）。
 */
export const RENDER_ASSETS_MISSING = [
    {
        "bodyId": "jool",
        "family": "albedo",
        "reason": "本批没有该天体的 albedo 源（只有 biome 图）⇒ **缺**，未生成（不伪造）"
    }
];

/** 已见但**不进本文件**的 family（data family 归形状表，资产/形状分离） */
export const RENDER_ASSETS_SKIPPED = [
    {
        "bodyId": "kerbin",
        "family": "shape",
        "reason": "data family 由 src/config/world/bodyRenderShape.js 接管（资产/形状分离）"
    },
    {
        "bodyId": "mun",
        "family": "shape",
        "reason": "data family 由 src/config/world/bodyRenderShape.js 接管（资产/形状分离）"
    },
    {
        "bodyId": "jool",
        "family": "shape",
        "reason": "data family 由 src/config/world/bodyRenderShape.js 接管（资产/形状分离）"
    }
];

/** 外接球半径语义（供消费方读取，避免只写在注释里） */
export const RADIUS_SEMANTICS = {
    "note": "`screenRadiusPx` 一律按**外接球半径**解释",
    "sphere": "circumscribedRatio = 1（见 bodyRenderShape.js）",
    "irregular": "取 bodyRenderShape.js 的 circumscribedRatio（= 1 + Σ|harmonics[].amp|）",
    "conversion": "physScreenR = screenRadiusPx × circumscribedRatio"
};
