'use strict';

// 机动节点预测引擎（0.3.0）— 纯函数模块，无内部状态
// 链路：沿当前预测链时间寻址 t_node 状态 → 两段式燃烧弧积分（动态质量真实段
// + 燃料耗尽后恒定加速度虚拟续烧段）→ patchedStep 拼接机动后轨道
// 与渲染层/交互层解耦：renderer 每帧调用并缓存结果，UI 只读缓存

import { stateToKepler, keplerToState, getOrbitalDirectionAngles } from './orbitalMechanics.js';
import { bodyFuturePos, patchedStep } from './orbitalPrediction.js';
import { celestialBodies } from './physics.js';
import { getTotalMass, getFuelAmount, G0 } from '../resources/resourceSystem.js';
import { MANEUVER_CONFIG } from '../config/maneuverConfig.js';

// 沿预测链时间寻址：返回 absTime 时刻飞船的 { relPos, relVel, host, time, kepler }
// 命中段的解析 kepler 优先（keplerToState 解析推进），无 kepler 段（径向直线 / RK4
// 兜底）用段点插值 + 差分速度。absTime 落在链外 / 链为空 → null。
export function walkToTime(segments, absTime) {
    if (!segments || segments.length === 0 || !isFinite(absTime)) return null;

    for (const seg of segments) {
        const pts = seg.relPoints;
        if (!pts || pts.length < 2 || !isFinite(seg.anchorTime)) continue;

        const segStart = seg.anchorTime;
        if (absTime < segStart) continue;   // 链按时间排序，尚未到该段则继续找

        const lastT = pts[pts.length - 1].t;
        const segEnd = isFinite(lastT) ? segStart + lastT : null;
        if (segEnd !== null && absTime > segEnd + 1e-6) continue;

        const body = celestialBodies.find(b => b.name === seg.anchorBody);
        const st = seg.startState;

        // 解析 kepler 推进优先（有起始状态快照且有有效引力场）
        if (st && st.relPos && st.relVel && body && body.gm > 0) {
            const kepler = stateToKepler(st.relPos, st.relVel, body.gm);
            if (kepler) {
                const tLocal = Math.max(0, absTime - st.time);
                const { pos, vel } = keplerToState(kepler, body.gm, tLocal);
                return { relPos: pos, relVel: vel, host: body, time: absTime, kepler };
            }
        }

        // 采样点插值兜底（径向直线段 / RK4 病态段）
        const tLocal = Math.max(0, absTime - segStart);
        let p0 = pts[0];
        let p1 = pts[pts.length - 1];
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].t >= tLocal) {
                p0 = pts[i - 1];
                p1 = pts[i];
                break;
            }
        }
        const span = p1.t - p0.t;
        const f = span > 1e-9 ? Math.max(0, Math.min(1, (tLocal - p0.t) / span)) : 0;
        const relPos = { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
        let relVel;
        if (span > 1e-9) {
            relVel = { x: (p1.x - p0.x) / span, y: (p1.y - p0.y) / span };
        } else if (st && st.relVel) {
            relVel = { x: st.relVel.x, y: st.relVel.y };
        } else {
            relVel = { x: 0, y: 0 };
        }
        return { relPos, relVel, host: body, time: absTime, kepler: null };
    }
    return null;
}

