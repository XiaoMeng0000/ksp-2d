'use strict';

// 机动节点预测引擎（0.2.5）— 纯函数模块，无内部状态
// 链路：沿当前预测链时间寻址 t_node 状态 → 两段式燃烧弧积分（动态质量真实段
// + 燃料耗尽后恒定加速度虚拟续烧段）→ patchedStep 拼接机动后轨道
// 与渲染层/交互层解耦：renderer 每帧调用并缓存结果，UI 只读缓存

import { stateToKepler, keplerToState, getOrbitalDirectionAngles } from './orbitalMechanics.js';
import { bodyFuturePos, patchedStep, getCachedTime } from './orbitalPrediction.js';
import { celestialBodies } from './physics.js';
import { getTotalMass, getFuelAmount, G0 } from '../resources/resourceSystem.js';
import { MANEUVER_CONFIG } from '../config/gameplay/maneuverConfig.js';

// 段的解析传播预备量（一次算好，供 segmentStateAtTime 多次求值复用）：
// 有起始状态快照且宿主引力场有效 → { kepler, body, t0 }；否则 null（非解析段）。
// 单独暴露给"真实曲线精化"用：黄金分割每轮都要取状态，重复 stateToKepler 是纯浪费。
export function prepareSegmentState(seg) {
    if (!seg) return null;
    const st = seg.startState;
    if (!st || !st.relPos || !st.relVel) return null;
    const body = celestialBodies.find(b => b.name === seg.anchorBody);
    if (!body || !(body.gm > 0)) return null;
    const kepler = stateToKepler(st.relPos, st.relVel, body.gm);
    if (!kepler) return null;
    const t0 = isFinite(st.time) ? st.time : seg.anchorTime;
    if (!isFinite(t0)) return null;
    return { kepler, body, t0 };
}

// 按段取状态（纯函数）：seg 内 absTime 时刻 → { relPos, relVel, host, time, kepler } / null。
// 这是"时刻 → 状态"的唯一求值来源（walkToTime 与最近点精化都复用它），
// 因此 relPos 与 relVel 必然来自**同一个 absTime**——节点快照原子性的来源。
//   · 解析 kepler 推进优先（kepler 非 null）
//   · 无 kepler 段（径向直线 / RK4 兜底）→ 采样点插值 + 差分速度，kepler = null
// pre（可选）：prepareSegmentState 的结果，传入则跳过重复的根数计算（语义完全一致）。
export function segmentStateAtTime(seg, absTime, pre = null) {
    if (!seg || !isFinite(absTime)) return null;
    const pts = seg.relPoints;
    if (!pts || pts.length < 2 || !isFinite(seg.anchorTime)) return null;

    const prep = pre || prepareSegmentState(seg);
    if (prep) {
        const tLocal = Math.max(0, absTime - prep.t0);
        const { pos, vel } = keplerToState(prep.kepler, prep.body.gm, tLocal);
        return { relPos: pos, relVel: vel, host: prep.body, time: absTime, kepler: prep.kepler };
    }

    // 采样点插值兜底（径向直线段 / RK4 病态段）
    const body = celestialBodies.find(b => b.name === seg.anchorBody);
    const st = seg.startState;
    const tLocal = Math.max(0, absTime - seg.anchorTime);
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

// 沿预测链时间寻址：返回 absTime 时刻飞船的 { relPos, relVel, host, time, kepler }
// 命中段的解析 kepler 优先（keplerToState 解析推进），无 kepler 段（径向直线 / RK4
// 兜底）用段点插值 + 差分速度。absTime 落在链外 / 链为空 → null。
// 段内求值统一转交 segmentStateAtTime（单一来源），本函数只负责"按时间挑段"。
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

        const st = segmentStateAtTime(seg, absTime);
        if (st) return st;
    }
    return null;
}

