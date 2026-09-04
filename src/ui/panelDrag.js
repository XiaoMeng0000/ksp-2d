'use strict'

// ============================================================
// panelDrag.js — 浮层面板拖动工具(零依赖,Pointer Events 实现)
// 用法:makePanelDraggable(panelEl, handleEl)
// 行为:
//  1. 仅在 handle 上按下并移动超过阈值才进入拖动(区分"点击页头内按钮")
//  2. 拖动开始时读取当前视觉位置(getBoundingClientRect),清除 CSS 的
//     transform 居中偏移,改为 left/top 绝对定位(运行时布局归 JS,符合 UI 规范 §4.4)
//  3. 拖动中位置 clamp 在视口内;面板大于视口时允许贴边
//  4. 拖动中禁止文本选中(body.panel-drag-active);页头 cursor:grab/grabbing
//     (样式在 root.css 通用组件段;模块自动给 handle 加 .drag-handle)
//  5. 窗口 resize 时若面板可见且超出视口,自动拉回(防止拖出界后无法找回)
//  6. 支持鼠标与触摸;不使用 setPointerCapture(避免重定向 click,
//     破坏页头内关闭按钮的点击)
// ============================================================

// 阈值:按下后移动超过该距离才视为拖动(px)
const DRAG_THRESHOLD = 3;

// 面板位置与面板尺寸按视口 clamp;面板比视口大时允许贴边
function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

// 多面板并存(0.3.0):参与错位判断的浮层选择器 — 两大主面板 + 所有工具栏页面面板(.tkp-page)。
// 各浮层默认位相同,同开时需按遮挡情况错位,保证新面板不被其它面板完全盖住(永远露出可抓边缘)
const DEFAULT_CASCADE_SELECTORS = ['#shipBuilderPanel', '#facilityDeployPanel', '.tkp-page'];
const CASCADE_STEP = 40;   // 每次尝试错位增量(px,向右下)

export function makePanelDraggable(panelEl, handleEl) {
    if (!panelEl || !handleEl) return;

    handleEl.classList.add('drag-handle');

    let pending = false;    // 已按下、未达拖动阈值
    let dragging = false;   // 正在拖动
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let maxLeft = 0;
    let maxTop = 0;

    const onPointerDown = (e) => {
        // 只响应主键/触摸按下;页头内的交互元素不启动拖动(关闭按钮等)
        if (e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea, [data-action]')) return;
        pending = true;
        startX = e.clientX;
        startY = e.clientY;
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = (e) => {
        if (!pending && !dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            beginDrag();
        }
        panelEl.style.left = clamp(origLeft + dx, 0, maxLeft) + 'px';
        panelEl.style.top = clamp(origTop + dy, 0, maxTop) + 'px';
    };

    const beginDrag = () => {
        dragging = true;
        const rect = panelEl.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        // 固化当前位置:把 CSS 的 transform 居中偏移改写成 left/top
        panelEl.style.left = origLeft + 'px';
        panelEl.style.top = origTop + 'px';
        panelEl.style.transform = 'none';
        maxLeft = Math.max(0, window.innerWidth - rect.width);
        maxTop = Math.max(0, window.innerHeight - rect.height);
        panelEl.classList.add('panel-dragging');
        document.body.classList.add('panel-drag-active');
    };

    const onPointerUp = () => {
        if (!pending && !dragging) return;
        pending = false;
        dragging = false;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        panelEl.classList.remove('panel-dragging');
        document.body.classList.remove('panel-drag-active');
    };

    // 窗口 resize:已拖动的面板超出视口时拉回(未拖动时 CSS 默认位在视口内,不受影响)
    window.addEventListener('resize', () => {
        if (panelEl.offsetWidth === 0) return;   // display:none 时跳过
        const rect = panelEl.getBoundingClientRect();
        const newMaxLeft = Math.max(0, window.innerWidth - rect.width);
        const newMaxTop = Math.max(0, window.innerHeight - rect.height);
        const newLeft = clamp(rect.left, 0, newMaxLeft);
        const newTop = clamp(rect.top, 0, newMaxTop);
        if (newLeft !== rect.left) panelEl.style.left = newLeft + 'px';
        if (newTop !== rect.top) panelEl.style.top = newTop + 'px';
    });

    handleEl.addEventListener('pointerdown', onPointerDown);
}

// 面板打开时的错位放置(0.3.0 多面板并存):
// 若该面板从未被拖动过(无内联 left/top)且已有其它浮层面板可见,则把
// 当前位置(即 CSS 默认位)向右下逐步错位,直到新面板不被任何一个已可见
// 面板完全盖住(留出可抓/可辨的边缘),避免相同默认位导致完全重叠。
// 必须在面板显示后(offsetWidth > 0)调用;独自打开时保持 CSS 默认居中位不变。
export function cascadePanelOpen(panelEl, panelSelectors = DEFAULT_CASCADE_SELECTORS) {
    if (!panelEl || panelEl.style.left || panelEl.style.top) return;
    const others = Array.from(document.querySelectorAll(panelSelectors.join(',')))
        .filter((el) => el && el !== panelEl && el.offsetWidth > 0);
    if (others.length === 0) return;
    const rect = panelEl.getBoundingClientRect();
    let step = 0;
    // 完全被盖住(矩形被任一其它面板包含)时继续右下错位,最多尝试 8 次
    while (step <= CASCADE_STEP * 8) {
        const left = rect.left + step;
        const top = rect.top + Math.round(step / 2);
        const fullyHidden = others.some((o) => {
            const r = o.getBoundingClientRect();
            return left >= r.left && top >= r.top
                && left + rect.width <= r.right && top + rect.height <= r.bottom;
        });
        if (!fullyHidden) break;
        step += CASCADE_STEP;
    }
    panelEl.style.left = (rect.left + step) + 'px';
    panelEl.style.top = (rect.top + Math.round(step / 2)) + 'px';
    panelEl.style.transform = 'none';
}
