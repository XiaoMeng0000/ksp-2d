// SAS系统 — 姿态稳定系统 时间最优姿态控制器（bang-bang）
// 方案依据：时间最优双积分器控制（刹停距离判据）+ KSP 的按扭矩/MOI 自适应思想
//   1. 每帧以可达角加速度 aMax=扭矩/惯量 评估"当前角速度的刹停距离 v²/(2·aMax)"
//   2. 刹停距离 ≥ 剩余误差 → 立即全力刹车；距离充足 → 全力加速；达巡航上限 → 维持
//   3. 双死区：角度与角速度都小 → 停止输出；角度已到位但仍有角速度 → 持续刹车

import { SASMode, computeTargetHeading } from './sasModes.js';
import { SAS_CONTROL } from '../config/sasConfig.js';

// 控制器参数（统一从配置文件读取，避免硬编码）
const MAX_ANG_VEL = SAS_CONTROL.maxAngularVelocity;        // 绝对角速度上限（rad/s，约 115°/s）
const VELOCITY_DEADBAND = SAS_CONTROL.velocityDeadband;    // 速度环死区（rad/s）
const DEADBAND_ERROR = SAS_CONTROL.deadbandError;          // 角度死区（rad ≈ 0.6°）
const DEADBAND_VELOCITY = SAS_CONTROL.deadbandVelocity;    // 角速度死区（rad/s）

/**
 * SAS 控制器
 * 每个飞船实例一个控制器，负责根据当前模式计算目标朝向并输出扭矩
 */
export class SASController {
    /**
     * @param {object} ship - 飞船实例引用（直接引用，非拷贝）
     */
    constructor(ship) {
        this.ship = ship;
        this.mode = SASMode.OFF;

        // STABILITY 模式锁定的朝向（弧度）
        this._stabilityLockHeading = ship.heading || 0;

        // 追踪手动输入状态：是否有上一帧按着 A/D 的手动操作
        this._wasManualInput = false;

        // 跨帧可变状态，传给 computeTargetHeading 使用
        this._state = {
            lastValidProgradeHeading: null,
            externalTargetHeading: null,
            maneuverHeading: null
        };
    }

    // ========== 模式管理 ==========

    /**
     * 切换 SAS 模式
     * @param {string} mode - SASMode 枚举值
     */
    setMode(mode) {
        if (this.mode === mode) return;

        this.mode = mode;

        // 切换到 STABILITY 时锁定当前朝向
        if (mode === SASMode.STABILITY) {
            this._stabilityLockHeading = this.ship.heading;
        }
    }

    /** @returns {string} 当前 SAS 模式 */
    getMode() {
        return this.mode;
    }

    /** @returns {boolean} SAS 是否已激活 */
    isActive() {
        return this.mode !== SASMode.OFF;
    }

    // ========== 预留接口（TARGET 模式） ==========

    /**
     * 外部设置目标朝向（供 TARGET 模式使用）
     * @param {number} angle - 目标朝向（弧度）
     */
    setTargetHeading(angle) {
        this._state.externalTargetHeading = angle;
    }

    /** @returns {boolean} 是否有有效的外部目标朝向 */
    hasValidTarget() {
        return this._state.externalTargetHeading !== null;
    }

    // ========== 机动节点指向（MANEUVER 模式） ==========

    /**
     * 外部注入机动节点指向（0.3.0）：
     *   过节点前 = 节点加速方向；过节点后 = 达成目标轨道的当前燃烧方向。
     * 每帧由飞行场景计算并注入；angle 为 null（无有效方向）时回退当前朝向。
     * @param {number|null} angle - 机动方向（弧度，heading 约定 0=+Y 顺时针）
     */
    setManeuverHeading(angle) {
        this._state.maneuverHeading = angle;
    }

    // ========== 核心控制 ==========