// 两段式燃烧弧积分（动态质量）：
//   真实段：满油门，m(t) = mWet − ṁ·t，a(t) = F/m(t)，直到达成 Δv 或燃料耗尽；
//   虚拟段（仅当燃料耗尽早于达成，预测专用）：a = F/mDry 恒值续烧到达成 Δv。
// 半隐式欧拉 dt（与 integrateThrustArc 同款），SOI 半径上限退出；
// 返回终点状态 / 轨迹点（含 ghost 标记）/ 燃料耗尽点 / 实际燃烧时长。
export function planBurnArc(relPos, relVel, host, params, startTime) {
    const cfg = MANEUVER_CONFIG;
    const dt = cfg.burnDt;
    const { dirX, dirY, maxThrust, isp, mWet, mDry, dvTarget } = params;

    const result = {
        finalRelPos: { x: relPos.x, y: relPos.y },
        finalRelVel: { x: relVel.x, y: relVel.y },
        relPoints: [{ x: relPos.x, y: relPos.y, t: 0 }],
        fuelOutPoint: null,
        burnDuration: 0,
        appliedDv: 0,
        ghostUsed: false
    };

    // 病态输入防御：无推力 / 无推进剂 / 零目标 → 零长度弧
    const c = isp * G0;
    const mdot = c > 0 ? maxThrust / c : 0;
    if (!(maxThrust > 0) || !(mdot > 0) || !(mDry > 0) || !(dvTarget > 0)) {
        return result;
    }

    const gm = host && host.gm > 0 ? host.gm : 0;
    const maxSteps = cfg.burnMaxSteps;
    const ghostEnabled = cfg.ghostBurnEnabled;

    let rp = { x: relPos.x, y: relPos.y };
    let rv = { x: relVel.x, y: relVel.y };
    let m = mWet;
    let applied = 0;
    let phase = 'real';   // 'real' 动态质量 | 'ghost' 虚拟续烧
    let fuelOutRecorded = false;
    let t = 0;
    let i = 0;

    while (i < maxSteps) {
        let aMag;
        if (phase === 'real') {
            if (m <= mDry) {
                // 燃料耗尽：记录耗尽点 → 切虚拟段（预测专用）
                if (!fuelOutRecorded) {
                    result.fuelOutPoint = { relPos: { x: rp.x, y: rp.y }, t, body: host ? host.name : null };
                    fuelOutRecorded = true;
                }
                if (!ghostEnabled) break;
                phase = 'ghost';
            }
            aMag = maxThrust / Math.max(m, 1e-6);
        } else {
            aMag = maxThrust / Math.max(mDry, 1e-6);
        }

        const ax = dirX * aMag;
        const ay = dirY * aMag;
        const r = Math.sqrt(rp.x * rp.x + rp.y * rp.y);
        const ga = (r > 0.001 && gm > 0) ? gm / (r * r) : 0;
        rv.x += (-ga * rp.x / Math.max(r, 0.001) + ax) * dt;
        rv.y += (-ga * rp.y / Math.max(r, 0.001) + ay) * dt;
        rp.x += rv.x * dt;
        rp.y += rv.y * dt;
        t += dt;
        i++;

        // 达成量：真实段按推进剂消耗的火箭方程口径；虚拟段按 a·dt 累计
        if (phase === 'real') {
            m = Math.max(mDry, m - mdot * dt);
            applied = c * Math.log(mWet / m);
        } else {
            applied += aMag * dt;
        }

        // 点存储节流：默认每 3 步一点；点数逼近上限后降频，防超长燃烧撑爆段点数组
        if (i % 3 === 0 && (result.relPoints.length <= 900 || i % 60 === 0)) {
            result.relPoints.push({ x: rp.x, y: rp.y, t, ghost: phase === 'ghost' });
        }

        if (applied >= dvTarget - 1e-9) break;
        if (host && r > host.soiRadius * cfg.burnSoiRadiusLimit) break;
    }

    result.relPoints.push({ x: rp.x, y: rp.y, t, ghost: phase === 'ghost' });
    result.finalRelPos = { x: rp.x, y: rp.y };
    result.finalRelVel = { x: rv.x, y: rv.y };
    result.burnDuration = t;
    result.appliedDv = applied;
    result.ghostUsed = phase === 'ghost';
    return result;
}

