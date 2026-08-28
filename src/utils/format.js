'use strict';

// 通用格式化工具 — 0.2.5 收敛共享
// trackingUI 的原 formatPeriod 与 startGamePanel 的存档元信息展示共用本模块，
// 避免同类格式化逻辑在多处重复维护。

// 游戏日秒数（与 scanSystem 约定一致：6 小时/日）
export const GAME_DAY_SECONDS = 21600;

// Kerbin 年秒数（426 日 × 6 小时/日 × 3600 秒/小时）
const GAME_YEAR_SECONDS = GAME_DAY_SECONDS * 426;

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

// 宇宙时间格式化：秒 → "Y:D:H:M"（KSP2 风格，例：1Y:10D:00H:01M）
// 与示例图 ESC 菜单元信息展示一致
export function formatUniverseTime(s) {
    const yearSeconds = GAME_YEAR_SECONDS;
    const daySeconds = GAME_DAY_SECONDS;
    const hourSeconds = 3600;
    const minuteSeconds = 60;
    let t = Math.max(0, Math.floor(s));
    const y = Math.floor(t / yearSeconds);
    t %= yearSeconds;
    const d = Math.floor(t / daySeconds);
    t %= daySeconds;
    const h = Math.floor(t / hourSeconds);
    t %= hourSeconds;
    const m = Math.floor(t / minuteSeconds);
    return `${y}Y:${String(d).padStart(2, '0')}D:${String(h).padStart(2, '0')}H:${String(m).padStart(2, '0')}M`;
}

// 存档时间戳格式化：毫秒 → 本地日期时间（"2026/8/15 02:25"）
export function formatGameDate(ts) {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

// 时长格式化：1h 30m 00s / 12m 30s / 45s（0.3.0 从 renderer.js 迁移为共享工具）
export function formatDuration(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '--';
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
    if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
    return s + 's';
}

// 长时长格式化（游戏年/天口径）："0年:0天:01时:16分:20秒"（0.3.0 轨道标签展开面板用）
// 年 = 426 日 × 6 小时（GAME_YEAR_SECONDS），天 = 6 小时（GAME_DAY_SECONDS）；时/分/秒补零
export function formatGameDurationLong(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '--';
    sec = Math.max(0, Math.floor(sec));
    const y = Math.floor(sec / GAME_YEAR_SECONDS);
    sec %= GAME_YEAR_SECONDS;
    const d = Math.floor(sec / GAME_DAY_SECONDS);
    sec %= GAME_DAY_SECONDS;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return y + '年:' + d + '天:' + String(h).padStart(2, '0') + '时:'
        + String(m).padStart(2, '0') + '分:' + String(s).padStart(2, '0') + '秒';
}

// 精确米数格式化（千分位）："499,999 m"（0.3.0 轨道标签展开面板高度行用）
export function formatMeters(m) {
    if (m === null || m === undefined || !isFinite(m)) return '--';
    return Math.round(m).toLocaleString('en-US') + ' m';
}
