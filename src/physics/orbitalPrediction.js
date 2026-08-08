import { eventBus, Events } from '../eventBus.js';
import { celestialBodies, getAbsolutePosition } from './physics.js';
import { rk4Integrate } from './integrator.js';
import { stateToKepler, keplerPositionAtTime, keplerPositionAtTheta, findSOIIntersection } from './orbitalMechanics.js';

// SOI 边界诊断开关 — 运行时从 window 读取，支持控制台热切换
function soiDiagEnabled() {
    return window._soiDiag === true;
}

// 缓存最近一次广播的游戏时间，供轨道预测使用
let _cachedTime = 0;
eventBus.on(Events.CELESTIAL_TIME_UPDATED, ({ time }) => {
    _cachedTime = time;
});

// ========== 轨道预测辅助函数 ==========

// 递归计算天体在 futureTime 时的绝对世界坐标
function bodyFuturePos(body, futureTime) {
    if (!body) return { x: 0, y: 0 };
    if (!body.orbitParent) return { x: body.position.x, y: body.position.y };

    const parent = celestialBodies.find(b => b.name === body.orbitParent);
    if (!parent) return { x: body.position.x, y: body.position.y };

    const parentPos = bodyFuturePos(parent, futureTime);
    const kepler = { a: body.orbitA, e: body.orbitE, theta: body.orbitTheta0, omega: body.orbitOmega };
    const relPos = keplerPositionAtTime(kepler, parent.gm, futureTime, body.orbitOmega);

    return { x: parentPos.x + relPos.x, y: parentPos.y + relPos.y };
}

// 数值微分计算天体在 futureTime 时的速度
function bodyFutureVel(body, futureTime) {
    if (!body) return { x: 0, y: 0 };
    const dt2 = 0.001;
    const pos1 = bodyFuturePos(body, futureTime);
    const pos2 = bodyFuturePos(body, futureTime + dt2);
    return { x: (pos2.x - pos1.x) / dt2, y: (pos2.y - pos1.y) / dt2 };
}

// 时间敏感的 SOI 检测：判断 pos 在 time 时刻属于哪个天体的 SOI
export function getSOIHostAtTime(pos, time) {
    let starHost = null;
    let closestNonStar = null;
    let closestDist = Infinity;

    for (const body of celestialBodies) {
        const bodyPos = bodyFuturePos(body, time);
        const dx = bodyPos.x - pos.x;
        const dy = bodyPos.y - pos.y;
        const r = Math.sqrt(dx * dx + dy * dy);

        if (r < body.soiRadius) {
            if (body.type === 'star') {
                starHost = body;
            } else {
                if (r < closestDist) {
                    closestDist = r;
                    closestNonStar = body;
                }
            }
        }
    }
    return closestNonStar || starHost;
}

// ========== 轨道预测主函数 ==========

