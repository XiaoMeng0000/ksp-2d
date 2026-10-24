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
    segmentStateAtTime,
    prepareSegmentState,
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

// ===== 链上最近点（真实曲线最近时刻，0.2.6）=====
// 折线只做粗筛（distToSegmentSq 找候选段与候选时刻），最终在候选段的**真实曲线 P(t)**
// 上求距鼠标最近的时刻：窗口内均匀采样定位局部极小 → 黄金分割收敛 → 端点比较。
// 返回的 relPos/relVel/anchorBody/time 全部来自同一次求值 —— 节点快照原子性的来源
// （旧实现的"弦上插值位置 + walkToTime 速度"混写会造出自相矛盾的轨道根数）。
// 解析段（有 startState 且根数有效）走 kepler 传播；非解析段（径向直线 / RK4 兜底）
// 退回采样点插值并标 exact:false —— 不伪装成精确。

// 段采样点的时间跨度（秒）：取"最大有限 t"作为包围上界。
// 采样点 t 不能全信（预测层采样标签历史上曾错位），故它只当包围上界用，
// 精化窗口在边界取到极小值时向外扩展（见 resolveNearestPointOnChain）。
function segmentSpan(seg) {
    const pts = seg.relPoints;
    let span = 0;
    for (const p of pts) {
        if (isFinite(p.t) && p.t > span) span = p.t;
    }
    return span;
}

// 窗口内取真实曲线上的最近时刻：均匀采样定位局部极小所在子区间 → 黄金分割 → 端点比较
function refineWindow(distSqAt, lo, hi, cfg) {
    const n = Math.max(2, cfg.nearestRefineScanSamples | 0);
    const ts = [];
    const fs = [];
    for (let i = 0; i <= n; i++) {
        const t = lo + (hi - lo) * (i / n);
        ts.push(t);
        fs.push(distSqAt(t));
    }
    let bi = 0;
    for (let i = 1; i <= n; i++) {
        if (fs[i] < fs[bi]) bi = i;
    }
    let bestT = ts[bi];
    let bestF = fs[bi];

    const tol = cfg.nearestRefineTimeTol;
    const a = ts[Math.max(0, bi - 1)];
    const b = ts[Math.min(n, bi + 1)];
    if (b - a > tol) {
        const r = goldenSectionMin(distSqAt, a, b, cfg.nearestRefineMaxIters | 0, tol);
        if (r.f < bestF) {
            bestT = r.t;
            bestF = r.f;
        }
    }
    // 端点比较：极小值落在窗口边界时由外层扩展窗口再试（采样点 t 不可信的兜底）
    if (fs[0] < bestF) {
        bestT = ts[0];
        bestF = fs[0];
    }
    if (fs[n] < bestF) {
        bestT = ts[n];
        bestF = fs[n];
    }
    return { t: bestT, f: bestF };
}

// 黄金分割求单峰区间内的极小值（迭代上限硬约束，防死循环）
function goldenSectionMin(f, lo, hi, maxIters, tol) {
    const g = 0.6180339887498949;          // 1/φ
    let a = lo;
    let b = hi;
    let c = b - g * (b - a);
    let d = a + g * (b - a);
    let fc = f(c);
    let fd = f(d);
    for (let i = 0; i < maxIters && (b - a) > tol; i++) {
        if (fc < fd) {
            b = d;
            d = c;
            fd = fc;
            c = b - g * (b - a);
            fc = f(c);
        } else {
            a = c;
            c = d;
            fc = fd;
            d = a + g * (b - a);
            fd = f(d);
        }
    }
    // 收敛区间中点 vs 两端点：取最优（区间内已按单峰假设收缩，端点仍需参与比较）
    const mid = (a + b) / 2;
    let bestT = mid;
    let bestF = f(mid);
    for (const t of [a, b, lo, hi]) {
        const fv = f(t);
        if (fv < bestF) {
            bestT = t;
            bestF = fv;
        }
    }
    return { t: bestT, f: bestF };
}

/**
 * 在预测链中找距指定世界点最近的真实轨道点（折线粗筛 + 真实曲线精化）。
 * 位置/速度/宿主/时刻来自同一次求值，调用方应把四个字段整体写入节点（原子写入）。
 * @param {Array} segments - 预测段（relPoints + anchorBody / anchorTime / startState）
 * @param {Object} worldPoint - { x, y } 世界坐标（绝对坐标，与渲染层轨道线同锚定口径）
 * @param {number} thresholdWorld - 命中阈值（世界长度；调用方把像素阈值除以每像素世界长度）
 * @returns {Object|null} {
 *   time,        // 命中点的绝对游戏时刻（与 relPos/relVel 同一求值）
 *   relPos, relVel,   // 该时刻相对宿主的位置/速度（节点快照字段来源）
 *   anchorBody,  // 该时刻宿主名
 *   host,        // 宿主天体对象（缺失 → null，深空段）
 *   segmentIndex,// 命中的段下标（**相对传入的 segments**，调用方不得再换用别的链取段）
 *   distWorld,   // 鼠标到真实曲线最近点的世界距离
 *   exact        // true = 解析传播求值；false = 非解析段采样点插值（降级）
 * }
 */