// 两段式燃烧弧积分（动态质量）：
//   真实段：满油门，m(t) = mWet − ṁ·t，a(t) = F/m(t)，直到达成 Δv 或燃料耗尽；
//   虚拟段（仅当燃料耗尽早于达成，预测专用）：a = F/mDry 恒值续烧到达成 Δv。
// 半隐式欧拉 dt（与 integrateThrustArc 同款），SOI 半径上限退出；
// 返回终点状态 / 轨迹点（含 ghost 标记）/ 燃料耗尽点 / 实际燃烧时长。
//
// 收口约定（"燃烧时长 0.05 s 网格量化"修复）：末步用**部分步长**收口到目标 Δv，
// 使 burnDuration 随输入连续变化（不再落在 burnDt 整数倍的网格上）。
// 量化曾导致：所需时长随质量连续下降、每 ~4.8 s 掉一档 → 终点 Δv/Δr 单帧跳变
// （Δv 0.4976 m/s → 机动线末端 ~6.4 万 km 台阶）。
// 说明：两段式都为"按推进剂消耗的火箭方程"口径（applied = c·ln(mWet/m) / ghost 段 a·t），
// 则该口径的增量与步长严格成正比 → 末步比例 f = 剩余 Δv / 本步 Δv 即为精确解。
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
        const remDv = dvTarget - applied;
        const stepDv = aMag * dt;
        // 末步收口（关键）：整步 Δv 会超出目标 → 只走"恰好达成"的那一小段，且**解析求解**步长：
        //   真实段 m(t) = m − ṁ·sub ⇒ applied(sub) = applied + c·ln(m/(m − ṁ·sub))
        //                                          ⇒ sub = (m/ṁ)(1 − e^(−remDv/c))   ← 用**当前**质量 m
        //   虚拟段 a 恒定 ⇒ sub = remDv / a
        // （用 mWet 代替 m 会让解析时长系统性偏长 +2.2e-4 s、末端物理 Δv 超目标 +2.25e-3 m/s。）
        // 解出的 sub 满足 applied(sub) ≡ dvTarget，故 burnDuration 是输入的连续函数、不再量化到
        // burnDt 网格，appliedDv 也精确落在目标上（原先末步整步会过冲，且过冲量随质量跳变）。
        // 注意：绝不用"整步 Δv = aMag·dt"当收口上界 —— 半隐式欧拉在整步内用起点加速度，
        // 首次进入该分支时整步 Δv 可能**小于** remDv（f 略 >1）；此时仍按解析式收口，
        // 若 remDv ≥ 整步 Δv 才退回整步（f 钳到 1）。
        let sub = dt;
        if (remDv <= 0) break;                                     // 已达成 → 收口退出（防御）
        if (stepDv > 0 && remDv < stepDv) {
            const exact = (phase === 'real')
                ? (m - mDry) / mdot                                // 到干质量的剩余可烧时长（燃料上限）
                : Infinity;
            const frac = (phase === 'real')
                ? (m / mdot) * (1 - Math.exp(-remDv / c))
                : remDv / aMag;
            const capped = Math.min(exact, frac, dt - 1e-12);
            if (capped > 0) sub = capped;
        }

        rv.x += (-ga * rp.x / Math.max(r, 0.001) + ax) * sub;
        rv.y += (-ga * rp.y / Math.max(r, 0.001) + ay) * sub;
        rp.x += rv.x * sub;
        rp.y += rv.y * sub;
        t += sub;

        // 达成量（按实际步长累计）
        if (phase === 'real') {
            m = Math.max(mDry, m - mdot * sub);
            applied = c * Math.log(mWet / m);
            // 末步（部分步长）以解析目标值收口：订正"1 − ṁ·sub/mWet"的浮点损耗（实测 ~1.3e-6 m/s），
            // 但不得虚报 —— 真实段被 mDry 截断（燃料恰好在本步耗尽）时保持原值，
            // 由下一轮循环记录耗尽点并转入虚拟段续烧（语义与原来完全一致）。
            if (sub < dt) applied = Math.min(applied, dvTarget) >= dvTarget - 1e-6 ? dvTarget : applied;
        } else {
            applied += aMag * sub;
            if (applied > dvTarget) applied = dvTarget;          // 恒速段无截断风险，收口到目标
        }
        i++;

        // 点存储节流：默认每 3 步一点；点数逼近上限后降频，防超长燃烧撑爆段点数组
        // 注意：判档必须用**整数步计数 i**，不能用浮点累加时间 t —— t += dt 之后
        // `t % 3 === 0` 恒不命中（60 步后 t = 2.9999999999999973），会让点数从 671 掉到 2 点，
        // 导致 real/ghost 分色子段失效、弧上命中退化成弦。末步（部分步长）的终点由循环后的
        // 收尾 push 补齐，循环内无需额外判档。
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

