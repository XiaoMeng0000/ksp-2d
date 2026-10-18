'use strict';

// 主菜单 WebGL 星球层（场景层单例）—— 渲染层无业务逻辑：
//   · 只读 menuPlanetConfig 与渲染资产配置，不读 GameState / eventBus / sceneManager；
//   · 整屏透明层：离屏 WebGL2 画布 → 渲染器（transparent）→ 每帧一次 drawImage 合成进主画布；
//   · 首进建一次（单槽初始化成本高，不能每进一次菜单重建）；
//   · exit 只停渲染并 releaseTargets，保留渲染器/贴图/上下文供重进复用，不 dispose。
//
// 生命周期：enter(mainCanvas) / update(dt) / render(ctx) / exit()。

import { createGLContext } from '../glCore/context.js';
import { createPlanetRenderer } from '../planet/meshRenderer.js';
import { RENDER_ASSETS, RENDER_ASSETS_MISSING } from '../config/assets/renderAssets.js';
import { toCircumscribedScreenR } from '../config/world/bodyRenderShape.js';
import { MENU_PLANET_CONFIG } from '../config/ui/menuPlanetConfig.js';
import { BIOME_RELIEF, resolveBiomeReliefArray } from '../config/biomeRelief.js';

const LOG_TAG = '[MenuPlanet]';

let _mainCanvas = null;      // 主画布（Canvas2D）
let _glCanvas = null;        // 离屏 WebGL2 画布（缓冲尺寸与主画布一致）
let _gl = null;
let _renderer = null;
let _ready = false;          // 上下文 + 渲染器创建成功
let _failed = false;         // 初始化/渲染失败（不再重试，菜单照常）
let _contextLost = false;
let _albedoReady = false;
let _sizeKey = '';
let _spinDeg = 0;
let _lastDt = 0;
let _detailRequested = false;   // 细节层只请求一次（失败也不反复刷屏）
let _normalRequested = false;   // 法线图只请求一次（失败也不反复刷屏）
const _warned = new Set();

// 细节层参数（来自实验室 kerbin biome-styles.json 的 detail 配置；主游戏侧固定接线）
const DETAIL_TILES = 6;
const DETAIL_WARP_AMOUNT = 0.30;
const DETAIL_COARSE_WEIGHT = 0.45;

// 法线图路径（卡2，主游戏侧固定接线，同 DETAIL_* 约定）：不进 RENDER_ASSETS 校验链；
// 渲染器在没挂图时会把起伏强度强制归零，缺文件只告警一次、菜单星球照常。
const NORMAL_MAP_PATH = 'assets/images/celestial/kerbolar/render/kerbin.normal.png';

// 失效路径非静默，但同一原因只告警一次，避免逐帧刷屏
function _warnOnce(reason) {
    if (_warned.has(reason)) return;
    _warned.add(reason);
    console.warn(LOG_TAG + ' ' + reason);
}

function _errorText(e) {
    return (e && e.message) ? e.message : String(e);
}

// 上下文丢失统一入口：事件与渲染前检查都走这里，保证同一原因只告警一次
function _markContextLost() {
    if (_contextLost) return;
    _contextLost = true;
    _warnOnce('WebGL 上下文丢失（context lost），菜单星球层停止渲染');
}

// 显式查缺资产清单（RENDER_ASSETS_MISSING）：缺 albedo 的天体（如 jool）不得进入渲染
function _findAlbedoPath(bodyId) {
    const missing = RENDER_ASSETS_MISSING.find((item) => item.bodyId === bodyId && item.family === 'albedo');
    if (missing) {
        _warnOnce('缺资产，菜单星球层停用：bodyId=' + bodyId + ' family=albedo reason=' + missing.reason);
        return null;
    }
    const body = RENDER_ASSETS[bodyId];
    const family = body && body.families ? body.families.albedo : null;
    if (!family || !family.path) {
        _warnOnce('缺资产，菜单星球层停用：bodyId=' + bodyId + ' family=albedo（RENDER_ASSETS 无该条目）');
        return null;
    }
    return family.path;
}