// 递归内部：分段拼接一步，采样从 theta0 到交点或完整轨道
function patchedStep(posAbs, velRel, host, stepStartTime, depth, maxSeg, segments) {
    if (depth >= maxSeg) return;

    const hostPos = bodyFuturePos(host, stepStartTime);
    const relPos = { x: posAbs.x - hostPos.x, y: posAbs.y - hostPos.y };
    const kepler = stateToKepler(relPos, velRel, host.gm);

    // 双曲线轨道（a<0）：解析推进到 SOI 边界交点（与椭圆"穿越 SOI"分支同构）
    if (kepler && kepler.a < 0) {
        const intersection = findSOIIntersection(kepler, host.gm, host.soiRadius);

        if (!intersection) {
            // 无交点兜底：时间采样推进（解析）直到出 SOI
            const pts = [{ x: posAbs.x, y: posAbs.y }];
            const aMag = -kepler.a;
            const v0 = Math.sqrt(velRel.x * velRel.x + velRel.y * velRel.y);
            const r0 = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
            const estT = (v0 > 0.01) ? (host.soiRadius - r0) / v0 : 300;
            const stepT = Math.max(1, estT / 60);
            const maxSteps = 600;
            for (let i = 1; i <= maxSteps; i++) {
                const t = i * stepT;
                const hP = bodyFuturePos(host, stepStartTime + t);
                const rP = keplerPositionAtTime(kepler, host.gm, t, kepler.omega);
                const absP = { x: hP.x + rP.x, y: hP.y + rP.y };
                if (i % 2 === 0) pts.push(absP);
                if (Math.sqrt(rP.x * rP.x + rP.y * rP.y) > host.soiRadius) break;
            }
            segments.push({ points: pts, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: true });
            if (soiDiagEnabled()) {
                console.log(`[DIAG-轨道] patchedStep depth=${depth} host=${host.name} 双曲线无交点采样出界 pts=${pts.length}`);
            }
            return;
        }

        // dir 适配：解析推进在"运动坐标"θm=dir·θ 中求解（θm 沿运动方向单调增），
        // 保证顺行（dir=+1）/逆行（dir=-1）轨道的交点时间与采样方向均正确。
        // findSOIIntersection 返回的 intersection.theta 为真实角，映射回运动坐标后恒有 θm_end>θm_0
        const dir = kepler.dir === undefined ? 1 : kepler.dir;
        const theta0m = dir * kepler.theta;
        const thetaEndm = dir * intersection.theta;
        const deltaTheta = thetaEndm - theta0m;  // 运动坐标中沿运动方向单调增，恒为正

        // 到达交点时间：ΔM / n（双曲平近点角差，θm 单调增 → M 单调增，无需 mod 2π）
        const aMag = -kepler.a;
        const n = Math.sqrt(host.gm / (aMag * aMag * aMag));
        const F0 = 2 * Math.atanh(Math.max(-(1 - 1e-12), Math.min(1 - 1e-12,
            Math.sqrt((kepler.e - 1) / (kepler.e + 1)) * Math.tan(theta0m / 2))));
        const Fend = 2 * Math.atanh(Math.max(-(1 - 1e-12), Math.min(1 - 1e-12,
            Math.sqrt((kepler.e - 1) / (kepler.e + 1)) * Math.tan(thetaEndm / 2))));
        const deltaM = (kepler.e * Math.sinh(Fend) - Fend) - (kepler.e * Math.sinh(F0) - F0);
        const deltaT = Math.max(deltaM / n, 0.01);

        // 采样绘制（运动坐标插值 → 映射回真实真近点角，双曲线兼容 keplerPositionAtTheta）
        const N = Math.max(20, Math.min(Math.floor(deltaTheta / Math.PI * 100), 500));
        const points = [];
        const hP = bodyFuturePos(host, stepStartTime);
        for (let i = 0; i <= N; i++) {
            const frac = i / N;
            const th = dir * (theta0m + frac * deltaTheta);
            const rP = keplerPositionAtTheta({ a: kepler.a, e: kepler.e, omega: kepler.omega }, host.gm, th);
            points.push({ x: hP.x + rP.x, y: hP.y + rP.y });
        }
        segments.push({ points, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: true });

        // 交点处切换参考系 → 递归（与椭圆穿越分支同构）
        const intersectionTime = stepStartTime + deltaT;
        const hostPosEnd = bodyFuturePos(host, intersectionTime);
        const hostVelEnd = bodyFutureVel(host, intersectionTime);

        const nextAbsPos = {
            x: hostPosEnd.x + intersection.pos.x,
            y: hostPosEnd.y + intersection.pos.y
        };
        const nextAbsVel = {
            x: hostVelEnd.x + intersection.vel.x,
            y: hostVelEnd.y + intersection.vel.y
        };

        const nextHost = getSOIHostAtTime(nextAbsPos, intersectionTime);
        if (!nextHost || (nextHost.name === host.name)) return;

        const nextHostVel = bodyFutureVel(nextHost, intersectionTime);
        const nextRelVel = {
            x: nextAbsVel.x - nextHostVel.x,
            y: nextAbsVel.y - nextHostVel.y
        };

        patchedStep(nextAbsPos, nextRelVel, nextHost, intersectionTime, depth + 1, maxSeg, segments);
        return;
    }

    if (!kepler) {
        if (soiDiagEnabled()) {
            console.log(`[DIAG-轨道] patchedStep depth=${depth} host=${host.name} 双曲线/逃逸 startTime=${stepStartTime.toFixed(2)} posAbs=(${posAbs.x.toFixed(1)},${posAbs.y.toFixed(1)}) hostPos=(${hostPos.x.toFixed(1)},${hostPos.y.toFixed(1)})`);
        }
        // 深空/近抛物线（无轨道根数）：RK4 积分（相对坐标系），与物理引擎一致
        const hP0 = bodyFuturePos(host, stepStartTime);
        let relP = { x: posAbs.x - hP0.x, y: posAbs.y - hP0.y };
        let relV = { x: velRel.x, y: velRel.y };
        const pts = [{ x: posAbs.x, y: posAbs.y }];
        const dt = 0.05;
        for (let i = 1; i <= 1200; i++) {
            const t = i * dt;
            const hP = bodyFuturePos(host, stepStartTime + t);

            // RK4 步进（相对坐标系）
            const result = rk4Integrate(relP, relV, dt, host.gm, { ax: 0, ay: 0 });
            relP = result.pos;
            relV = result.vel;

            // 转到绝对坐标
            const absP = { x: hP.x + relP.x, y: hP.y + relP.y };

            if (i % 2 === 0) {
                pts.push(absP);
            }

            // 每步检测 SOI 切换
            const soiHost = getSOIHostAtTime(absP, stepStartTime + t);
            if (soiHost && soiHost.name !== host.name) {
                segments.push({ points: pts, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: true });
                if (soiDiagEnabled()) {
                    console.log(`[DIAG-轨道] patchedStep depth=${depth} 双曲线→切换 nextSoi=${soiHost.name} pts=${pts.length}`);
                }
                // 将相对速度转回绝对速度，再转到新宿主参考系
                const oldHostVel = bodyFutureVel(host, stepStartTime + t);
                const absVel = { x: relV.x + oldHostVel.x, y: relV.y + oldHostVel.y };
                const newHostVel = bodyFutureVel(soiHost, stepStartTime + t);
                const newRelVel = { x: absVel.x - newHostVel.x, y: absVel.y - newHostVel.y };
                patchedStep(absP, newRelVel, soiHost, stepStartTime + t, depth + 1, maxSeg, segments);
                return;
            }

            // 安全阀：避免飞出太远不收敛
            const relDistFinal = Math.sqrt(relP.x * relP.x + relP.y * relP.y);
            if (relDistFinal > host.soiRadius * 1.5) {
                break;
            }
        }
        segments.push({ points: pts, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: true });
        if (soiDiagEnabled()) {
            console.log(`[DIAG-轨道] patchedStep depth=${depth} host=${host.name} 双曲线出界 pts=${pts.length}`);
        }
        return;
    }

    // 椭圆轨道：检查是否穿越 SOI
    const intersection = findSOIIntersection(kepler, host.gm, host.soiRadius);

    if (!intersection) {
        // 轨道未离开当前宿主 SOI，但需检测是否进入其他天体嵌套 SOI
        const T = 2 * Math.PI * Math.sqrt(kepler.a * kepler.a * kepler.a / host.gm);
        const N = 200;

        // 绘制用点：固定锚点，保证以宿主为中心的视觉椭圆
        const drawPoints = [];
        const anchorHP = bodyFuturePos(host, stepStartTime);
        for (let i = 0; i <= N; i++) {
            const t = (i / N) * T;
            const rP = keplerPositionAtTime(kepler, host.gm, t, kepler.omega);
            drawPoints.push({ x: anchorHP.x + rP.x, y: anchorHP.y + rP.y });
        }

        // 扫描用点：逐点绝对坐标，用于 getSOIHostAtTime 精确检测
        const scanPoints = [];
        for (let i = 0; i <= N; i++) {
            const t = (i / N) * T;
            const hp = bodyFuturePos(host, stepStartTime + t);
            const rP = keplerPositionAtTime(kepler, host.gm, t, kepler.omega);
            scanPoints.push({ x: hp.x + rP.x, y: hp.y + rP.y });
        }

        // 逐点绝对坐标扫描 SOI 归属
        let switchIdx = -1;
        let nextSoiHost = null;
        for (let i = 1; i <= N; i++) {
            const t = (i / N) * T;
            const soiAtPt = getSOIHostAtTime(scanPoints[i], stepStartTime + t);
            if (soiAtPt && soiAtPt.name !== host.name) {
                switchIdx = i;
                nextSoiHost = soiAtPt;
                break;
            }
        }

        if (switchIdx === -1) {
            // 全程未切换 → 用固定锚点绘制完整轨道
            segments.push({ points: drawPoints, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: false });
            if (soiDiagEnabled()) {
                console.log(`[DIAG-轨道] patchedStep depth=${depth} host=${host.name} 椭圆无切换 pts=${drawPoints.length}`);
            }
            return;
        }

        // 二分法精确定位 SOI 切换时刻
        const tPrev = ((switchIdx - 1) / N) * T;
        const tCurr = (switchIdx / N) * T;
        let tLo = tPrev;
        let tHi = tCurr;
        for (let iter = 0; iter < 15; iter++) {
            const tMid = (tLo + tHi) / 2;
            const rPos = keplerPositionAtTime(kepler, host.gm, tMid, kepler.omega);
            const hpMid = bodyFuturePos(host, stepStartTime + tMid);
            const absPos = { x: hpMid.x + rPos.x, y: hpMid.y + rPos.y };
            const soiCheck = getSOIHostAtTime(absPos, stepStartTime + tMid);
            if (soiCheck && soiCheck.name === nextSoiHost.name) {
                tHi = tMid;
            } else {
                tLo = tMid;
            }
        }
        const switchTime = stepStartTime + tHi;

        // 精确切换点位置
        const rPosSwitch = keplerPositionAtTime(kepler, host.gm, tHi, kepler.omega);
        const hostPosSwitch = bodyFuturePos(host, switchTime);
        const switchAbsPos = { x: hostPosSwitch.x + rPosSwitch.x, y: hostPosSwitch.y + rPosSwitch.y };

        // 安全校验：切换点处确认新宿主
        const verifiedHost = getSOIHostAtTime(switchAbsPos, switchTime);
        if (!verifiedHost || verifiedHost.name === host.name) {
            segments.push({ points: drawPoints, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: false });
            return;
        }
        nextSoiHost = verifiedHost;

        // 截断至切换点：使用固定锚点的 drawPoints 保证视觉以宿主为中心
        const truncatedPoints = drawPoints.slice(0, switchIdx);
        const drawSwitchPos = { x: anchorHP.x + rPosSwitch.x, y: anchorHP.y + rPosSwitch.y };
        truncatedPoints.push(drawSwitchPos);
        segments.push({ points: truncatedPoints, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: false });

        // 数值微分求飞船绝对速度（两个绝对坐标差 / dt = 绝对速度）
        const dt2 = 0.001;
        const rPos2 = keplerPositionAtTime(kepler, host.gm, tHi + dt2, kepler.omega);
        const hostPos2 = bodyFuturePos(host, switchTime + dt2);
        const absPos2 = { x: hostPos2.x + rPos2.x, y: hostPos2.y + rPos2.y };
        const absVel = { x: (absPos2.x - switchAbsPos.x) / dt2, y: (absPos2.y - switchAbsPos.y) / dt2 };

        const newHostVel = bodyFutureVel(nextSoiHost, switchTime);
        const newRelVel = { x: absVel.x - newHostVel.x, y: absVel.y - newHostVel.y };

        patchedStep(switchAbsPos, newRelVel, nextSoiHost, switchTime, depth + 1, maxSeg, segments);
        return;
    }

    // 轨道穿越 SOI：采样到交点（运动坐标 θm=dir·θ 单调增，E/M 计算与插值均在其上进行）
    const dir = kepler.dir === undefined ? 1 : kepler.dir;
    const theta0m = dir * kepler.theta;
    const thetaEndm = dir * intersection.theta;
    const deltaTheta = (thetaEndm - theta0m + 2 * Math.PI) % (2 * Math.PI);

    // 到达交点的飞行时间
    const n = Math.sqrt(host.gm / (kepler.a * kepler.a * kepler.a));
    const E0 = 2 * Math.atan(Math.sqrt((1 - kepler.e) / (1 + kepler.e)) * Math.tan(theta0m / 2));
    const M0 = E0 - kepler.e * Math.sin(E0);
    const Eend = 2 * Math.atan(Math.sqrt((1 - kepler.e) / (1 + kepler.e)) * Math.tan(thetaEndm / 2));
    const Mend = Eend - kepler.e * Math.sin(Eend);
    let deltaM = Mend - M0;
    if (deltaM < 0) deltaM += 2 * Math.PI;
    const deltaT = Math.max(deltaM / n, 0.01);

    const N = Math.max(20, Math.floor(deltaTheta / Math.PI * 100));
    const points = [];
    const hP = bodyFuturePos(host, stepStartTime);
    for (let i = 0; i <= N; i++) {
        const frac = i / N;
        const th = dir * (theta0m + frac * deltaTheta);
        const rP = keplerPositionAtTheta({ a: kepler.a, e: kepler.e, omega: kepler.omega }, host.gm, th);
        points.push({ x: hP.x + rP.x, y: hP.y + rP.y });
    }
    segments.push({ points, soiName: host.name, isCurrentSoi: depth === 0, isHyperbolic: false });

    // 在交点处切换参考系 → 递归
    const intersectionTime = stepStartTime + deltaT;
    const hostPosEnd = bodyFuturePos(host, intersectionTime);
    const hostVelEnd = bodyFutureVel(host, intersectionTime);

    const nextAbsPos = {
        x: hostPosEnd.x + intersection.pos.x,
        y: hostPosEnd.y + intersection.pos.y
    };
    const nextAbsVel = {
        x: hostVelEnd.x + intersection.vel.x,
        y: hostVelEnd.y + intersection.vel.y
    };

    const nextHost = getSOIHostAtTime(nextAbsPos, intersectionTime);
    if (!nextHost || (nextHost.name === host.name)) return;

    const nextHostVel = bodyFutureVel(nextHost, intersectionTime);
    const nextRelVel = {
        x: nextAbsVel.x - nextHostVel.x,
        y: nextAbsVel.y - nextHostVel.y
    };

    patchedStep(nextAbsPos, nextRelVel, nextHost, intersectionTime, depth + 1, maxSeg, segments);
}

