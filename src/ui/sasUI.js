'use strict';

// SAS系统 — KSP2 风格导航球 + SAS 控制圆盘（Canvas 渲染）
// Step2：导航球（左下角，纯显示）+ SAS 控制圆盘（右侧，仅渲染）
// Step3：SAS 圆盘交互（方向按钮点击 / 右键回 stability / tooltip）
// Step4：节流阀弧形（导航球外圈左侧，Canvas 绘制，连续拖动）
// Step5：导航球下方按钮区（DOM：SAS 开关 + 机动节点/目标预留按钮）

import { eventBus, Events } from '../eventBus.js';
import { textureManager } from '../graphics/textureManager.js';
import { t } from '../config/strings.js';
import { showTooltip, hideTooltip } from './uiTooltip.js';

// EventBus — 缓存最近一帧飞船渲染数据（导航球姿态/方向，同 flightUI 模式）
// 同时按"是否有活动飞船"控制按钮框显隐（设施操作模式无活动飞船 → 隐藏）
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
    sasUI.setBottomButtonsVisible(!!data.exists);
});

// EventBus — 场景切换时控制下方按钮区显隐（仅飞行场景显示）
eventBus.on(Events.SCENE_CHANGED, (data) => {
    sasUI.setBottomButtonsVisible(data.to === 'flight');
});

// ========== 布局常量（1920x1080 基准） ==========

// ---- 通用配色（0.2.7 统一为左侧工具栏风格：纯黑底 + 紫色边框） ----
const PANEL_BG = '#000';                    // 与左侧工具栏底色一致（纯黑）
const PANEL_BORDER_COLOR = '#6153D0';       // 与左侧工具栏外框同款紫（--toolbar-border 实色，明度-10%）
const MARKER_COLOR = '#ffffff';             // 姿态指示（白色三角 / 圆盘中心白圆）

// 导航球板块（0.2.7 重构）：
//  一级背景 = 原尺寸圆盘（深蓝黑实色 + 紫描边，保留原有圆框造型）
//  二级背景 = 原球内容整体缩小到中央（黑色球面不变，内容样式不变）；外围空出部分即一级背景
// 交互不变（导航球纯显示不响应点击，命中检测仅覆盖 SAS 圆盘）
const NAVBALL_PLATE_BG = '#0d1015';
// 节流阀 激活色（0.2.7：项目绿 --progress-green 实色）
const THROTTLE_FILL_COLOR = '#3dff3d';
// 节流阀 未填充色（参考图紫 #5A5FCF 暗化 75% 后再暗化 75%）→ rgb(23,24,52)×0.25 ≈ #06060d
const THROTTLE_EMPTY_COLOR = '#06060d';
// 节流阀 二级背景（环带底）黑色
const THROTTLE_TRACK_COLOR = '#000';
// 节流阀 内容弧（未填充紫/填充绿）距边框距离（基准 px，两侧各缩进，露出黑色二级背景）
const THROTTLE_FILL_GAP = 5;

// ---- 图标状态色（0.3.0 图标替换规范：SVG 白色模板 + 运行时染色，色值与 root.css 变量对应） ----
// 按钮配色方案 v2（参考 KSP2 圆盘按钮像素参考图）：正逆=绿 / 径向=青
//   激活（SAS 开 + 选中）  = 语义色图标，黑底
//   未激活（SAS 开 + 未选中）= 语义色实底圆 + 黑色符号
//   SAS 关闭                = 全部深灰（已有样式）
const DIR_PROGRADE_COLOR = '#00d84a';       // 按钮 顺向/逆向 语义绿（参考图一/二 像素绿）
const DIR_RADIAL_COLOR = '#3fa8a8';         // 按钮 径向内/外 语义青（参考图三/四 teal 青）
const DIR_SYMBOL_ON_BG = '#000';            // 未激活实底圆上的符号黑（参考图二/四）
// 导航球标记色（沿用 v1：正逆黄 / 径向青，与按钮语义色分离；如需同步按钮配色请告知）
const NAV_DIR_PROGRADE_COLOR = '#ffcc33';   // 导航球 顺向/逆向 标记黄
const NAV_DIR_RADIAL_COLOR = '#4fc3f7';     // 导航球 径向内/外 标记青
const DIR_INACTIVE_COLOR = '#555';          // 未激活 图标/框 深灰（--border / --text-faint）
const SAS_ACTIVE_COLOR = '#3dff3d';         // SAS 主开关 激活绿（--progress-green 工具栏激活条）
const SAS_INACTIVE_COLOR = '#555';          // SAS 主开关 未激活深灰（--border）

// ---- 导航球（左下角，纯显示） ----
const NAVBALL_RADIUS = 175;                // 大导航球半径
// 内部装饰绿（0.3.0 由蓝改绿：--progress-green #3dff3d 暗 25% = RGB×0.75 → rgb(46,191,46)）
const NAVBALL_DECOR_RGB = '46,191,46';
// 二级背景（缩小的球）边界距外框 15px（基准）→ 内容缩放系数
const NAVBALL_CONTENT_SCALE = (NAVBALL_RADIUS - 15) / NAVBALL_RADIUS;
const NAVBALL_MARKER_SIZE = 26;            // 中心白色三角外接圆半径
const NAVBALL_DIR_R = 140;                 // 圆上方向标记的半径位置（内缩避让描边）
const MARKER_RADIUS = 18;                  // 圆上方向小圆半径（0.3.0 由 12 调大 1.5 倍：SVG 图标内部细节 24px 下不可辨）
const NAV_MARKER_BG_COLOR = '#0e0e0e';     // 方向标记圆底（非常接近背景黑的深灰：遮蔽罗盘刻度、凸显图标）

// ---- SAS 控制圆盘（导航球右侧，交互，按 KSP2 比例约为导航球 0.5 倍） ----
const SAS_PANEL_RADIUS = 88;               // 圆盘半径（导航球 0.5 倍）
const SAS_PANEL_CENTER_RADIUS = 6;         // 圆盘中心白色圆半径（0.3.0 由 10 改小：直径 12，与按钮(40)拉开层次）
const DIR_BTN_RADIUS = 20;                 // 方向按钮半径（0.3.0 由 16 调大：参考 KSP2 圆盘按钮约占圆盘 20%，
                                            //  取再大一点 → 直径 40 ≈ 圆盘 22.7%；相邻按钮仍留 ~44px 间隙）
const DIR_OFFSET = 42;                     // 方向按钮偏移（X 斜角布局 dx/dy）
const SAS_PANEL_GAP = 46;                  // 导航球与圆盘水平间距

