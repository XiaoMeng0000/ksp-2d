import { camera, worldToScreen } from './camera.js';
import { celestialBodies, getAbsolutePosition } from './physics/physics.js';
import { predictTrajectoryPatched, predictTrajectoryBurned, bodyFuturePos, getCachedTime } from './physics/orbitalPrediction.js';
import { getOrbitalInfo, stateToKepler, findSOIExitTime, timeToHyperPeriapsis } from './physics/orbitalMechanics.js';
import { getFacilityType } from './facility/facilityTypes.js';
import { renderableManager } from './graphics/renderable.js';
import { textureManager } from './graphics/textureManager.js';
import { drawStarGlow, drawStarBall, drawPlanetRing } from './graphics/programEffects.js';
import { STARFIELD_CONFIG } from './config/starfieldConfig.js';
import { t } from './config/strings.js';
import { ORBIT_POINT_TYPES, ORBIT_MARKER_COLOR } from './config/orbitPointTypes.js';
import { syncOrbitLabels } from './ui/orbitLabels.js';
import { formatDuration } from './utils/format.js';

// 星空背景（天空盒）：屏幕空间固定坐标 + 固定像素尺寸，与相机解耦
let stars = [];
const BODY_MIN_SCREEN_RADIUS = 3;  // 天体最低屏幕半径，防止远距离缩成一个像素以下

// 大圆虚线环的屏幕半径上限（0.2.5 卡顿修复）：
// setLineDash 会让浏览器把圆周按弧长逐段展开成小线段，段数 = 周长 / 虚线周期。
// zoom 放大时半径随 camera.zoom 线性增长，屏幕半径超过该阈值后虚线展开段数
// 每帧可达数百万(危险环 zoom=10 时 ≈420 万段) → 巨卡。超大环降级为实线绘制。
const DASHED_RING_MAX_RADIUS = 20000;

/**
 * 大圆环屏幕可见性判定（0.2.5 卡顿修复）：
 * 圆周与屏幕区域相交（|r − 圆心距屏心| ≤ 屏幕外接半径）才需要绘制。
 * zoom 放大时半径可远超屏幕：整屏落入圆内(圆周在屏外)或圆远离屏幕时直接跳过，
 * 避免无谓的 path 构造与光栅化；同时把虚线环的可见半径约束在
 * "圆心距 + 屏外接半径"量级，虚线展开段数有界。
 * @param {number} cx, cy - 圆心的屏幕（画布物理像素）坐标
 * @param {number} r - 圆半径（画布物理像素）
 * @param {HTMLCanvasElement} canvas
 */
function isRingOnScreen(cx, cy, r, canvas) {
    if (!(r > 1) || !isFinite(r) || !canvas) return false;
    const farCorner = Math.hypot(canvas.width, canvas.height) / 2;
    const dc = Math.hypot(cx - canvas.width / 2, cy - canvas.height / 2);
    return Math.abs(r - dc) <= farCorner;
}

// ===== 轨道交互骨架（0.3.0）：渲染层持有"本帧已绘制的轨道几何"，供交互层读取 =====
// 交互层（flightScene）通过访问器读取，不与预测引擎直接耦合；
// hover 状态由交互层写入，渲染层在绘制标记时消费。功能体待后续提交填充。
let _lastOrbitSegments = null;   // 本帧活动飞船轨道预测 segments（renderOrbit 写入，null = 无活动飞船）
let _lastOrbitMarkers = [];      // 本帧 Ap/Pe 标记屏幕位置（renderOrbitMarkers 写入）
let _orbitHoverState = null;     // 悬停状态（setOrbitHoverState 写入，标记绘制消费）
let _lastVisibility = {};        // 本帧可见性选项（render 写入，SOI 标签开关等消费）

// rgba 字符串缓存（0.2.5 A8：hexToRgba 每帧对每个天体/设施重复 parse+拼接，按 (hex,alpha) 缓存）
const _rgbaCache = new Map();
function hexToRgba(hex, alpha) {
    const key = hex + '|' + alpha;
    const cached = _rgbaCache.get(key);
    if (cached) return cached;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const out = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    if (_rgbaCache.size < 512) _rgbaCache.set(key, out);   // 有界缓存防无限增长
    return out;
}

// 轨道线非当前 SOI 的颜色池（0.2.5 A8：原为 getOrbitColor 内每帧新建数组 → 模块常量）
const ORBIT_BRIGHT_COLORS = [
    'rgba(68, 255, 136, 0.8)',
    'rgba(255, 255, 68, 0.8)',
    'rgba(255, 68, 255, 0.8)',
    'rgba(68, 255, 255, 0.8)',
    'rgba(255, 136, 68, 0.8)',
    'rgba(136, 68, 255, 0.8)'
];

/**
 * 渲染天体图层（贴图 + 程序效果）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx, cy - 屏幕中心坐标
 * @param {number} drawRadius - 天体基础屏幕半径
 * @param {Array} layers - 图层数组（已按 LOD 选档/插值）
 * @returns {boolean} 是否至少绘制了一个图层
 */
function renderBodyLayers(ctx, cx, cy, drawRadius, layers) {
    let rendered = false;

    for (const layer of layers) {
        const alpha = layer.alpha !== undefined ? layer.alpha : 1.0;
        const scale = layer.scale || 1;
        const layerRadius = drawRadius * scale;

        if (layer.texture) {
            // 贴图层
            const tex = textureManager.get(layer.texture);
            if (!tex) continue;
            if (alpha < 1.0) {
                ctx.globalAlpha = alpha;
            }
            ctx.drawImage(tex, cx - layerRadius, cy - layerRadius, layerRadius * 2, layerRadius * 2);
            if (alpha < 1.0) {
                ctx.globalAlpha = 1.0;
            }
            rendered = true;
        } else if (layer.program === 'star_ball') {
            // 程序化纯色光球（普通合成，实心球体，与贴图同尺寸）
            drawStarBall(ctx, cx, cy, layerRadius, layer.color, alpha);
            rendered = true;
        } else if (layer.program === 'star_glow') {
            // 程序光晕层（additive 叠加）
            const color = layer.color || '#ffffff';
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            drawStarGlow(ctx, cx, cy, drawRadius, color, scale, alpha);
            ctx.restore();
            rendered = true;
        } else if (layer.program === 'planet_ring') {
            // 程序星环层（天体赤道平面正圆环带，支持多细分 bands）
            drawPlanetRing(ctx, cx, cy, drawRadius, layer);
            rendered = true;
        }
    }

    return rendered;
}

/**
 * 生成天空盒星空（屏幕空间固定背景）
 * @param {number} canvasWidth - 画布物理像素宽度
 * @param {number} canvasHeight - 画布物理像素高度
 * @param {number} [dpr=1] - 设备像素比（星点半径/边缘余量按物理像素放大，保持视觉尺寸与密度恒定）
 */
function createStars(canvasWidth, canvasHeight, dpr = 1) {
    const cfg = STARFIELD_CONFIG;
    const pr = dpr || 1;
    // 按屏幕面积（含边缘余量）计算星数，限制在 [minCount, maxCount] 防失控
    const totalArea = (canvasWidth + cfg.margin * 2 * pr) * (canvasHeight + cfg.margin * 2 * pr);
    const count = Math.round(totalArea / cfg.density);
    const n = Math.max(cfg.minCount, Math.min(cfg.maxCount, count));

    stars = [];
    for (let i = 0; i < n; i++) {
        stars.push({
            x: Math.random() * (canvasWidth + cfg.margin * 2 * pr) - cfg.margin * pr,
            y: Math.random() * (canvasHeight + cfg.margin * 2 * pr) - cfg.margin * pr,
            radius: (cfg.radiusRange.min + Math.random() * (cfg.radiusRange.max - cfg.radiusRange.min)) * pr,
            brightness: cfg.brightnessRange.min + Math.random() * (cfg.brightnessRange.max - cfg.brightnessRange.min),
            color: cfg.colors[Math.floor(Math.random() * cfg.colors.length)],
            // 闪烁参数：随机相位 + 周期 + 振幅
            phase: Math.random() * Math.PI * 2,
            period: cfg.twinkle.periodRange.min + Math.random() * (cfg.twinkle.periodRange.max - cfg.twinkle.periodRange.min),
            amplitude: cfg.twinkle.amplitudeRange.min + Math.random() * (cfg.twinkle.amplitudeRange.max - cfg.twinkle.amplitudeRange.min)
        });
    }
}

