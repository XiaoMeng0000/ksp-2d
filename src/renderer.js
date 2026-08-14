import { camera, worldToScreen } from './camera.js';
import { celestialBodies, getAbsolutePosition } from './physics/physics.js';
import { predictTrajectoryPatched, predictTrajectoryBurned, bodyFuturePos, getCachedTime } from './physics/orbitalPrediction.js';
import { getOrbitalInfo, stateToKepler } from './physics/orbitalMechanics.js';
import { getFacilityType } from './facility/facilityTypes.js';
import { renderableManager } from './graphics/renderable.js';
import { textureManager } from './graphics/textureManager.js';
import { drawStarGlow, drawStarBall, drawPlanetRing } from './graphics/programEffects.js';
import { STARFIELD_CONFIG } from './config/starfieldConfig.js';
import { t } from './config/strings.js';

// 星空背景（天空盒）：屏幕空间固定坐标 + 固定像素尺寸，与相机解耦
let stars = [];
const BODY_MIN_SCREEN_RADIUS = 3;  // 天体最低屏幕半径，防止远距离缩成一个像素以下

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
 */
function createStars(canvasWidth, canvasHeight) {
    const cfg = STARFIELD_CONFIG;
    // 按屏幕面积（含边缘余量）计算星数，限制在 [minCount, maxCount] 防失控
    const totalArea = (canvasWidth + cfg.margin * 2) * (canvasHeight + cfg.margin * 2);
    const count = Math.round(totalArea / cfg.density);
    const n = Math.max(cfg.minCount, Math.min(cfg.maxCount, count));

    stars = [];
    for (let i = 0; i < n; i++) {
        stars.push({
            x: Math.random() * (canvasWidth + cfg.margin * 2) - cfg.margin,
            y: Math.random() * (canvasHeight + cfg.margin * 2) - cfg.margin,
            radius: cfg.radiusRange.min + Math.random() * (cfg.radiusRange.max - cfg.radiusRange.min),
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
    const { visibility = { ships: false, facilities: false, bodyOrbits: true }, facilities = [], selectedFacilityId = null } = options;
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

        // SOI 边界圆（屏幕半径小于 1 时不绘制，避免画面混乱）
        const soiScreenR = body.soiRadius * camera.zoom;
        if (soiScreenR >= 1) {
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
                if (hazardScreenR >= 1) {
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, hazardScreenR, 0, Math.PI * 2);
                    ctx.setLineDash([6, 4]);
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
        const allShips = window.__shipSystem?.getAllShips() || [];
        for (const s of allShips) {
            if (s.id !== activeShip?.id) shipsToRender.push(s);
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
        if (visibility.facilityRange !== false) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, f.interactionRange * camera.zoom, 0, Math.PI * 2);
            // 选中设施用高亮色，未选中用类型色（半透明）
            const rangeColor = f.id === selectedFacilityId
                ? 'rgba(255, 255, 100, 0.35)'
                : hexToRgba(color, 0.15);
            ctx.strokeStyle = rangeColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

export { createStars, render, renderFlightHud };

// ========== 轨道线渲染系统 ==========

// 根据 SOI 名称返回轨道线颜色
// isCurrentSoi=true → 固定绿色；否则从亮色池哈希取色
function getOrbitColor(soiName, isManeuver = false, isCurrentSoi = false) {
    if (isManeuver) return 'rgba(255, 68, 68, 0.8)';
    if (isCurrentSoi) return 'rgba(64, 224, 80, 0.85)';

    const brightColors = [
        'rgba(68, 255, 136, 0.8)',
        'rgba(255, 255, 68, 0.8)',
        'rgba(255, 68, 255, 0.8)',
        'rgba(68, 255, 255, 0.8)',
        'rgba(255, 136, 68, 0.8)',
        'rgba(136, 68, 255, 0.8)'
    ];
    const safeName = soiName || t('orbit.type.deepSpace');
    let hash = 0;
    for (let i = 0; i < safeName.length; i++) hash = (hash * 31 + safeName.charCodeAt(i)) | 0;
    return brightColors[Math.abs(hash) % brightColors.length];
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
    if (!ship) return;

    let segments;
    if (ship.mode === 'on_rails') {
        segments = predictTrajectoryPatched(ship);
    } else {
        // 推力模式：显示假设立即熄火的常规轨道
        segments = predictTrajectoryBurned(ship, false);
    }

    // 非活动飞船只显示当前 SOI 段（第 0 段），避免跨 SOI 预测复杂性
    if (!segments || !Array.isArray(segments)) return;
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
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

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

// 时长格式化：1h 30m 00s / 12m 30s / 45s
function formatDuration(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '--';
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
    if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
    return s + 's';
}

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