// ---- 节流阀弧形（导航球外圈左侧，连续填充无分段） ----
const THROTTLE_ARC_INNER = 182;          // 弧形内半径（基准，略大于导航球半径）
const THROTTLE_ARC_OUTER = 210;          // 弧形外半径
const THROTTLE_ARC_START = 180;          // 起始角（度，底部，Canvas 坐标系）
const THROTTLE_ARC_END = 360;            // 结束角（度，顶部）

// 距左边缘 = 节流阀弧外缘 + 边距，保证弧不出屏
const MARGIN = THROTTLE_ARC_OUTER + 16;  // 距左/下边缘（=210+16=226）

// ---- 按钮框（DOM：SAS 圆盘正下方的方形框，主开关 + 副钮组） ----
// 0.3.0 由 44px 缩至 3/4（33px），间距/内边距同步 ×0.75；框底仍与节流阀弧底对齐
const BOTTOM_MAIN_SIZE = 33;             // 主开关（SAS）按钮边长（基准，与副钮统一大小）
const BOTTOM_SUB_SIZE = 33;              // 副钮（节点/目标）边长（基准）
const BOTTOM_BTN_GAP = 7.5;              // 同组按钮间距（基准）
const BOTTOM_FRAME_PAD = 6;              // 方形框内边距（基准）
// 圆盘底部到按钮框顶部间距（基准）— 0.2.7 起框底与节流阀弧底对齐：
// 框底 = 圆心 y + Δ + 88 + GAP_BELOW + 框高(33+6×2=45) = 圆心 y + 210(节流阀外缘半径)
// 0.3.0 为贴近工具栏将间距收紧为 11px，圆盘下移量 Δ 由公式自动反解（62→11 后 Δ=66）
const BOTTOM_BTN_GAP_BELOW = 11;
// 圆盘下移量（基准）— 由对齐等式反解：Δ = 节流阀外缘(210) - 圆盘半径(88) - 间距(62) - 框高(45)
const SAS_PANEL_DOWN_SHIFT = THROTTLE_ARC_OUTER - SAS_PANEL_RADIUS - BOTTOM_BTN_GAP_BELOW
    - (BOTTOM_MAIN_SIZE + BOTTOM_FRAME_PAD * 2);

// ========== 导航球四方向定义（注册表，为机动节点预留扩展位） ==========
// key 与 RENDER_DATA.directions 字段名对应；tex 为方向图标纹理 key（0.3.0 图标替换）
const NAV_DIRECTIONS = [
    { key: 'prograde',   label: t('sas.prograde'),   color: NAV_DIR_PROGRADE_COLOR, tex: 'dir_prograde' },
    { key: 'retrograde', label: t('sas.retrograde'), color: NAV_DIR_PROGRADE_COLOR, tex: 'dir_retrograde' },
    { key: 'radialIn',   label: t('sas.radialIn'),   color: NAV_DIR_RADIAL_COLOR,  tex: 'dir_radial_in' },
    { key: 'radialOut',  label: t('sas.radialOut'),  color: NAV_DIR_RADIAL_COLOR,  tex: 'dir_radial_out' }
    // 未来：{ key: 'maneuverNode', label: '机动节点', color: '#4FC3F7' }
];

// ========== SAS 圆盘方向按钮（X 斜角布局） ==========
// tex 与 NAV_DIRECTIONS 共用同一套方向图标
// iconScale：图标占按钮直径比例（默认 0.8）。0.3.0 径向图标内容扩展远小于正逆长十字
// （正逆内容跨距 92%、径向仅 44%~69% 的 viewBox），同等 0.8 下视觉偏小 → 径向单独放大
const DIR_CIRCLES = [
    { mode: 'radial_in',  dx: -DIR_OFFSET, dy: -DIR_OFFSET, color: DIR_RADIAL_COLOR, label: t('sas.radialIn'),    tex: 'dir_radial_in',  iconScale: 0.95 },
    { mode: 'prograde',   dx:  DIR_OFFSET, dy: -DIR_OFFSET, color: DIR_PROGRADE_COLOR, label: t('sas.prograde'), tex: 'dir_prograde' },
    { mode: 'retrograde', dx: -DIR_OFFSET, dy:  DIR_OFFSET, color: DIR_PROGRADE_COLOR, label: t('sas.retrograde'), tex: 'dir_retrograde' },
    { mode: 'radial_out', dx:  DIR_OFFSET, dy:  DIR_OFFSET, color: DIR_RADIAL_COLOR, label: t('sas.radialOut'),    tex: 'dir_radial_out', iconScale: 0.95 }
];

// ========== 动画时间常量 ==========
const APPEAR_TIME = 0.3;   // 出现动画时长（秒）
const DISAPPEAR_TIME = 0.2; // 消失动画时长（秒）
const PULSE_PERIOD = 2.0;  // 脉冲周期（秒）

class SASUI {
    constructor() {
        this._appearance = 0;      // 方向标记出现度 [0, 1]
        this._pulsePhase = 0;      // 中心脉冲相位（弧度）
        this._scale = 1.0;
        this._isDragging = false;
        this._hovered = null;      // 当前悬停目标: 'center' | 方向 mode 名 | null
        this._visibilityExpanded = false;  // 可见性筛选面板是否展开
        this._visibilityPanel = null;      // DOM 容器
        this._visibilityContent = null;    // 展开后的内容区
        // 圆心缓存（由 updateLayout 每帧刷新）
        this._navballCenter = { x: 0, y: 0 };  // 导航球圆心（左下角）
        this._panelCenter = { x: 0, y: 0 };    // SAS 圆盘圆心（导航球右侧）
        this._centerPos = this._navballCenter; // 兼容旧引用（flightScene 拖拽检测）
        // 下方按钮区（DOM）状态
        this._bottomButtons = null;     // 按钮区容器
        this._sasBtnEl = null;          // SAS 开关按钮
        this._bottomVisible = undefined; // 按钮框当前显隐（避免每帧重复写 DOM）
        this._bottomLastPos = null;     // 上次定位 key（避免每帧改 style）
        this._bottomLastSas = -1;       // 上次 SAS 激活态（避免每帧改 style）
    }

    // ========== 布局 ==========

