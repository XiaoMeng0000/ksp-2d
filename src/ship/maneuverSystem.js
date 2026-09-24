'use strict';

// 机动节点系统（0.2.5 单节点 → 0.2.6 多节点）— 节点生命周期 + 手动燃烧进度跟踪（单例）
// 职责边界：
//   - 节点集合的数据操作（创建/删除/编辑 Δv/时间）——写入 ship.maneuverNodes
//   - 每帧 update：逐个节点的到达检测（MANEUVER_ARRIVED）、手动燃烧冲量累计、完成判定（MANEUVER_COMPLETED）
//   - 选中节点（编辑目标）与"下一个未完成节点"（执行目标）两条查询
//   - 不写 ship.mode / throttle / thrust——无自动执行原则，飞船控制仍完全由玩家进行
// 事件：MANEUVER_CREATED / DELETED / ARRIVED / COMPLETED（UI 与音频层订阅）
//
// 多节点（0.2.6）语义（总监定稿）：
//   · 链式规划：节点 2 的计划建立在"节点 1 烧完后的预测链"上（快照由渲染层链解析器写入）
//   · 选择模型：显式选中（面板编辑选中节点）；SAS 与定点加速指向"下一个未完成节点"
//   · 进度跟踪按节点隔离（Map，键 = 节点 id）；冲量归属于当前执行目标（下一个未完成节点）
//   · 节点数量不设上限；跟踪态不入存档（读档进度归零，与单节点时代一致）

import { eventBus, Events } from '../eventBus.js';
import { MANEUVER_CONFIG } from '../config/gameplay/maneuverConfig.js';
import { getCachedTime } from '../physics/orbitalPrediction.js';
import { computeNodeAxes, syncComponentsFromDeltaV, rebuildDeltaVFromComponents, propagateNodeSnapshot } from '../physics/maneuverPrediction.js';
import { getTotalMass, getFuelAmount } from '../resources/resourceSystem.js';

class ManeuverSystem {
    constructor() {
        if (ManeuverSystem._instance) {
            return ManeuverSystem._instance;
        }
        ManeuverSystem._instance = this;
        // 按节点的燃烧进度跟踪：nodeId → { applied:{x,y}, trackKey, arrivalNotified }
        this._track = new Map();
        // 按飞船的选中节点：shipId → nodeId（编辑目标；缺省 = 下一个未完成节点）
        this._selectedByShip = new Map();
        // 节点 id 序号（旧存档节点在首次访问时补发）
        this._idSeq = 0;
    }

    // ===== 基础查询 =====

    // 补发节点 id（旧存档/控制台裸建节点）
    _ensureIds(ship) {
        if (!ship || !Array.isArray(ship.maneuverNodes)) return;
        for (const n of ship.maneuverNodes) {
            if (!n.id) {
                this._idSeq += 1;
                n.id = 'mv' + this._idSeq + '_' + Math.round((n.time || 0) * 1000);
            }
        }
    }

    // 全部节点（按时刻升序；链式解析与 UI 切换器都用这个顺序）
    getNodesSorted(ship) {
        if (!ship || !Array.isArray(ship.maneuverNodes)) return [];
        this._ensureIds(ship);
        return ship.maneuverNodes.slice().sort((a, b) => a.time - b.time);
    }

    // 按 id / 引用取节点
    getNodeById(ship, id) {
        if (!ship || !Array.isArray(ship.maneuverNodes) || !id) return null;
        return ship.maneuverNodes.find(n => n.id === id) || null;
    }

    // 下一个未完成节点（执行目标：SAS 指向、定点加速、冲量归属）
    getNextPendingNode(ship) {
        for (const n of this.getNodesSorted(ship)) {
            if (!n.executed) return n;
        }
        return null;
    }

