'use strict';

import { LATEST_NEWS_CONFIG } from '../config/ui/latestNewsConfig.js';

// ============================================================
// 最新消息客户端（在线内容源）
// - 启动加载阶段由 main.js 调用 loadLatestNews()（与纹理/音频/字体并行，不阻塞进入游戏）
// - 取数：三个源**并行竞速**，第一个返回合法内容的胜出，其余立即 abort；总窗口 timeoutMs
// - 降级：竞速全失败 → 本地缓存 → 都没有则不弹（启动退回打开公告）
// - 配图：远端只给通知类型 type，游戏按 latestNewsConfig.typeImages 查表选内置配图，
//         图片路径由 UI 侧经 assetManifest.getTexturePath 解析
// - 只读契约数据，不碰 DOM（渲染见 src/ui/latestNewsUI.js）
// - 远端内容一律按「外部输入」处理：字段白名单 + 纯文本渲染 + imageKey 枚举白名单
// ============================================================

let _news = null;          // 归一化后的当前消息（null = 无可展示内容）
let _source = '';          // 胜出的源名 / 'cache'
let _settled = false;      // 拉取是否已有结论（成功或彻底失败）
let _loadPromise = null;

// 本地日期键（YYYY-MM-DD）：跨天自动失效，无需定时器
function _todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 正文归一化：统一换行、去控制字符、折叠多余空行、超长截断
function _normalizeText(rawText) {
    if (typeof rawText !== 'string') return '';
    let text = rawText
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const max = LATEST_NEWS_CONFIG.maxTextChars;
    if (max > 0 && text.length > max) {
        text = text.slice(0, max) + '…';
    }
    return text;
}

// 通知类型 → 内置配图资源 key（未知返回空串）
// 兼容旧字段 imageKey（0.3.0 早期命名），新内容一律写 type
function _resolveTextureKey(rawType) {
    const type = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
    if (!type) return '';
    const textureKey = LATEST_NEWS_CONFIG.typeImages[type];
    if (!textureKey) {
        console.warn('[LatestNews] 未知通知类型 type，忽略配图:', type);
        return '';
    }
    return textureKey;
}

// 取通知类型（type 优先；imageKey 为旧字段兼容）
function _readType(raw) {
    if (typeof raw.type === 'string' && raw.type.trim()) return raw.type.trim().toLowerCase();
    if (typeof raw.imageKey === 'string' && raw.imageKey.trim()) return raw.imageKey.trim().toLowerCase();
    return '';
}

// 解析远端 JSON：
//   返回 { kind: 'news', news } / { kind: 'disabled' }（作者主动下线）/ null（无效内容）
function _parsePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    // 格式版本：升级时在此加兼容分支，未知版本一律忽略（保护旧客户端）
    if (raw.schemaVersion !== 1) return null;
    if (raw.enabled === false) return { kind: 'disabled' };

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const text = _normalizeText(raw.text);
    if (!id || !text) return null;

    const type = _readType(raw);
    return {
        kind: 'news',
        news: {
            id,
            updated: typeof raw.updated === 'string' ? raw.updated.trim() : '',
            title: typeof raw.title === 'string' ? raw.title.trim() : '',
            type,
            textureKey: _resolveTextureKey(type),
            text
        }
    };
}

