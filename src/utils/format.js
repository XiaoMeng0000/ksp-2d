'use strict';

// 通用格式化工具 — 0.2.5 收敛共享
// trackingUI 的原 formatPeriod 与 startGamePanel 的存档元信息展示共用本模块，
// 避免同类格式化逻辑在多处重复维护。

// 游戏日秒数（与 scanSystem 约定一致：6 小时/日）
export const GAME_DAY_SECONDS = 21600;

// 游戏时间格式化：秒 → "X日 X时" / "X时 X分" / "X分 X秒"
export function formatGameTime(s) {
    if (s >= GAME_DAY_SECONDS) {
        const d = Math.floor(s / GAME_DAY_SECONDS);
        const h = Math.round((s % GAME_DAY_SECONDS) / 3600);
        return h > 0 ? d + '日 ' + h + '时' : d + '日';
    }
    if (s >= 3600) {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h + '时 ' + m + '分';
    }
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + '分 ' + sec + '秒';
}

// 存档时间戳格式化：毫秒 → 本地日期时间（"2026/8/15 02:25"）
export function formatGameDate(ts) {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