// 解析解分段预测 — 多段拼接完整轨道（含 SOI 穿越）
export function predictTrajectoryPatched(ship, maxSegments = 5) {
    const segments = [];
    const startTime = _cachedTime;

    // ship.pos 现在是相对坐标，转绝对坐标用于预测
    const absPos = getAbsolutePosition(ship);

    let host = null;
    if (ship.currentSOI) {
        host = celestialBodies.find(b => b.name === ship.currentSOI) || null;
    }
    if (!host) {
        host = getSOIHostAtTime(absPos, startTime);
    }

    if (soiDiagEnabled()) {
        console.log(`[DIAG-轨道] predictTrajectoryPatched host=${host?.name} startTime=${startTime.toFixed(2)} absPos=(${absPos.x.toFixed(1)},${absPos.y.toFixed(1)}) shipVel=(${ship.vel.x.toFixed(2)},${ship.vel.y.toFixed(2)}) shipSOI=${ship.currentSOI} kepler=${ship.kepler ? '有' : 'null'} mode=${ship.mode}`);
    }

    if (!host) return segments;  // predictTrajectoryPatched

    patchedStep(absPos, ship.vel, host, startTime, 0, maxSegments, segments);
    return segments;
}

// 通用燃烧弧积分函数：欧拉积分 dt=0.05s，供推力模式和机动节点共用
// 返回燃烧终点的相对状态 + 绝对世界坐标轨迹点数组
export function integrateThrustArc(relPos, relVel, gm, host, thrustAccel, burnDuration, soiRadiusLimit, startTime) {
    const dt = 0.05;
    const maxSteps = Math.ceil(burnDuration / dt);
    const points = [];

    let rp = { x: relPos.x, y: relPos.y };
    let rv = { x: relVel.x, y: relVel.y };

    // 起点（绝对世界坐标）
    const hostPos0 = bodyFuturePos(host, startTime);
    points.push({ x: hostPos0.x + rp.x, y: hostPos0.y + rp.y });

    for (let i = 1; i <= maxSteps; i++) {
        const r = Math.sqrt(rp.x * rp.x + rp.y * rp.y);
        const ga = (r > 0.001) ? gm / (r * r) : 0;
        rv.x += (-ga * rp.x / Math.max(r, 0.001) + thrustAccel.x) * dt;
        rv.y += (-ga * rp.y / Math.max(r, 0.001) + thrustAccel.y) * dt;
        rp.x += rv.x * dt;
        rp.y += rv.y * dt;
        if (i % 3 === 0) {
            const hostPos = bodyFuturePos(host, startTime + i * dt);
            points.push({ x: hostPos.x + rp.x, y: hostPos.y + rp.y });
        }
        if (r > host.soiRadius * soiRadiusLimit) break;
    }

    return {
        finalRelPos: { x: rp.x, y: rp.y },
        finalRelVel: { x: rv.x, y: rv.y },
        points: points
    };
}

