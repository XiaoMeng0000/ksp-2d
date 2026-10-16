'use strict';

// ===== LOD 共享数学（0.3.x）=====
// 从 renderer.js 的恒星光晕过渡区内联实现中提取，现由两处共用：
//   1. 恒星 near/far 两档 LOD 的过渡区（贴图渐隐 + 光晕渐显、尺寸收敛）
//   2. 天体图标缩放保护的贴图→图标交叉淡入
// 纯数学、无副作用、不依赖画布与状态。

/**
 * 归一化混合进度 + easeInOut 缓动。
 * 语义：value 从 from 变化到 to 时，返回 0→1 的缓动进度。
 *   · value >= from → 0（尚未进入过渡）
 *   · value <= to   → 1（过渡完成）
 * 缓动曲线（与原恒星 LOD 内联实现逐字一致，保证行为数值等价）：
 *   前半段 2t²（缓入）、后半段 1 − (−2t+2)²/2（缓出）
 * @param {number} value - 当前值（如贴图屏幕半径，随缩小递减）
 * @param {number} from - 过渡起点（较大值）
 * @param {number} to - 过渡终点（较小值）；等于 from 时返回 1
 * @returns {number} 0~1 缓动进度
 */
export function lodBlendT(value, from, to) {
    const span = from - to;
    if (!(span > 0)) return value <= to ? 1 : 0;
    const t = (from - value) / span;
    const c = t < 0 ? 0 : (t > 1 ? 1 : t);
    return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

/**
 * 对数插值：跨尺度参数的平滑过渡（线性插值会在大倍率差时前快后慢）。
 * from / to 必须同号且非零，否则原样返回 from（调用方兜底）。
 * @param {number} from - 起始值
 * @param {number} to - 目标值
 * @param {number} s - 进度 0~1
 * @returns {number} 插值结果
 */
export function lerpLog(from, to, s) {
    if (!(from > 0) || !(to > 0)) return from;
    return from * Math.pow(to / from, s);
}
