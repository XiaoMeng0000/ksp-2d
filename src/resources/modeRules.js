'use strict';

// 游戏模式规则层（0.2.0）
// sandbox（自由）/ career（生涯）的规则差异全部集中在本模块。
// 业务代码只调这些接口，不散落 if (mode === 'career')，将来扩展差异只改本模块。

import { gameState } from '../gameState.js';

function getMode() {
    return gameState.getState().player.gameMode || 'sandbox';
}

// 是否启用资源校验/扣费（0.2.0 阶段4：全模式生效，保证经济闭环可观测）
// 原设计 sandbox 免检，但会导致建造/补给完全不扣费、资源数字静止，已改为统一扣费
// TODO: 将来若需要"无限资源沙盒"，改回按 mode 区分
export function isResourceCheckEnabled() {
    return true;
}

// 蓝图是否需要科技解锁（career=true，sandbox=false 全解锁）
export function isTechLocked() {
    return getMode() === 'career';
}

// 星球资源丰度是否直接可见（sandbox=true 直接可见，career=false 需扫描模块）
export function isScansEnabled() {
    return getMode() !== 'career';
}
