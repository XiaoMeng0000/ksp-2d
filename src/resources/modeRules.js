'use strict';

// 游戏模式规则层（0.2.0）
// sandbox（自由）/ career（生涯）的规则差异全部集中在本模块。
// 业务代码只调这些接口，不散落 if (mode === 'career')，将来扩展差异只改本模块。

import { gameState } from '../gameState.js';

function getMode() {
    return gameState.getState().player.gameMode || 'sandbox';
}

// 是否严格校验余额（不足即拒绝操作）
// career=true 严格经济；sandbox=false 无限资源兜底 —— 扣费照常（数字流动），
// 但余额不足不构成操作障碍（有多少扣多少，扣到 0）。决策：0.2.0 阶段7。
export function isBalanceEnforced() {
    return getMode() === 'career';
}

// 该资源在自由模式下是否免扣（不扣费）
// 当前规则：sandbox 下科技点永不消耗（蓝图全解锁，科技点无意义）；
// 其余资源（实体资源/推进剂）照常扣费。注意：推进剂引擎燃烧不走本接口，
// 燃料耗尽 engineOut 是玩法约束，任何模式都严格。
export function isResourceFree(resourceId) {
    return getMode() !== 'career' && resourceId === 'science';
}

// 蓝图是否需要科技解锁（career=true，sandbox=false 全解锁）
export function isTechLocked() {
    return getMode() === 'career';
}

// 星球资源丰度是否直接可见（sandbox=true 直接可见，career=false 需扫描模块）
export function isScansEnabled() {
    return getMode() !== 'career';
}