// 推力模式：相对坐标系欧拉积分短预测（@deprecated — 内部改为调用 integrateThrustArc）
export function predictThrustTrajectory(ship) {
    const startTime = _cachedTime;
    const absPos = getAbsolutePosition(ship);

    let host = null;
    if (ship.currentSOI) {
        host = celestialBodies.find(b => b.name === ship.currentSOI) || null;
    }
    if (!host) {
        host = getSOIHostAtTime(absPos, startTime);
    }
    if (!host) return [];

    const hostRefPos = bodyFuturePos(host, startTime);
    const relPos = { x: absPos.x - hostRefPos.x, y: absPos.y - hostRefPos.y };
    const relVel = { x: ship.vel.x, y: ship.vel.y };
    const thrust = ship.thrust || { ax: 0, ay: 0 };
    const dt = 0.05;
    const v0 = Math.sqrt(relVel.x * relVel.x + relVel.y * relVel.y);
    const r0 = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
    const estPeriod = (v0 > 0.01 && r0 < host.soiRadius)
        ? 2 * Math.PI * r0 / v0
        : 120;
    const maxSteps = Math.min(Math.ceil(estPeriod / dt), 3000);

    const result = integrateThrustArc(relPos, relVel, host.gm, host, thrust, maxSteps * dt, 1.5, startTime);
    return [{ points: result.points, soiName: host.name, isCurrentSoi: true, isHyperbolic: true }];
}

