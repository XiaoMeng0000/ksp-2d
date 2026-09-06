'use strict';

// 机动节点系统（0.3.0）— 节点生命周期 + 手动燃烧进度跟踪（单例）
// 职责边界：
//   - 节点数据操作（创建/删除/编辑 Δv/时间）——写入 ship.maneuverNodes
//   - 每帧 update：到达检测（MANEUVER_ARRIVED）、手动燃烧冲量累计、完成判定（MANEUVER_COMPLETED）
//   - 不写 ship.mode / throttle / thrust——无自动执行原则，飞船控制仍完全由玩家进行
// 事件：MANEUVER_CREATED / DELETED / ARRIVED / COMPLETED（UI 与音频层订阅）

import { eventBus, Events } from '../eventBus.js';
import { MANEUVER_CONFIG } from '../config/maneuverConfig.js';
import { getCachedTime } from '../physics/orbitalPrediction.js';
import { getTotalMass, getFuelAmount } from '../resources/resourceSystem.js';

class ManeuverSystem {
    constructor() {
        if (ManeuverSystem._instance) {
            return ManeuverSystem._instance;
        }
        ManeuverSystem._instance = this;
        // 手动燃烧累计冲量（host 局部系，m/s）与归属键（节点时间/Δv 变化即重置）
        this._applied = { x: 0, y: 0 };
        this._trackKey = null;
        this._arrivalNotified = false;
    }

    // 当前节点：优先取未执行节点（单节点 MVP 下最多一个）；全部已执行时取第一个（完成灰态显示用）
    getNode(ship) {
        if (!ship || !Array.isArray(ship.maneuverNodes)) return null;
        const arr = ship.maneuverNodes;
        for (const n of arr) {
            if (!n.executed) return n;
        }
        return arr.length > 0 ? arr[0] : null;
    }

    // 节点跟踪键：时间或 Δv 变化 → 冲量/到达状态归零（编辑即重算进度）
    _nodeKey(node) {
        return node.time + '|' + node.deltaV.x + '|' + node.deltaV.y;
    }

    _resetTracking(nodeKey) {
        this._applied = { x: 0, y: 0 };
        this._trackKey = nodeKey;
        this._arrivalNotified = false;
    }

    // 创建节点（右键菜单"创建机动计划"落地）：已存在未完成节点 → 拒绝
    // data: { time, relX, relY, anchorBody }（菜单冻结快照）
    createNode(ship, data) {
        if (!ship || !data || !isFinite(data.time)) {
            return { ok: false, reason: 'invalid' };
        }
        if (!Array.isArray(ship.maneuverNodes)) ship.maneuverNodes = [];
        for (const n of ship.maneuverNodes) {
            if (!n.executed) {
                return { ok: false, reason: 'exists' };
            }
        }
        const node = {
            time: data.time,
            deltaV: { x: 0, y: 0 },
            executed: false,
            // 轨道坐标冻结锚（图标随轨道线移动、预测不可用时回退显示）
            relX: (data.relX !== null && data.relX !== undefined) ? data.relX : null,
            relY: (data.relY !== null && data.relY !== undefined) ? data.relY : null,
            anchorBody: data.anchorBody || null,
            // 节点时刻速度快照（host 局部系，0.3.0 打磨）：节点时刻已过/链外时重建预测状态
            relVelX: (data.velRel && isFinite(data.velRel.x)) ? data.velRel.x : null,
            relVelY: (data.velRel && isFinite(data.velRel.y)) ? data.velRel.y : null,
            // 节点时刻质量快照（0.3.0 "燃烧期预测漂移"修复）：
            // 计划锚定节点时刻的飞船质量——点火燃烧后当前质量逐帧下降，
            // 若计划读取当前质量会每帧漂移（dvMax/燃烧时长/虚拟段逐帧变化）。
            // 旧存档无快照时 computePlan 回退当前质量（向后兼容）。
            massWet: getTotalMass(ship) || 0,
            massFuel: getFuelAmount(ship) || 0
        };
        ship.maneuverNodes.push(node);
        this._resetTracking(this._nodeKey(node));
        eventBus.emit(Events.MANEUVER_CREATED, { shipId: ship.id, node });
        return { ok: true, node };
    }

    // 删除节点（面板红按钮）：单节点 MVP 下清空全部节点
    deleteNode(ship) {
        if (!ship || !Array.isArray(ship.maneuverNodes) || ship.maneuverNodes.length === 0) {
            return false;
        }
        ship.maneuverNodes.length = 0;
        this._resetTracking(null);
        eventBus.emit(Events.MANEUVER_DELETED, { shipId: ship.id });
        return true;
    }