    // 选中的编辑目标（缺省 = 下一个未完成节点；全部完成后为最后一个节点）
    getSelectedNode(ship) {
        if (!ship || !Array.isArray(ship.maneuverNodes) || ship.maneuverNodes.length === 0) return null;
        this._ensureIds(ship);
        const id = this._selectedByShip.get(ship.id);
        const found = id ? this.getNodeById(ship, id) : null;
        if (found) return found;
        const next = this.getNextPendingNode(ship);
        const fallback = next || this.getNodesSorted(ship).slice(-1)[0] || null;
        if (fallback) this._selectedByShip.set(ship.id, fallback.id);
        return fallback;
    }

    // 切换选中（面板切换器 / 点击节点图标）
    setSelectedNode(ship, idOrNode) {
        if (!ship) return false;
        const node = typeof idOrNode === 'string' ? this.getNodeById(ship, idOrNode) : idOrNode;
        if (!node || !node.id) return false;
        this._selectedByShip.set(ship.id, node.id);
        return true;
    }

    // 兼容旧接口：单节点时代的 getNode == 选中节点
    getNode(ship) {
        return this.getSelectedNode(ship);
    }

    // 面板切换器：按时刻序循环（delta = ±1）
    cycleSelected(ship, delta) {
        const sorted = this.getNodesSorted(ship);
        if (sorted.length === 0) return null;
        const cur = this.getSelectedNode(ship);
        const idx = cur ? sorted.findIndex(n => n.id === cur.id) : 0;
        const nextIdx = ((idx + (delta || 0)) % sorted.length + sorted.length) % sorted.length;
        this.setSelectedNode(ship, sorted[nextIdx]);
        return sorted[nextIdx];
    }

    // ===== 按节点的进度跟踪 =====

    // 节点跟踪键：时间或 Δv 变化 → 该节点的冲量/到达状态归零（编辑即重算进度）
    _nodeKey(node) {
        return node.time + '|' + node.deltaV.x + '|' + node.deltaV.y;
    }

    _trackOf(node) {
        if (!node || !node.id) return { applied: { x: 0, y: 0 }, trackKey: null, arrivalNotified: false };
        let t = this._track.get(node.id);
        if (!t) {
            t = { applied: { x: 0, y: 0 }, trackKey: null, arrivalNotified: false };
            this._track.set(node.id, t);
        }
        return t;
    }

    // 重置指定节点的跟踪（编辑后调用）
    _resetTrackingFor(node) {
        if (!node || !node.id) return;
        this._track.set(node.id, {
            applied: { x: 0, y: 0 },
            trackKey: this._nodeKey(node),
            arrivalNotified: false
        });
    }

    // 兼容旧签名：传 null 清空全部跟踪
    _resetTracking(nodeKey) {
        if (nodeKey === null || nodeKey === undefined) {
            this._track.clear();
            return;
        }
        // 旧调用点传的是节点键而非 id —— 无法定位节点时保守清空该键命中的节点
        for (const [id, t] of this._track) {
            if (t.trackKey === nodeKey) this._track.delete(id);
        }
    }

    // ===== 创建 / 删除 =====