// 节点计划汇总：walk 状态 + 节点参考系轴 + 燃烧参数 + 燃烧积分 + 机动后段拼接
// 返回 plan（含 axes / burnDuration / dvMag / dvMax / fuelLimited / fuelOutPoint /
// burnResult / segments）；nodeState 不可达时仍返回基础信息（面板倒计时可用）。
export function computePlan(ship, node, baseSegments) {
    const dvMag = Math.hypot(node.deltaV.x, node.deltaV.y) || 0;
    const maxThrust = ship.maxThrust || 0;
    const isp = ship.isp || 0;
    const mWet = getTotalMass(ship) || 0;
    const mFuel = getFuelAmount(ship) || 0;
    const mDry = Math.max(mWet - mFuel, 1);
    const c = isp * G0;
    const dvMax = (mWet > mDry && c > 0) ? c * Math.log(mWet / mDry) : 0;

    const plan = {
        node,
        nodeState: null,
        dvMag,
        dvMax,
        fuelLimited: dvMag > dvMax + 1e-6,
        maxThrust,
        isp,
        mWet,
        mDry,
        axes: null,
        burnDuration: null,
        fuelOutPoint: null,
        burnResult: null,
        segments: []
    };

    const nodeState = walkToTime(baseSegments, node.time);
    plan.nodeState = nodeState;
    if (!nodeState) return plan;

    // 节点参考系轴（host 局部系单位向量）：方向手柄与读数共用。
    // 注意：必须先于 dvMag 守卫计算——节点初始 Δv 为 0 时手柄仍需显示，
    // 玩家从零拖拽建立目标 Δv。
    const dirs = getOrbitalDirectionAngles(nodeState.relPos, nodeState.relVel);
    plan.axes = {
        pro: { x: Math.cos(dirs.prograde), y: Math.sin(dirs.prograde) },
        retro: { x: Math.cos(dirs.retrograde), y: Math.sin(dirs.retrograde) },
        radIn: { x: Math.cos(dirs.radialIn), y: Math.sin(dirs.radialIn) },
        radOut: { x: Math.cos(dirs.radialOut), y: Math.sin(dirs.radialOut) }
    };

    if (dvMag <= 0) return plan;

    // 燃烧弧（节点 Δv 方向沿 host 局部系恒定施加，与预测/手动执行同口径）
    const burnResult = planBurnArc(nodeState.relPos, nodeState.relVel, nodeState.host, {
        dirX: node.deltaV.x / dvMag,
        dirY: node.deltaV.y / dvMag,
        maxThrust,
        isp,
        mWet,
        mDry,
        dvTarget: dvMag
    }, node.time);
    plan.burnResult = burnResult;
    plan.burnDuration = burnResult.burnDuration;
    plan.fuelOutPoint = burnResult.fuelOutPoint;

    // 机动后轨道：燃烧终点状态接 patchedStep（与 predictTrajectoryBurned 同口径）
    const postSegments = [];
    const burnEndTime = node.time + burnResult.burnDuration;
    const hostPosEnd = bodyFuturePos(nodeState.host, burnEndTime);
    const postAbsPos = {
        x: hostPosEnd.x + burnResult.finalRelPos.x,
        y: hostPosEnd.y + burnResult.finalRelPos.y
    };
    patchedStep(postAbsPos, burnResult.finalRelVel, nodeState.host, burnEndTime, 0, 5, postSegments);
    plan.segments = postSegments;
    return plan;
}

// 机动节点预测主入口：输出渲染段序列（燃烧弧 + 机动后段）+ 燃料耗尽点 + 计划信息
// baseSegments = 当前预测链（predictTrajectoryPatched 产物，渲染层本帧缓存）
export function predictManeuverTrajectories(ship, node, baseSegments) {
    const plan = computePlan(ship, node, baseSegments);
    if (!plan.nodeState || !plan.burnResult) {
        return { segments: [], burnArc: null, fuelOutPoint: null, plan };
    }
    const result = plan.burnResult;
    const burnArc = {
        relPoints: result.relPoints,
        anchorBody: plan.nodeState.host.name,
        anchorTime: node.time,
        soiName: plan.nodeState.host.name,
        isCurrentSoi: true,
        isBurnArc: true
    };
    return {
        segments: [burnArc].concat(plan.segments),
        burnArc,
        fuelOutPoint: result.fuelOutPoint,
        plan
    };
}