/**
 * 绘制天空盒星空：屏幕空间固定坐标 + 固定像素尺寸
 * 不随相机平移/缩放变化（恒星无限远语义）；
 * 亮度按真实时间微闪烁，不受游戏时间加速影响
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {number} [globalAlpha=1] - 整层透明度乘数（0~1），用于恒星遮挡淡出
 */
function renderStarfield(ctx, canvas, globalAlpha = 1) {
    const cfg = STARFIELD_CONFIG;
    // 闪烁时间基准：performance.now（真实时间，秒），与游戏时间加速无关
    const t = performance.now() / 1000;
    const W = canvas.width;
    const H = canvas.height;

    for (const star of stars) {
        if (star.x < -50 || star.x > W + 50 ||
            star.y < -50 || star.y > H + 50) continue;

        // 微闪烁：alpha = 基准亮度 × (1 + 振幅 × sin(2π·t/周期 + 相位))
        let alpha = star.brightness;
        if (cfg.twinkle.enabled) {
            alpha = star.brightness * (1 + star.amplitude * Math.sin(2 * Math.PI * t / star.period + star.phase));
        }

        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * globalAlpha));
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;
}

/**
 * 计算恒星对星空的遮挡系数（0=星空完全消失，1=星空完整可见）
 * 科学依据：视角靠近恒星时，恒星光芒淹没背景星光
 * 驱动指标 covered = 星盘屏幕半径 − 星心到屏幕中心距离（px）
 *   covered <= fadeStart：恒星未覆盖视野中央，不遮挡
 *   covered >= fadeEnd：恒星充分覆盖视野，星空完全消失
 * 遍历所有恒星型天体取最小可见系数，兼容未来多恒星系统
 * @param {HTMLCanvasElement} canvas
 * @returns {number} 星空透明度乘数（0~1）
 */
function computeStarfieldVisibility(canvas) {
    const cfg = STARFIELD_CONFIG;
    const oc = cfg.starOcclusion;
    if (!oc || !oc.enabled) return 1;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    let minFactor = 1;

    for (const body of celestialBodies) {
        if (body.type !== 'star') continue;
        // 与天体渲染一致的恒星屏幕半径（无最小保护，直接等比缩放）
        const drawRadius = body.displayRadius * camera.zoom;
        if (drawRadius <= oc.fadeStart) continue;

        const screen = worldToScreen(body.position.x, body.position.y, canvas);
        const distToCenter = Math.hypot(screen.x - cx, screen.y - cy);
        const covered = drawRadius - distToCenter;
        if (covered <= oc.fadeStart) continue;

        const t = Math.min(1, (covered - oc.fadeStart) / (oc.fadeEnd - oc.fadeStart));
        minFactor = Math.min(minFactor, 1 - t);
    }
    return minFactor;
}

/**
 * 绘制天体轨道线（以天体自身代表色，数据驱动）
 * 轨道焦点 = 父天体当前 position，形状参数来自 orbitA/orbitE/orbitOmega
 * 用分段采样绘制，避免 canvas 大半径 arc 的精度问题
 */
function drawBodyOrbits(ctx, canvas) {
    for (const body of celestialBodies) {
        // 恒星无轨道
        if (!body.orbitParent) continue;
        const parent = celestialBodies.find(b => b.name === body.orbitParent);
        if (!parent) continue;

        const pixelR = body.orbitA * camera.zoom;
        // 显示条件：屏幕半径过小（<10px）不可见；过大（>屏幕长边×2）无意义且开销大
        const maxScreen = Math.max(canvas.width, canvas.height);
        if (pixelR < 10 || pixelR > maxScreen * 2) continue;

        const center = worldToScreen(parent.position.x, parent.position.y, canvas);
        const e = body.orbitE || 0;
        const omega = body.orbitOmega || 0;
        const semiMinor = pixelR * Math.sqrt(1 - e * e);

        // 采样密度：按屏幕周长每约 20px 一个点，限制在 [64, 256]
        const points = Math.min(256, Math.max(64, Math.round(Math.PI * (pixelR + semiMinor) / 20)));
        // Y 轴翻转补偿：屏幕坐标系下旋转角取反
        const cosO = Math.cos(-omega);
        const sinO = Math.sin(-omega);

        // 焦点极坐标参数方程：r = a(1-e²)/(1+e·cosθ)，以父天体（焦点）为原点。
        // 与 keplerPositionAtTime 的位置计算一致（orbitalMechanics.js），
        // 远拱点距焦点 a(1+e)、近拱点 a(1-e)。旧版用中心参数方程 (a·cosθ, b·sinθ)，
        // 对 e>0 的天体（如 Duna）椭圆中心与焦点不重合，天体位置会跑出轨道线。
        const semiLatusRectum = pixelR * (1 - e * e);

        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
            const theta = (i / points) * Math.PI * 2;
            const r = semiLatusRectum / (1 + e * Math.cos(theta));
            const localX = r * Math.cos(theta);
            const localY = r * Math.sin(theta);
            const sx = center.x + localX * cosO - localY * sinO;
            const sy = center.y + localX * sinO + localY * cosO;
            if (i === 0) {
                ctx.moveTo(sx, sy);
            } else {
                ctx.lineTo(sx, sy);
            }
        }
        ctx.strokeStyle = hexToRgba(body.color, 0.4);
        ctx.lineWidth = Math.max(1, 2 * camera.zoom);
        ctx.stroke();
    }
}

