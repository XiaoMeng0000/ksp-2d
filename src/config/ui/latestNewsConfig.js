'use strict';

// ============================================================
// 最新消息（在线内容）配置
// 内容源是**独立于游戏仓库**的 GitHub 仓库（只存 news.json），启动加载阶段拉取，
// 进主菜单弹出「最新消息」面板；拉取失败退回自动打开公告。
// 字段语义与编写规则见 docs/最新消息编写规范.md
//
// 0.3.0 起配图改为**游戏内置图库**：远端只写 imageKey（release/progress/issue），
// 图片随本体发布（assets/images/news/），不再从远端下载图片 —— 零网络延迟、断网也有图。
// ============================================================

export const LATEST_NEWS_CONFIG = {
    // 功能总开关：false 时不联网、不弹窗（启动直接退回自动打开公告）
    enabled: true,

    // 三源竞速取数（谁先返回合法内容用谁），`delayMs` 让慢源晚出场，避免陈旧数据抢跑
    //   pages    ：GitHub Pages，实测最快（~0.25s），且与游戏线上部署同域 → 抢占窗口 0
    //   raw      ：GitHub raw，内容最新，部分网络下不可用 → 抢占窗口 0
    //   jsdelivr：CDN，可达性好但**对 @main 分支有 12 小时级缓存**，可能返回旧内容，
    //              因此延迟 800ms 才出场：只在 Pages/raw 都没回来时才用它兜底
    sources: [
        { name: 'pages', url: 'https://xiaomeng0000.github.io/ksp2d-news/news.json', delayMs: 0 },
        { name: 'raw', url: 'https://raw.githubusercontent.com/XiaoMeng0000/ksp2d-news/main/news.json', delayMs: 0 },
        { name: 'jsdelivr', url: 'https://cdn.jsdelivr.net/gh/XiaoMeng0000/ksp2d-news@main/news.json', delayMs: 800 }
    ],

    // 竞速总窗口（毫秒）：超过即按失败处理（实测最快源约 0.25s，慢源直接超时）
    timeoutMs: 3000,

    // 进主菜单时若拉取仍未结束，最多再等这么久再决定弹什么
    // （覆盖「玩家秒跳 splash、菜单比网络先就绪」的场景）
    menuWaitMs: 1500,

    // 正文硬上限（远端规范要求 ≤200 字；此处做保护性截断，防异常内容撑爆面板）
    maxTextChars: 400,

    // 通知类型（type）→ 内置配图（值为 textureConfig 的 key，随本体预载）
    // 内容仓库只写 type，图片由游戏内部查表决定；未知/缺失 type → 不显示图片
    // 新增类型＝加一张内置图 + 在这里登记一行（需发版）
    typeImages: {
        release: 'news_release',    // 新版本发布
        progress: 'news_progress',  // 制作组刚做好 / 正在做什么
        issue: 'news_issue'         // 开发遇到问题
    },

    storage: {
        // 上次成功拉取的内容（离线/拉取失败时降级使用）
        cacheKey: 'ksp2d_latest_news_cache',
        // 「今日内不再显示」记录的本地日期（YYYY-MM-DD）
        dismissDateKey: 'ksp2d_latest_news_dismiss'
    }
};