    /**
     * 每帧根据 canvas 尺寸重算导航球 / SAS 圆盘圆心与缩放
     * @param {HTMLCanvasElement} canvas
     */
    updateLayout(canvas) {
        // 缩放下限 0.15：canvas 尺寸为 0/极小的瞬间（预览面板 resize 等）会算得 _scale=0，
        // 导致导航球装饰环 R-21/R-23 等硬编码偏移变成负半径，ctx.arc 抛 IndexSizeError。
        // 下限 0.15 保证 R=175×0.15=26.25 > 23，所有装饰偏移均为正。
        this._scale = Math.max(0.15, Math.min(canvas.width / 1920, canvas.height / 1080, 1.0));
        const margin = MARGIN * this._scale;
        // 底部预留：取两个约束较大者（均在屏幕外不再画，只影响导航球上移量）
        //  a) 节流阀弧外缘(210)距底 ≥ 16
        //  b) 按钮框（圆盘下移 Δ 后：Δ + 圆盘半径 + 间距 + 主钮高 + 框内边距）距底 ≥ 16
        const bottomPad = Math.max(
            THROTTLE_ARC_OUTER + 16 - NAVBALL_RADIUS,
            SAS_PANEL_DOWN_SHIFT + SAS_PANEL_RADIUS + BOTTOM_BTN_GAP_BELOW + BOTTOM_MAIN_SIZE + BOTTOM_FRAME_PAD * 2 + 16 - NAVBALL_RADIUS
        ) * this._scale;
        const navY = canvas.height - bottomPad - NAVBALL_RADIUS * this._scale;
        this._navballCenter = {
            x: margin,
            y: navY
        };
        this._panelCenter = {
            x: margin + (NAVBALL_RADIUS + SAS_PANEL_GAP + SAS_PANEL_RADIUS) * this._scale,
            // 0.3.0：圆盘整体下移 Δ，按钮框底（navY+Δ+88+62+45）恒等于节流阀弧底（navY+210）
            y: navY + SAS_PANEL_DOWN_SHIFT * this._scale
        };
        this._centerPos = this._navballCenter;

        // 下方按钮区位置跟随导航球
        this._updateBottomButtonsLayout();
    }

    // ========== 动画更新 ==========

    /**
     * 每帧更新动画状态
     * @param {number} dt - 时间步长（秒）
     * @param {string} sasMode - 当前 SAS 模式（'off' / 'stability' / ...）
     * @param {number} throttle - 油门值 [0, 1]
     */
    update(dt, sasMode, throttle) {
        // 方向标记常驻显示（不随 SAS 开关淡出；角度无效时由渲染层单独隐藏）
        this._appearance = 1.0;

        // 中心脉冲相位（保留，供后续圆盘中心态使用）
        this._pulsePhase += dt * (2.0 * Math.PI / PULSE_PERIOD);
        if (this._pulsePhase > 2.0 * Math.PI) {
            this._pulsePhase -= 2.0 * Math.PI;
        }

        // 下方按钮区 SAS 激活态同步（值变化才写 DOM）
        this._updateBottomButtonsState(sasMode);
    }

    // ========== 角度换算 ==========

    /**
     * 游戏角（弧度，0=世界+Y，顺时针）→ 导航球屏幕角（度，0=右，顺时针）
     * @param {number} rad - 游戏角（弧度）
     * @returns {number} 屏幕角（度，[0, 360)）
     */
    _toNavAngle(rad) {
        return ((rad * 180 / Math.PI) + 270) % 360;
    }

    // ========== 渲染 ==========

    /**
     * 渲染导航球 + SAS 控制圆盘
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} sasMode - 当前 SAS 模式
     * @param {number} throttle - 油门值 [0, 1]
     */
    render(ctx, sasMode, throttle) {
        const s = this._scale;
        const appearance = this._appearance;
        const data = _cachedShipData || {};
        const heading = typeof data.heading === 'number' ? data.heading : 0;
        const directions = data.directions || null;

        // 节流阀弧形分段（导航球外圈左侧，先绘制在底层）
        this._drawThrottleArc(ctx, this._navballCenter.x, this._navballCenter.y, s, throttle);

        // 导航球（左下角，纯显示）
        this._drawNavball(ctx, this._navballCenter.x, this._navballCenter.y, s, appearance, heading, directions);

        // SAS 控制圆盘（导航球右侧，本步仅渲染）
        this._drawSasPanel(ctx, this._panelCenter.x, this._panelCenter.y, s, sasMode, heading);

        // 悬停提示已迁移到全局 DOM tooltip（uiTooltip.js），由 flightScene 的 mousemove 驱动
    }