function render(ctx, canvas, activeShip, options = {}) {
    // 0.2.5（H4）：渲染层无业务逻辑 —— 非活动飞船列表由场景层经 options 注入，
    // 不再直连 window.__shipSystem（旧实现绕过 GameState/eventBus，依赖全局挂载时序）
    const {
        visibility = { ships: false, facilities: false, bodyOrbits: true },
        facilities = [],
        ships = [],
        selectedFacilityId = null
    } = options;
    // 供标记层消费本次可见性（SOI 切换标签开关等；模块级状态，与悬停通道同风格）
    _lastVisibility = visibility;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 天空盒星空（屏幕空间固定背景 + 微闪烁）
    // 靠近恒星时恒星光茫淹没背景 → 星空整层淡出
    const starfieldAlpha = computeStarfieldVisibility(canvas);
    renderStarfield(ctx, canvas, starfieldAlpha);

    // 天体轨道线（以天体代表色绘制，右下角👁可开关）
    if (visibility.bodyOrbits !== false) {
        drawBodyOrbits(ctx, canvas);
    }

    for (const body of celestialBodies) {
        const screen = worldToScreen(body.position.x, body.position.y, canvas);
        const physScreenR = body.displayRadius * camera.zoom;
        // 恒星不套最小保护：光晕随物理尺寸等比缩小，极远时自然淡出（未来用图标方案接管）
        // 行星保留最小屏幕保护，防止贴图缩成一个像素以下消失
        const drawRadius = body.type === 'star'
            ? physScreenR
            : Math.max(physScreenR, BODY_MIN_SCREEN_RADIUS);

        // 图形驱动器：按 textureKey 渲染多层贴图/程序效果（星球贴图/恒星光晕），未配置或未加载时回退纯色圆
        const config = renderableManager.get(body.textureKey);
        let textured = false;

        if (config && config.modes) {
            // LOD 分级渲染（恒星用）
            const { modes, nearScreenR, farScreenR } = config;
            const nearLayers = modes.near?.layers || [];
            const farLayers = modes.far?.layers || [];
            let layersToRender = [];

            if (drawRadius >= nearScreenR) {
                // 近景档
                layersToRender = nearLayers;
            } else if (drawRadius <= farScreenR) {
                // 远景档
                layersToRender = farLayers;
            } else {
                // 过渡区：贴图渐隐 + 白色光球渐显（中心亮白覆盖贴图，避免半透明变灰）
                // 光晕按 t 渐显，且大小从近景档光晕起步、平滑扩大到远景档完整大小
                const t = 1 - (drawRadius - farScreenR) / (nearScreenR - farScreenR); // 0=near, 1=far
                // easeInOut 曲线：过渡起止柔和、中间快
                const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

                // 光晕起始大小 = 近景档光晕的 scale（数据驱动，从 near 配置读取）
                const nearGlow = nearLayers.find(l => l.program === 'star_glow');
                const glowStartScale = nearGlow ? (nearGlow.scale || 1) : 1;

                layersToRender = [];
                // 贴图渐隐（其上方有白色光球覆盖提亮，不会透黑变灰）
                for (const l of nearLayers) {
                    layersToRender.push({
                        ...l,
                        alpha: (l.alpha !== undefined ? l.alpha : 1.0) * (1 - e)
                    });
                }
                // 白色光球渐显 + 光晕渐显且大小收敛
                for (const l of farLayers) {
                    if (l.program === 'star_ball') {
                        layersToRender.push({ ...l, alpha: l.alpha * e });
                    } else {
                        const fullScale = l.scale || 1;
                        layersToRender.push({
                            ...l,
                            alpha: (l.alpha !== undefined ? l.alpha : 1.0) * e,
                            scale: glowStartScale + (fullScale - glowStartScale) * e
                        });
                    }
                }
                layersToRender.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
            }

            textured = renderBodyLayers(ctx, screen.x, screen.y, drawRadius, layersToRender);
        } else if (config && config.layers) {
            // 单模式渲染（行星用，如 Kerbin）
            textured = renderBodyLayers(ctx, screen.x, screen.y, drawRadius, config.layers);
        }

        if (!textured) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, drawRadius, 0, Math.PI * 2);
            ctx.fillStyle = body.color;
            ctx.fill();
        }

        // SOI 边界圆（屏幕半径小于 1 时不绘制，避免画面混乱；
        // 0.2.5：放大后圆周可能整体在屏外，加可见性判定跳过无谓绘制）
        const soiScreenR = body.soiRadius * camera.zoom;
        if (isRingOnScreen(screen.x, screen.y, soiScreenR, canvas)) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, soiScreenR, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
            ctx.lineWidth = Math.max(1, 2 * camera.zoom);
            ctx.stroke();
        }

        // 危险边界警示环（飞船接近时显示）：
        // 有大气天体 → 浅蓝虚线大气边界；无大气天体 → 红色虚线表面边界
        if (activeShip) {
            const shipAbs = getAbsolutePosition(activeShip);
            const bdx = body.position.x - shipAbs.x;
            const bdy = body.position.y - shipAbs.y;
            const shipDist = Math.sqrt(bdx * bdx + bdy * bdy);
            const hasAtmo = body.hasAtmosphere && body.atmosphereHeight > 0;
            const hazardBoundary = hasAtmo ? body.radius + body.atmosphereHeight : body.radius;
            if (shipDist < hazardBoundary * 2) {
                const hazardScreenR = hazardBoundary * camera.zoom;
                // 0.2.5 卡顿修复：圆周穿过屏幕才绘制（虚线按弧长逐段展开，屏外巨圆
                // 会导致每帧数百万 dash 线段）；半径过大时降级为实线（虚线段数有界）。
                if (isRingOnScreen(screen.x, screen.y, hazardScreenR, canvas)) {
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, hazardScreenR, 0, Math.PI * 2);
                    if (hazardScreenR <= DASHED_RING_MAX_RADIUS) {
                        ctx.setLineDash([6, 4]);
                    }
                    ctx.strokeStyle = hasAtmo ? 'rgba(120, 200, 255, 0.5)' : 'rgba(255, 80, 80, 0.6)';
                    ctx.lineWidth = Math.max(1, 2 * camera.zoom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        }
    }

    // 多飞船渲染 - 活动飞船始终渲染，非活动飞船根据 visibility.ships 控制
    let shipsToRender = [];
    if (activeShip) shipsToRender.push(activeShip);
    if (visibility.ships) {
        for (const s of ships) {
            if (s && s.id !== (activeShip && activeShip.id)) shipsToRender.push(s);
        }
    }

    for (const s of shipsToRender) {
        const isActive = s.id === activeShip?.id;

        ctx.save();
        if (!isActive && visibility.ships) {
            ctx.globalAlpha = 0.5;
        }

        const absPos = getAbsolutePosition(s);
        const shipScreen = worldToScreen(absPos.x, absPos.y, canvas);

        // 按飞船 heading 旋转绘制
        ctx.translate(shipScreen.x, shipScreen.y);
        ctx.rotate(s.heading || 0);

        // 船体图标：优先使用模板指定的纹理，否则用默认图
        const shipTexKey = s.iconTextureKey || (isActive ? 'ship_default_active' : 'ship_default_inactive');
        const shipTex = textureManager.get(shipTexKey);
        if (shipTex) {
            const halfSize = isActive ? Math.max(14, 16 * camera.zoom) : Math.max(4, 8 * camera.zoom);
            ctx.drawImage(shipTex, -halfSize, -halfSize, halfSize * 2, halfSize * 2);
        } else {
            // Fallback: 程序化三角形
            const shipSize = isActive ? Math.max(14, 16 * camera.zoom) : Math.max(4, 8 * camera.zoom);
            ctx.beginPath();
            ctx.moveTo(0, -shipSize);
            ctx.lineTo(-shipSize * 0.6, shipSize * 0.6);
            ctx.lineTo(shipSize * 0.6, shipSize * 0.6);
            ctx.closePath();
            ctx.fillStyle = isActive ? '#ffffff' : '#888888';
            ctx.fill();
        }

        ctx.restore();

        // 为非活动飞船绘制灰色轨道线
        if (visibility.ships && !isActive) {
            renderOrbit(s, ctx, canvas, false);
        }
    }

    if (visibility.facilities) {
        renderFacilities(ctx, canvas, facilities, selectedFacilityId, visibility);
    }

    // 设施轨道线
    if (visibility.facilities && facilities.length > 0) {
        for (const f of facilities) {
            const isActiveFac = f.id === selectedFacilityId;
            if (!isActiveFac) {
                renderOrbit(f, ctx, canvas, false);
            }
        }
    }
    // 选中设施轨道线（彩色）
    if (selectedFacilityId) {
        const selectedFac = facilities.find(f => f.id === selectedFacilityId);
        if (selectedFac) {
            renderOrbit(selectedFac, ctx, canvas, true);
        }
    }

    // 轨道线绘制（活动飞船：彩色 + 多段预测 + 跨SOI衔接）
    renderOrbit(activeShip, ctx, canvas, true);
}