// 三阶段预测引擎：燃烧段（可选）→ 熄火后轨道 → SOI穿越
// burnEnabled=true 模式B（燃烧轨迹），false 模式A（常规轨道，假设立即熄火）
export function predictTrajectoryBurned(ship, burnEnabled) {
    const segments = [];
    const startTime = _cachedTime;
    const absPos = getAbsolutePosition(ship);

    let host = null;
    if (ship.currentSOI) {
        host = celestialBodies.find(b => b.name === ship.currentSOI) || null;
    }
    if (!host) {
        host = getSOIHostAtTime(absPos, startTime);
    }
    if (!host) return segments;

    const hostRefPos = bodyFuturePos(host, startTime);
    const relPos = { x: absPos.x - hostRefPos.x, y: absPos.y - hostRefPos.y };
    const relVel = { x: ship.vel.x, y: ship.vel.y };

    if (burnEnabled) {
        // 阶段 1：燃烧段
        const thrust = ship.thrust || { ax: 0, ay: 0 };
        const burnDuration = ship.burnDuration || 120;
        const result = integrateThrustArc(relPos, relVel, host.gm, host, thrust, burnDuration, 1.5, startTime);

        segments.push({
            points: result.points,
            soiName: host.name,
            isCurrentSoi: true,
            isHyperbolic: true,
            isBurnArc: true
        });

        // 阶段 2 + 3：熄火后轨道 + SOI穿越
        const burnEndTime = startTime + burnDuration;
        const burnEndHostPos = bodyFuturePos(host, burnEndTime);
        const postBurnAbsPos = {
            x: burnEndHostPos.x + result.finalRelPos.x,
            y: burnEndHostPos.y + result.finalRelPos.y
        };
        patchedStep(postBurnAbsPos, result.finalRelVel, host, burnEndTime, 0, 5, segments);
    } else {
        // 模式 A：跳过燃烧段，直接走 patchedStep（等价 predictTrajectoryPatched）
        patchedStep(absPos, ship.vel, host, startTime, 0, 5, segments);
    }

    return segments;
}