    // 创建节点（轨道菜单 / 放大图菜单落地）
    // data: { time, relX, relY, anchorBody, velRel? }（该链上的冻结快照）
    // 多节点：不再拒绝已有节点；新建节点自动成为选中目标
    createNode(ship, data) {
        if (!ship || !data || !isFinite(data.time)) {
            return { ok: false, reason: 'invalid' };
        }
        if (!Array.isArray(ship.maneuverNodes)) ship.maneuverNodes = [];
        this._ensureIds(ship);
        this._idSeq += 1;

        const node = {
            id: 'mv' + this._idSeq + '_' + Math.round(data.time * 1000),
            time: data.time,
            // Δv：世界矢量（派生缓存，消费方接口不变）+ 轨道参考系分量（唯一真值，方案B）
            deltaV: { x: 0, y: 0 },
            dvPro: 0,       // +顺向 / −逆向（节点时刻轨道参考系分量）
            dvRadial: 0,    // +径向朝外 / −径向朝内
            executed: false,
            // 链式失效版本号（多节点 0.2.6）：编辑/重投影时 +1，供下游节点判定是否重投影
            _rev: 0,
            // 依赖记录（由渲染层链解析器写入）：{ predId, predRev }
            _deps: null,
            // 轨道坐标冻结锚（图标随轨道线移动、预测不可用时回退显示）
            relX: (data.relX !== null && data.relX !== undefined) ? data.relX : null,
            relY: (data.relY !== null && data.relY !== undefined) ? data.relY : null,
            anchorBody: data.anchorBody || null,
            // 节点时刻速度快照（host 局部系）：节点时刻已过/链外时重建预测状态
            relVelX: (data.velRel && isFinite(data.velRel.x)) ? data.velRel.x : null,
            relVelY: (data.velRel && isFinite(data.velRel.y)) ? data.velRel.y : null,
            // 节点时刻质量快照：多节点下由渲染层链解析器按"前序节点燃烧后"的投影质量刷新
            // （这里先写当前质量作为初值，链解析会在下一帧校正）
            massWet: getTotalMass(ship) || 0,
            massFuel: getFuelAmount(ship) || 0
        };
        ship.maneuverNodes.push(node);
        this._resetTrackingFor(node);
        this._selectedByShip.set(ship.id, node.id);
        eventBus.emit(Events.MANEUVER_CREATED, { shipId: ship.id, node });
        return { ok: true, node };
    }

    // 删除节点（面板红按钮）：多节点下**只删选中/指定节点**（总监定稿）
    deleteNode(ship, idOrNode) {
        if (!ship || !Array.isArray(ship.maneuverNodes) || ship.maneuverNodes.length === 0) {
            return false;
        }
        const node = idOrNode
            ? (typeof idOrNode === 'string' ? this.getNodeById(ship, idOrNode) : idOrNode)
            : this.getSelectedNode(ship);
        if (!node) return false;
        const idx = ship.maneuverNodes.indexOf(node);
        if (idx < 0) return false;
        ship.maneuverNodes.splice(idx, 1);
        this._track.delete(node.id);
        if (this._selectedByShip.get(ship.id) === node.id) {
            this._selectedByShip.delete(ship.id);
        }
        eventBus.emit(Events.MANEUVER_DELETED, { shipId: ship.id, nodeId: node.id });
        return true;
    }

    // ===== 编辑 =====

    // 节点版本号（多节点链式失效用）：任何影响"该节点之后的链"的编辑都必须 +1，
    // 渲染层链解析器据此判定下游节点是否需要重投影（位置/速度取新链，Δv 分量不变）。
    _bumpRev(node) {
        if (!node) return;
        node._rev = (node._rev | 0) + 1;
    }

    // 沿节点参考系轴增减 Δv（方向手柄拖拽）：axisKey ∈ pro|retro|radIn|radOut，
    // axes = 预测 plan.axes（节点时刻轨道系单位向量）；编辑即重置该节点进度
    updateNodeDeltaV(ship, axisKey, deltaMs, axes, idOrNode) {
        const node = idOrNode ? (typeof idOrNode === 'string' ? this.getNodeById(ship, idOrNode) : idOrNode)
            : this.getSelectedNode(ship);
        if (!node || !axes || !axes[axisKey]) return false;
        syncComponentsFromDeltaV(node, axes);
        // 手柄语义：右=顺向(+) / 左=逆向(−)；上=径向朝外(+) / 下=径向朝内(−)
        if (axisKey === 'pro') node.dvPro += deltaMs;
        else if (axisKey === 'retro') node.dvPro -= deltaMs;
        else if (axisKey === 'radOut') node.dvRadial += deltaMs;
        else if (axisKey === 'radIn') node.dvRadial -= deltaMs;
        rebuildDeltaVFromComponents(node, axes);
        // 拖拽高频调用：不逐帧发事件（UI 每帧读预测缓存自刷新），仅重置该节点冲量基准
        this._bumpRev(node);
        this._resetTrackingFor(node);
        this._reopenAfterEdit(node);
        return true;
    }

