import { camera, worldToScreen } from './camera.js';
import { celestialBodies } from './physics/physics.js';
import { predictTrajectoryPatched, predictTrajectoryBurned } from './physics/orbitalPrediction.js';
import { getFacilityType } from './facility/facilityTypes.js';
import { renderableManager } from './graphics/renderable.js';
import { textureManager } from './graphics/textureManager.js';

let stars = [];
const STAR_COUNT = 800;
const WORLD_RANGE = 2000;

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function render(ctx, canvas, activeShip, options = {}) {
    const { visibility = { ships: false, facilities: false }, facilities = [], selectedFacilityId = null } = options;
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

    for (const body of celestialBodies) {
        const screen = worldToScreen(body.position.x, body.position.y, canvas);
        const drawRadius = body.displayRadius * camera.zoom;

        ctx.beginPath();
        ctx.arc(screen.x, screen.y, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = body.color;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(screen.x, screen.y, body.soiRadius * camera.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
        ctx.lineWidth = Math.max(1, 2 * camera.zoom);
        ctx.stroke();
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

        const shipScreen = worldToScreen(s.pos.x, s.pos.y, canvas);
        const shipSize = Math.max(6, (isActive ? 12 : 8) * camera.zoom);

        // 按飞船 heading 旋转绘制
        ctx.translate(shipScreen.x, shipScreen.y);
        ctx.rotate(s.heading || 0);

        // 船体图标：优先使用模板指定的纹理，否则用默认图
        const shipTexKey = s.iconTextureKey || (isActive ? 'ship_default_active' : 'ship_default_inactive');
        const shipTex = textureManager.get(shipTexKey);
        if (shipTex) {
            const halfSize = Math.max(3, 6 * camera.zoom);  // 与设施图标统一尺寸
            ctx.drawImage(shipTex, -halfSize, -halfSize, halfSize * 2, halfSize * 2);
        } else {
            // Fallback: 程序化三角形
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
        const screen = worldToScreen(f.pos.x, f.pos.y, canvas);
        const halfSize = Math.max(3, 6 * camera.zoom);
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
        const shipScreen = worldToScreen(ship.pos.x, ship.pos.y, canvas);
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
