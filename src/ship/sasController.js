// SAS系统 —姿态稳定系统 级联控制器（位置环 + 速度环）

import { SASMode, computeTargetHeading } from './sasModes.js';

/**
 * SAS PD 控制器
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
            externalTargetHeading: null
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

    // ========== 核心控制 ==========

    /**
     * 每帧调用，计算并返回应施加的扭矩
     * @param {number} dt - 时间步长（秒），保留供未来扩展
     * @param {number} manualInput - 手动输入: -1(A键), +1(D键), 0(无输入)
     * @param {object} context - 飞行上下文
     * @param {number} context.shipVx - 飞船速度 X
     * @param {number} context.shipVy - 飞船速度 Y
     * @param {number} context.shipX - 飞船位置 X
     * @param {number} context.shipY - 飞船位置 Y
     * @param {number|undefined} context.hostX - SOI 中心天体 X
     * @param {number|undefined} context.hostY - SOI 中心天体 Y
     * @returns {number} 施加的扭矩（N·m），已限幅到 [-reactionWheelTorque, +reactionWheelTorque]
     */
    update(dt, manualInput, context) {
        const ship = this.ship;
        const maxTorque = ship.reactionWheelTorque || 0;

        // 无动量轮，SAS 无效
        if (maxTorque <= 0) return 0;

        // SAS 关闭 → 纯手动，无自动扭矩（不经过 PD，不施加阻尼）
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

        // STABILITY 模式：手动旋转时直接输出手动扭矩，跳过 PD 阻尼（避免与玩家对抗）
        if (this.mode === SASMode.STABILITY && manualInput !== 0) {
            this._wasManualInput = true;
            return manualInput * maxTorque;
        }

        // ---- 2. 计算角度误差（处理 wrap-around） ----
        const angleError = Math.atan2(
            Math.sin(targetHeading - ship.heading),
            Math.cos(targetHeading - ship.heading)
        );

        // ---- 3. 级联控制（外环位置 + 内环速度） ----
        // 外环（位置 → 期望角速度）：限制最大旋转速度，从根源杜绝刹车不及导致的震荡
        const MAX_ANG_VEL = 2.0;                       // rad/s（约 115°/s）
        const KP_POS = MAX_ANG_VEL / 0.8;              // 角度误差 0.8 rad（~46°）时驱动全速
        const desiredAngVel = Math.max(-MAX_ANG_VEL,
            Math.min(MAX_ANG_VEL, KP_POS * angleError));

        // 内环（速度 → 扭矩）：追逐期望角速度
        const angularVel = typeof ship.angularVelocity === 'number' ? ship.angularVelocity : 0;
        const KP_VEL = maxTorque / MAX_ANG_VEL;        // 达到最大角速度时用满扭矩
        let autoTorque = KP_VEL * (desiredAngVel - angularVel);

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