function _loadAlbedo(path) {
    const bodyId = MENU_PLANET_CONFIG.bodyId;
    const img = new Image();
    img.onload = () => {
        if (!_renderer || _contextLost || _failed) return;
        if (img.naturalWidth !== img.naturalHeight * 2) {
            _warnOnce('资产非 2:1 等距柱状：bodyId=' + bodyId + ' family=albedo path=' + path);
        }
        try {
            // 顺序硬性：setAlbedo → setPlanet（含 anisotropy）→ setDetail
            _renderer.setAlbedo(img, Object.assign({}, MENU_PLANET_CONFIG.albedoTexture));
            _albedoReady = true;
            _applyPlanetParams(Math.max(1, _mainCanvas.width | 0), Math.max(1, _mainCanvas.height | 0));
            _loadDetail();
            _loadNormalMap();
        } catch (e) {
            _warnOnce('albedo 上传失败（bodyId=' + bodyId + ' family=albedo path=' + path + '）：' + _errorText(e));
        }
    };
    img.onerror = () => {
        _warnOnce('贴图加载失败，菜单星球层停用：bodyId=' + bodyId + ' family=albedo path=' + path);
    };
    img.src = path;
}

// 细节层（detail + biome + biomeStyles）：缺任何一项都显式告警，不静默降级
function _loadDetail() {
    if (_detailRequested || !_renderer || _contextLost || _failed) return;
    _detailRequested = true;
    const bodyId = MENU_PLANET_CONFIG.bodyId;
    const families = (RENDER_ASSETS[bodyId] && RENDER_ASSETS[bodyId].families) || {};
    const detailEntry = families.detail;
    const biomeEntry = families.biome;
    const stylesEntry = families.biomeStyles;
    const styles = stylesEntry && stylesEntry.params ? stylesEntry.params.biomes : null;

    if (!detailEntry || !detailEntry.path) {
        _warnOnce('缺 detail 资产，细节层停用：bodyId=' + bodyId
            + ' family=detail（RENDER_ASSETS 无该条目或 path）');
        return;
    }
    if (!biomeEntry || !biomeEntry.path) {
        _warnOnce('缺 biome 资产，细节层停用：bodyId=' + bodyId
            + ' family=biome（RENDER_ASSETS 无该条目或 path）');
        return;
    }
    if (!Array.isArray(styles) || !styles.length) {
        _warnOnce('缺 biomeStyles 数据，细节层停用：bodyId=' + bodyId
            + ' family=biomeStyles（RENDER_ASSETS 无 params.biomes）');
        return;
    }
    if (detailEntry.projection !== 'tile') {
        _warnOnce('detail projection 不符，细节层停用：bodyId=' + bodyId
            + ' family=detail projection=' + detailEntry.projection + '（要求 tile）');
        return;
    }
    if (biomeEntry.projection !== 'equirect') {
        _warnOnce('biome projection 不符，细节层停用：bodyId=' + bodyId
            + ' family=biome projection=' + biomeEntry.projection + '（要求 equirect）');
        return;
    }

    const load = (path, famName) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('加载失败：bodyId=' + bodyId + ' family=' + famName + ' path=' + path));
        img.src = path;
    });

    Promise.all([load(detailEntry.path, 'detail'), load(biomeEntry.path, 'biome')])
        .then(([detailImage, biomeImage]) => {
            if (!_renderer || _contextLost || _failed) return;
            if (detailImage.naturalWidth !== detailImage.naturalHeight) {
                _warnOnce('detail 运行期尺寸不符，细节层停用：bodyId=' + bodyId
                    + ' family=detail 实测 ' + detailImage.naturalWidth + '×' + detailImage.naturalHeight
                    + '（projection=tile 要求 1:1）');
                return;
            }
            if (biomeImage.naturalWidth !== biomeImage.naturalHeight * 2) {
                _warnOnce('biome 运行期尺寸不符，细节层停用：bodyId=' + bodyId
                    + ' family=biome 实测 ' + biomeImage.naturalWidth + '×' + biomeImage.naturalHeight
                    + '（projection=equirect 要求 2:1）');
                return;
            }
            try {
                _renderer.setDetail({
                    detailImage,
                    biomeImage,
                    biomeStyles: styles,
                    tiles: DETAIL_TILES,
                    warpAmount: DETAIL_WARP_AMOUNT,
                    coarseWeight: DETAIL_COARSE_WEIGHT,
                });
            } catch (e) {
                _warnOnce('细节层上传失败（bodyId=' + bodyId + '）：' + _errorText(e));
            }
        })
        .catch((e) => {
            _warnOnce('细节层加载失败，菜单照常：' + _errorText(e));
        });
}