    /**
     * 每帧调用，计算并返回应施加的扭矩
     * @param {number} dt - 时间步长（秒）
     * @param {number} manualInput - 手动输入: -1(A键), +1(D键), 0(无输入)
     * @param {object} context - 飞行上下文
     * @param {number} context.shipVx - 飞船速度 X
     * @param {number} context.shipVy - 飞船速度 Y
     * @param {number} context.shipX - 飞船位置 X
     * @param {number} context.shipY - 飞船位置 Y
     * @param {number|undefined} context.hostX - SOI 中心天体 X
     * @param {number|undefined} context.hostY - SOI 中心天体 Y
     * @param {number} context.shipHeading - 飞船当前朝向
     * @returns {number} 施加的扭矩（N·m），已限幅到 [-reactionWheelTorque, +reactionWheelTorque]
     */
    update(dt, manualInput, context) {
        const ship = this.ship;
        const maxTorque = ship.reactionWheelTorque || 0;

        // 无动量轮，SAS 无效
        if (maxTorque <= 0) return 0;

        // SAS 关闭 → 纯手动，无自动扭矩（不经过控制律，不施加阻尼）
        if (this.mode === SASMode.OFF) {
            return (manualInput || 0) * maxTorque;
        }

        // ---- 1. 确定目标朝向 ----
        let targetHeading;
        if (this.mode === SASMode.STABILITY) {
            targetHeading = this._stabilityLockHeading;
        } else {
            targetHeading = computeTargetHeading(this.mode, context, this._state);
        }

        // STABILITY 模式：手动旋转时直接输出手动扭矩，跳过自动控制（避免与玩家对抗）
        if (this.mode === SASMode.STABILITY && manualInput !== 0) {
            this._wasManualInput = true;
            return manualInput * maxTorque;
        }

        // ---- 2. 计算角度误差（处理 wrap-around） ----
        const angleError = Math.atan2(
            Math.sin(targetHeading - ship.heading),
            Math.cos(targetHeading - ship.heading)
        );

        // ---- 3. 时间最优 bang-bang 控制 ----
        const moi = ship.momentOfInertia || 1.0;
        const aMax = maxTorque / moi;                 // 可达最大角加速度（物理极限）
        const angularVel = typeof ship.angularVelocity === 'number' ? ship.angularVelocity : 0;
        const signE = Math.sign(angleError);

        let aCmd = 0;
        if (Math.abs(angularVel) < DEADBAND_VELOCITY && Math.abs(angleError) < DEADBAND_ERROR) {
            // 双死区：角度与角速度都已归位，完全停止输出，防到位抖动
            aCmd = 0;
        } else if (Math.abs(angleError) < DEADBAND_ERROR) {
            // 角度已到位，仅消除残余角速度
            aCmd = -Math.sign(angularVel) * aMax;
        } else {
            const vToward = signE * angularVel;       // 朝目标方向的角速度分量（>0 表示正向目标）
            const stopDist = angularVel * angularVel / (2 * aMax);  // 当前角速度的刹停距离
            if (vToward < 0) {
                // 正在反向转动：先全力消除反向角速度
                aCmd = signE * aMax;
            } else if (stopDist >= Math.abs(angleError) - DEADBAND_ERROR) {
                // 刹停距离已达剩余误差：立即全力刹车，杜绝过冲
                aCmd = -signE * aMax;
            } else if (Math.abs(angularVel) >= MAX_ANG_VEL - VELOCITY_DEADBAND) {
                // 已达巡航速度上限：维持，不再加速
                aCmd = 0;
            } else {
                // 距离充足：全力加速（时间最优）
                aCmd = signE * aMax;
            }
        }

        const autoTorque = moi * aCmd;

        // ---- 4. 手动输入叠加（KSP 方式） ----
        const manualTorque = manualInput * maxTorque;
        let totalTorque = autoTorque + manualTorque;

        // ---- 5. 扭矩限幅 ----
        totalTorque = Math.max(-maxTorque, Math.min(maxTorque, totalTorque));

        // ---- 6. STABILITY 松手重锁 ----
        if (this.mode === SASMode.STABILITY) {
            if (manualInput !== 0) {
                this._wasManualInput = true;
            } else if (this._wasManualInput) {
                // 刚松手，重新锁定当前朝向
                this._stabilityLockHeading = ship.heading;
                this._wasManualInput = false;
            }
        }

        return totalTorque;
    }
}