// ===== 节点 Δv 的轨道参考系分量 ↔ 世界矢量互转（0.2.5 方案B：分量 = 唯一真值）=====
// 分量定义：dvPro（+顺向 / −逆向）、dvRadial（+径向朝外 / −径向朝内）
// 语义：Δv 以"节点时刻轨道参考系"的分量存储；节点被拖到新位置后分量不变、
//       参考系随新位置旋转 → 世界矢量自动变为"新位置的顺向/径向"
//       （修复：拖拽后燃烧方向仍停留在旧位置顺向）。
// axes 结构：{ pro, retro, radIn, radOut }，每项为 host 局部系单位向量（plan.axes 同构）

// 由轨道状态计算四方向单位向量（单一来源；computePlan 与拖拽重投影共用）
export function computeNodeAxes(relPos, relVel) {
    const dirs = getOrbitalDirectionAngles(relPos, relVel);
    return {
        pro: { x: Math.cos(dirs.prograde), y: Math.sin(dirs.prograde) },
        retro: { x: Math.cos(dirs.retrograde), y: Math.sin(dirs.retrograde) },
        radIn: { x: Math.cos(dirs.radialIn), y: Math.sin(dirs.radialIn) },
        radOut: { x: Math.cos(dirs.radialOut), y: Math.sin(dirs.radialOut) }
    };
}

// 世界矢量 → 分量（旧节点迁移：无 dvPro/dvRadial 时按给定参考系反投影一次）
export function syncComponentsFromDeltaV(node, axes) {
    if (!node || !axes || !axes.pro || !axes.radOut) return false;
    if (isFinite(node.dvPro) && isFinite(node.dvRadial)) return true;
    node.dvPro = node.deltaV.x * axes.pro.x + node.deltaV.y * axes.pro.y;
    node.dvRadial = node.deltaV.x * axes.radOut.x + node.deltaV.y * axes.radOut.y;
    return true;
}

// 分量 → 世界矢量（按当前参考系重建；分量缺失时返回 false，保持原矢量不动）
export function rebuildDeltaVFromComponents(node, axes) {
    if (!node || !axes || !axes.pro || !axes.radOut) return false;
    if (!isFinite(node.dvPro) || !isFinite(node.dvRadial)) return false;
    node.deltaV.x = node.dvPro * axes.pro.x + node.dvRadial * axes.radOut.x;
    node.deltaV.y = node.dvPro * axes.pro.y + node.dvRadial * axes.radOut.y;
    return true;
}