    // 编辑即"重新进入计划态"：完成（executed）后节点与预测轨迹常驻，玩家可继续编辑；
    // 编辑后 executed 复位、该节点进度归零；若节点时刻已过，不重复弹到达提醒。
    _reopenAfterEdit(node) {
        if (!node) return;
        if (node.executed) node.executed = false;
        const t = this._trackOf(node);
        if (getCachedTime() >= node.time) t.arrivalNotified = true;
    }

    // 由节点快照（relX/relY/relVel）计算轨道参考系轴；快照不全时返回 null
    _snapshotAxes(node) {
        if (!node
            || node.relX === null || node.relX === undefined
            || node.relY === null || node.relY === undefined
            || node.relVelX === null || node.relVelX === undefined
            || node.relVelY === null || node.relVelY === undefined
            || !isFinite(node.relVelX) || !isFinite(node.relVelY)) {
            return null;
        }
        return computeNodeAxes({ x: node.relX, y: node.relY }, { x: node.relVelX, y: node.relVelY });
    }

    // 沿轨道拖动改节点时刻（data: { time, relX, relY, anchorBody, velRel? }）
    // 方案B：拖拽前按旧快照参考系迁移分量，拖拽后按新快照参考系重建世界矢量
    updateNodeTime(ship, data, idOrNode) {
        const node = idOrNode ? (typeof idOrNode === 'string' ? this.getNodeById(ship, idOrNode) : idOrNode)
            : this.getSelectedNode(ship);
        if (!node || !data || !isFinite(data.time)) return false;
        const oldAxes = this._snapshotAxes(node);
        if (oldAxes) syncComponentsFromDeltaV(node, oldAxes);

        node.time = data.time;
        if (data.relX !== null && data.relX !== undefined) node.relX = data.relX;
        if (data.relY !== null && data.relY !== undefined) node.relY = data.relY;
        if (data.anchorBody) node.anchorBody = data.anchorBody;
        if (data.velRel && isFinite(data.velRel.x) && isFinite(data.velRel.y)) {
            node.relVelX = data.velRel.x;
            node.relVelY = data.velRel.y;
        }
        // 新参考系下重建世界矢量（分量不变 → 方向随新位置旋转）
        const newAxes = this._snapshotAxes(node);
        if (newAxes) rebuildDeltaVFromComponents(node, newAxes);

        // 编辑即重新锚定计划：刷新质量快照（链解析会在下一帧按前序燃烧重新投影）
        node.massWet = getTotalMass(ship) || 0;
        node.massFuel = getFuelAmount(ship) || 0;
        this._bumpRev(node);
        this._resetTrackingFor(node);
        this._reopenAfterEdit(node);
        return true;
    }

    /**
     * 纯时间编辑（规划面板：改节点时间 / 按周期平移）：
     * 用节点冻结快照的 Kepler 轨道解析传播到 newTime（可跨任意多圈，不依赖预测链），
     * 刷新位置/速度快照并按新参考系重建 Δv 世界矢量（分量不变）。
     * @returns {{ok:boolean, period:number|null}}
     */
    updateNodeTimeByTime(ship, newTime, idOrNode) {
        const node = idOrNode ? (typeof idOrNode === 'string' ? this.getNodeById(ship, idOrNode) : idOrNode)
            : this.getSelectedNode(ship);
        if (!node || !isFinite(newTime)) return { ok: false, period: null };
        const prop = propagateNodeSnapshot(node, newTime);
        if (!prop) return { ok: false, period: null };

        const oldAxes = this._snapshotAxes(node);
        if (oldAxes) syncComponentsFromDeltaV(node, oldAxes);

        node.time = newTime;
        node.relX = prop.relPos.x;
        node.relY = prop.relPos.y;
        node.relVelX = prop.relVel.x;
        node.relVelY = prop.relVel.y;

        const newAxes = this._snapshotAxes(node);
        if (newAxes) rebuildDeltaVFromComponents(node, newAxes);

        this._bumpRev(node);
        this._resetTrackingFor(node);
        this._reopenAfterEdit(node);
        return { ok: true, period: prop.period };
    }

