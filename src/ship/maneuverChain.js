'use strict';

// 机动节点链解析（领域模块 —— 0.2.6 阶段2：从渲染层搬出）
//
// 职责边界（本模块只做领域计算，**不引用任何渲染概念**：无 camera / worldToScreen / canvas）：
//   ① 本帧基础链：自己从 orbitalPrediction 取（on_rails → predictTrajectoryPatched；
//      推力模式 → predictTrajectoryBurned），**不接受渲染层传入的链** —— 彻底解耦；
//      渲染层反向读本模块结果绘制轨道线（同帧同源）
//   ② 多节点链式解析：时刻序遍历 → 上游依赖判定 → 节点快照重投影 → 链式质量投影
//      → 逐节点计划（按节点缓存 + 分帧重算预算）→ 链前推
//   ③ 维护节点快照字段（relX/relY/relVelX/relVelY/anchorBody/massWet/massFuel/_rev/_deps）
//      —— 这些是**设计上要持久化的快照**（读档后未渲染时预测也必须可用），
//      由领域模块维护是正确形态；渲染层只读不写
//
// 明确不属于本模块：屏幕坐标投影（canvas / worldToScreen）、节点图标与预测线绘制
//
// 帧内同源约定：更新阶段调用 updateManeuverChain(ship) 解析一次；渲染阶段再调用时
// 输入指纹未变 → 直接复用同一份结果（纯读，不重算、不写节点）。
// 保持该约定的意义：同一帧内轨道线、节点标记、右键菜单命中必须基于同一份投影。

import { predictTrajectoryPatched, predictTrajectoryBurned, bodyFuturePos, getCachedTime } from '../physics/orbitalPrediction.js';
import {
    predictManeuverTrajectories,
    walkToTime,
    computeNodeAxes,
    syncComponentsFromDeltaV,
    rebuildDeltaVFromComponents
} from '../physics/maneuverPrediction.js';
import { celestialBodies } from '../physics/physics.js';
import { getTotalMass, getFuelAmount } from '../resources/resourceSystem.js';
import { maneuverSystem } from './maneuverSystem.js';
import { MANEUVER_CONFIG } from '../config/gameplay/maneuverConfig.js';

// ===== 帧结果与计划缓存 =====
let _frame = null;                 // 本帧解析结果（见 resolveChain 返回值）
let _mvPlanCache = new Map();      // node → { key, result }

// 节点快照是否完整（computePlan 的冻结路径前提）
function hasNodeSnapshot(node) {
    return !!(node && node.relX !== null && node.relX !== undefined
        && node.relY !== null && node.relY !== undefined
        && isFinite(node.relVelX) && isFinite(node.relVelY) && node.anchorBody);
}

// 把链上状态写回节点快照（重投影：分量不变，世界矢量按新参考系重建）
function reprojectNodeToState(node, st) {
    if (!node || !st || !st.relPos || !st.relVel) return false;
    const oldAxes = computeNodeAxes(
        { x: node.relX, y: node.relY }, { x: node.relVelX, y: node.relVelY });
    if (oldAxes) syncComponentsFromDeltaV(node, oldAxes);
    node.relX = st.relPos.x;
    node.relY = st.relPos.y;
    node.relVelX = st.relVel.x;
    node.relVelY = st.relVel.y;
    node.anchorBody = st.host ? st.host.name : node.anchorBody;
    const newAxes = computeNodeAxes({ x: node.relX, y: node.relY }, { x: node.relVelX, y: node.relVelY });
    if (newAxes) rebuildDeltaVFromComponents(node, newAxes);
    return true;
}

// 计划缓存键（含版本号/时刻/Δv/质量/引擎参数：无编辑时逐帧零重算）
function planCacheKey(ship, node) {
    return (node._rev | 0) + '|' + node.time + '|' + node.deltaV.x + '|' + node.deltaV.y + '|'
        + (isFinite(node.massWet) && node.massWet > 0 ? node.massWet : -1) + '|'
        + (ship.maxThrust || 0) + '|' + (ship.isp || 0);
}

// 单节点计划（带缓存）
// allowRecompute=false（本帧重算预算已用完）：命中缓存则沿用上一帧结果，未命中则返回降级空结果
function planForNode(ship, node, chain, allowRecompute) {
    const cacheKey = planCacheKey(ship, node);
    const cached = _mvPlanCache.get(node);
    if (cached && cached.key === cacheKey) return cached.result;
    if (!allowRecompute && cached) return cached.result;      // 预算用完 → 沿用旧计划

    let result;
    try {
        result = predictManeuverTrajectories(ship, node, chain);
    } catch (err) {
        // 隔离异常：机动预测失败仅降级（无红线/无标记），绝不让整帧渲染中断（黑屏防线）
        console.error('[Maneuver] 机动预测异常（已降级）:', err);
        result = { segments: [], burnArc: null, fuelOutPoint: null, plan: null };
    }
    _mvPlanCache.set(node, { key: cacheKey, result });
    return result;
}