// 节点计划汇总：walk 状态 + 节点参考系轴 + 燃烧参数 + 燃烧积分 + 机动后段拼接
// 返回 plan（含 axes / burnDuration / dvMag / dvMax / fuelLimited / fuelOutPoint /
// burnResult / segments）；nodeState 不可达时仍返回基础信息（面板倒计时可用）。
export function computePlan(ship, node, baseSegments) {
    const dvMag = Math.hypot(node.deltaV.x, node.deltaV.y) || 0;
    const maxThrust = ship.maxThrust || 0;
    const isp = ship.isp || 0;
    // 质量参数（0.2.5 "燃烧期预测漂移"修复）：优先用节点时刻质量快照——
    // 点火燃烧后当前质量逐帧下降，若读当前值，dvMax/燃烧时长/虚拟段会每帧漂移；
    // 旧存档无快照时回退当前质量（向后兼容）。
    const mWet = (isFinite(node.massWet) && node.massWet > 0)
        ? node.massWet
        : (getTotalMass(ship) || 0);
    const mFuel = (isFinite(node.massFuel) && node.massFuel >= 0)
        ? node.massFuel
        : (getFuelAmount(ship) || 0);
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

    // 节点状态获取（0.2.5 修复"燃烧后节点整体跳变"）：
    //   · 冻结快照（创建/拖动时保存的 relX/relY/relVelX/relVelY + anchorBody）**优先**——
    //     节点位置锁定在规划点（相对宿主固定），燃烧开始后轨道改变也不漂移；
    //   · 无快照（旧存档/控制台裸建节点）→ 沿当前预测链 walk（节点时刻已过则重建）。
    let nodeState = null;
    const hasSnapshot = node.relX !== undefined && node.relX !== null
        && node.relVelX !== undefined && isFinite(node.relVelX)
        && node.anchorBody;
    if (hasSnapshot) {
        const b = celestialBodies.find(x => x.name === node.anchorBody);
        if (b) {
            nodeState = {
                relPos: { x: node.relX, y: node.relY },
                relVel: { x: node.relVelX, y: node.relVelY },
                host: b,
                time: node.time,
                kepler: null,
                pinned: true
            };
        }
    }
    if (!nodeState) {
        nodeState = walkToTime(baseSegments, node.time);
    }
    plan.nodeState = nodeState;
    if (!nodeState) return plan;
    plan.axes = computeNodeAxes(nodeState.relPos, nodeState.relVel);

    // 方案B（0.2.5）：分量 = 唯一真值 —— 先迁移旧节点分量（世界矢量反投影一次），
    // 再由分量 + 当前参考系轴重建世界矢量（节点被拖到新位置后方向随之旋转）
    syncComponentsFromDeltaV(node, plan.axes);
    rebuildDeltaVFromComponents(node, plan.axes);
    const dvMagNow = Math.hypot(node.deltaV.x, node.deltaV.y) || 0;
    plan.dvMag = dvMagNow;
    plan.fuelLimited = dvMagNow > dvMax + 1e-6;

    if (dvMagNow <= 0) return plan;

    // 燃烧弧（节点 Δv 方向沿 host 局部系恒定施加，与预测/手动执行同口径）
    const burnResult = planBurnArc(nodeState.relPos, nodeState.relVel, nodeState.host, {
        dirX: node.deltaV.x / dvMagNow,
        dirY: node.deltaV.y / dvMagNow,
        maxThrust,
        isp,
        mWet,
        mDry,
        dvTarget: dvMagNow
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

// 机动节点两态方向（0.2.5 SAS 节点指向 / 导航球机动标记）：
//   过节点前（now < node.time）：恒为节点加速方向（节点 Δv 方向，host 局部系 = 世界向）
//   过节点后（now >= node.time）：若想达到目标（机动后）轨道的当前燃烧方向——
//     在"当前位置空间角"处取目标轨道的速度矢量，与当前速度差 = 所需速度增量方向，
//     随飞船沿轨道滑行实时变化（目标轨道不可解析/宿主改变时返回 null）
// 角度约定与 heading / computeNavballDirections 一致：0=+Y，顺时针（atan2(x, y)）。
export function computeManeuverDirection(ship, pred, now) {
    const plan = pred && pred.plan ? pred.plan : null;
    if (!plan || !plan.node || !plan.nodeState) return null;
    const node = plan.node;
    const dvMag = Math.hypot(node.deltaV.x, node.deltaV.y);
    if (!(dvMag > 1e-6)) return null;

    const tNow = now !== undefined ? now : getCachedTime();
    if (tNow < node.time) {
        // 过节点前：恒为节点加速方向
        return Math.atan2(node.deltaV.x, node.deltaV.y);
    }

    // 过节点后：目标轨道速度差方向（仅当当前宿主与节点宿主一致——同参考系）
    const seg0 = plan.segments && plan.segments[0];
    const st = seg0 && seg0.startState;
    if (!st || !st.body) return null;
    if (ship.currentSOI !== st.body) return null;
    const body = celestialBodies.find(b => b.name === st.body);
    if (!body || !(body.gm > 0)) return null;
    const tKepler = stateToKepler(st.relPos, st.relVel, body.gm);
    if (!tKepler || !isFinite(tKepler.a)) return null;

    const { a, e, omega } = tKepler;
    const d = tKepler.dir === undefined ? 1 : tKepler.dir;
    const p = a * (1 - e * e);
    if (!(p > 0)) return null;

    const thetaP = Math.atan2(ship.pos.y, ship.pos.x);   // 当前位置空间角
    const local = thetaP - omega;                        // 目标轨道局部真近点角
    const denom = 1 + e * Math.cos(local);
    if (!(denom > 1e-9)) return null;

    // 目标轨道在该空间角上的速度（径向/切向分解，与 keplerToState 同口径）；
    // 位置角 θp 已含 omega 旋转，切向/径向基直接在世界向
    const sqrtGMp = Math.sqrt(body.gm / p);
    const vr = d * sqrtGMp * e * Math.sin(local);
    const vtheta = d * sqrtGMp * (1 + e * Math.cos(local));
    const vtx = vr * Math.cos(thetaP) - vtheta * Math.sin(thetaP);
    const vty = vr * Math.sin(thetaP) + vtheta * Math.cos(thetaP);

    const dvx = vtx - ship.vel.x;
    const dvy = vty - ship.vel.y;
    if (Math.hypot(dvx, dvy) < 0.1) return null;   // 已在目标轨道（误差内）→ 无指向意义
    return Math.atan2(dvx, dvy);
}

// ===== 节点"纯时间编辑"支撑（0.2.5 规划面板：改时间 / 按周期平移）=====

/**
 * 节点所在轨道周期（秒）：由节点冻结快照的 Kepler 根数解析求解 2π√(a³/gm)；
 * 逃逸/双曲线（a<0）/快照缺失 → null（无周期，按周期平移不可用）
 * @returns {number|null}
 */
export function getNodeOrbitPeriod(node) {
    if (!node || node.relX === null || node.relX === undefined
        || node.relVelX === null || node.relVelX === undefined
        || !node.anchorBody) {
        return null;
    }
    const body = celestialBodies.find(b => b.name === node.anchorBody);
    if (!body || !(body.gm > 0)) return null;
    const k = stateToKepler({ x: node.relX, y: node.relY }, { x: node.relVelX, y: node.relVelY }, body.gm);
    if (!k || !isFinite(k.a) || !(k.a > 0)) return null;
    return 2 * Math.PI * Math.sqrt(k.a * k.a * k.a / body.gm);
}

/**
 * 沿节点冻结快照的轨道解析传播到 newTime（可跨任意多圈）：
 * 返回 { relPos, relVel, period } 或 null（快照缺失/无有效根数/宿主不存在）。
 * 说明：不依赖预测链，故"节点时刻远超可见预测链"也能精确外推（同一 SOI 内）。
 * @param {Object} node - 机动节点（relX/relY/relVelX/relVelY/time/anchorBody）
 * @param {number} newTime - 目标绝对时刻（游戏秒）
 */
export function propagateNodeSnapshot(node, newTime) {
    if (!node || !isFinite(newTime)) return null;
    if (node.relX === null || node.relX === undefined
        || node.relY === null || node.relY === undefined
        || node.relVelX === null || node.relVelX === undefined
        || node.relVelY === null || node.relVelY === undefined
        || !node.anchorBody) {
        return null;
    }
    const body = celestialBodies.find(b => b.name === node.anchorBody);
    if (!body || !(body.gm > 0)) return null;
    const k = stateToKepler({ x: node.relX, y: node.relY }, { x: node.relVelX, y: node.relVelY }, body.gm);
    if (!k) return null;
    const dt = newTime - node.time;
    const st = keplerToState(k, body.gm, dt);
    const period = (isFinite(k.a) && k.a > 0)
        ? 2 * Math.PI * Math.sqrt(k.a * k.a * k.a / body.gm)
        : null;
    return { relPos: st.pos, relVel: st.vel, period };
}