// 逐群系起伏强度数组：来自 src/config/biomeRelief.js（海洋/滨海 = 0，水面不长山）；
// 长度按配置表登记的群系数取 —— setNormalMap 内部会补齐/截断到着色器 MAX_BIOMES，
// 未登记下标走缺省强度 1（与配置表 DEFAULT_BIOME_RELIEF 同语义），因此这里不硬编码长度。
function _biomeReliefArray() {
    const table = BIOME_RELIEF[MENU_PLANET_CONFIG.bodyId];
    const count = table ? Object.keys(table).length : 0;
    return resolveBiomeReliefArray(MENU_PLANET_CONFIG.bodyId, count);
}

// 地形法线图（卡2）：必须在 setAlbedo / setPlanet 之后挂图（setNormalMap 按 params.anisotropy
// 建纹理）；relief 传逐群系强度数组（src/config/biomeRelief.js，海洋/滨海 = 0），
// 全局旋钮 normalStrength 走 setPlanet 白名单参数（见 _applyPlanetParams）；
// 生效强度 = normalStrength × relief[群系下标]。纹理选项用渲染器缺省（与 albedo 同约定）。
function _loadNormalMap() {
    if (_normalRequested || !_renderer || _contextLost || _failed) return;
    _normalRequested = true;
    const img = new Image();
    img.onload = () => {
        if (!_renderer || _contextLost || _failed) return;
        try {
            _renderer.setNormalMap(img, { relief: _biomeReliefArray() });
        } catch (e) {
            _warnOnce('法线图上传失败，地表起伏停用：' + _errorText(e));
        }
    };
    img.onerror = () => {
        _warnOnce('法线图加载失败，地表起伏停用：path=' + NORMAL_MAP_PATH);
    };
    img.src = NORMAL_MAP_PATH;
}

// 尺寸 / 盘心 / 光照参数：全部来自配置，按外接球语义传像素半径
function _applyPlanetParams(w, h) {
    const cfg = MENU_PLANET_CONFIG;
    const light = cfg.lighting;
    // R = radiusRatio × 缓冲高；toCircumscribedScreenR 内部按 shapeOf(bodyId) 的 ratio 换算
    const { physScreenR } = toCircumscribedScreenR(cfg.radiusRatio * h, cfg.bodyId);
    _renderer.setPlanet({
        screenRadiusPx: physScreenR,
        tiltDeg: cfg.tiltDeg,
        spinDeg: _spinDeg,
        atmosphereEnabled: cfg.atmosphereEnabled === true,
        atmosphere: cfg.atmosphere,
        terminatorSoftDeg: cfg.terminatorSoftDeg,
        cloudEnabled: cfg.cloudEnabled === true,
        clouds: cfg.clouds,
        cloudOrder: cfg.cloudOrder,
        ambient: light.ambient,
        diffuse: light.diffuse,
        edgeDarkening: light.edgeDarkening,
        nightLimbFade: light.nightLimbFade,
        nightLimbFadeWidth: light.nightLimbFadeWidth,
        sunDir: light.sunDir,
        mipmap: cfg.albedoTexture.mipmap,
        filter: cfg.albedoTexture.filter,
        anisotropy: cfg.albedoTexture.anisotropy,
        // 地表起伏强度（卡2）：配置缺省按 0（关）处理；渲染器在无法线图时也会强制归零
        normalStrength: Number(cfg.normalStrength) || 0,
    });
    const centerX = cfg.centerXRatio * w;
    const centerY = cfg.centerYRatio * h;
    // 相机换算（实验室实测 kx=-H/2、ky=+H/2）：显式半径通道把世界尺度钉成视图半高
    _renderer.setCamera({
        cx: -(centerX - w / 2) / (h / 2),
        cy: (centerY - h / 2) / (h / 2),
    });
}