// 多源竞速取数：每个源按 delayMs 出场，首个合法内容胜出；全部失败/超时返回 null
// delayMs 让「缓存可能陈旧」的源晚出场（jsDelivr 对 @main 分支有 12 小时级缓存），
// 否则它可能抢先返回旧内容，表现为「面板有文字但没配图」
function _raceSources() {
    const sources = LATEST_NEWS_CONFIG.sources || [];
    const total = sources.length;
    if (total === 0) return Promise.resolve(null);

    return new Promise((resolve) => {
        let done = false;
        let finished = 0;
        const controllers = [];
        const startTimers = [];

        const finish = (payload) => {
            if (done) return;
            done = true;
            clearTimeout(windowTimer);
            // 未出场的源不再启动，已出场的立即取消，不浪费带宽
            for (const startTimer of startTimers) clearTimeout(startTimer);
            for (const controller of controllers) {
                try {
                    controller.abort();
                } catch (e) {
                    // 已结束的请求 abort 会抛错，忽略
                }
            }
            resolve(payload);
        };

        const windowTimer = setTimeout(() => finish(null), LATEST_NEWS_CONFIG.timeoutMs);

        const startFetch = (source) => {
            if (done) return;
            const controller = new AbortController();
            controllers.push(controller);
            fetch(source.url, { cache: 'no-cache', signal: controller.signal })
                .then((res) => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then((raw) => {
                    const payload = _parsePayload(raw);
                    if (!payload) throw new Error('内容无效');
                    finish({ payload, source: source.name });
                })
                .catch(() => {
                    // 该源失败：等其余源；全部失败由 finally 收口
                })
                .finally(() => {
                    finished++;
                    if (!done && finished === total) finish(null);
                });
        };

        for (const source of sources) {
            const delay = Math.max(0, Number(source.delayMs) || 0);
            if (delay > 0) {
                startTimers.push(setTimeout(() => startFetch(source), delay));
            } else {
                startFetch(source);
            }
        }
    });
}

function _readCache() {
    try {
        const raw = localStorage.getItem(LATEST_NEWS_CONFIG.storage.cacheKey);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        const news = saved && saved.news;
        if (!news || typeof news.text !== 'string') return null;
        const text = _normalizeText(news.text);
        const id = String(news.id || '');
        if (!id || !text) return null;
        const imageKey = String(news.imageKey || '');
        const type = String(news.type || imageKey || '').toLowerCase();
        return {
            id,
            updated: String(news.updated || ''),
            title: String(news.title || ''),
            type,
            // 缓存里的配图也按当前配置重算，改配置后旧缓存不会指向已删资源
            textureKey: LATEST_NEWS_CONFIG.typeImages[type] || '',
            text
        };
    } catch (e) {
        return null;
    }
}

function _writeCache(news) {
    try {
        localStorage.setItem(
            LATEST_NEWS_CONFIG.storage.cacheKey,
            JSON.stringify({ savedAt: Date.now(), news })
        );
    } catch (e) {
        // localStorage 满/被禁用：缓存只是降级手段，失败忽略
    }
}

function _clearCache() {
    try {
        localStorage.removeItem(LATEST_NEWS_CONFIG.storage.cacheKey);
    } catch (e) {
        // 同上，忽略
    }
}

// 拉取最新消息（重复调用返回同一个 Promise）
// 返回 { ok, news, source?, offline?, reason? }：ok=false 表示本次没有可展示内容
function loadLatestNews() {
    if (_loadPromise) return _loadPromise;

    if (!LATEST_NEWS_CONFIG.enabled) {
        _settled = true;
        _loadPromise = Promise.resolve({ ok: false, news: null, reason: 'disabled' });
        return _loadPromise;
    }

    _loadPromise = (async () => {
        const win = await _raceSources();
        _settled = true;

        if (win) {
            // 作者主动下线：清缓存，本次不弹（不是网络故障，不回退缓存）
            if (win.payload.kind === 'disabled') {
                _news = null;
                _source = win.source;
                _clearCache();
                return { ok: true, news: null, source: win.source, reason: 'disabled-by-content' };
            }
            _news = win.payload.news;
            _source = win.source;
            _writeCache(_news);
            return { ok: true, news: _news, source: win.source };
        }

        // 三源全部失败/超时 → 本地缓存降级（离线仍可提示上次内容）
        const cached = _readCache();
        if (cached) {
            _news = cached;
            _source = 'cache';
            return { ok: true, news: cached, source: 'cache', offline: true };
        }

        _news = null;
        _source = '';
        return { ok: false, news: null, reason: 'network' };
    })();

    return _loadPromise;
}

// 当前可展示的消息（未拉取/无内容时为 null）
function getLatestNews() {
    return _news;
}

// 拉取是否仍在进行中
function isNewsLoading() {
    return !_settled;
}

// 启动时该弹什么：
//   'news'         —— 有消息且今日未勾选「不再显示」
//   'none'         —— 有消息但今日已勾选，什么都不弹
//   'announcement' —— 无消息（拉取失败/作者下线），退回自动打开公告
function getStartupNoticeKind() {
    if (_news) {
        return isDismissedToday() ? 'none' : 'news';
    }
    return 'announcement';
}

// 启动决策（异步）：若拉取仍在进行，最多再等 menuWaitMs 再拍板
// —— 覆盖「玩家秒跳 splash、菜单比网络先就绪」导致误判为「无消息」的场景
async function resolveStartupNoticeKind() {
    if (!_settled) {
        await Promise.race([
            loadLatestNews(),
            new Promise((resolve) => setTimeout(resolve, LATEST_NEWS_CONFIG.menuWaitMs))
        ]);
    }
    return getStartupNoticeKind();
}

function isDismissedToday() {
    try {
        return localStorage.getItem(LATEST_NEWS_CONFIG.storage.dismissDateKey) === _todayKey();
    } catch (e) {
        return false;
    }
}

// 写入「今日内不再显示」：关闭弹窗时若勾选了该项调用
function markDismissedToday() {
    try {
        localStorage.setItem(LATEST_NEWS_CONFIG.storage.dismissDateKey, _todayKey());
    } catch (e) {
        // 存储不可用：不阻塞关闭流程
    }
}

// 数据来源（胜出的源名 / 'cache' / ''），供加载日志与排查使用
function getNewsSource() {
    return _source;
}

export {
    loadLatestNews,
    getLatestNews,
    isNewsLoading,
    getStartupNoticeKind,
    resolveStartupNoticeKind,
    isDismissedToday,
    markDismissedToday,
    getNewsSource
};