function renderFacilities(ctx, canvas, facilities, selectedFacilityId, visibility = {}) {
    if (!facilities || facilities.length === 0) return;

    for (const f of facilities) {
        const fAbsPos = getAbsolutePosition(f);
        const screen = worldToScreen(fAbsPos.x, fAbsPos.y, canvas);
        const isSelected = f.id === selectedFacilityId;
        const halfSize = isSelected ? Math.max(14, 16 * camera.zoom) : Math.max(4, 8 * camera.zoom);
        const typeConfig = getFacilityType(f.typeId);
        const color = typeConfig ? typeConfig.color : '#888888';

        // 尝试从图形驱动器获取设施纹理
        let textured = false;
        const layers = renderableManager.getLayers('facility');
        if (layers.length > 0) {
            const tex = textureManager.get(layers[0].texture);
            if (tex) {
                ctx.drawImage(tex, screen.x - halfSize, screen.y - halfSize, halfSize * 2, halfSize * 2);
                textured = true;
            }
        }

        if (!textured) {
            // fallback: 纯色方块（区别于圆形天体、三角形飞船）
            ctx.fillStyle = color;
            ctx.fillRect(screen.x - halfSize, screen.y - halfSize, halfSize * 2, halfSize * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(screen.x - halfSize, screen.y - halfSize, halfSize * 2, halfSize * 2);
        }

        // 对接范围虚线圆（常态显示，可通过筛选菜单隐藏）
        // 0.2.5：可见性判定 + 超大半径降级实线（虚线按弧长展开，防止放大后段数爆炸）
        if (visibility.facilityRange !== false) {
            const rangeScreenR = f.interactionRange * camera.zoom;
            if (isRingOnScreen(screen.x, screen.y, rangeScreenR, canvas)) {
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, rangeScreenR, 0, Math.PI * 2);
                // 选中设施用高亮色，未选中用类型色（半透明）
                const rangeColor = f.id === selectedFacilityId
                    ? 'rgba(255, 255, 100, 0.35)'
                    : hexToRgba(color, 0.15);
                ctx.strokeStyle = rangeColor;
                ctx.lineWidth = 1;
                if (rangeScreenR <= DASHED_RING_MAX_RADIUS) {
                    ctx.setLineDash([4, 4]);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }
}

export {
    createStars,
    render,
    renderFlightHud,
    // 轨道交互骨架（0.3.0）：数据访问器 + 悬停状态通道 + 待填功能函数
    computeApPePositions,
    renderOrbitMarkers,
    findNearestOrbitPoint,
    resolveOrbitHit,
    setOrbitHoverState,
    getOrbitHoverState,
    getLastOrbitSegments,
    getLastOrbitMarkers
};

// ========== 轨道线渲染系统 ==========

// 根据 SOI 名称返回轨道线颜色
// isCurrentSoi=true → 固定绿色；否则从亮色池哈希取色
function getOrbitColor(soiName, isManeuver = false, isCurrentSoi = false) {
    if (isManeuver) return 'rgba(255, 68, 68, 0.8)';
    if (isCurrentSoi) return 'rgba(64, 224, 80, 0.85)';

    const safeName = soiName || t('orbit.type.deepSpace');
    let hash = 0;
    for (let i = 0; i < safeName.length; i++) hash = (hash * 31 + safeName.charCodeAt(i)) | 0;
    return ORBIT_BRIGHT_COLORS[Math.abs(hash) % ORBIT_BRIGHT_COLORS.length];
}

// 判断两个 SOI 天体之间的层级方向
// 返回 'up'（子→父）、'down'（父→子）或 null（无直接层级关系）
function getSOIDirection(fromName, toName) {
    const fromBody = celestialBodies.find(b => b.name === fromName);
    const toBody = celestialBodies.find(b => b.name === toName);
    if (!fromBody || !toBody) return null;
    if (fromBody.orbitParent === toName) return 'up';   // 子→父
    if (toBody.orbitParent === fromName) return 'down'; // 父→子
    return null;
}

// 段锚点：anchorBody 在当前游戏时刻的绝对世界位置（返回原点兜底 = 深空段）。
// 锚定"当前时刻"而非段起始时刻 → 每段以自身宿主为参考系并跟随宿主移动（KSP 语义）；
// 锚点不同的两段在 SOI 边界处会有断层，由跨 SOI 衔接虚线接线。
function getSegmentAnchor(seg) {
    const anchorBody = celestialBodies.find(b => b.name === seg.anchorBody);
    return anchorBody ? bodyFuturePos(anchorBody, getCachedTime()) : { x: 0, y: 0 };
}

// 轨道线渲染主入口
// 绘制点 = 锚点绝对位置 + 相对坐标（worldToScreen 期望绝对世界坐标）
function renderOrbit(ship, ctx, canvas, isActive = true) {
    if (!ship) {
        // 无活动飞船：清空轨道几何缓存与标签，防止交互层读到过期数据/标签残留
        _lastOrbitSegments = null;
        _lastOrbitMarkers = [];
        syncOrbitLabels([], canvas);
        return;
    }

    let segments;
    if (ship.mode === 'on_rails') {
        segments = predictTrajectoryPatched(ship);
    } else {
        // 推力模式：显示假设立即熄火的常规轨道
        segments = predictTrajectoryBurned(ship, false);
    }

    // 非活动飞船只显示当前 SOI 段（第 0 段），避免跨 SOI 预测复杂性
    if (!segments || !Array.isArray(segments)) {
        // 0.2.5（M1）：预测段缺失/非法（如模式切换过渡帧）时显式清空轨道缓存与标签——
        // 旧实现直接 return，_lastOrbitSegments/_lastOrbitMarkers 保留上一帧旧轨道，
        // 悬停检测与右键菜单会读到过期几何（与 ship=null 分支行为不一致）
        if (isActive) {
            _lastOrbitSegments = null;
            _lastOrbitMarkers = [];
            syncOrbitLabels([], canvas);
        }
        return;
    }
    // 骨架：缓存本帧活动飞船的预测段，供悬停检测 / 右键菜单读取（通道，交互层只读）
    if (isActive) _lastOrbitSegments = segments;
    const maxSegIdx = isActive ? segments.length - 1 : 0;

    for (let si = 0; si <= maxSegIdx; si++) {
        const seg = segments[si];
        if (!seg.relPoints || seg.relPoints.length < 2) continue;

        // 锚点绝对位置只算一次
        const anchor = getSegmentAnchor(seg);
        const color = isActive ? getOrbitColor(seg.soiName, false, seg.isCurrentSoi) : '#888888';

        ctx.beginPath();
        const p0 = worldToScreen(seg.relPoints[0].x + anchor.x, seg.relPoints[0].y + anchor.y, canvas);
        ctx.moveTo(p0.x, p0.y);

        for (let i = 1; i < seg.relPoints.length; i++) {
            const p = worldToScreen(seg.relPoints[i].x + anchor.x, seg.relPoints[i].y + anchor.y, canvas);
            ctx.lineTo(p.x, p.y);
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 跨SOI衔接线：非活动飞船跳过
    if (!isActive) return;

    for (let si = 0; si < segments.length - 1; si++) {
        const seg = segments[si];
        const nextSeg = segments[si + 1];
        if (!seg.relPoints || seg.relPoints.length < 2) continue;
        if (!nextSeg.relPoints || nextSeg.relPoints.length < 2) continue;
        if (getSOIDirection(seg.soiName, nextSeg.soiName) !== 'up') continue;

        const anchorA = getSegmentAnchor(seg);
        const anchorB = getSegmentAnchor(nextSeg);
        const lastP = seg.relPoints[seg.relPoints.length - 1];
        const firstP = nextSeg.relPoints[0];
        const nextColor = getOrbitColor(nextSeg.soiName, false, nextSeg.isCurrentSoi);
        ctx.beginPath();
        const s0 = worldToScreen(lastP.x + anchorA.x, lastP.y + anchorA.y, canvas);
        const s1 = worldToScreen(firstP.x + anchorB.x, firstP.y + anchorB.y, canvas);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.strokeStyle = nextColor;
        ctx.lineWidth = 2;
        // 0.2.5：衔接线屏幕长度超过虚线展开上限时降级实线（防高倍放大下 dash 段数爆炸）
        const linkScreenLen = Math.hypot(s1.x - s0.x, s1.y - s0.y);
        if (linkScreenLen <= DASHED_RING_MAX_RADIUS) {
            ctx.setLineDash([4, 6]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 骨架：Ap/Pe 标记绘制调用点（renderOrbitMarkers 功能体待填，当前返回 []）
    // 输出缓存到 _lastOrbitMarkers，供交互层命中检测（此处已过 isActive 提前返回，恒为活动飞船）
    _lastOrbitMarkers = renderOrbitMarkers(ctx, canvas, ship, _orbitHoverState) || [];

    renderManeuverOrbits(ship, ctx, canvas);
}

// ship.maneuverNodes 由 shipSystem.createShip 初始化为空数组，数据结构：
// { time: Number, deltaV: {x, y}, executed: Boolean }
// 渲染层 predictManeuverTrajectories 预测机动后轨道，本函数用红色虚线绘制

function renderManeuverOrbits(ship, ctx, canvas) {
    if (!ship || !ship.maneuverNodes || ship.maneuverNodes.length === 0) return;
    if (ship.mode !== 'on_rails') return;

    const pendingNodes = ship.maneuverNodes.filter(n => !n.executed);
    if (pendingNodes.length === 0) return;

    // TODO: 调用 predictManeuverTrajectories，对每个节点的结果段用红色虚线绘制
}

// ===== 轨道交互（0.3.0：骨架 + 提交2 标记 + 提交3 悬停检测计算层） =====
// 目标：活动飞船轨道线的 Ap/Pe 标记显示、轨道线悬停检测、右键菜单数据通道。
// 已完成：数据通道（缓存/访问器/悬停状态）+ computeApPePositions/renderOrbitMarkers
//   （提交 2：Canvas 锚点 + DOM 文字本体，类型注册表数据驱动）+ findNearestOrbitPoint
//   （提交 3：屏幕空间点-线段悬停检测）。
// 待填：flightScene 交互接入（提交 4）、右键菜单（提交 5）。

/**
 * 把 orbitPoint 命中参数解析为当前帧的世界/屏幕坐标与到达时间（0.3.0 提交4 修复）：
 * 轨道线每帧随 cachedTime 重锚（锚点 = 宿主"当前时刻"位置），命中缓存的世界坐标
 * 跨帧会与重锚后的轨道线错位（warp 下偏移、zoom 越大越明显）。
 * 本函数与轨道线同帧同源重算：用本帧 segments（_lastOrbitSegments）+ 段锚点，
 * 保证圆点恒贴在线上。返回 { screenX, screenY, worldX, worldY, tToNext,
 * anchorBody, relX, relY } 或 null——relX/relY 为"相对宿主中心的轨道坐标"（轨道形状
 * 在宿主参考系固定），冻结后供菜单锚点随宿主/轨道线移动：世界坐标 = 宿主当前时刻
 * 位置 + 轨道坐标（点始终在轨道线上、不沿轨道滑动）。
 * @param {Object} hit - { segIndex, pointIndex, segT }（findNearestOrbitPoint 产出）
 * @param {HTMLCanvasElement} canvas
 */
function resolveOrbitHit(hit, canvas) {
    if (!hit) return null;
    // 字段兼容：上游 findNearestOrbitPoint 返回 segmentIndex，悬停通道构造 segIndex；
    // 统一在此归一（菜单/悬停/未来调用方均不依赖字段名）
    const segIndex = (hit.segIndex !== undefined) ? hit.segIndex : hit.segmentIndex;
    if (segIndex === undefined || hit.pointIndex === undefined) return null;
    const segs = _lastOrbitSegments;
    const seg = segs && segs[segIndex];
    if (!seg || !seg.relPoints || seg.relPoints.length < 2) return null;

    const pi = Math.max(0, Math.min(hit.pointIndex, seg.relPoints.length - 2));
    const p0 = seg.relPoints[pi];
    const p1 = seg.relPoints[pi + 1];
    const t = (hit.segT !== undefined) ? Math.max(0, Math.min(1, hit.segT)) : 0;

    const anchor = getSegmentAnchor(seg);   // 本帧锚点（与轨道线同源）
    const relX = (p0.x + (p1.x - p0.x) * t);
    const relY = (p0.y + (p1.y - p0.y) * t);
    const wx = relX + anchor.x;
    const wy = relY + anchor.y;
    const s = worldToScreen(wx, wy, canvas);

    // 到该点的剩余时间（与渲染帧同一 cachedTime）
    let tToNext = null;
    if (p0.t !== undefined && p1.t !== undefined && isFinite(seg.anchorTime)) {
        tToNext = Math.max(0, (seg.anchorTime + (p0.t + (p1.t - p0.t) * t)) - getCachedTime());
    }

    return {
        screenX: s.x, screenY: s.y,
        worldX: wx, worldY: wy,
        tToNext,
        // 轨道坐标（相对宿主）与宿主名：供锚定菜单点随轨道线移动（冻结后用）
        anchorBody: seg.anchorBody,
        relX, relY
    };
}

/**
 * 计算拱点相对于宿主中心的轨道坐标
 * 椭圆（a>0）：Pe（θ=0，r=a(1-e)）与 Ap（θ=π，r=a(1+e)）；
 * 双曲线（a<0）：仅 Pe（最近接近点，r=|a|(e-1)，公式 a(1-e) 对 a<0 自动恒等），无 Ap。
 * 数学方案：焦点极坐标 r = p/(1+e·cosθ) 在 θ=0/π 处的退化，局部坐标按 omega 旋回世界系，
 * 与 keplerPositionAtTheta 同构、与预测线 patchedStep 同口径。纯几何解不依赖 gm。
 * 注意：kepler 必须用实时重算的 liveKepler（stateToKepler(ship.pos, ship.vel, ship.currentGM)），
 * 不要用 ship.kepler —— 推力模式下会过期，标记将与绘制线脱节。
 * @param {Object} kepler - stateToKepler 输出（含 a/e/omega）
 * @returns {Object|null} { ap:{x,y}|null, pe:{x,y}, apAlt|null, peAlt }；非法输入返回 null
 */
function computeApPePositions(kepler) {
    if (!kepler || !isFinite(kepler.a) || kepler.a === 0) return null;

    const { a, e, omega } = kepler;
    const cosO = Math.cos(omega);
    const sinO = Math.sin(omega);
    // 局部椭圆系：Pe 在 +x（θ=0，r=a(1-e)，双曲线时为正）、Ap 在 -x（θ=π，仅椭圆存在）
    const peLocalX = a * (1 - e);
    const isEllipse = a > 0;

    return {
        pe: { x: peLocalX * cosO, y: peLocalX * sinO },
        ap: isEllipse ? { x: -a * (1 + e) * cosO, y: -a * (1 + e) * sinO } : null,
        apAlt: isEllipse ? a * (1 + e) : null,
        peAlt: a * (1 - e)
    };
}

// 锚点 → 标签本体的固定偏移（首版单段直线折线，本体放锚点右上方轨道外侧；
// 两段式折线（斜线+水平短段）与 labelStyle 扩展留待后续）
const ORBIT_LABEL_DX = 18;
const ORBIT_LABEL_DY = -16;

/**
 * 绘制轨道标记（Ap/Pe：Canvas 锚点 + 折线，DOM 文字本体），并返回标记列表
 * 分工（提交 2 修正版，UI 开发规范：一切 UI 文字都是 DOM）：
 *   Canvas：锚点菱形（悬停放大 + 半透明填充）+ 单段直线折线（世界元素，与轨道线同层）
 *   DOM：   文字本体由 syncOrbitLabels 同步（注册表驱动颜色，fixed 像素不随缩放）
 * 锚点与轨道线同口径：宿主在"当前游戏时刻"的位置（bodyFuturePos = getSegmentAnchor(seg0)）
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {Object} ship - 活动飞船
 * @param {Object|null} hoveredMarker - 悬停状态 { type: 'ap'|'pe'|'orbitPoint', ... }（提交 4 接入）
 * @returns {Array} markers - [{ type, worldX, worldY, screenX, screenY, bodyX, bodyY,
 *                              icon, label, value, tToNext, contextMenu, isHover }]
 */
function renderOrbitMarkers(ctx, canvas, ship, hoveredMarker) {
    const markers = [];

    // 无活动飞船 / 深空 / 逃逸：清空标签
    const host = (ship && ship.currentSOI) ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
    const liveKepler = (ship && ship.currentGM > 0) ? stateToKepler(ship.pos, ship.vel, ship.currentGM) : null;
    if (!ship || !host || !liveKepler || !computeApPePositions(liveKepler)) {
        syncOrbitLabels([], canvas);
        return markers;
    }

    const apPe = computeApPePositions(liveKepler);
    // 锚点基准 = 宿主当前游戏时刻的位置（与轨道线段锚点同口径）
    const anchor = bodyFuturePos(host, getCachedTime());
    const info = getOrbitalInfo(liveKepler, ship.currentGM, host, ship.pos);

    // 拱点可达性（0.3.0 修复）：标记只显示"预测轨道线上真实存在"的拱点。
    // tExit = 到宿主 SOI 出界的剩余时间（findSOIExitTime 与预测线 patchedStep 同口径）：
    //   闭合椭圆（tExit null ⇔ rApo ≤ SOI，预测线画整圈）→ Pe + Ap 恒显示；
    //   出界/伪椭圆（段 0 只画到出界交点）→ Pe 仅未过近点时显示（tToPe < tExit）
    //     （驶过近点后 Pe 在飞船身后 → 隐藏；近逃逸抖动帧 tToPe 巨大 > tExit → 一并过滤）；
    //   Ap 仅闭合椭圆显示（出界轨迹到达前已切换参考系，无 Ap 点）。
    //   双曲线（a<0，捕获/飞掠，0.3.0 修复3）：无 Ap 概念；
    //     Pe = 最近接近点（KSP 入近点语义），未过最近点时显示
    //     （数学保证近点半径 ≤ 当前 r < SOI → 到达近点恒先于出界，无需 tExit 比较）。
    const tExit = findSOIExitTime(liveKepler, ship.currentGM, host.soiRadius);
    const defs = [];
    if (liveKepler.a < 0) {
        // 双曲线：入近点时间（null = 已过最近点 → 不显示）
        const tToPe = timeToHyperPeriapsis(liveKepler, ship.currentGM);
        if (tToPe !== null) {
            defs.push({ typeId: 'periapsis', world: apPe.pe, alt: apPe.peAlt, tToNext: tToPe });
        }
    } else {
        if (tExit === null || (info && info.tToPe !== null && info.tToPe < tExit)) {
            defs.push({ typeId: 'periapsis', world: apPe.pe, alt: apPe.peAlt, tToNext: info ? info.tToPe : null });
        }
        if (tExit === null) {
            defs.push({ typeId: 'apoapsis', world: apPe.ap, alt: apPe.apAlt, tToNext: info ? info.tToAp : null });
        }
    }

    for (const d of defs) {
        const def = ORBIT_POINT_TYPES[d.typeId];
        if (!def) continue;
        const wx = d.world.x + anchor.x;
        const wy = d.world.y + anchor.y;
        const s = worldToScreen(wx, wy, canvas);
        markers.push({
            // 实例唯一 id（DOM 标签元素标识）：Ap/Pe 每类唯一，用类型本身
            id: d.typeId,
            type: d.typeId,
            worldX: wx, worldY: wy,
            screenX: s.x, screenY: s.y,
            bodyX: s.x + ORBIT_LABEL_DX,
            bodyY: s.y + ORBIT_LABEL_DY,
            icon: def.icon,
            label: t(def.labelKey),
            value: formatAltitude(d.alt - host.radius),
            // 精确海拔（米）：供展开面板"499,999 m"千分位格式；value 为 HUD 风格摘要文本
            altM: d.alt - host.radius,
            tToNext: d.tToNext,
            // 到达时刻的宇宙时间（秒）：供标签展开后显示 UT；无数据时为 null
            arrivalUt: (d.tToNext !== null && d.tToNext !== undefined) ? getCachedTime() + d.tToNext : null,
            contextMenu: def.contextMenu,
            // 悬停按实例 id 匹配优先（SOI 标签同 type 多次出现时只高亮命中的那个），
            // 无 id 的外部 marker 回退按 type 匹配
            isHover: !!hoveredMarker && (hoveredMarker.id ? hoveredMarker.id === d.typeId
                : hoveredMarker.type === d.typeId)
        });
    }

    // ===== SOI 穿越标签（0.3.0）：存在 SOI 穿越时，段尾=离开该段 SOI、段头=进入该段 SOI =====
    // 可由可见性面板"SOI 切换标签"开关控制（soiLabels === false 时不生成）
    // 数据源：本帧预测 segments（与轨道线同源）；段点 t = 段起点（anchorTime）起的秒偏移
    // → 到边界时刻 tToNext = anchorTime + relPt.t − 当前游戏时间；段 0 头（飞船位置）不标"进入"。
    // 注意：段 i 尾与段 i+1 头是世界同一点，但渲染锚点各自不同（宿主当前时刻位置），
    // 屏幕位置不同（跨 SOI 衔接线两端），标签天然不重叠。
    const segments = getLastOrbitSegments();
    if (segments && segments.length > 1 && _lastVisibility.soiLabels !== false) {
        const now = getCachedTime();
        for (let si = 0; si < segments.length; si++) {
            const seg = segments[si];
            if (!seg.relPoints || seg.relPoints.length < 2) continue;
            const segAnchor = getSegmentAnchor(seg);
            const hostBody = celestialBodies.find(b => b.name === seg.anchorBody);

            // 段尾（有后续段 → 末点即 SOI 边界）：离开 seg.soiName
            if (si < segments.length - 1) {
                pushSoiTag(markers, 'soi_exit', si, seg.relPoints[seg.relPoints.length - 1],
                    seg, segAnchor, hostBody, now, canvas, hoveredMarker);
            }
            // 段头（si>0 → 首点即从上级进入的边界点）：进入 seg.soiName
            if (si > 0) {
                pushSoiTag(markers, 'soi_entry', si, seg.relPoints[0],
                    seg, segAnchor, hostBody, now, canvas, hoveredMarker);
            }
        }
    }

    // ===== 标签避让（KSP2 风格，0.3.0）：同一 SOI 边界两端的离开/进入标签若挤在一起，
    // 则后段"进入"标签沿两标签连线方向推开（leader 线相应延长），迭代收敛 =====
    applyLabelAvoidance(markers);

    // Canvas：折线（锚点 → 本体位置，单段直线）+ 锚点（旋转 45° 正方形 = 菱形）
    // 统一使用飞行界面紫（ORBIT_MARKER_COLOR），类型区分只在 DOM 标签文字颜色；
    // 锚点悬停高亮效果已去除（0.3.0：悬停只作用于 DOM 标签本体），恒普通样式
    for (const m of markers) {
        const r = 3.5;

        ctx.beginPath();
        ctx.moveTo(m.screenX, m.screenY);
        ctx.lineTo(m.bodyX, m.bodyY);
        ctx.strokeStyle = ORBIT_MARKER_COLOR;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.translate(m.screenX, m.screenY);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = ORBIT_MARKER_COLOR;
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.rect(-r, -r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // 轨道线任意点悬停高亮（0.3.0 提交4）：hoveredMarker 为 orbitPoint 命中参数时，
    // 用本帧 segments 同帧重算（resolveOrbitHit）—— 与轨道线同源，warp 重锚下零错位
    if (hoveredMarker && hoveredMarker.type === 'orbitPoint') {
        const cur = resolveOrbitHit(hoveredMarker, canvas);
        if (cur) {
            ctx.beginPath();
            ctx.arc(cur.screenX, cur.screenY, 5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 220, 90, 0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // DOM 文字本体同步（与 Canvas 同帧同源）
    syncOrbitLabels(markers, canvas);
    return markers;
}

// SOI 穿越标签构建（0.3.0）：push 单个边界点标签（段尾=离开 / 段头=进入）
// relPt 为段内相对锚点坐标；id 用"类型+段索引+头尾"保证实例唯一
// （同一 type 可出现多次——多次穿越有多个离开/进入标签，DOM 元素必须按 id 区分）；
// name 防御：soiName 缺失时回退 anchorBody，再回退深空文案（防"离开 undefined"）
function pushSoiTag(markers, typeId, segIndex, relPt, seg, segAnchor, hostBody, now, canvas, hoveredMarker) {
    const def = ORBIT_POINT_TYPES[typeId];
    if (!def) return;

    const name = seg.soiName || seg.anchorBody || t('orbit.type.deepSpace');
    const isExit = typeId === 'soi_exit';
    const id = typeId + '_' + segIndex + (isExit ? '_out' : '_in');
    const wx = relPt.x + segAnchor.x;
    const wy = relPt.y + segAnchor.y;
    const s = worldToScreen(wx, wy, canvas);
    // 边界高度：边界点距段宿主中心距离 − 天体半径（宿主缺失（深空段）时无数据）
    const dist = Math.hypot(relPt.x, relPt.y);
    const alt = hostBody ? dist - hostBody.radius : null;
    // 到边界时刻：段点绝对时刻（anchorTime + t）− 当前游戏时间（防御负值/缺 t 字段）
    const tToNext = (relPt.t !== undefined) ? Math.max(0, (seg.anchorTime + relPt.t) - now) : null;

    markers.push({
        id,
        type: typeId,
        // 目标天体名（图标化后本体文字只显示名称；展开面板标题/状态行复用）
        name,
        worldX: wx, worldY: wy,
        screenX: s.x, screenY: s.y,
        bodyX: s.x + ORBIT_LABEL_DX,
        bodyY: s.y + ORBIT_LABEL_DY,
        icon: def.icon,
        label: t(def.labelKey, { name }),
        value: alt !== null ? formatAltitude(alt) : '--',
        altM: alt,
        // 展开面板状态行（替代高度行）：正在离开/正在遭遇
        statusText: t(isExit ? 'orbitPoint.soiLeaving' : 'orbitPoint.soiEncounter', { name }),
        tToNext,
        arrivalUt: tToNext !== null ? now + tToNext : null,
        contextMenu: def.contextMenu,
        // 悬停按实例 id 匹配优先（同 type 多实例只高亮命中的那个）
        isHover: !!hoveredMarker && (hoveredMarker.id ? hoveredMarker.id === id
            : hoveredMarker.type === typeId)
    });
}

// KSP2 风格标签避让（0.3.0 修复4）：所有标签（SOI 穿越 + Ap/Pe）两两 body 挤压时
// 沿两者连线方向互相推开（各推一半；锚点不动、leader 线相应延长），迭代收敛。
// 全标不丢弃，只错位——多次穿越时同类型标签同堆（进入×2 等）也必须互相避让。
const LABEL_MIN_DIST = 70;   // 标签 body 最小间隔（px）
function applyLabelAvoidance(markers) {
    for (let iter = 0; iter < 4; iter++) {
        let adjusted = false;
        for (let i = 0; i < markers.length; i++) {
            for (let j = i + 1; j < markers.length; j++) {
                const a = markers[i];
                const b = markers[j];
                let dx = b.bodyX - a.bodyX;
                let dy = b.bodyY - a.bodyY;
                let d = Math.hypot(dx, dy);
                if (d < LABEL_MIN_DIST) {
                    // 完全重合时给固定方向，避免除零/抖动
                    if (d < 1) { dx = 1; dy = 0.5; d = Math.hypot(dx, dy); }
                    const push = (LABEL_MIN_DIST - d) / 2 + 2;   // 各推一半 + 余量
                    a.bodyX -= dx / d * push;
                    a.bodyY -= dy / d * push;
                    b.bodyX += dx / d * push;
                    b.bodyY += dy / d * push;
                    adjusted = true;
                }
            }
        }
        if (!adjusted) break;
    }
}

// 屏幕空间点到线段的最短距离（平方）与线段插值参数 t（0~1）
// 返回 { distSq, t }：distSq 供阈值比较（避免逐对开方），t 为命中点在线段上的位置。
// 世界→屏幕是仿射变换（线性缩放 + Y 翻转 + 平移），线段映射保持线性，
// 因此该 t 可直接复用于世界坐标与时间插值（见 findNearestOrbitPoint）。
function distToSegmentSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
    }
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const ex = px - cx;
    const ey = py - cy;
    return { distSq: ex * ex + ey * ey, t };
}

/**
 * 在轨道预测 segments 中找距鼠标最近的轨道点（屏幕空间点-线段距离）
 * 方案：鼠标世界坐标先转屏幕，逐点 worldToScreen 后计算屏幕空间点到线段的距离，
 * 阈值 thresholdPx 直接在屏幕像素空间比较 —— 避免"世界距离阈值 / zoom"
 * 在极限缩放下失效（zoom→0 时阈值膨胀为天文数字，悬停恒命中）。
 * 命中点附带插值时间（段内秒偏移，绝对时刻 = seg.anchorTime + timeOffset）。
 * 悬停/右键共用本函数；内部使用 getSegmentAnchor 与轨道线渲染同口径锚点。
 * @param {Array} segments - getLastOrbitSegments() 的同一批 segments
 * @param {Object} mouseWorld - { x, y } 鼠标世界坐标（screenToWorld 产出）
 * @param {number} thresholdPx - 悬停判定阈值（屏幕像素）
 * @param {HTMLCanvasElement} canvas
 * @returns {Object|null} 命中信息，无命中返回 null：
 *   {
 *     segmentIndex, pointIndex,   // 命中线段 [pointIndex, pointIndex+1]
 *     segT,                       // 线段内插值参数 0~1
 *     worldX, worldY,             // 线段上最近点（世界坐标）
 *     screenX, screenY,           // 线段上最近点（屏幕坐标）
 *     distPx,                     // 鼠标到最近点的屏幕距离（像素）
 *     soiName, isCurrentSoi,      // 段归属 SOI（跨 SOI 段区分用）
 *     timeOffset                  // 插值时间（段内秒偏移，缺 t 字段时为 null）
 *   }
 */
function findNearestOrbitPoint(segments, mouseWorld, thresholdPx, canvas) {
    if (!segments || segments.length === 0 || !mouseWorld || !canvas) return null;

    // 鼠标统一到屏幕空间（与线段点同坐标系比较）
    const mouse = worldToScreen(mouseWorld.x, mouseWorld.y, canvas);
    const thresholdSq = thresholdPx * thresholdPx;
    let best = null;
    let bestDistSq = thresholdSq;

    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        if (!seg.relPoints || seg.relPoints.length < 2) continue;

        const anchor = getSegmentAnchor(seg);
        let prev = worldToScreen(seg.relPoints[0].x + anchor.x, seg.relPoints[0].y + anchor.y, canvas);

        for (let pi = 1; pi < seg.relPoints.length; pi++) {
            const rp = seg.relPoints[pi];
            const cur = worldToScreen(rp.x + anchor.x, rp.y + anchor.y, canvas);

            const hit = distToSegmentSq(mouse.x, mouse.y, prev.x, prev.y, cur.x, cur.y);
            if (hit.distSq < bestDistSq) {
                bestDistSq = hit.distSq;
                const p0 = seg.relPoints[pi - 1];
                // 屏幕线段上的插值参数 t 可直接复用于世界线段（仿射变换保线性）
                best = {
                    segmentIndex: si,
                    pointIndex: pi - 1,
                    segT: hit.t,
                    worldX: (p0.x + (rp.x - p0.x) * hit.t) + anchor.x,
                    worldY: (p0.y + (rp.y - p0.y) * hit.t) + anchor.y,
                    screenX: prev.x + (cur.x - prev.x) * hit.t,
                    screenY: prev.y + (cur.y - prev.y) * hit.t,
                    soiName: seg.soiName,
                    isCurrentSoi: seg.isCurrentSoi,
                    // 时间与位置同参数插值；外部构造的段可能缺 t 字段，防御为 null
                    timeOffset: (p0.t !== undefined && rp.t !== undefined)
                        ? p0.t + (rp.t - p0.t) * hit.t
                        : null
                };
            }
            prev = cur;
        }
    }

    if (!best) return null;
    best.distPx = Math.sqrt(bestDistSq);
    return best;
}

// 悬停状态通道：flightScene 在 mousemove 中写入，renderOrbitMarkers 绘制时消费
function setOrbitHoverState(state) {
    _orbitHoverState = state;
}

function getOrbitHoverState() {
    return _orbitHoverState;
}

// 轨道几何数据通道：本帧已绘制内容，交互层只读（悬停检测 / 右键菜单数据源）
function getLastOrbitSegments() {
    return _lastOrbitSegments;
}

function getLastOrbitMarkers() {
    return _lastOrbitMarkers;
}

// ========== 飞行 HUD（顶部轨道数据 + 推力箭头） ==========

// HUD 绿色系 — 呼应 getOrbitColor 中当前 SOI 轨道线颜色 rgba(64,224,80,0.85)
const HUD_GREEN = '64, 224, 80';
const HUD_LABEL = `rgba(${HUD_GREEN}, 0.45)`;
const HUD_VALUE = `rgba(${HUD_GREEN}, 0.95)`;
const HUD_WARN = 'rgba(255, 80, 80, 0.95)';
const HUD_ESCAPE = 'rgba(255, 220, 80, 0.95)';

// 轨道类型 → 显示文本（数据驱动收敛：文案入库 strings.js）
const ORBIT_TYPE_TEXT = {
    circular: t('orbit.type.circular'),
    elliptical: t('orbit.type.elliptical'),
    suborbital: t('orbit.type.suborbital'),
    escape: t('orbit.type.escape'),
    deep_space: t('orbit.type.deepSpace')
};

// 高度格式化：≥1000m 显示 km，否则 m
function formatAltitude(m) {
    if (m === null || m === undefined || !isFinite(m)) return '--';
    if (Math.abs(m) >= 1000) return (m / 1000).toFixed(1) + ' km';
    return m.toFixed(0) + ' m';
}

// 速度格式化：≥1000m/s 显示 km/s
function formatSpeed(mps) {
    if (mps === null || mps === undefined || !isFinite(mps)) return '--';
    if (Math.abs(mps) >= 1000) return (mps / 1000).toFixed(2) + ' km/s';
    return mps.toFixed(1) + ' m/s';
}

// 时长格式化（0.3.0 迁移至 utils/format.js 共享，此处不再定义）

// 顶部轨道数据 HUD：2 行 × 4 列纯文字，绿色系，以画布中轴中心对称
function renderOrbitHud(ctx, canvas, ship) {
    const body = ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
    // 用当前 pos/vel 实时反算瞬时轨道元素，而不是直接用 ship.kepler：
    // 1) ship.kepler.theta 不随在轨推进更新，直接用会使 T+Ap/T+Pe 冻结；
    // 2) 推力模式下 ship.kepler 是上一次在轨的值，直接用会使 Ap/Pe 滞后。
    const liveKepler = (ship.currentGM > 0)
        ? stateToKepler(ship.pos, ship.vel, ship.currentGM)
        : null;
    const info = getOrbitalInfo(liveKepler, ship.currentGM, body, ship.pos);
    if (!info) return;

    const soiText = (ship.currentSOI || t('orbit.type.deepSpace'))
        + (info.orbitType === 'deep_space' ? '' : ' · ' + (ORBIT_TYPE_TEXT[info.orbitType] || '--'));

    const vel = Math.sqrt(ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y);

    const typeColor = info.orbitType === 'suborbital' ? HUD_WARN
        : info.orbitType === 'escape' ? HUD_ESCAPE
        : HUD_VALUE;

    const rows = [
        [
            { label: 'Ap', value: formatAltitude(info.apAlt), warn: info.apAlt !== null && info.apAlt < 0 },
            { label: 'Pe', value: formatAltitude(info.peAlt), warn: info.peAlt !== null && info.peAlt < 0 },
            { label: 'ALT', value: formatAltitude(info.currentAlt) },
            { label: 'VEL', value: formatSpeed(vel) }
        ],
        [
            { label: 'T+Ap', value: formatDuration(info.tToAp) },
            { label: 'T+Pe', value: formatDuration(info.tToPe) },
            { label: 'T', value: formatDuration(info.period) },
            { label: 'SOI', value: soiText, color: typeColor, small: true }
        ]
    ];

    const cols = 4;
    const colW = 150;
    const totalW = cols * colW;
    const startX = (canvas.width - totalW) / 2;
    const topY = 30;

    ctx.textAlign = 'center';
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = rows[r][c];
            const cx = startX + c * colW + colW / 2;
            const cy = topY + r * 36;
            // label 小字
            ctx.fillStyle = cell.warn ? 'rgba(255, 80, 80, 0.6)' : HUD_LABEL;
            ctx.font = '10px monospace';
            ctx.fillText(cell.label, cx, cy);
            // value 大字
            ctx.fillStyle = cell.warn ? HUD_WARN : (cell.color || HUD_VALUE);
            ctx.font = (cell.small ? '12px' : '14px') + ' monospace';
            ctx.fillText(cell.value, cx, cy + 15);
        }
    }
}

// 飞行HUD（顶部轨道数据 + 推力箭头）
function renderFlightHud(ctx, canvas, ship) {
    if (!ship) return;

    // === 顶部轨道数据 HUD ===
    renderOrbitHud(ctx, canvas, ship);

    // === 大气进入警告（倒计时） ===
    if (ship._atmoDanger) {
        const danger = ship._atmoDanger;
        const remaining = Math.max(0, danger.remaining);
        // 闪烁：约 4Hz 交替背景色
        const blink = Math.floor(performance.now() / 250) % 2 === 0;
        ctx.save();
        // 显式居中绘制（renderOrbitHud 残留的 textAlign 不会影响：这里重新设置）
        ctx.textAlign = 'center';
        ctx.fillStyle = blink ? 'rgba(255, 40, 40, 0.95)' : 'rgba(180, 30, 30, 0.95)';
        const bannerText = `⚠ 警告：进入 ${danger.bodyName} 大气层！剩余 ${remaining.toFixed(1)}s`;
        ctx.font = 'bold 18px monospace';
        const textWidth = ctx.measureText(bannerText).width;
        // 位置在轨道数据 HUD（y 30~81）下方，避免重叠
        const bx = canvas.width / 2;
        const by = 120;
        ctx.fillRect(bx - textWidth / 2 - 12, by - 22, textWidth + 24, 30);
        ctx.fillStyle = '#fff';
        ctx.fillText(bannerText, bx, by);
        ctx.restore();
    }

    // === 推力方向箭头（仅在推力模式下绘制） ===
    if (ship.throttle > 0) {
        const absPos = getAbsolutePosition(ship);
        const shipScreen = worldToScreen(absPos.x, absPos.y, canvas);
        const arrowLen = 30;
        // heading=0 → 世界+Y → 屏幕-Y（Canvas Y轴朝下）
        const endX = shipScreen.x + Math.sin(ship.heading) * arrowLen;
        const endY = shipScreen.y - Math.cos(ship.heading) * arrowLen;

        ctx.strokeStyle = 'rgba(68, 204, 68, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(shipScreen.x, shipScreen.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // 箭头头部三角
        const headLen = 8;
        const angle = ship.heading;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
            endX - headLen * Math.cos(angle - 0.5),
            endY + headLen * Math.sin(angle - 0.5)
        );
        ctx.lineTo(
            endX - headLen * Math.cos(angle + 0.5),
            endY + headLen * Math.sin(angle + 0.5)
        );
        ctx.closePath();
        ctx.fillStyle = 'rgba(68, 204, 68, 0.8)';
        ctx.fill();
    }
}