    // ===== 每帧更新 =====

    // flightScene 每帧调用（仅活动飞船）：
    // 1) 到达检测：跨过任一节点时刻一帧触发一次 MANEUVER_ARRIVED（永不失效，不自动执行）
    // 2) 冲量累计：thrust 模式期间 Σ(thrust·dt)，归属**当前执行目标**（下一个未完成节点）
    // 3) 完成判定：逐节点 剩余 = |Δv节点 − 已达成| ≤ 容差 → executed=true + MANEUVER_COMPLETED
    update(ship, dt) {
        if (!ship || !Array.isArray(ship.maneuverNodes) || ship.maneuverNodes.length === 0) {
            if (this._track.size > 0) this._track.clear();
            return;
        }
        this._ensureIds(ship);
        const now = getCachedTime();
        const nodes = this.getNodesSorted(ship);

        // 编辑过的节点：跟踪键变化 → 该节点进度归零
        for (const node of nodes) {
            const t = this._trackOf(node);
            const key = this._nodeKey(node);
            if (t.trackKey !== key) {
                this._track.set(node.id, { applied: { x: 0, y: 0 }, trackKey: key, arrivalNotified: false });
            }
        }

        // 1) 到达提醒（逐节点、一次性）
        for (const node of nodes) {
            const t = this._trackOf(node);
            if (!t.arrivalNotified && !node.executed && now >= node.time) {
                t.arrivalNotified = true;
                eventBus.emit(Events.MANEUVER_ARRIVED, { shipId: ship.id, node });
            }
        }

        // 2) 手动燃烧冲量累计 → 归属执行目标（下一个未完成节点）
        const target = this.getNextPendingNode(ship);
        if (target && ship.mode === 'thrust' && ship.thrust) {
            const t = this._trackOf(target);
            t.applied.x += ship.thrust.ax * dt;
            t.applied.y += ship.thrust.ay * dt;
        }

        // 3) 完成判定（逐节点；防假完成：计划 Δv 需 ≥ completionMinDv）
        for (const node of nodes) {
            if (node.executed) continue;
            const progress = this.getProgress(ship, node);
            if (progress.planned >= MANEUVER_CONFIG.completionMinDv
                && progress.remaining <= MANEUVER_CONFIG.completionTolerance) {
                node.executed = true;
                const t = this._trackOf(node);
                // 冲量对齐到节点 Δv：剩余精确归零，进度条满格、读数 0/47
                t.applied = { x: node.deltaV.x, y: node.deltaV.y };
                t.arrivalNotified = true;
                eventBus.emit(Events.MANEUVER_COMPLETED, { shipId: ship.id, node });
            }
        }
    }

    // 进度读取（UI 面板 / 进度条）：{ applied, remaining, planned, done }
    // nodeRef 缺省 = 选中节点
    getProgress(ship, nodeRef) {
        const node = nodeRef
            ? (typeof nodeRef === 'string' ? this.getNodeById(ship, nodeRef) : nodeRef)
            : this.getSelectedNode(ship);
        if (!node) return { applied: { x: 0, y: 0 }, remaining: 0, planned: 0, done: false };
        const t = this._trackOf(node);
        const planned = Math.hypot(node.deltaV.x, node.deltaV.y) || 0;
        const remaining = Math.hypot(
            node.deltaV.x - t.applied.x,
            node.deltaV.y - t.applied.y
        );
        return {
            applied: { x: t.applied.x, y: t.applied.y },
            remaining,
            planned,
            done: planned >= MANEUVER_CONFIG.completionMinDv
                && (node.executed || remaining <= MANEUVER_CONFIG.completionTolerance)
        };
    }
}

// 单例导出
export const maneuverSystem = new ManeuverSystem();

// 挂载到 window 供调试（与 shipSystem/gameState 一致）
if (typeof window !== 'undefined') {
    window.__maneuverSystem = maneuverSystem;
    console.log('[ManeuverSystem] 单例已创建，可通过 window.__maneuverSystem 访问');
}
