// SAS系统 — 姿态稳定系统模式枚举与目标朝向计算

// ========== 模式枚举 ==========
export const SASMode = Object.freeze({
    OFF:        'off',
    STABILITY:  'stability',
    PROGRADE:   'prograde',
    RETROGRADE: 'retrograde',
    RADIAL_IN:  'radial_in',
    RADIAL_OUT: 'radial_out',
    TARGET:     'target'    // 预留
});

// ========== 模式中文标签 ==========
export const SASModeLabels = {
    off:        '关闭',
    stability:  '姿态保持',
    prograde:   '顺向',
    retrograde: '逆向',
    radial_in:  '径向内',
    radial_out: '径向外',
    target:     '目标指向'
};

// ========== T键循环切换顺序 ==========
export const SAS_CYCLE_ORDER = [
    SASMode.OFF,
    SASMode.STABILITY,
    SASMode.PROGRADE,
    SASMode.RETROGRADE,
    SASMode.RADIAL_IN,
    SASMode.RADIAL_OUT
];

// ========== G键方向循环顺序（不含 OFF） ==========
export const SAS_DIRECTION_ORDER = [
    SASMode.STABILITY,
    SASMode.PROGRADE,
    SASMode.RETROGRADE,
    SASMode.RADIAL_IN,
    SASMode.RADIAL_OUT
];

// ========== 辅助函数 ==========

/**
 * 将角度归一化到 [0, 2π) 范围
 * @param {number} angle - 弧度
 * @returns {number} 归一化后的弧度
 */
function wrapAngle(angle) {
    return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// ========== 目标朝向计算 ==========

// 用于 PROGRADE 模式的低速退避阈值（m/s）
const LOW_SPEED_THRESHOLD = 0.1;

/**
 * 根据 SAS 模式计算目标朝向
 * @param {string} mode - SASMode 枚举值
 * @param {object} context - 当前飞行上下文
 * @param {number} context.shipVx - 飞船速度 X
 * @param {number} context.shipVy - 飞船速度 Y
 * @param {number} context.shipX - 飞船位置 X
 * @param {number} context.shipY - 飞船位置 Y
 * @param {number|undefined} context.hostX - SOI 中心天体位置 X
 * @param {number|undefined} context.hostY - SOI 中心天体位置 Y
 * @param {number} context.shipHeading - 飞船当前朝向（回退值，弧度）
 * @param {object} state - 跨帧可变状态
 * @param {number|null} state.lastValidProgradeHeading - 上一个有效的 PROGRADE 指向
 * @param {number|null} state.externalTargetHeading - 外部设置的目标朝向（TARGET 模式）
 * @returns {number|null} 目标朝向（弧度），STABILITY 模式返回 null
 */
export function computeTargetHeading(mode, context, state) {
    switch (mode) {
        // ---- 姿态保持 ----
        case SASMode.STABILITY:
            return null;

        // ---- 顺向 ----
        case SASMode.PROGRADE: {
            const speed = Math.sqrt(context.shipVx ** 2 + context.shipVy ** 2);
            if (speed < LOW_SPEED_THRESHOLD) {
                return state.lastValidProgradeHeading ?? context.shipHeading;
            }
            // heading=0 = 世界+Y = 屏幕上方向，atan2(vx, vy) 对应速度在世界坐标系的方向
            const heading = Math.atan2(context.shipVx, context.shipVy);
            state.lastValidProgradeHeading = heading;
            return heading;
        }

        // ---- 逆向 ----
        case SASMode.RETROGRADE: {
            const prograde = computeTargetHeading(SASMode.PROGRADE, context, state);
            return wrapAngle(prograde + Math.PI);
        }

        // ---- 径向向内（指向宿主天体） ----
        case SASMode.RADIAL_IN: {
            if (context.hostX === undefined || context.hostY === undefined) {
                return context.shipHeading;
            }
            const dx = context.hostX - context.shipX;
            const dy = context.hostY - context.shipY;
            return Math.atan2(dx, dy);
        }

        // ---- 径向向外（背离宿主天体） ----
        case SASMode.RADIAL_OUT: {
            const radialIn = computeTargetHeading(SASMode.RADIAL_IN, context, state);
            return wrapAngle(radialIn + Math.PI);
        }

        // ---- 目标指向（预留） ----
        case SASMode.TARGET:
            return state.externalTargetHeading ?? context.shipHeading;

        // ---- 关闭 / 未知模式 ----
        default:
            return context.shipHeading;
    }
}