// 计划燃烧消耗的推进剂（质量投影用）：massFlow × 燃烧时长
function burnFuelOf(result, ship) {
    const plan = result && result.plan;
    if (!plan || !plan.burnResult) return 0;
    const isp = ship.isp || 0;
    const thrust = ship.maxThrust || 0;
    if (!(isp > 0) || !(thrust > 0)) return 0;
    const massFlow = thrust / (isp * 9.80665);
    const dur = plan.burnResult.burnDuration || 0;
    return massFlow * dur;
}

// ===== 帧身份（幂等解析的输入指纹）=====
// 任一项变化都必须重算：时间/模式/位置/宿主/引擎/当前质量（连续扣减）+ 节点集合与编辑
// （时刻、Δv、版本号、执行态、快照完整性）+ 选中态。
// 位置与质量一并入指纹的原因：不能假设"时间一定在推进"——暂停、读档、切场景时
// 时钟可能冻结，此时飞船状态仍可能被改写（模式切换 / 传送 / 加油），必须重算。
function frameFingerprint(ship) {
    const nodes = Array.isArray(ship.maneuverNodes) ? ship.maneuverNodes : [];
    let fp = (ship.id || '') + '|' + getCachedTime() + '|' + (ship.mode || '')
        + '|' + (ship.currentSOI || '')
        + '|' + (ship.pos ? ship.pos.x + ',' + ship.pos.y : '')
        + '|' + (ship.maxThrust || 0) + '|' + (ship.isp || 0)
        + '|' + (getTotalMass(ship) || 0) + '|' + (getFuelAmount(ship) || 0);
    for (const n of nodes) {
        fp += '|' + (n.id || '') + ',' + (n._rev | 0) + ',' + n.time
            + ',' + n.deltaV.x + ',' + n.deltaV.y + ',' + (n.executed ? 1 : 0)
            + ',' + (hasNodeSnapshot(n) ? 'S' : 'N')
            + ',' + (isFinite(n.massWet) ? n.massWet : -1);
    }
    const sel = maneuverSystem.peekSelectedNode(ship);   // 纯读（不写选中态、不补发 id）
    return fp + '|sel=' + (sel && sel.id ? sel.id : '');
}