    /**
     * 绘制通用姿态三角形（顶点指向给定朝向）
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - 圆心 X
     * @param {number} cy - 圆心 Y
     * @param {number} s - 缩放比例
     * @param {number} heading - 飞船朝向（游戏角，弧度）
     * @param {number} size - 三角形外接圆半径（基准）
     * @param {string} color - 填充颜色
     */
    _drawTriangle(ctx, cx, cy, s, heading, size, color) {
        const rad = this._toNavAngle(heading) * Math.PI / 180;
        const tipDist = size * s;
        const baseDist = tipDist * 0.5;
        const halfW = tipDist * 0.55;
        const tipX = cx + Math.cos(rad) * tipDist;
        const tipY = cy + Math.sin(rad) * tipDist;
        const baseX = cx - Math.cos(rad) * baseDist;
        const baseY = cy - Math.sin(rad) * baseDist;
        const px = -Math.sin(rad) * halfW;
        const py = Math.cos(rad) * halfW;

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + px, baseY + py);
        ctx.lineTo(baseX - px, baseY - py);
        ctx.closePath();
        ctx.fillStyle = color || MARKER_COLOR;
        ctx.fill();
    }

    /**
     * 图标模板染色：将单色 SVG 模板着色为指定纯色（离屏 canvas + source-in）。
     * 方向图标 SVG 统一为白色底稿，激活/未激活颜色由此函数在运行时决定。
     * @param {HTMLImageElement} img - 模板图（白色单色描线）
     * @param {string} color - 目标颜色（如 #d4c86a / #555）
     * @param {number} w - 输出宽（px）
     * @param {number} h - 输出高（px）
     * @returns {HTMLCanvasElement} 染色后的离屏画布（上下同宽高，可 drawImage）
     */
    _tintImage(img, color, w, h) {
        if (!this._tintCanvas) this._tintCanvas = document.createElement('canvas');
        const off = this._tintCanvas;
        if (off.width !== w || off.height !== h) {
            off.width = w;
            off.height = h;
        }
        const octx = off.getContext('2d');
        octx.clearRect(0, 0, w, h);
        octx.drawImage(img, 0, 0, w, h);
        octx.globalCompositeOperation = 'source-in';
        octx.fillStyle = color;
        octx.fillRect(0, 0, w, h);
        octx.globalCompositeOperation = 'source-over';
        return off;
    }

    /**
     * 绘制导航球（左下角，纯显示）
     * 0.2.7 分层：
     *  - 一级背景：原尺寸圆盘（深蓝黑实色 + 紫描边，保留原有圆框造型）
     *  - 二级背景：原球内容整体缩小到中央（黑色球面 / 刻线 / 标记 / 姿态，样式不变）
     * 外围空出的环形区域 = 一级背景色
     */
    _drawNavball(ctx, cx, cy, s, appearance, heading, directions) {
        // ---- 一级背景：原尺寸圆盘（深蓝黑实色） + 双层描边（黑外衬 2px + 紫内描边，原有造型保留） ----
        ctx.beginPath();
        ctx.arc(cx, cy, NAVBALL_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = NAVBALL_PLATE_BG;
        ctx.fill();
        // 黑色外衬(紫外侧 2px,无缝衔接)
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(cx, cy, NAVBALL_RADIUS * s + 1.75 * s, 0, Math.PI * 2);
        ctx.stroke();
        // 紫色内描边(原样式)
        ctx.strokeStyle = PANEL_BORDER_COLOR;
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        ctx.arc(cx, cy, NAVBALL_RADIUS * s, 0, Math.PI * 2);
        ctx.stroke();

        // ---- 二级背景：原球内容整体缩放（以圆心为基准），内容样式/颜色全部不变 ----
        const k = NAVBALL_CONTENT_SCALE;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(k, k);
        ctx.translate(-cx, -cy);

        // 球面（黑色二级背景底）
        ctx.beginPath();
        ctx.arc(cx, cy, NAVBALL_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = PANEL_BG;
        ctx.fill();

        // ========== 科技感装饰层（罗盘刻线 / 十字参考 / 光环） ==========
        const R = NAVBALL_RADIUS * s;
        ctx.save();

        // ---- 罗盘刻度环（主刻度每 90° 加长加亮，次刻度每 30°、细刻度每 10°） ----
        for (let deg = 0; deg < 360; deg += 10) {
            const isMajor = deg % 90 === 0;
            const isMedium = deg % 30 === 0;
            const rad = deg * Math.PI / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            const outerR = R - (isMajor ? 3 : isMedium ? 5 : 7);
            const innerR = R - (isMajor ? 18 : isMedium ? 12 : 10);
            ctx.beginPath();
            ctx.moveTo(cx + cosA * outerR, cy + sinA * outerR);
            ctx.lineTo(cx + cosA * innerR, cy + sinA * innerR);
            ctx.strokeStyle = isMajor ? `rgba(${NAVBALL_DECOR_RGB},0.85)`
                : (isMedium ? `rgba(${NAVBALL_DECOR_RGB},0.45)` : `rgba(${NAVBALL_DECOR_RGB},0.22)`);
            ctx.lineWidth = (isMajor ? 2 : 1) * s;
            ctx.stroke();
        }
        // ---- 主方向读数（0/90/180/270，位于刻度内侧） ----
        ctx.font = `${11 * s}px monospace`;
        ctx.fillStyle = `rgba(${NAVBALL_DECOR_RGB},0.75)`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const numR = R - 25;
        for (const deg of [0, 90, 180, 270]) {
            const rad = deg * Math.PI / 180;
            ctx.fillText(String(deg), cx + Math.cos(rad) * numR, cy + Math.sin(rad) * numR);
        }
        // ---- 十字参考线（淡色，贯穿圆心，作为姿态参考系） ----
        ctx.beginPath();
        ctx.moveTo(cx - R + 4, cy);
        ctx.lineTo(cx + R - 4, cy);
        ctx.moveTo(cx, cy - R + 4);
        ctx.lineTo(cx, cy + R - 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1 * s;
        ctx.stroke();
        // ---- 科技光环：内侧固定细环 + 旋转虚线环（缓慢扫掠，动态科技感） ----
        ctx.beginPath();
        ctx.arc(cx, cy, R - 21, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${NAVBALL_DECOR_RGB},0.15)`;
        ctx.lineWidth = 1 * s;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, R - 23, this._pulsePhase, this._pulsePhase + Math.PI * 1.2);
        ctx.setLineDash([4 * s, 9 * s]);
        ctx.strokeStyle = `rgba(${NAVBALL_DECOR_RGB},0.40)`;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // ---- 中心白色姿态三角形 ----
        this._drawTriangle(ctx, cx, cy, s, heading, NAVBALL_MARKER_SIZE, MARKER_COLOR);

        // ---- 圆上四方向标记（常驻，角度有效时显示） ----
        // 0.3.0 图标替换：纹理就绪用方向 SVG 模板染色（固定朝向不随角度旋转，仅沿圆环移动），
        // 纹理未就绪回退程序化小圆（铁律：永远带 fallback）
        if (appearance > 0.01) {
            const dirR = NAVBALL_DIR_R * s;
            const markerR = MARKER_RADIUS * s * appearance;
            for (const dir of NAV_DIRECTIONS) {
                const d = directions ? directions[dir.key] : null;
                if (!d || typeof d.angle !== 'number') continue;
                const rad = this._toNavAngle(d.angle) * Math.PI / 180;
                const mx = cx + Math.cos(rad) * dirR;
                const my = cy + Math.sin(rad) * dirR;

                const img = dir.tex ? textureManager.get(dir.tex) : null;
                if (img) {
                    // 方向图标：模板染色为语义色（正逆黄 / 径向青），正方形绘制（直径 = 小圆直径）
                    const size = Math.max(1, Math.round(markerR * 2));
                    // 圆底：接近背景黑的深灰，直径 = 图标 + 0.5px 刚好撑满（遮蔽罗盘刻度，图标更清晰）；
                    // 0.3.0 不透明度 95%（图标保持 0.9）
                    ctx.globalAlpha = 0.95 * appearance;
                    ctx.beginPath();
                    ctx.arc(mx, my, size / 2 + 0.5, 0, Math.PI * 2);
                    ctx.fillStyle = NAV_MARKER_BG_COLOR;
                    ctx.fill();
                    const tinted = this._tintImage(img, dir.color, size, size);
                    ctx.globalAlpha = 0.9 * appearance;
                    ctx.drawImage(tinted, mx - size / 2, my - size / 2, size, size);
                    ctx.globalAlpha = 1.0;
                } else {
                    ctx.beginPath();
                    ctx.arc(mx, my, markerR, 0, Math.PI * 2);
                    ctx.fillStyle = dir.color;
                    ctx.globalAlpha = 0.9 * appearance;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        // 关闭二级背景缩放层
        ctx.restore();
    }

    /**
     * 绘制 SAS 控制圆盘（导航球右侧）
     * - 圆框 + 中心姿态三角形（纯显示）
     * - 四方向按钮（X 斜角布局），当前 SAS 模式对应按钮高亮
     */
    _drawSasPanel(ctx, cx, cy, s, sasMode, heading) {
        // ---- 圆框（双层描边：黑外衬 2px + 紫内描边，原有造型保留） ----
        ctx.beginPath();
        ctx.arc(cx, cy, SAS_PANEL_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = PANEL_BG;
        ctx.fill();
        // 黑色外衬(紫外侧 2px,无缝衔接)
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(cx, cy, SAS_PANEL_RADIUS * s + 1.75 * s, 0, Math.PI * 2);
        ctx.stroke();
        // 紫色内描边(原样式)
        ctx.strokeStyle = PANEL_BORDER_COLOR;
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        ctx.arc(cx, cy, SAS_PANEL_RADIUS * s, 0, Math.PI * 2);
        ctx.stroke();

        // ---- 中心白色圆 ----
        ctx.beginPath();
        ctx.arc(cx, cy, SAS_PANEL_CENTER_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = MARKER_COLOR;
        ctx.fill();

        // ---- 四方向按钮 ----
        // 0.3.0 配色方案 v2（参考 KSP2 圆盘按钮像素图）：
        //   外框  SAS 开启 = 语义色（与图标一致，含未激活态；正逆绿/径向青）；SAS 关闭 = 深灰，描边 1px
        //   图标  SAS 开 + 选中   = 语义色实底（填满外框内，无黑隙）+ 黑色符号（醒目高亮）
        //         SAS 开 + 未选中 = 语义色图标·黑底（低调常显）
        //         SAS 关          = 全部深灰（已有样式）
        // 纹理未就绪回退纯描边圆按钮（铁律：永远带 fallback）
        const btnR = DIR_BTN_RADIUS * s;
        for (const dir of DIR_CIRCLES) {
            const bx = cx + dir.dx * s;
            const by = cy + dir.dy * s;
            const isSelected = sasMode === dir.mode;

            ctx.beginPath();
            ctx.arc(bx, by, btnR, 0, Math.PI * 2);
            // 边框色：SAS 开启时 = 语义色（与图标一致，含未激活态）；SAS 关闭 = 深灰
            ctx.strokeStyle = (sasMode === 'off') ? DIR_INACTIVE_COLOR : dir.color;
            ctx.lineWidth = 1 * s;
            ctx.stroke();

            const img = dir.tex ? textureManager.get(dir.tex) : null;
            if (img) {
                // 图标内缩 20%（iconScale 可覆盖：径向调大），与外框留出间隙；模板染色随状态切换颜色
                const iconSize = Math.max(1, Math.round(btnR * 2 * (dir.iconScale || 0.8)));
                const iconX = bx - iconSize / 2;
                const iconY = by - iconSize / 2;
                if (sasMode === 'off') {
                    // SAS 关闭：全部深灰图标
                    const tinted = this._tintImage(img, DIR_INACTIVE_COLOR, iconSize, iconSize);
                    ctx.drawImage(tinted, iconX, iconY, iconSize, iconSize);
                } else if (isSelected) {
                    // 激活：语义色实底填满外框内（直径 = 外框直径，无未填充空隙）+ 黑色符号
                    ctx.beginPath();
                    ctx.arc(bx, by, btnR, 0, Math.PI * 2);
                    ctx.fillStyle = dir.color;
                    ctx.fill();
                    const tinted = this._tintImage(img, DIR_SYMBOL_ON_BG, iconSize, iconSize);
                    ctx.drawImage(tinted, iconX, iconY, iconSize, iconSize);
                } else {
                    // 未激活：语义色图标（黑底）
                    const tinted = this._tintImage(img, dir.color, iconSize, iconSize);
                    ctx.drawImage(tinted, iconX, iconY, iconSize, iconSize);
                }
            }
        }
    }

    // ========== 悬停检测（SAS 圆盘交互） ==========

    /**
     * 处理鼠标移动，更新悬停目标（仅检测 SAS 圆盘；导航球纯显示不响应）
     * @param {number} x - 鼠标相对 canvas 的 X 坐标
     * @param {number} y - 鼠标相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     * @returns {{ label: string|null, changed: boolean }} label=提示文本（无目标为 null）；
     *          changed=悬停目标是否发生变化（调用方据此只在变化时刷新 tooltip，保证位置不变）
     */
    handleHover(x, y, currentSasMode) {
        const cx = this._panelCenter.x;
        const cy = this._panelCenter.y;
        const s = this._scale;

        // 圆盘中心
        const distCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distCenter < SAS_PANEL_CENTER_RADIUS * s + 4 * s) {
            return this._setHovered('center');
        }

        // 四方向按钮
        for (const dir of DIR_CIRCLES) {
            const bx = cx + dir.dx * s;
            const by = cy + dir.dy * s;
            const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
            if (dist < DIR_BTN_RADIUS * s + 4 * s) {
                return this._setHovered(dir.mode);
            }
        }

        // 不在任何可悬停区域
        return this._setHovered(null);
    }

    /**
     * 设置悬停目标并返回 { label, changed }：
     *   label   目标提示文本（center → 姿态保持；方向 → DIR_CIRCLES label；无目标 null）
     *   changed 目标是否变化（进入新目标为 true，同一目标内移动为 false）
     * @param {string|null} target
     * @returns {{ label: string|null, changed: boolean }}
     */
    _setHovered(target) {
        const changed = this._hovered !== target;
        this._hovered = target;
        if (target === null) {
            return { label: null, changed };
        }
        if (target === 'center') {
            return { label: t('sas.stability'), changed };
        }
        const dir = DIR_CIRCLES.find(d => d.mode === target);
        return { label: dir ? dir.label : null, changed };
    }

    /**
     * 清除悬停状态（鼠标离开 canvas 时调用）
     */
    clearHover() {
        this._hovered = null;
        hideTooltip();
    }

    // ========== 点击 / 右键（SAS 圆盘交互） ==========

    /**
     * 处理 Canvas 点击（SAS 圆盘方向按钮）
     * @param {number} x - 点击相对 canvas 的 X 坐标
     * @param {number} y - 点击相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     * @returns {{ hit: boolean, action?: string, value?: any }}
     */
    handleClick(x, y, currentSasMode) {
        const navCx = this._navballCenter.x;
        const navCy = this._navballCenter.y;
        const s = this._scale;

        // 节流阀弧形点击检测（左侧外圈）
        const dx = x - navCx;
        const dy = y - navCy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const innerR = THROTTLE_ARC_INNER * s;
        const outerR = THROTTLE_ARC_OUTER * s;

        if (dist >= innerR && dist <= outerR) {
            // 计算点击角度（Canvas 坐标系，0=右，顺时针）
            let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
            if (angle < 0) angle += 360;

            // 检查是否在左侧弧形范围内（180~360 度）
            if (angle >= THROTTLE_ARC_START && angle <= THROTTLE_ARC_END) {
                const ratio = (angle - THROTTLE_ARC_START) / (THROTTLE_ARC_END - THROTTLE_ARC_START);
                return { hit: true, action: 'throttle', value: Math.max(0, Math.min(1, ratio)) };
            }
        }

        // SAS 圆盘方向按钮
        const cx = this._panelCenter.x;
        const cy = this._panelCenter.y;

        // 四方向按钮（点击已选中的方向 → 回到 STABILITY）
        for (const dir of DIR_CIRCLES) {
            const bx = cx + dir.dx * s;
            const by = cy + dir.dy * s;
            const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
            if (dist < DIR_BTN_RADIUS * s + 4 * s) {
                const newMode = (currentSasMode === dir.mode) ? 'stability' : dir.mode;
                return { hit: true, action: 'mode', value: newMode };
            }
        }

        return { hit: false };
    }

    /**
     * 处理 Canvas 右键（圆盘中心右键 → 回到 STABILITY）
     * @param {number} x - 点击相对 canvas 的 X 坐标
     * @param {number} y - 点击相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     * @returns {{ hit: boolean, action?: string }}
     */
    handleRightClick(x, y, currentSasMode) {
        const cx = this._panelCenter.x;
        const cy = this._panelCenter.y;
        const s = this._scale;

        const distCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distCenter < SAS_PANEL_CENTER_RADIUS * s + 4 * s) {
            // 仅在锁定方向时生效（非 OFF、非 STABILITY）
            if (currentSasMode !== 'off' && currentSasMode !== 'stability') {
                return { hit: true, action: 'back_to_stability' };
            }
        }

        return { hit: false };
    }

    /**
     * 判断坐标是否落在节流阀弧形区域内（供 flightScene 判定拖拽起点）
     * @param {number} x - 相对 canvas 的 X 坐标
     * @param {number} y - 相对 canvas 的 Y 坐标
     * @returns {boolean}
     */
    isInThrottleArc(x, y) {
        const cx = this._navballCenter.x;
        const cy = this._navballCenter.y;
        const s = this._scale;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const innerR = THROTTLE_ARC_INNER * s;
        const outerR = THROTTLE_ARC_OUTER * s;
        if (dist < innerR || dist > outerR) return false;

        let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        if (angle < 0) angle += 360;
        return angle >= THROTTLE_ARC_START && angle <= THROTTLE_ARC_END;
    }

    /**
     * 处理拖拽（节流阀弧形：根据当前指针角度连续设油门）
     * @param {number} x - 相对 canvas 的 X 坐标
     * @param {number} y - 相对 canvas 的 Y 坐标
     * @returns {{ throttle: number } | null}
     */
    handleDrag(x, y) {
        const cx = this._navballCenter.x;
        const cy = this._navballCenter.y;
        const dx = x - cx;
        const dy = y - cy;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        if (angle < 0) angle += 360;

        const ratio = (angle - THROTTLE_ARC_START) / (THROTTLE_ARC_END - THROTTLE_ARC_START);
        return { throttle: Math.max(0, Math.min(1, ratio)) };
    }

    // ========== 节流阀弧形分段（Canvas，导航球外圈左侧） ==========

    /**
     * 绘制节流阀弧形分段（与导航球一体，左侧外圈）
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - 导航球圆心 X
     * @param {number} cy - 导航球圆心 Y
     * @param {number} s - 缩放比例
     * @param {number} throttle - 油门值 [0, 1]
     */
    _drawThrottleArc(ctx, cx, cy, s, throttle) {
        const innerR = THROTTLE_ARC_INNER * s;
        const outerR = THROTTLE_ARC_OUTER * s;
        const startRad = (THROTTLE_ARC_START - 90) * Math.PI / 180;   // 底部（180°）
        const endRad = (THROTTLE_ARC_END - 90) * Math.PI / 180;       // 顶部（360°）
        const totalRad = (THROTTLE_ARC_END - THROTTLE_ARC_START) * Math.PI / 180;
        const fillRad = startRad + totalRad * (throttle || 0);        // 当前油门对应角度

        // ========== 0.2.7 层级 ==========
        //  底(二级背景)：黑色铺满整条弧带
        //  未填充弧(紫色 #5A5FCF)：距边框 5px
        //  激活填充弧(项目绿)：距边框 5px（油门到达部分）
        const fillOuter = outerR - THROTTLE_FILL_GAP * s;
        const fillInner = innerR + THROTTLE_FILL_GAP * s;

        // 二级背景（黑色，整条弧带）
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startRad, endRad);
        ctx.arc(cx, cy, innerR, endRad, startRad, true);
        ctx.closePath();
        ctx.fillStyle = THROTTLE_TRACK_COLOR;
        ctx.fill();

        // 未填充弧（紫色，从当前油门角到结束角）
        ctx.beginPath();
        ctx.arc(cx, cy, fillOuter, fillRad, endRad);
        ctx.arc(cx, cy, fillInner, endRad, fillRad, true);
        ctx.closePath();
        ctx.fillStyle = THROTTLE_EMPTY_COLOR;
        ctx.fill();

        // 激活填充弧（项目绿，从起始角到当前油门角）
        if (throttle > 0.01) {
            ctx.beginPath();
            ctx.arc(cx, cy, fillOuter, startRad, fillRad);
            ctx.arc(cx, cy, fillInner, fillRad, startRad, true);
            ctx.closePath();
            ctx.fillStyle = THROTTLE_FILL_COLOR;
            ctx.fill();
        }

        // ========== 0.2.7 双层描边：紫色内描边 + 黑色外衬(2px,基准) ==========
        const sC = Math.cos(startRad), sS = Math.sin(startRad);
        const eC = Math.cos(endRad), eS = Math.sin(endRad);
        // 黑色外衬(先画,外缘在外侧 2px;内缘在内侧 2px;端帽两侧各 1px)
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2 * s;
        // 外缘黑衬
        ctx.beginPath();
        ctx.arc(cx, cy, outerR + 1.5 * s, startRad, endRad);
        ctx.stroke();
        // 内缘黑衬
        ctx.beginPath();
        ctx.arc(cx, cy, innerR - 1.5 * s, startRad, endRad);
        ctx.stroke();
        // 端帽黑衬(径向短线,线宽加倍包边)
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        ctx.moveTo(cx + sC * innerR, cy + sS * innerR);
        ctx.lineTo(cx + sC * outerR, cy + sS * outerR);
        ctx.moveTo(cx + eC * innerR, cy + eS * innerR);
        ctx.lineTo(cx + eC * outerR, cy + eS * outerR);
        ctx.stroke();

        // 紫色内描边(原样式)
        ctx.strokeStyle = PANEL_BORDER_COLOR;
        ctx.lineWidth = 1 * s;
        // 外缘
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startRad, endRad);
        ctx.stroke();
        // 内缘
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, startRad, endRad);
        ctx.stroke();
        // 两端封口（底部/顶部径向短线）
        ctx.beginPath();
        ctx.moveTo(cx + sC * innerR, cy + sS * innerR);
        ctx.lineTo(cx + sC * outerR, cy + sS * outerR);
        ctx.moveTo(cx + eC * innerR, cy + eS * innerR);
        ctx.lineTo(cx + eC * outerR, cy + eS * outerR);
        ctx.stroke();

        // 顶部百分比文字
        const pct = Math.round((throttle || 0) * 100);
        const labelR = outerR + 15 * s;
        const labelAngle = endRad;
        const labelX = cx + Math.cos(labelAngle) * labelR;
        const labelY = cy + Math.sin(labelAngle) * labelR;

        ctx.font = `bold ${12 * s}px monospace`;
        ctx.fillStyle = '#88ccff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct.toString(), labelX, labelY);
    }

    // ========== 下方按钮区（DOM：主开关 + 副钮组，方形 1:1） ==========

    /**
     * 按钮定义（tex 为图标纹理 key，就绪时优先显示图片，否则 emoji 占位）
     * iconScale：mask 图标占按钮边长比例（默认 0.7）。
     * 0.3.0 视觉对齐：icon_sas 正式素材圆环撑满 viewBox（≈95%），而 node/+/- 占位素材
     * 内容仅约 75% —— 同为 0.7 时 SAS 显得大。icon_sas 单独缩至 0.55（视觉 ≈ 0.55×95% ≈ 52%，
     * 与占位图标的 0.7×75% ≈ 52.5% 对齐）；三张占位素材换成正式版（撑满圆环）后,
     * 建议把 iconScale 统一回 0.7。
     */
    _getBottomBtnDefs() {
        return [
            { id: 'sas',          label: t('sas.main'),          emoji: '🛰', tex: 'icon_sas',          main: true, iconScale: 0.55 },
            { id: 'node',         label: t('sas.node'),          emoji: '⭐', tex: 'icon_node',         main: false },
            { id: 'target_plus',  label: t('sas.targetPlus'),    emoji: '🎯', tex: 'icon_target_plus',  main: false },
            { id: 'target_minus', label: t('sas.targetMinus'),   emoji: '🎯', tex: 'icon_target_minus', main: false }
        ];
    }

    /**
     * 懒创建下方按钮区 DOM（仅首次显示时执行）
     */
    _ensureBottomButtons() {
        if (this._bottomButtons) return;

        const wrap = document.createElement('div');
        wrap.id = 'sasBottomButtons';
        wrap.style.display = 'none';

        for (const def of this._getBottomBtnDefs()) {
            const btn = document.createElement('button');
            btn.dataset.btnId = def.id;
            btn.dataset.btnMain = def.main ? '1' : '0';

            // 悬停提示：统一走全局 DOM tooltip（进入时触发一次，延迟显示、位置固定）
            btn.addEventListener('mouseenter', (e) => {
                showTooltip(def.label, e.clientX, e.clientY);
            });
            btn.addEventListener('mouseleave', () => {
                hideTooltip();
            });

            // 内容：纹理就绪用 SVG mask 图标（background 染色，随按钮状态色切换，与 Canvas 模板染色同思路），
            // 图标占按钮比例由 def.iconScale 控制（默认 0.7），纹理未就绪回退 emoji 占位
            const tex = def.tex ? textureManager.get(def.tex) : null;
            if (tex) {
                const icon = document.createElement('div');
                icon.className = 'sas-btn-icon';
                const iconPct = Math.round((def.iconScale || 0.7) * 100);
                icon.style.cssText = [
                    `width:${iconPct}%;height:${iconPct}%;`,
                    `-webkit-mask-image:url(${tex.src});`,
                    `mask-image:url(${tex.src});`,
                    '-webkit-mask-size:contain;',
                    'mask-size:contain;',
                    '-webkit-mask-repeat:no-repeat;',
                    'mask-repeat:no-repeat;',
                    '-webkit-mask-position:center;',
                    'mask-position:center;',
                    'background:#ddd;'   // 初始灰白（--text-main），激活态由 _updateBottomButtonsState 改写
                ].join('');
                btn.appendChild(icon);
            } else {
                const span = document.createElement('span');
                span.style.cssText = `font-size:20px;line-height:1;`;
                span.textContent = def.emoji;
                btn.appendChild(span);
            }

            btn.addEventListener('click', () => {
                const ship = window.__shipSystem?.getActiveShip?.();
                if (def.id === 'sas') {
                    if (ship) {
                        ship.sasMode = ship.sasMode === 'off' ? 'stability' : 'off';
                    }
                } else if (typeof window.showNotification === 'function') {
                    window.showNotification(t('sas.wip'), 'info');
                }
            });

            wrap.appendChild(btn);
            if (def.id === 'sas') {
                this._sasBtnEl = btn;
                // 主开关与副钮组之间的竖分隔线（追踪站导航栏同款：#555 1px 竖线）
                const divider = document.createElement('div');
                divider.dataset.divider = '1';
                divider.style.cssText = `width:1px;height:28px;background:var(--border);flex-shrink:0;align-self:center;`;
                wrap.appendChild(divider);
            }
        }

        document.body.appendChild(wrap);
        this._bottomButtons = wrap;
    }

    /**
     * 控制按钮框显隐（飞行场景且有活动飞船时显示；设施模式/其他场景隐藏）
     * @param {boolean} visible
     */
    setBottomButtonsVisible(visible) {
        if (this._bottomVisible === visible) return;
        this._bottomVisible = visible;
        this._ensureBottomButtons();
        this._bottomButtons.style.display = visible ? 'flex' : 'none';
        if (visible) {
            this._updateBottomButtonsLayout();
        }
    }

    /**
     * 更新按钮框位置（SAS 圆盘正下方居中；位置变化才写 DOM）
     */
    _updateBottomButtonsLayout() {
        if (!this._bottomButtons) return;
        const s = this._scale;
        const pad = BOTTOM_FRAME_PAD * s;
        const mainSize = BOTTOM_MAIN_SIZE * s;
        const subSize = BOTTOM_SUB_SIZE * s;
        const gap = BOTTOM_BTN_GAP * s;

        // 框总宽 = 内边距×2 + 主开关 + 4×gap（主-分隔线-节点-目标+-目标-）+ 分隔线 + 3 副钮
        const dividerW = 1 * s;
        const totalW = pad * 2 + mainSize + gap * 4 + dividerW + subSize * 3;
        const x = this._panelCenter.x - totalW / 2;
        const y = this._panelCenter.y + SAS_PANEL_RADIUS * s + BOTTOM_BTN_GAP_BELOW * s;

        // 统一用 flex gap 控制间距（分隔线两侧各一个 gap，实现主/副钮组的分隔）
        this._bottomButtons.style.gap = gap + 'px';
        const btns = this._bottomButtons.querySelectorAll('[data-btn-id]');
        btns.forEach(b => {
            const isMain = b.dataset.btnMain === '1';
            const size = isMain ? mainSize : subSize;
            b.style.width = size + 'px';
            b.style.height = size + 'px';
            b.style.marginRight = '0px';
            const span = b.querySelector('span');
            if (span) {
                span.style.fontSize = 20 * s + 'px';
            }
        });
        // 分隔线缩放
        const divider = this._bottomButtons.querySelector('[data-divider="1"]');
        if (divider) {
            divider.style.width = dividerW + 'px';
            divider.style.height = 28 * s + 'px';
        }

        // 框内边距缩放
        this._bottomButtons.style.padding = pad + 'px';

        const key = [x, y, totalW].map(v => v.toFixed(1)).join(',');
        if (key !== this._bottomLastPos) {
            this._bottomLastPos = key;
            this._bottomButtons.style.left = x + 'px';
            this._bottomButtons.style.top = y + 'px';
        }
    }

    /**
     * 同步 SAS 按钮激活态（sasMode 变化才写 DOM）
     * 0.3.0 状态色规范：激活=通用绿(--progress-green) / 未激活=通用深灰(--border)
     * @param {string} sasMode
     */
    _updateBottomButtonsState(sasMode) {
        if (!this._sasBtnEl) return;
        const active = sasMode !== 'off' ? 1 : 0;
        if (active !== this._bottomLastSas) {
            this._bottomLastSas = active;
            const stateColor = active ? SAS_ACTIVE_COLOR : SAS_INACTIVE_COLOR;
            this._sasBtnEl.style.borderColor = stateColor;
            // color 同步：mask 图标 background 初始为固定色，直接改写；emoji fallback 文字随 color
            this._sasBtnEl.style.color = stateColor;
            const iconEl = this._sasBtnEl.querySelector('.sas-btn-icon');
            if (iconEl) {
                iconEl.style.background = stateColor;
            }
        }
    }

    // ========== 可见性筛选面板（DOM，保留原逻辑） ==========

    /**
     * 创建或显示右下角可见性筛选面板
     */
    showVisibilityPanel(opts = {}) {
        if (!this._visibilityPanel) {
            this._createVisibilityPanel();
        }
        // 仅"从非显示→显示"广播打开事件：重复调用不重复发声
        // opts.silent = true 用于场景 enter 自动打开（不产生打开音效）
        if (this._visibilityPanel.style.display !== 'flex') {
            this._visibilityPanel.style.display = 'flex';
            if (!opts.silent) {
                eventBus.emit(Events.UI_PANEL_OPENED, { panelId: 'visibility' });
            }
        }
        this._updateVisibilityCheckboxes();
    }

    /**
     * 隐藏可见性筛选面板
     */
    hideVisibilityPanel(opts = {}) {
        // 仅"从显示→非显示"广播关闭事件：已隐藏时静默
        // opts.silent = true 用于场景 exit 自动关闭（不产生关闭音效）
        if (this._visibilityPanel && this._visibilityPanel.style.display === 'flex') {
            this._visibilityPanel.style.display = 'none';
            if (!opts.silent) {
                eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: 'visibility' });
            }
        }
    }

    /**
     * 构建 DOM 结构（只执行一次）——样式见 flight.css #visibilityPanel
     */
    _createVisibilityPanel() {
        const panel = document.createElement('div');
        panel.id = 'visibilityPanel';

        // 折叠按钮
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'vis-toggle-btn';
        toggleBtn.textContent = '👁';
        toggleBtn.title = t('sas.showFilter');
        toggleBtn.addEventListener('click', () => {
            this._visibilityExpanded = !this._visibilityExpanded;
            if (this._visibilityExpanded) {
                this._visibilityContent.style.display = 'flex';
                toggleBtn.classList.add('active');
            } else {
                this._visibilityContent.style.display = 'none';
                toggleBtn.classList.remove('active');
            }
        });
        panel.appendChild(toggleBtn);

        // 展开内容区
        const content = document.createElement('div');
        content.className = 'vis-content';

        // 飞船 toggle
        const shipsLabel = this._makeCheckbox('ships', t('sas.ships'));
        content.appendChild(shipsLabel);

        // 设施 toggle
        const facilitiesLabel = this._makeCheckbox('facilities', t('sas.facilities'));
        content.appendChild(facilitiesLabel);

        // 设施范围 toggle
        const rangeLabel = this._makeCheckbox('facilityRange', t('sas.facilityRange'));
        content.appendChild(rangeLabel);

        // 天体轨道 toggle
        const orbitsLabel = this._makeCheckbox('bodyOrbits', t('sas.bodyOrbits'));
        content.appendChild(orbitsLabel);

        // SOI 切换标签 toggle（0.3.0）
        const soiLabel = this._makeCheckbox('soiLabels', t('sas.soiLabels'));
        content.appendChild(soiLabel);

        panel.appendChild(content);
        // 0.3.0：挂入左上玩家 HUD 黑条尾端（黑条不存在时兜底 body，正常时序黑条必已创建）
        const hudHost = document.getElementById('playerResourceHud');
        (hudHost || document.body).appendChild(panel);

        this._visibilityPanel = panel;
        this._visibilityContent = content;
    }

    /**
     * 创建一个 checkbox label（样式见 flight.css #visibilityPanel label）
     */
    _makeCheckbox(type, labelText) {
        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.visType = type;
        checkbox.addEventListener('change', () => {
            if (typeof window.__toggleVisibility === 'function') {
                window.__toggleVisibility(type);
            }
        });
        label.appendChild(checkbox);

        const span = document.createElement('span');
        span.textContent = labelText;
        label.appendChild(span);

        return label;
    }

    /**
     * 根据当前状态更新 checkbox 选中值
     */
    _updateVisibilityCheckboxes() {
        if (!this._visibilityContent) return;
        const state = window.__visibilityState || { ships: true, facilities: true };
        const checkboxes = this._visibilityContent.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            const type = cb.dataset.visType;
            if (type) {
                cb.checked = state[type] !== false;
            }
        });
    }
}

// ========== 导出单例 ==========
export const sasUI = new SASUI();