// 主画布缓冲尺寸变化：先释放旧尺寸离屏目标（避免滞留），再 resize，再重算半径/盘心
function _applySize() {
    if (!_mainCanvas || !_renderer) return;
    const w = Math.max(1, _mainCanvas.width | 0);
    const h = Math.max(1, _mainCanvas.height | 0);
    const key = w + 'x' + h;
    if (key === _sizeKey) return;
    _sizeKey = key;
    _renderer.releaseTargets();
    _glCanvas.width = w;
    _glCanvas.height = h;
    _renderer.resize(w, h, 1);
    // setAlbedo 之后才接 setPlanet（顺序硬性）；未就绪时只 resize，等 albedo onload 再补
    if (_albedoReady) _applyPlanetParams(w, h);
}

function _createRenderer() {
    const bodyId = MENU_PLANET_CONFIG.bodyId;
    const albedoPath = _findAlbedoPath(bodyId);
    if (!albedoPath) {
        _failed = true;
        return;
    }
    const w = Math.max(1, _mainCanvas.width | 0);
    const h = Math.max(1, _mainCanvas.height | 0);
    _glCanvas = document.createElement('canvas');
    _glCanvas.width = w;
    _glCanvas.height = h;
    try {
        _gl = createGLContext(_glCanvas, { alpha: true });
    } catch (e) {
        _failed = true;
        _warnOnce('WebGL2 不可用，菜单星球层停用：' + _errorText(e));
        return;
    }
    _glCanvas.addEventListener('webglcontextlost', _markContextLost);
    try {
        // 透明背景模式：离屏 clearColor alpha=0 + 铺屏 alpha 透传，供 Canvas2D 一次 drawImage 叠加
        _renderer = createPlanetRenderer(_gl, { transparent: true });
    } catch (e) {
        _failed = true;
        _warnOnce('渲染器创建失败，菜单星球层停用：' + _errorText(e));
        return;
    }
    try {
        _applySize();
    } catch (e) {
        _failed = true;
        _warnOnce('菜单星球参数应用失败：' + _errorText(e));
        return;
    }
    _ready = true;
    _loadAlbedo(albedoPath);
}

function enter(mainCanvas) {
    if (!mainCanvas) return;
    _mainCanvas = mainCanvas;
    if (_failed || _contextLost) return;
    if (!_renderer) _createRenderer();
    if (!_renderer || !_ready) return;
    // 重进菜单时主画布可能已 resize：清 key 强制重算尺寸与相机（旧目标已在 exit 释放）
    _sizeKey = '';
    try {
        _applySize();
    } catch (e) {
        _failed = true;
        _warnOnce('菜单星球尺寸应用失败：' + _errorText(e));
    }
}

function update(dt) {
    if (!_ready || _failed || _contextLost) return;
    const step = Number(dt) || 0;
    _spinDeg = (_spinDeg + step * MENU_PLANET_CONFIG.spinDegPerSec) % 360;
    _lastDt = step;
}

function render(ctx) {
    if (!_ready || _failed || _contextLost || !_albedoReady) return;
    // 上下文丢失可能没有事件（或事件先于监听）：渲染前再显式检查一次
    if (_gl && _gl.isContextLost && _gl.isContextLost()) {
        _markContextLost();
        return;
    }
    try {
        _applySize();
        _renderer.setPlanet({ spinDeg: _spinDeg });
        _renderer.render(_lastDt);
        // 场景卫生：主画布 ctx 跨场景复用，显式复位 alpha/合成模式/变换后再叠一次
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(_glCanvas, 0, 0);
        ctx.restore();
    } catch (e) {
        _failed = true;
        _warnOnce('菜单星球渲染失败，已停用：' + _errorText(e));
    }
}

function exit() {
    // 停渲染 + 释放离屏目标；保留渲染器/贴图/上下文供重进复用（不 dispose）
    if (_renderer) _renderer.releaseTargets();
    _lastDt = 0;
}

export const menuPlanetLayer = {
    enter,
    update,
    render,
    exit,
};
