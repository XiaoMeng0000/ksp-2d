import { camera, worldToScreen } from './camera.js';
import { celestialBodies, getAbsolutePosition } from './physics/physics.js';
import { predictTrajectoryPatched, predictTrajectoryBurned } from './physics/orbitalPrediction.js';
import { getFacilityType } from './facility/facilityTypes.js';
import { renderableManager } from './graphics/renderable.js';
import { textureManager } from './graphics/textureManager.js';
import { drawStarGlow, drawStarBall } from './graphics/programEffects.js';

let stars = [];
const STAR_COUNT = 800;
const WORLD_RANGE = 6.8e10;  // Kerbin 轨道半径 × 5，适配真实 KSP 尺度
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
        }
    }

    return rendered;
}

function createStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
        const dist = Math.random() * WORLD_RANGE;
        const angle = Math.random() * Math.PI * 2;
        stars.push({
            x: dist * Math.cos(angle),
            y: dist * Math.sin(angle),
            radius: 0.8 + Math.random() * 1.5,
            brightness: 0.3 + Math.random() * 0.7
        });
    }
}

/**
 * 绘制天体轨道线（以天体自身代表色，数据驱动）
 * 轨道圆心 = 父天体当前 position，形状参数来自 orbitA/orbitE/orbitOmega
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

        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
            const theta = (i / points) * Math.PI * 2;
            const localX = pixelR * Math.cos(theta);
            const localY = semiMinor * Math.sin(theta);
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

    for (const star of stars) {
        const screen = worldToScreen(star.x, star.y, canvas);
        if (screen.x < -50 || screen.x > canvas.width + 50 ||
            screen.y < -50 || screen.y > canvas.height + 50) continue;
        
        const drawRadius = Math.max(0.5, star.radius * camera.zoom);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
        ctx.fill();
    }

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
    const safeName = soiName || '深空';
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

// 轨道线渲染主入口
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
        if (seg.points.length < 2) continue;

        const color = isActive ? getOrbitColor(seg.soiName, false, seg.isCurrentSoi) : '#888888';

        ctx.beginPath();
        const p0 = worldToScreen(seg.points[0].x, seg.points[0].y, canvas);
        ctx.moveTo(p0.x, p0.y);

        for (let i = 1; i < seg.points.length; i++) {
            const p = worldToScreen(seg.points[i].x, seg.points[i].y, canvas);
            ctx.lineTo(p.x, p.y);
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.setLineDash(seg.isCurrentSoi ? [] : [8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 跨SOI衔接线：非活动飞船跳过
    if (!isActive) return;

    for (let si = 0; si < segments.length - 1; si++) {
        const seg = segments[si];
        const nextSeg = segments[si + 1];
        if (seg.points.length < 2 || nextSeg.points.length < 2) continue;
        if (getSOIDirection(seg.soiName, nextSeg.soiName) !== 'up') continue;

        const lastP = seg.points[seg.points.length - 1];
        const firstP = nextSeg.points[0];
        const nextColor = getOrbitColor(nextSeg.soiName, false, nextSeg.isCurrentSoi);
        ctx.beginPath();
        const s0 = worldToScreen(lastP.x, lastP.y, canvas);
        const s1 = worldToScreen(firstP.x, firstP.y, canvas);
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

// 飞行HUD（速度显示 + 推力箭头）
function renderFlightHud(ctx, canvas, ship) {
    if (!ship) return;

    // === 速度显示（屏幕中下方） ===
    const speed = Math.sqrt(ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y);
    let speedStr, unit;
    if (speed >= 1000) {
        speedStr = (speed / 1000).toFixed(2);
        unit = 'km/s';
    } else {
        speedStr = speed.toFixed(1);
        unit = 'm/s';
    }

    const speedBoxW = 130;
    const speedBoxH = 40;
    const speedBoxX = (canvas.width - speedBoxW) / 2;
    const speedBoxY = canvas.height - speedBoxH - 40;
    const radius = 4;

    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.moveTo(speedBoxX + radius, speedBoxY);
    ctx.lineTo(speedBoxX + speedBoxW - radius, speedBoxY);
    ctx.arcTo(speedBoxX + speedBoxW, speedBoxY, speedBoxX + speedBoxW, speedBoxY + radius, radius);
    ctx.lineTo(speedBoxX + speedBoxW, speedBoxY + speedBoxH - radius);
    ctx.arcTo(speedBoxX + speedBoxW, speedBoxY + speedBoxH, speedBoxX + speedBoxW - radius, speedBoxY + speedBoxH, radius);
    ctx.lineTo(speedBoxX + radius, speedBoxY + speedBoxH);
    ctx.arcTo(speedBoxX, speedBoxY + speedBoxH, speedBoxX, speedBoxY + speedBoxH - radius, radius);
    ctx.lineTo(speedBoxX, speedBoxY + radius);
    ctx.arcTo(speedBoxX, speedBoxY, speedBoxX + radius, speedBoxY, radius);
    ctx.closePath();
    ctx.fill();

    // 速度值
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(speedStr, speedBoxX + speedBoxW / 2 - 14, speedBoxY + 27);

    // 单位
    ctx.fillStyle = '#999999';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(unit, speedBoxX + speedBoxW / 2 + 8, speedBoxY + 27);

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