export function resolveNearestPointOnChain(segments, worldPoint, thresholdWorld) {
    const cfg = MANEUVER_CONFIG;
    if (!segments || segments.length === 0 || !worldPoint
        || !isFinite(worldPoint.x) || !isFinite(worldPoint.y)
        || !(thresholdWorld > 0)) {
        return null;
    }

    // ① 粗筛：折线弦（只在阈值内的边参与，候选边自带段锚点局部坐标）
    const thresholdSq = thresholdWorld * thresholdWorld;
    const candidates = [];
    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        if (!seg || !seg.relPoints || seg.relPoints.length < 2) continue;
        const anchor = segmentAnchor(seg);
        const lx = worldPoint.x - anchor.x;
        const ly = worldPoint.y - anchor.y;
        let prev = seg.relPoints[0];
        for (let pi = 1; pi < seg.relPoints.length; pi++) {
            const rp = seg.relPoints[pi];
            const hit = distToSegmentSq(lx, ly, prev.x, prev.y, rp.x, rp.y);
            if (hit.distSq <= thresholdSq) {
                candidates.push({ si, pi: pi - 1, segT: hit.t, distSq: hit.distSq, lx, ly });
            }
            prev = rp;
        }
    }
    if (candidates.length === 0) return null;

    // ② 候选排序：同段只精化最近的一条边，最多 nearestRefineCandidates 段（每帧成本护栏）
    candidates.sort((p, q) => p.distSq - q.distSq);
    const maxCand = Math.max(1, cfg.nearestRefineCandidates | 0);
    const picked = [];
    const seenSeg = new Set();
    for (const c of candidates) {
        if (seenSeg.has(c.si)) continue;
        seenSeg.add(c.si);
        picked.push(c);
        if (picked.length >= maxCand) break;
    }

    // ③ 逐候选在真实曲线上精化，取世界距离最小者
    let best = null;
    for (const cand of picked) {
        const seg = segments[cand.si];
        const span = segmentSpan(seg);
        const prep = prepareSegmentState(seg);
        let tLocal = null;
        let exact = false;

        if (prep && span > 0) {
            // 候选时刻：优先用采样点 t 插值；t 缺失/越界时按边序号比例（采样点 t 不可信的兜底）
            const pts = seg.relPoints;
            const p0 = pts[cand.pi];
            const p1 = pts[cand.pi + 1];
            const tSample = (isFinite(p0.t) && isFinite(p1.t))
                ? p0.t + (p1.t - p0.t) * cand.segT
                : null;
            const tHit = (tSample !== null && tSample >= 0 && tSample <= span)
                ? tSample
                : span * ((cand.pi + cand.segT) / (pts.length - 1));

            // 距离函数：段内局部秒 → 鼠标到 P(t) 的世界距离平方（与折线同一锚定口径）
            const distSqAt = (t) => {
                const st = segmentStateAtTime(seg, seg.anchorTime + t, prep);
                if (!st || !st.relPos) return Infinity;
                const dx = cand.lx - st.relPos.x;
                const dy = cand.ly - st.relPos.y;
                return dx * dx + dy * dy;
            };

            // 有界搜索：窗口半宽 = max(段跨度×比例, 最小秒数)；极小值贴窗边 → 扩展窗口再试
            const halfBase = Math.max(cfg.nearestRefineWindowMinSeconds,
                span * cfg.nearestRefineWindowFrac);
            const maxExpand = Math.max(0, cfg.nearestRefineMaxExpand | 0);
            let win = null;
            for (let expand = 0; expand <= maxExpand; expand++) {
                const half = halfBase * Math.pow(2, expand);
                const lo = Math.max(0, Math.min(span, tHit - half));
                const hi = Math.min(span, Math.max(0, tHit + half));
                if (hi - lo < 1e-12) {
                    // 段跨度已退化到零：只在候选时刻单点求值（无窗口可搜）
                    win = { t: tHit, f: distSqAt(tHit) };
                    break;
                }
                const r = refineWindow(distSqAt, lo, hi, cfg);
                if (!win || r.f < win.f) win = r;
                const atEdge = (r.t <= lo + 1e-9) || (r.t >= hi - 1e-9);
                if (!atEdge) break;                       // 极小值在窗口内侧 → 收敛
            }
            if (!win) continue;
            tLocal = win.t;
            exact = true;
        } else {
            // 非解析段 / 无可用跨度：退回采样点插值（exact:false，不伪装精确）
            const pts = seg.relPoints;
            const p0 = pts[cand.pi];
            const p1 = pts[cand.pi + 1];
            const tSample = (isFinite(p0.t) && isFinite(p1.t))
                ? p0.t + (p1.t - p0.t) * cand.segT
                : null;
            if (tSample === null || !isFinite(tSample)) continue;
            tLocal = tSample;
            exact = false;
        }

        const absTime = seg.anchorTime + tLocal;
        const st = segmentStateAtTime(seg, absTime, prep);
        if (!st || !st.relPos || !st.relVel) continue;
        if (!isFinite(st.relPos.x) || !isFinite(st.relPos.y)
            || !isFinite(st.relVel.x) || !isFinite(st.relVel.y)) {
            continue;
        }
        const distWorld = Math.hypot(cand.lx - st.relPos.x, cand.ly - st.relPos.y);
        // 精化后跑出阈值外 = 鼠标其实不在曲线上（弦比曲线更贴近鼠标的假命中）→ 丢弃
        if (!(distWorld <= thresholdWorld)) continue;
        if (!best || distWorld < best.distWorld) {
            best = {
                time: absTime,
                relPos: st.relPos,
                relVel: st.relVel,
                anchorBody: seg.anchorBody || seg.soiName || null,
                host: st.host || null,
                segmentIndex: cand.si,
                distWorld,
                exact
            };
        }
    }
    return best;
}
