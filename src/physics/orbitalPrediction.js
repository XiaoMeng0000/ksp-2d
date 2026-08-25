import { eventBus, Events } from '../eventBus.js';
import { celestialBodies, getAbsolutePosition } from './physics.js';
import { rk4Integrate } from './integrator.js';
import { stateToKepler, keplerPositionAtTime, keplerPositionAtTheta, findSOIIntersection, findSOIExitTime } from './orbitalMechanics.js';

// SOI 边界诊断开关 — 运行时从 window 读取，支持控制台热切换
function soiDiagEnabled() {
    return window._soiDiag === true;
}

// 缓存最近一次广播的游戏时间，供轨道预测使用
let _cachedTime = 0;
eventBus.on(Events.CELESTIAL_TIME_UPDATED, ({ time }) => {
    _cachedTime = time;
});

// 供绘制层获取当前游戏时间（段锚定"宿主当前时刻位置"用）
export function getCachedTime() {
    return _cachedTime;
}

// ========== 轨道预测辅助函数 ==========

// 递归计算天体在 futureTime 时的绝对世界坐标
export function bodyFuturePos(body, futureTime) {
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

// 预测起始状态：以当前位置实际归属为准校正宿主，并同步把速度转换到校正后宿主参考系。
// （校正 currentSOI 与位置不一致——如物理层未及时切换或存档异常；
//   两者一致时返回原宿主与 ship.vel，行为不变）
function resolvePredictionState(ship, absPos, time) {
    let host = null;
    if (ship.currentSOI) {
        host = celestialBodies.find(b => b.name === ship.currentSOI) || null;
    }
    if (!host) {
        return { host: getSOIHostAtTime(absPos, time), velRel: ship.vel };
    }
    const actual = getSOIHostAtTime(absPos, time);
    if (actual && actual.name !== host.name) {
        const oldVel = bodyFutureVel(host, time);
        const newVel = bodyFutureVel(actual, time);
        return {
            host: actual,
            velRel: { x: ship.vel.x + oldVel.x - newVel.x, y: ship.vel.y + oldVel.y - newVel.y }
        };
    }
    return { host, velRel: ship.vel };
}

// ========== 轨道预测主函数 ==========

// 径向/深空直线段（解析几何，无时间积分）：
// 角动量≈0 的径向弹道，轨道退化为过宿主的直线；深空（GM≤0）为匀速直线。
// 沿速度方向直线画到 能量零点（束缚 apogee）或 SOI 边界（逃逸），端点在边界时切换递归。
// 根治 RK4 对径向弹道步数爆炸（69ms/次 → <0.05ms/次）与数值失真问题。
function patchedRadialLine(relPos, relVel, host, depth, maxSeg, segments, stepStartTime) {
    const r0 = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
    const v0 = Math.sqrt(relVel.x * relVel.x + relVel.y * relVel.y);
    const h = relPos.x * relVel.y - relPos.y * relVel.x;
    const E = v0 * v0 / 2 - host.gm / r0;

    // 径向判定（hMin 与 stateToKepler 同口径）；深空 gm≤0 恒视为直线
    let hMin = Infinity;
    if (host.gm > 0) {
        const invA = Math.abs(2 / r0 - v0 * v0 / host.gm);
        const aMag = invA > 1e-14 ? 1 / invA : 1e14;
        hMin = 1e-4 * Math.sqrt(host.gm * aMag);
    }
    if (!(host.gm <= 0 || Math.abs(h) < hMin)) {
        return false;   // 非径向（切向近抛物线等），交给 RK4 兜底
    }

    // 速度方向（静止/极低速时退化为径向向外）
    let ux, uy;
    if (v0 > 1e-6) {
        ux = relVel.x / v0;
        uy = relVel.y / v0;
    } else if (r0 > 1e-6) {
        ux = relPos.x / r0;
        uy = relPos.y / r0;
    } else {
        ux = 1;
        uy = 0;
    }

    // 目标半径：逃逸→SOI 边界；束缚→能量零点 r_apo=1/(1/r0-v0²/(2gm))（超边界则截到边界）；深空→固定长度
    let rT;
    if (host.gm <= 0) {
        rT = Math.max(r0 + 1e6, 1e8);
    } else if (E >= 0) {
        rT = host.soiRadius;
    } else {
        rT = 1 / Math.max(1 / r0 - v0 * v0 / (2 * host.gm), 1e-12);
        if (rT > host.soiRadius) rT = host.soiRadius;
    }

    // 弧长采样（沿速度方向；向内时穿过中心到对侧 rT）
    const outward = relPos.x * relVel.x + relPos.y * relVel.y >= 0;
    const sEnd = Math.max(outward ? (rT - r0) : (rT + r0), 1);
    const M = 16;
    // 径向段总飞行时间（供逐点 t 使用；下方逃逸分支的 switchT 复用本值，避免重复积分）
    const tTotal = radialLineTime(relPos, ux, uy, sEnd, E, host.gm);
    const pts = [];
    for (let i = 0; i <= M; i++) {
        const s = (i / M) * sEnd;
        // 径向段速度非均匀，逐点 t 用弧长比例近似
        // TODO: 骨架期近似值，填功能时可按需精化为逐点积分
        pts.push({ x: relPos.x + ux * s, y: relPos.y + uy * s, t: (i / M) * tTotal });
    }

    const pushSeg = () => segments.push({
        relPoints: pts,
        anchorBody: host.name,
        anchorTime: stepStartTime,
        soiName: host.name,
        isCurrentSoi: depth === 0
    });

    // 逃逸出 SOI（端点在边界）→ 切换递归
    if (host.gm > 0 && rT >= host.soiRadius - 1) {
        const switchT = stepStartTime + tTotal;
        const hostPosEnd = bodyFuturePos(host, switchT);
        const hostVelEnd = bodyFutureVel(host, switchT);
        const rBound = host.soiRadius;
        // 端点（SOI 边界，相对 host）= u×soiRadius；径向速度由能量守恒得出
        const nextAbsPos = { x: hostPosEnd.x + ux * rBound, y: hostPosEnd.y + uy * rBound };
        const vBound = Math.sqrt(2 * Math.max(E + host.gm / rBound, 0));
        const nextAbsVel = { x: hostVelEnd.x + ux * vBound, y: hostVelEnd.y + uy * vBound };
        // 探针判定（离开宿主方向 1s），同解析分支
        const probePos = { x: nextAbsPos.x + nextAbsVel.x, y: nextAbsPos.y + nextAbsVel.y };
        const nextHost = getSOIHostAtTime(probePos, switchT + 1);
        if (nextHost && nextHost.name !== host.name) {
            pushSeg();
            const nextHostVel = bodyFutureVel(nextHost, switchT);
            const nextRelVel = { x: nextAbsVel.x - nextHostVel.x, y: nextAbsVel.y - nextHostVel.y };
            patchedStep(nextAbsPos, nextRelVel, nextHost, switchT, depth + 1, maxSeg, segments);
            return true;
        }
    }

    // 束缚/深空/探针失败：画直线段，无切换
    pushSeg();
    return true;
}

// 径向直线飞行时间：t = ∫₀^sEnd ds/v(s)，v(s)=√(2(E+gm/r(s)))，r(s)=|relPos+u·s|
function radialLineTime(relPos, ux, uy, sEnd, E, gm) {
    if (gm <= 0) return sEnd / Math.max(Math.sqrt(2 * Math.max(E, 1e-6)), 1e-3);  // 深空匀速
    const N = 200;
    let t = 0;
    const ds = sEnd / N;
    for (let i = 0; i < N; i++) {
        const s = (i + 0.5) * ds;
        const rx = relPos.x + ux * s;
        const ry = relPos.y + uy * s;
        const rr = Math.max(Math.sqrt(rx * rx + ry * ry), 1);
        const v2 = 2 * (E + gm / rr);
        if (v2 <= 0) return t;   // 到达能量零点（束缚 apogee），速度归零不再前进
        t += ds / Math.sqrt(v2);
    }
    return t;
}

// 递归内部：分段拼接一步，采样从 theta0 到交点或完整轨道
// 段点结构（0.3.0 骨架新增 t 字段）：{ x, y, t } — x/y 为相对锚点坐标，
// t 为自该段起点（anchorTime）起的游戏秒偏移；锚点绝对时刻 = anchorTime + t。
// 供轨道悬停 Tooltip 的 T+ 显示与右键菜单"时间加速至此"计算（飞行Scene 交互层读取）。
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
            // 段点存相对锚点坐标（宿主在 stepStartTime 的位置），消除绝对坐标大数
            const pts = [{ x: relPos.x, y: relPos.y, t: 0 }];
            const aMag = -kepler.a;
            const v0 = Math.sqrt(velRel.x * velRel.x + velRel.y * velRel.y);
            const r0 = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
            const estT = (v0 > 0.01) ? (host.soiRadius - r0) / v0 : 300;
            const stepT = Math.max(1, estT / 60);
            const maxSteps = 600;
            for (let i = 1; i <= maxSteps; i++) {
                const t = i * stepT;
                const rP = keplerPositionAtTime(kepler, host.gm, t, kepler.omega);
                if (i % 2 === 0) pts.push({ x: rP.x, y: rP.y, t });
                if (Math.sqrt(rP.x * rP.x + rP.y * rP.y) > host.soiRadius) break;
            }
            segments.push({
                relPoints: pts,
                anchorBody: host.name,
                anchorTime: stepStartTime,
                soiName: host.name,
                isCurrentSoi: depth === 0
            });
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
        // 段点存相对锚点坐标（宿主在 stepStartTime 的位置）
        const N = Math.max(20, Math.min(Math.floor(deltaTheta / Math.PI * 100), 500));
        const points = [];
        for (let i = 0; i <= N; i++) {
            const frac = i / N;
            const th = dir * (theta0m + frac * deltaTheta);
            const rP = keplerPositionAtTheta({ a: kepler.a, e: kepler.e, omega: kepler.omega }, host.gm, th);
            points.push({ x: rP.x, y: rP.y, t: frac * deltaT });
        }
        segments.push({
            relPoints: points,
            anchorBody: host.name,
            anchorTime: stepStartTime,
            soiName: host.name,
            isCurrentSoi: depth === 0
        });

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

        // 切换方向 = 离开宿主：探针取运动方向前 1s 位置再判归属，
        // 避免切换点（宿主 SOI 边界上）被浮点误判为"仍属宿主"导致递归终止
        const probePos = { x: nextAbsPos.x + nextAbsVel.x, y: nextAbsPos.y + nextAbsVel.y };
        const nextHost = getSOIHostAtTime(probePos, intersectionTime + 1);
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

        // 径向/深空 → 解析直线（无时间积分），根治 RK4 步数爆炸；
        // 仅切向近抛物线（|h| 健康但 e-1<3e-5）等真正病态轨道才走 RK4 兜底
        const radialHandled = patchedRadialLine(
            { x: posAbs.x - hostPos.x, y: posAbs.y - hostPos.y },
            velRel, host, depth, maxSeg, segments, stepStartTime
        );
        if (radialHandled) return;

        // 深空/近抛物线（无轨道根数）：RK4 积分（相对坐标系），与物理引擎一致
        // 段点存相对锚点坐标（hP0 = 宿主在 stepStartTime 的位置，固定锚，消除宿主漂移）
        const hP0 = bodyFuturePos(host, stepStartTime);
        let relP = { x: posAbs.x - hP0.x, y: posAbs.y - hP0.y };
        let relV = { x: velRel.x, y: velRel.y };
        const pts = [{ x: relP.x, y: relP.y, t: 0 }];
        const dt = 0.05;

        // RK4 步数动态化：病态逃逸（kepler=null）时到达 SOI 边界的时间可能远大于
        // 固定 60s（1200×0.05）。按估算出界时间设置步数（×2 余量 + 缓冲），
        // 并设大上限防失控。注：极近抛物线（e-1<3e-5）出 SOI 步数需求仍可能巨大，
        // 该类由 stateToKepler 阈值放宽后的解析分支优先接管，此处为兜底。
        const RK4_MAX_STEPS = 8000;   // ≈400s，仅极近抛物线切向病态兜底（径向已解析直线化）
        let maxSteps = 1200;
        if (host.gm > 0) {
            const r0dist = Math.sqrt(relP.x * relP.x + relP.y * relP.y);
            const v0 = Math.sqrt(relV.x * relV.x + relV.y * relV.y);
            if (v0 > 0.01 && r0dist < host.soiRadius) {
                maxSteps = Math.min(RK4_MAX_STEPS, Math.ceil((host.soiRadius - r0dist) / (v0 * dt)) * 2 + 200);
            }
        }

        for (let i = 1; i <= maxSteps; i++) {
            const t = i * dt;

            // RK4 步进（相对坐标系）
            const result = rk4Integrate(relP, relV, dt, host.gm, { ax: 0, ay: 0 });
            relP = result.pos;
            relV = result.vel;

            if (i % 2 === 0) {
                pts.push({ x: relP.x, y: relP.y, t });
            }

            // 转到绝对坐标（仅用于 SOI 检测）
            const hP = bodyFuturePos(host, stepStartTime + t);
            const absP = { x: hP.x + relP.x, y: hP.y + relP.y };

            // 每步检测 SOI 切换
            const soiHost = getSOIHostAtTime(absP, stepStartTime + t);
            if (soiHost && soiHost.name !== host.name) {
                segments.push({
                    relPoints: pts,
                    anchorBody: host.name,
                    anchorTime: stepStartTime,
                    soiName: host.name,
                    isCurrentSoi: depth === 0
                });
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
        segments.push({
            relPoints: pts,
            anchorBody: host.name,
            anchorTime: stepStartTime,
            soiName: host.name,
            isCurrentSoi: depth === 0
        });
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

        // 绘制用点：固定锚点（宿主在 stepStartTime 的位置），
        // 段点存相对锚点坐标，保证以宿主为中心的视觉椭圆
        const drawPoints = [];
        for (let i = 0; i <= N; i++) {
            const t = (i / N) * T;
            const rP = keplerPositionAtTime(kepler, host.gm, t, kepler.omega);
            drawPoints.push({ x: rP.x, y: rP.y, t });
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
            segments.push({
                relPoints: drawPoints,
                anchorBody: host.name,
                anchorTime: stepStartTime,
                soiName: host.name,
                isCurrentSoi: depth === 0
            });
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

        // 数值微分求飞船绝对速度（先算，供探针判定与换帧用）
        const dt2 = 0.001;
        const rPos2 = keplerPositionAtTime(kepler, host.gm, tHi + dt2, kepler.omega);
        const hostPos2 = bodyFuturePos(host, switchTime + dt2);
        const absPos2 = { x: hostPos2.x + rPos2.x, y: hostPos2.y + rPos2.y };
        const absVel = { x: (absPos2.x - switchAbsPos.x) / dt2, y: (absPos2.y - switchAbsPos.y) / dt2 };

        // 安全校验：探针取运动方向前 1s 位置确认新宿主（进入子天体方向，
        // 避免切换点在子天体 SOI 边界上被浮点误判回宿主导致校验失败）
        const probePos = { x: switchAbsPos.x + absVel.x, y: switchAbsPos.y + absVel.y };
        const verifiedHost = getSOIHostAtTime(probePos, switchTime + 1);
        if (!verifiedHost || verifiedHost.name === host.name) {
            segments.push({
                relPoints: drawPoints,
                anchorBody: host.name,
                anchorTime: stepStartTime,
                soiName: host.name,
                isCurrentSoi: depth === 0
            });
            return;
        }
        nextSoiHost = verifiedHost;

        // 截断至切换点：在 [0, tHi] 区间重采样，保证最小点数（避免进入 SOI 前
        // 的短段在固定 N=200 采样下只剩少数点、画成短直线）
        const MIN_POINTS = 32;
        const M = Math.max(MIN_POINTS, Math.min(200, Math.ceil(tHi / (T / N))));
        const truncatedPoints = [];
        for (let i = 0; i <= M; i++) {
            const t = (i / M) * tHi;
            const rP = keplerPositionAtTime(kepler, host.gm, t, kepler.omega);
            truncatedPoints.push({ x: rP.x, y: rP.y, t });
        }
        segments.push({
            relPoints: truncatedPoints,
            anchorBody: host.name,
            anchorTime: stepStartTime,
            soiName: host.name,
            isCurrentSoi: depth === 0
        });

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
    for (let i = 0; i <= N; i++) {
        const frac = i / N;
        const th = dir * (theta0m + frac * deltaTheta);
        const rP = keplerPositionAtTheta({ a: kepler.a, e: kepler.e, omega: kepler.omega }, host.gm, th);
        points.push({ x: rP.x, y: rP.y, t: frac * deltaT });
    }
    segments.push({
        relPoints: points,
        anchorBody: host.name,
        anchorTime: stepStartTime,
        soiName: host.name,
        isCurrentSoi: depth === 0
    });

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

    // 切换方向 = 离开宿主：探针取运动方向前 1s 位置再判归属，
    // 避免切换点（宿主 SOI 边界上）被浮点误判为"仍属宿主"导致递归终止
    const probePos = { x: nextAbsPos.x + nextAbsVel.x, y: nextAbsPos.y + nextAbsVel.y };
    const nextHost = getSOIHostAtTime(probePos, intersectionTime + 1);
    if (!nextHost || (nextHost.name === host.name)) return;

    const nextHostVel = bodyFutureVel(nextHost, intersectionTime);
    const nextRelVel = {
        x: nextAbsVel.x - nextHostVel.x,
        y: nextAbsVel.y - nextHostVel.y
    };

    patchedStep(nextAbsPos, nextRelVel, nextHost, intersectionTime, depth + 1, maxSeg, segments);
}

// ========== SOI 切换时间保护 ==========

/**
 * 计算"沿当前解析轨道到下一次 SOI 切换"的剩余游戏时间（秒）。
 * 口径与 patchedStep（预测线）完全一致：
 *   1) 有出界交点（双曲线/椭圆离开宿主 SOI）→ 解析 ΔM/n；
 *   2) 无出界交点 → 整周期 200 点扫描嵌套 SOI 进入（如 Kerbin 轨道穿越 Mun SOI）
 *      + 二分精化 + 1s 探针校验（防假阳性）。
 * 返回 null 表示：无解析轨道（径向/RK4 病态，由 RK4 50x 限档兜底）、深空无宿主、
 * 或轨道永不切换（稳定轨道/无嵌套进入）——调用方按"不额外限档"处理。
 *
 * 注意：必须从当前状态（ship.pos/ship.vel）重拟合轨道根数——ship.kepler 只在
 * SOI 切换/机动时刻重拟合，其 theta 是彼时的真近点角，位置由 keplerToState 随
 * orbitTime 推进；直接用 ship.kepler 会把已飞行时间多算进"剩余切换时间"
 * （或当旧交点已过时错取下一圈交点），保护档位恒偏松、靠近边界也不会收紧。
 * 预测线 patchedStep 同口径：均从当前位移/速度重建轨道。
 * @param {Object} ship - 飞船实例（用 ship.pos/ship.vel，相对当前宿主坐标）
 * @param {Object|null} host - 当前宿主天体（null = 深空）
 * @returns {number|null} 剩余游戏秒
 */
export function timeToNextSOISwitch(ship, host) {
    if (!host || !(host.gm > 0) || !ship.pos || !ship.vel) {
        return null;
    }

    // 从当前状态重建轨道根数（与预测线同口径；径向/近抛物线病态 → null 走 RK4 兜底）
    const kepler = stateToKepler(ship.pos, ship.vel, host.gm);
    if (!kepler || !isFinite(kepler.a)) {
        return null;
    }

    const gm = host.gm;

    // 1) 出界交点时间（双曲线/椭圆统一，与预测线同公式）
    const tExit = findSOIExitTime(kepler, gm, host.soiRadius);
    if (tExit !== null) {
        return tExit;
    }

    // 2) 无出界：仅椭圆轨道（有周期）才可能进入嵌套 SOI
    if (!(kepler.a > 0)) {
        return null;
    }
    // 2.1) 嵌套扫描前置筛选（性能保护）：稳定轨道每帧整周期扫描 ≈1.4ms/船,
    // 飞行/追踪场景取全部飞船 → 多船档会挤爆帧预算。几何判定：
    //   |ship − B| ≥ d_min(宿主,B) − rMax（rMax = a(1+e) 为宿主-相对轨道最大半径），
    // 若对每个非宿主天体都有 d_min − rMax > B.soiRadius → 该轨道整个周期内
    // 不可能进入任何嵌套 SOI → 直接返回 null，无需扫描。
    // d_min 下界（沿父链求公共祖先再按径向区间间隙减缩）：
    //   ① B 是宿主(孙)后代 → 先取宿主直接子体近点半径，再逐级减去中间体远点半径；
    //   ② 非同系（绕公共祖先的兄弟/远亲）→ 宿主侧节点与 B 侧节点的径向区间
    //      [a(1−e), a(1+e)] 的间隙 max(0, bMin−hMax, hMin−bMax)，再逐级减去 B 侧中间体远点半径；
    //   ③ 链缺失/环 → 0（保守：总是扫描，保证不漏报）。
    // 注：星级宿主（深空）下行星即"宿主直接子体"，同公式成立（|ship−B| ≥ rB_pe − rMax）。
    const rMax = kepler.a * (1 + kepler.e);
    const dMinToHost = (b) => {
        const parentOf = (body) => body.orbitParent
            ? (celestialBodies.find(p => p.name === body.orbitParent) || null)
            : null;
        // 宿主链（自下而上）
        const hostChain = [];
        {
            let h = host;
            while (h && !hostChain.includes(h)) { hostChain.push(h); h = parentOf(h); }
        }
        // B 链（自下而上）
        const bChain = [];
        {
            let c = b;
            while (c && !bChain.includes(c)) { bChain.push(c); c = parentOf(c); }
        }
        // ① B 是宿主后代：宿主直接子体近点半径起算
        const hostIdx = bChain.indexOf(host);
        if (hostIdx >= 0 && hostIdx >= 1) {
            const child = bChain[hostIdx - 1];
            let dMin = child.orbitA * (1 - (child.orbitE || 0));
            for (let i = 0; i < hostIdx - 1; i++) {
                dMin = Math.max(0, dMin - bChain[i].orbitA * (1 + (bChain[i].orbitE || 0)));
            }
            return dMin;
        }
        // ② 兄弟/远亲：公共祖先下两侧节点的径向区间间隙
        const common = bChain.find(n => hostChain.includes(n));
        if (common) {
            const hSide = hostChain[hostChain.indexOf(common) - 1];
            const bSide = bChain[bChain.indexOf(common) - 1];
            if (hSide && bSide) {
                const bMin = bSide.orbitA * (1 - (bSide.orbitE || 0));
                const bMax = bSide.orbitA * (1 + (bSide.orbitE || 0));
                const hMin = hSide.orbitA * (1 - (hSide.orbitE || 0));
                const hMax = hSide.orbitA * (1 + (hSide.orbitE || 0));
                let dMin = Math.max(0, bMin - hMax, hMin - bMax);
                const bi = bChain.indexOf(common);
                for (let i = 0; i < bi - 1; i++) {
                    dMin = Math.max(0, dMin - bChain[i].orbitA * (1 + (bChain[i].orbitE || 0)));
                }
                return dMin;
            }
        }
        // ③ 保守兜底
        return 0;
    };
    let canEnterNested = false;
    for (const b of celestialBodies) {
        if (b === host || b.type === 'star') continue;
        if (dMinToHost(b) - rMax <= b.soiRadius) {
            canEnterNested = true;
            break;
        }
    }
    if (!canEnterNested) {
        return null;
    }
    const T = 2 * Math.PI * Math.sqrt(kepler.a * kepler.a * kepler.a / gm);
    const startTime = _cachedTime;
    const N = 200;

    // 逐点扫描整个轨道周期（与 patchedStep 无交点分支同口径）
    let switchIdx = -1;
    let nextSoiName = null;
    for (let i = 1; i <= N; i++) {
        const t = (i / N) * T;
        const rP = keplerPositionAtTime(kepler, gm, t, kepler.omega);
        const hp = bodyFuturePos(host, startTime + t);
        const absP = { x: hp.x + rP.x, y: hp.y + rP.y };
        const soiAtPt = getSOIHostAtTime(absP, startTime + t);
        if (soiAtPt && soiAtPt.name !== host.name) {
            switchIdx = i;
            nextSoiName = soiAtPt.name;
            break;
        }
    }
    if (switchIdx === -1) {
        return null;
    }

    // 3) 二分精化切换时刻（与 patchedStep 同口径）
    const tPrev = ((switchIdx - 1) / N) * T;
    const tCurr = (switchIdx / N) * T;
    let tLo = tPrev;
    let tHi = tCurr;
    for (let iter = 0; iter < 15; iter++) {
        const tMid = (tLo + tHi) / 2;
        const rPos = keplerPositionAtTime(kepler, gm, tMid, kepler.omega);
        const hpMid = bodyFuturePos(host, startTime + tMid);
        const absPos = { x: hpMid.x + rPos.x, y: hpMid.y + rPos.y };
        const soiCheck = getSOIHostAtTime(absPos, startTime + tMid);
        if (soiCheck && soiCheck.name === nextSoiName) {
            tHi = tMid;
        } else {
            tLo = tMid;
        }
    }
    const switchT = tHi;

    // 4) 探针校验（同 patchedStep）：切换点 +1s 后确认确属新宿主（防浮点假阳性）
    const dt2 = 0.001;
    const rPos = keplerPositionAtTime(kepler, gm, switchT, kepler.omega);
    const rPos2 = keplerPositionAtTime(kepler, gm, switchT + dt2, kepler.omega);
    const hp1 = bodyFuturePos(host, startTime + switchT);
    const hp2 = bodyFuturePos(host, startTime + switchT + dt2);
    const absPos = { x: hp1.x + rPos.x, y: hp1.y + rPos.y };
    const absPos2 = { x: hp2.x + rPos2.x, y: hp2.y + rPos2.y };
    const absVel = { x: (absPos2.x - absPos.x) / dt2, y: (absPos2.y - absPos.y) / dt2 };
    const probePos = { x: absPos.x + absVel.x, y: absPos.y + absVel.y };
    const verifiedHost = getSOIHostAtTime(probePos, startTime + switchT + 1);
    if (!verifiedHost || verifiedHost.name === host.name) {
        return null;
    }

    return switchT;
}

// 解析解分段预测 — 多段拼接完整轨道（含 SOI 穿越）
export function predictTrajectoryPatched(ship, maxSegments = 5) {
    const segments = [];
    const startTime = _cachedTime;

    // ship.pos 现在是相对坐标，转绝对坐标用于预测
    const absPos = getAbsolutePosition(ship);

    // 起始状态：校正宿主（当前位置实际归属优先）并按新宿主转换速度
    const { host, velRel } = resolvePredictionState(ship, absPos, startTime);

    if (soiDiagEnabled()) {
        console.log(`[DIAG-轨道] predictTrajectoryPatched host=${host?.name} startTime=${startTime.toFixed(2)} absPos=(${absPos.x.toFixed(1)},${absPos.y.toFixed(1)}) shipVel=(${ship.vel.x.toFixed(2)},${ship.vel.y.toFixed(2)}) shipSOI=${ship.currentSOI} kepler=${ship.kepler ? '有' : 'null'} mode=${ship.mode}`);
    }

    if (!host) return segments;  // predictTrajectoryPatched

    patchedStep(absPos, velRel, host, startTime, 0, maxSegments, segments);
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

    // 锚点（宿主在 startTime 的位置，固定锚，消除宿主漂移）
    // 段点存相对锚点坐标
    points.push({ x: rp.x, y: rp.y, t: 0 });

    for (let i = 1; i <= maxSteps; i++) {
        const r = Math.sqrt(rp.x * rp.x + rp.y * rp.y);
        const ga = (r > 0.001) ? gm / (r * r) : 0;
        rv.x += (-ga * rp.x / Math.max(r, 0.001) + thrustAccel.x) * dt;
        rv.y += (-ga * rp.y / Math.max(r, 0.001) + thrustAccel.y) * dt;
        rp.x += rv.x * dt;
        rp.y += rv.y * dt;
        if (i % 3 === 0) {
            points.push({ x: rp.x, y: rp.y, t: i * dt });
        }
        if (r > host.soiRadius * soiRadiusLimit) break;
    }

    return {
        finalRelPos: { x: rp.x, y: rp.y },
        finalRelVel: { x: rv.x, y: rv.y },
        relPoints: points,
        anchorBody: host.name,
        anchorTime: startTime
    };
}

// 推力模式：相对坐标系欧拉积分短预测（@deprecated — 内部改为调用 integrateThrustArc）
export function predictThrustTrajectory(ship) {
    const startTime = _cachedTime;
    const absPos = getAbsolutePosition(ship);

    // 起始状态：校正宿主（当前位置实际归属优先）并按新宿主转换速度
    const { host, velRel } = resolvePredictionState(ship, absPos, startTime);
    if (!host) return [];

    const hostRefPos = bodyFuturePos(host, startTime);
    const relPos = { x: absPos.x - hostRefPos.x, y: absPos.y - hostRefPos.y };
    const relVel = { x: velRel.x, y: velRel.y };
    const thrust = ship.thrust || { ax: 0, ay: 0 };
    const dt = 0.05;
    const v0 = Math.sqrt(relVel.x * relVel.x + relVel.y * relVel.y);
    const r0 = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
    const estPeriod = (v0 > 0.01 && r0 < host.soiRadius)
        ? 2 * Math.PI * r0 / v0
        : 120;
    const maxSteps = Math.min(Math.ceil(estPeriod / dt), 3000);

    const result = integrateThrustArc(relPos, relVel, host.gm, host, thrust, maxSteps * dt, 1.5, startTime);
    return [{
        relPoints: result.relPoints,
        anchorBody: result.anchorBody,
        anchorTime: result.anchorTime,
        soiName: host.name,
        isCurrentSoi: true
    }];
}

// 三阶段预测引擎：燃烧段（可选）→ 熄火后轨道 → SOI穿越
// burnEnabled=true 模式B（燃烧轨迹），false 模式A（常规轨道，假设立即熄火）
export function predictTrajectoryBurned(ship, burnEnabled) {
    const segments = [];
    const startTime = _cachedTime;
    const absPos = getAbsolutePosition(ship);

    // 起始状态：校正宿主（当前位置实际归属优先）并按新宿主转换速度
    const { host, velRel } = resolvePredictionState(ship, absPos, startTime);
    if (!host) return segments;

    const hostRefPos = bodyFuturePos(host, startTime);
    const relPos = { x: absPos.x - hostRefPos.x, y: absPos.y - hostRefPos.y };
    const relVel = { x: velRel.x, y: velRel.y };

    if (burnEnabled) {
        // 阶段 1：燃烧段
        const thrust = ship.thrust || { ax: 0, ay: 0 };
        const burnDuration = ship.burnDuration || 120;
        const result = integrateThrustArc(relPos, relVel, host.gm, host, thrust, burnDuration, 1.5, startTime);

        segments.push({
            relPoints: result.relPoints,
            anchorBody: result.anchorBody,
            anchorTime: result.anchorTime,
            soiName: host.name,
            isCurrentSoi: true,
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
        patchedStep(absPos, velRel, host, startTime, 0, 5, segments);
    }

    return segments;
}
