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
        "repeat": false,
        "suffix": ".albedo.png",
        "tier": "w×h（实际像素，见条目）"
    },
    "detail": {
        "kind": "image",
        "projection": "tile",
        "ratio": 1,
        "repeat": true,
        "suffix": ".detail.png",
        "tier": "w×h（实际像素，见条目）"
    },
    "biome": {
        "kind": "image",
        "projection": "equirect",
        "ratio": 2,
        "repeat": false,
        "suffix": ".biome.png",
        "tier": "w×h（实际像素，见条目）"
    },
    "biomeStyles": {
        "kind": "data",
        "note": "逐群系细节风格（detailStrength/detailScale/material），由资产包导入"
    }
};

/**
 * 按天体挂资产条目。
 * image family 条目：`{ path, projection, ratio, w, h, sha256, tier }`
 * data  family 条目：`{ params, provenance }`（如 biomeStyles）
 */
export const RENDER_ASSETS = {
    "kerbin": {
        "families": {
            "albedo": {
                // ⚠️ 2026-10-17 组长授权手改：kerbin albedo 升 4096 档（tier 接线未做，下次工具导入会覆盖）
                "path": "assets/images/celestial/kerbolar/render/kerbin.albedo.png",
                "projection": "equirect",
                "ratio": 2,
                "w": 4096,
                "h": 2048,
                "sha256": "sha256:586518e2b89d17c19bd01410df636b0a06bdb9812a10abaea90b0d177b3ace87",
                "tier": "4096×2048"
            },
            "detail": {
                "path": "assets/images/celestial/kerbolar/render/kerbin.detail.png",
                "projection": "tile",
                "ratio": 1,
                "w": 512,
                "h": 512,
                "sha256": "sha256:e19d9de5329d7114e25d623057f5bfe67fc675e884e3bac30e64ee9257a4fffc",
                "tier": "512×512"
            },
            "biome": {
                "path": "assets/images/celestial/kerbolar/render/kerbin.biome.png",
                "projection": "equirect",
                "ratio": 2,
                "w": 2048,
                "h": 1024,
                "sha256": "sha256:2ba774395b4748363374fb1177bf7a52a16eaeb59899a4635efbcd4abe6ea34f",
                "tier": "2048×1024"
            },
            "biomeStyles": {
                "params": {
                    "biomes": [
                        {
                            "detailStrength": 0,
                            "detailScale": 1,
                            "material": {
                                "f0": 0.08,
                                "rough": 0.44,
                                "waveDeg": 0.5,
                                "waveScale": 4
                            }
                        },
                        {
                            "detailStrength": 0,
                            "detailScale": 1,
                            "material": {
                                "f0": 0.08,
                                "rough": 0.47,
                                "waveDeg": 0.5,
                                "waveScale": 4
                            }
                        },
                        {
                            "detailStrength": 1,
                            "detailScale": 1
                        },
                        {
                            "detailStrength": 1,
                            "detailScale": 1
                        },
                        {
                            "detailStrength": 1,
                            "detailScale": 1
                        },
                        {
                            "detailStrength": 1,
                            "detailScale": 1
                        }
                    ]
                },
                "provenance": [
                    "data/planet-src/kerbin/palette-map.json",
                    "data/planet-src/kerbin/biome-styles.json"
                ]
            }
        }
    },
    "mun": {
        "families": {
            "albedo": {
                "path": "assets/images/celestial/kerbolar/render/mun.albedo.png",
                "projection": "equirect",
                "ratio": 2,
                "w": 2048,
                "h": 1024,
                "sha256": "sha256:99d575969dedf6e73b71d0c742b07d648dd01a092bb55ff4f9bd403100f0c26b",
                "tier": "2048×1024"
            },
            "detail": {
                "path": "assets/images/celestial/kerbolar/render/mun.detail.png",
                "projection": "tile",
                "ratio": 1,
                "w": 512,
                "h": 512,
                "sha256": "sha256:807903968ca04f1a9336c1d6023150dd9b78d6bb3b6b5870abfbd13edb389b3c",
                "tier": "512×512"
            },
            "biome": {
                "path": "assets/images/celestial/kerbolar/render/mun.biome.png",
                "projection": "equirect",
                "ratio": 2,
                "w": 2048,
                "h": 1024,
                "sha256": "sha256:2158f2935d1d7c7167f9524757908f1976bfb821bf0b65d3ae9613eb0515474b",
                "tier": "2048×1024"
            },
            "biomeStyles": {
                "params": {
                    "biomes": [
                        {
                            "detailStrength": 0.96,
                            "detailScale": 1.35
                        },
                        {
                            "detailStrength": 1.28,
                            "detailScale": 1
                        },
                        {
                            "detailStrength": 1.728,
                            "detailScale": 0.72
                        },
                        {
                            "detailStrength": 0.704,
                            "detailScale": 1.5
                        }
                    ]
                },
                "provenance": [
                    "data/planet-src/mun/palette-map.json",
                    "data/planet-src/mun/biome-styles.json"
                ]
            }
        }
    },
    "jool": {
        "families": {
            "biome": {
                "path": "assets/images/celestial/kerbolar/render/jool.biome.png",
                "projection": "equirect",
                "ratio": 2,
                "w": 64,
                "h": 32,
                "sha256": "sha256:08ad7b237c4bbb0f46a761b87e6f0b8942cf205c92c70cfedeb344c6fd8f18d4",
                "tier": "64×32"
            },
            "biomeStyles": {
                "params": {
                    "biomes": [
                        {
                            "detailStrength": 0,
                            "detailScale": 1
                        }
                    ]
                },
                "provenance": [
                    "data/planet-src/jool/palette-map.json",
                    "data/planet-src/jool/biome-styles.json"
                ]
            }
        }
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
    },
    {
        "bodyId": "jool",
        "family": "detail",
        "reason": "无源文件"
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
