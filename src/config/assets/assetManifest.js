'use strict';

// 资产清单聚合层（0.3.0）— 数据驱动的纹理清单来源
//
// 职责：把两类纹理会合为 textureManager 的加载清单
//   1. 「有实体归属」的资产 —— 就近声明在各实体配置里（天体贴图 / 模块图标 / 能力图标
//      / 设施图标 / 舱室图标 / 飞船两态船体图），本模块自动收集，无需手工登记
//   2. 「无主」的通用 UI 图标 —— 仍集中声明在 graphics/textureConfig.js
//      （菜单 / ESC / SAS / 时间轴 / 设施与飞船的通用兜底图等，无实体归属可挂）
//
// 约定：
//   - 实体资产在清单中的 key = 其「项目根相对路径」本身，消费层拿到路径直接
//     textureManager.get(path) 取图，不再有「短 key → 路径」的间接层与约定拼接
//   - 通用 UI 图标沿用原有短 key（如 'icon_sas'），两类 key 不会冲突（路径必含 '/'）
//   - 同一路径被多个实体引用（如设施与其舱室共用一张图）时自动去重，只加载一次

import { textureConfig } from './textureConfig.js';
import { solarSystemData } from '../world/starSystemIndex.js';
import { SHIP_TEMPLATES } from '../entities/shipTemplates.js';
import { getAllModules, getAllCapabilityToolbars } from '../entities/moduleTypes.js';
import { getAllFacilityTypes, getAllCompartments } from '../entities/facilityTypes.js';

// 构建纹理加载清单：{ 清单 key → 图片路径 }
// 注意：遍历的是全量星系静态数据（starSystemRegistry 的超集），与当前激活星系无关，
//       保证切换到任意星系组合后天体渲染层都已注册，不依赖加载时机
export function buildTextureManifest() {
    const manifest = {};

    // ===== 一、无主通用 UI 图标（原样沿用短 key） =====
    for (const key of Object.keys(textureConfig)) {
        manifest[key] = textureConfig[key];
    }

    // ===== 二、有实体归属的资产（路径即 key，重复路径自动去重） =====
    const addPath = (path) => {
        if (typeof path === 'string' && path) {
            manifest[path] = path;
        }
    };

    // 天体表面贴图
    for (const body of solarSystemData) {
        addPath(body.texture);
    }

    // 飞船模块图标
    for (const mod of getAllModules()) {
        addPath(mod.iconTexture);
    }

    // 飞船能力工具栏图标（部署设施 / 货仓 / 资源扫描）
    for (const toolbar of getAllCapabilityToolbars()) {
        addPath(toolbar.iconTexture);
    }

    // 设施类型图标
    for (const type of getAllFacilityTypes()) {
        addPath(type.iconTexture);
    }

    // 设施舱室图标
    for (const compartment of getAllCompartments()) {
        addPath(compartment.iconTexture);
    }

    // 飞船船体图（两态，均为可选项：未配置则走 textureConfig 的通用兜底图）
    for (const template of SHIP_TEMPLATES) {
        const textures = template.textures;
        if (textures) {
            addPath(textures.active);
            addPath(textures.inactive);
        }
    }

    return manifest;
}

// 进程内缓存的清单（清单完全由静态配置推导，运行期不变，无需重复构建）
let _cachedManifest = null;

// 获取纹理清单（textureManager 加载用）
export function getTextureManifest() {
    if (!_cachedManifest) {
        _cachedManifest = buildTextureManifest();
    }
    return _cachedManifest;
}

// 取某清单 key 对应的图片路径（供需要 URL 字符串的场景，如 CSS mask-image）
// 未知 key 原样返回（路径类 key 传入即得自身），调用方无需自行拼路径
export function getTexturePath(key) {
    if (!key) return null;
    return getTextureManifest()[key] || key;
}