// ===== 本帧解析 =====
// 返回 { fingerprint, shipId, baseSegments, nodes, selectedId, selected, nextPending }
//   nodes    : [{ node, plan, segments, burnArc, fuelOutPoint, selected }]（**不含屏幕坐标**，属渲染层）
//   selected : 选中节点条目（无节点/无计划 → null）
//   nextPending: 执行目标（下一个未执行节点）条目（无 → null）
function resolveChain(ship, fingerprint) {
    const nodes = maneuverSystem.getNodesSorted(ship);   // 附带旧存档节点 id 补发 + 时刻序
    if (nodes.length === 0) {
        _mvPlanCache.clear();
    } else if (_mvPlanCache.size > Math.max(8, nodes.length * 2)) {
        // 计划缓存清理（多节点 0.2.6）：节点增删后 Map 会残留已删除节点的条目 —
        // 数量明显超出当前节点数时重建缓存（避免长会话内存缓慢增长）
        const alive = new Set(nodes);
        for (const key of Array.from(_mvPlanCache.keys())) {
            if (!alive.has(key)) _mvPlanCache.delete(key);
        }
    }

    // 基础链（本模块自取，部署在渲染层之外）
    const baseSegments = ship.mode === 'on_rails'
        ? predictTrajectoryPatched(ship)
        : predictTrajectoryBurned(ship, false);

    let chain = baseSegments;
    let massLeft = getTotalMass(ship) || 0;
    let fuelLeft = getFuelAmount(ship) || 0;
    let prev = null;
    const out = [];
    // 分帧重算预算（多节点护栏）：一帧内最多重算 N 个计划，其余沿用上一帧（下一帧追赶）
    let recomputeBudget = MANEUVER_CONFIG.planRecomputeBudget || 3;

    for (const node of nodes) {
        // ① 旧节点快照回填 / 前序变化后的重投影
        const predId = prev ? prev.id : null;
        const predRev = prev ? (prev._rev | 0) : 0;
        const deps = node._deps;
        const needReproject = !hasNodeSnapshot(node)
            || !deps || deps.predId !== predId || deps.predRev !== predRev;
        if (needReproject) {
            try {
                const st = walkToTime(chain, node.time);
                if (st) {
                    reprojectNodeToState(node, st);
                    node._rev = (node._rev | 0) + 1;
                    // 快照重投影 = 节点被移到"本帧链（含前序燃烧）"的新点上 → 质量快照随
                    // 投影一并刷新为**链式投影值**（multinode 语义：节点时刻可见的剩余质量）。
                    // 注意：这里刷新的前提是链本身变了（上游编辑 / 前序执行 / 快照缺失）；
                    // 链不变时（②）不再改写 —— 见下。
                    node.massWet = massLeft;
                    node.massFuel = fuelLeft;
                }
            } catch (err) {
                // 链瞬时缺失（模式切换过渡帧 / 节点时刻超出链跨度）→ 保留原快照，本帧不重试
            }
            // 记录依赖：无论成功与否都写入，避免每帧重复尝试
            node._deps = { predId, predRev };
        }

        // ② 链式质量投影（前序燃烧后的剩余质量）—— **只在无有效快照时初始化**
        // node.massWet/massFuel 是"节点时刻质量快照"（computePlan 优先读它算 dvMax /
        // 燃烧时长 / 虚拟段）。原先每帧用飞船**当前**质量覆盖：燃烧期质量以 ṁ 下降 →
        // 计划 m(t) 曲线每帧变化 → 燃烧终点速度每帧漂移（实测机动线末端 217 km/帧），
        // 与 maneuverPrediction 的"优先用快照"注释自相矛盾。
        // 现在的刷新时机只有两个：① 快照重投影（链变化时，见上）；② 此处兜底 —— 节点
        // 从未有过有效质量快照（旧存档 / 外部裸建节点）时初始化一次。
        // 链未变化时（燃烧期每帧都属此情形）不再改写 → 计划缓存键稳定、末端静止。
        if (!isFinite(node.massWet) || node.massWet <= 0) {
            node.massWet = massLeft;
            node.massFuel = fuelLeft;
        } else if (!isFinite(node.massFuel) || node.massFuel < 0) {
            node.massFuel = Math.max(0, Math.min(fuelLeft, node.massWet));
        }

        // ③ 计算该节点计划（按节点缓存 + 分帧预算）
        const cacheHit = (() => {
            const c = _mvPlanCache.get(node);
            return !!(c && c.key === planCacheKey(ship, node));
        })();
        if (!cacheHit && recomputeBudget > 0) recomputeBudget -= 1;
        const result = planForNode(ship, node, chain, !cacheHit && recomputeBudget >= 0);

        out.push({ node, plan: result.plan, result });

        // ④ 链前推 + 扣质量
        if (result.segments && result.segments.length > 0) chain = result.segments;
        const used = burnFuelOf(result, ship);
        if (used > 0) {
            massLeft = Math.max(0, massLeft - used);
            fuelLeft = Math.max(0, fuelLeft - used);
        }
        prev = node;
    }

    // 选中节点：纯读领域层的选中态（写选中态是 UI 层职责，本模块不回写）
    const selNode = maneuverSystem.peekSelectedNode(ship);
    const selectedId = selNode ? selNode.id : null;

    const entries = out.map(o => ({
        node: o.node,
        plan: o.plan,
        segments: o.result.segments,
        burnArc: o.result.burnArc,
        fuelOutPoint: o.result.fuelOutPoint,
        selected: o.node.id === selectedId
    }));

    return {
        fingerprint,
        shipId: ship.id,
        baseSegments,
        nodes: entries,
        selectedId,
        selected: entries.find(e => e.node.id === selectedId) || entries[0] || null,
        // 执行目标（多节点 0.2.6）：下一个未执行节点 —— SAS 指向 / 定点加速 / 冲量归属都用它
        nextPending: entries.find(e => !e.node.executed) || null
    };
}

// ===== 对外接口 =====

/**
 * 解析本帧机动节点链（幂等）：
 *   · 更新阶段（flightScene.update）每帧调用一次 → 完成本帧解析；
 *   · 渲染阶段再调用 → 指纹未变直接复用（纯读，不重算、不写节点）。
 * 无飞船（ship 为空）→ 清空本帧结果。
 * @param {Object} ship - 活动飞船（或设施：无 maneuverNodes 时链为空）
 * @returns {Object|null} 本帧结果（见 resolveChain 返回值）
 */