    // 沿节点参考系轴增减 Δv（方向手柄拖拽）：axisKey ∈ pro|retro|radIn|radOut，
    // axes = 预测 plan.axes（节点时刻轨道系单位向量）；编辑即重置进度
    updateNodeDeltaV(ship, axisKey, deltaMs, axes) {
        const node = this.getNode(ship);
        if (!node || !axes || !axes[axisKey]) return false;
        const u = axes[axisKey];
        node.deltaV.x += u.x * deltaMs;
        node.deltaV.y += u.y * deltaMs;
        // 拖拽高频调用：不逐帧发事件（UI 每帧读预测缓存自刷新），仅重置冲量基准
        this._resetTracking(this._nodeKey(node));
        return true;
    }

    // 沿轨道拖动改节点时刻（data: { time, relX, relY, anchorBody, velRel? }；
    // velRel 可选——拖动命中链内时由调用方经 walkToTime 给出速度快照）
    updateNodeTime(ship, data) {
        const node = this.getNode(ship);
        if (!node || !data || !isFinite(data.time)) return false;
        node.time = data.time;
        if (data.relX !== null && data.relX !== undefined) node.relX = data.relX;
        if (data.relY !== null && data.relY !== undefined) node.relY = data.relY;
        if (data.anchorBody) node.anchorBody = data.anchorBody;
        if (data.velRel && isFinite(data.velRel.x) && isFinite(data.velRel.y)) {
            node.relVelX = data.velRel.x;
            node.relVelY = data.velRel.y;
        }
        // 编辑即重新锚定计划：刷新质量快照（质量快照 = 最近一次授权的节点时刻质量）
        node.massWet = getTotalMass(ship) || 0;
        node.massFuel = getFuelAmount(ship) || 0;
        this._resetTracking(this._nodeKey(node));
        return true;
    }

    // 每帧更新（flightScene 在推力向量计算后调用，仅活动飞船）：
    // 1) 到达检测：跨过 node.time 一帧触发一次 MANEUVER_ARRIVED（永不失效，不自动执行）
    // 2) 冲量累计：thrust 模式期间 Σ(thrust·dt)（host 局部系，质量动态已含于 thrust 模长）
    // 3) 完成判定：剩余 = |Δv节点 − 已达成| ≤ 容差 → executed=true + MANEUVER_COMPLETED
    update(ship, dt) {
        const node = this.getNode(ship);
        if (!node || !ship) {
            this._resetTracking(null);
            return;
        }
        const key = this._nodeKey(node);
        if (this._trackKey !== key) {
            this._resetTracking(key);
        }

        // 1) 到达提醒（一次性；时间源与预测/渲染同源）
        if (!this._arrivalNotified && !node.executed) {
            if (getCachedTime() >= node.time) {
                this._arrivalNotified = true;
                eventBus.emit(Events.MANEUVER_ARRIVED, { shipId: ship.id, node });
            }
        }

        // 2) 手动燃烧冲量累计（引擎推力矢量由 flightScene 每帧计算）
        if (!node.executed && ship.mode === 'thrust' && ship.thrust) {
            this._applied.x += ship.thrust.ax * dt;
            this._applied.y += ship.thrust.ay * dt;
        }

        // 3) 完成判定（防假完成：计划 Δv 需 ≥ completionMinDv 才有判定意义，
        // 否则点一下手柄注入的 0.x m/s 会瞬间判完成 → 节点灰态、手柄全消失）
        if (!node.executed) {
            const progress = this.getProgress(ship);
            if (progress.planned >= MANEUVER_CONFIG.completionMinDv
                && progress.remaining <= MANEUVER_CONFIG.completionTolerance) {
                node.executed = true;
                // 冲量对齐到节点 Δv：剩余精确归零，进度条满格、读数 0/47
                this._applied = { x: node.deltaV.x, y: node.deltaV.y };
                eventBus.emit(Events.MANEUVER_COMPLETED, { shipId: ship.id, node });
            }
        }
    }

    // 进度读取（UI 面板 / 进度条）：{ applied, remaining, planned, done }
    getProgress(ship) {
        const node = this.getNode(ship);
        if (!node) return { applied: { x: 0, y: 0 }, remaining: 0, planned: 0, done: false };
        const planned = Math.hypot(node.deltaV.x, node.deltaV.y) || 0;
        const remaining = Math.hypot(
            node.deltaV.x - this._applied.x,
            node.deltaV.y - this._applied.y
        );
        return {
            applied: { x: this._applied.x, y: this._applied.y },
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
