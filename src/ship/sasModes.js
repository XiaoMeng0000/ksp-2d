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
 * 计算导航球四方向实时角度（世界系，与 heading 同约定：0=世界+Y，顺时针，弧度）
 * 供 UI 层（导航球方向标记）与控制层（SAS 目标朝向）共用，消除两套重复数学
 * @param {number} shipVx - 飞船速度 X
 * @param {number} shipVy - 飞船速度 Y
 * @param {number} shipX - 飞船位置 X（世界/宿主相对系）
 * @param {number} shipY - 飞船位置 Y
 * @param {number|undefined} hostX - SOI 中心天体位置 X
 * @param {number|undefined} hostY - SOI 中心天体位置 Y
 * @returns {{ prograde: number|null, retrograde: number|null, radialIn: number|null, radialOut: number|null }}
 *         各方向角度（弧度），速度过小或无宿主时为 null
 */
export function computeNavballDirections(shipVx, shipVy, shipX, shipY, hostX, hostY) {
    const speed = Math.sqrt(shipVx * shipVx + shipVy * shipVy);

    // 顺向 = 速度方向；速度过小时方向无意义 → null（UI 层据此淡出标记）
    let prograde = null;
    if (speed >= LOW_SPEED_THRESHOLD) {
        prograde = Math.atan2(shipVx, shipVy);
    }

    // 径向内 = 指向宿主中心（世界系坐标差）
    let radialIn = null;
    if (hostX !== undefined && hostY !== undefined) {
        radialIn = Math.atan2(hostX - shipX, hostY - shipY);
    }

    return {
        prograde: prograde,
        retrograde: prograde !== null ? wrapAngle(prograde + Math.PI) : null,
        radialIn: radialIn,
        radialOut: radialIn !== null ? wrapAngle(radialIn + Math.PI) : null
    };
}

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
            // 复用统一方向数学：prograde 为 null（速度过小）时保持上一有效指向
            const dirs = computeNavballDirections(
                context.shipVx, context.shipVy,
                context.shipX, context.shipY,
                context.hostX, context.hostY
            );
            if (dirs.prograde === null) {
                return state.lastValidProgradeHeading ?? context.shipHeading;
            }
            state.lastValidProgradeHeading = dirs.prograde;
            return dirs.prograde;
        }

        // ---- 逆向 ----
        case SASMode.RETROGRADE: {
            const prograde = computeTargetHeading(SASMode.PROGRADE, context, state);
            return wrapAngle(prograde + Math.PI);
        }

        // ---- 径向向内（指向宿主天体） ----
        case SASMode.RADIAL_IN: {
            // 复用统一方向数学：无宿主时回退当前朝向
            const dirs = computeNavballDirections(
                context.shipVx, context.shipVy,
                context.shipX, context.shipY,
                context.hostX, context.hostY
            );
            return dirs.radialIn !== null ? dirs.radialIn : context.shipHeading;
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