export function updateManeuverChain(ship) {
    if (!ship) {
        _frame = null;
        _mvPlanCache.clear();
        return null;
    }
    const fp = frameFingerprint(ship);
    if (_frame && _frame.fingerprint === fp) return _frame;
    _frame = resolveChain(ship, fp);
    return _frame;
}

// 本帧基础链（当前轨道预测段；null = 未解析）
export function getBaseChain() {
    return _frame ? _frame.baseSegments : null;
}

// 本帧全部节点条目（[{ node, plan, segments, burnArc, fuelOutPoint, selected }]，无屏幕坐标）
export function getChainNodes() {
    return _frame ? _frame.nodes : [];
}

// 本帧选中节点条目（null = 无节点 / 解析失败）
export function getSelectedPrediction() {
    return _frame ? _frame.selected : null;
}

// 本帧选中节点 id
export function getChainSelectedId() {
    return _frame ? _frame.selectedId : null;
}

// 本帧执行目标（下一个未执行节点）条目
export function getNextPendingPrediction() {
    return _frame ? _frame.nextPending : null;
}

// ===== 链上最近点（领域坐标搜索）=====
// 段锚点：anchorBody 在当前游戏时刻的绝对世界位置（缺宿主 → 原点兜底 = 深空段）
function segmentAnchor(seg) {
    const body = celestialBodies.find(b => b.name === seg.anchorBody);
    return body ? bodyFuturePos(body, getCachedTime()) : { x: 0, y: 0 };
}

// 点到线段的最短距离（平方）与线段插值参数 t（0~1）
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
 * 在预测链中找距指定世界点最近的点（**领域坐标**搜索：不涉及 canvas / 屏幕投影）。
 * 世界→屏幕是等比相似变换（旋转 + 均匀缩放 + 平移），因此世界空间的距离比较、
 * 线段插值参数 t 与屏幕空间完全等价 —— 调用方把像素阈值除以每像素世界长度即可。
 * @param {Array} segments - 预测段（relPoints + anchorBody / anchorTime）
 * @param {Object} worldPoint - { x, y } 世界坐标
 * @param {number} thresholdWorld - 最近点判定阈值（世界长度）
 * @returns {Object|null} {
 *   segmentIndex, pointIndex,   // 命中线段 [pointIndex, pointIndex+1]
 *   segT,                       // 线段内插值参数 0~1
 *   worldX, worldY,             // 线段上最近点（世界坐标）
 *   distWorld,                  // 到最近点的世界距离
 *   soiName, isCurrentSoi,      // 段归属 SOI
 *   timeOffset                  // 插值时间（段内秒偏移，缺 t 字段时为 null）
 * }
 */
export function findNearestChainPoint(segments, worldPoint, thresholdWorld) {
    if (!segments || segments.length === 0 || !worldPoint || !(thresholdWorld > 0)) return null;

    const thresholdSq = thresholdWorld * thresholdWorld;
    let best = null;
    let bestDistSq = thresholdSq;

    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        if (!seg.relPoints || seg.relPoints.length < 2) continue;

        // 段间锚点不同（跨 SOI 各段宿主不同）→ 逐段把世界点折算到该段锚点参考系
        const anchor = segmentAnchor(seg);
        const px = worldPoint.x - anchor.x;
        const py = worldPoint.y - anchor.y;

        let prev = seg.relPoints[0];
        for (let pi = 1; pi < seg.relPoints.length; pi++) {
            const rp = seg.relPoints[pi];
            const hit = distToSegmentSq(px, py, prev.x, prev.y, rp.x, rp.y);
            if (hit.distSq < bestDistSq) {
                bestDistSq = hit.distSq;
                const p0 = prev;                                  // = seg.relPoints[pi - 1]
                best = {
                    segmentIndex: si,
                    pointIndex: pi - 1,
                    segT: hit.t,
                    worldX: (p0.x + (rp.x - p0.x) * hit.t) + anchor.x,
                    worldY: (p0.y + (rp.y - p0.y) * hit.t) + anchor.y,
                    soiName: seg.soiName,
                    isCurrentSoi: seg.isCurrentSoi,
                    // 时间与位置同参数插值；外部构造的段可能缺 t 字段，防御为 null
                    timeOffset: (p0.t !== undefined && rp.t !== undefined)
                        ? p0.t + (rp.t - p0.t) * hit.t
                        : null
                };
            }
            prev = rp;
        }
    }

    if (!best) return null;
    best.distWorld = Math.sqrt(bestDistSq);
    return best;
}
