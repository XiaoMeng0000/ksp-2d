'use strict';

// SAS系统 — KSP2 风格导航球 + SAS 控制圆盘（Canvas 渲染）
// Step2：导航球（左下角，纯显示）+ SAS 控制圆盘（右侧，仅渲染）
// Step3：SAS 圆盘交互（方向按钮点击 / 右键回 stability / tooltip）
// Step4：节流阀弧形（导航球外圈左侧，Canvas 绘制，连续拖动）
// Step5：导航球下方按钮区（DOM：SAS 开关 + 机动节点/目标预留按钮）

import { SASModeLabels } from '../ship/sasModes.js';
import { eventBus, Events } from '../eventBus.js';
import { textureManager } from '../graphics/textureManager.js';
import { t } from '../config/strings.js';

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

// ---- 通用配色（统一为游戏面板风格：半透明黑底 + #555 边框） ----
const PANEL_BG = 'rgba(0, 0, 0, 0.85)';    // 与左侧工具栏/浮层面板底色一致
const PANEL_BORDER_COLOR = '#555';         // 与左侧工具栏/浮层面板边框一致
const MARKER_COLOR = '#ffffff';            // 姿态指示（白色三角 / 圆盘中心白圆）
const DIR_PROGRADE_COLOR = '#88ccff';      // 顺向/逆向 主蓝
const DIR_RADIAL_COLOR = '#4fc3f7';        // 径向内/外 青色

// ---- 导航球（左下角，纯显示） ----
const NAVBALL_RADIUS = 175;                // 大导航球半径
const NAVBALL_MARKER_SIZE = 26;            // 中心白色三角外接圆半径
const NAVBALL_DIR_R = 140;                 // 圆上方向标记的半径位置（内缩避让描边）
const MARKER_RADIUS = 12;                  // 圆上方向小圆半径（Step2 先用小圆，后续换图片驱动器）

// ---- SAS 控制圆盘（导航球右侧，交互，按 KSP2 比例约为导航球 0.5 倍） ----
const SAS_PANEL_RADIUS = 88;               // 圆盘半径（导航球 0.5 倍）
const SAS_PANEL_CENTER_RADIUS = 10;        // 圆盘中心白色圆半径
const DIR_BTN_RADIUS = 16;                 // 方向按钮半径
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
const BOTTOM_MAIN_SIZE = 44;             // 主开关（SAS）按钮边长（基准，与副钮统一大小）
const BOTTOM_SUB_SIZE = 44;              // 副钮（节点/目标）边长（基准）
const BOTTOM_BTN_GAP = 10;               // 同组按钮间距（基准）
const BOTTOM_FRAME_PAD = 8;              // 方形框内边距（基准）
const BOTTOM_BTN_GAP_BELOW = 16;         // 圆盘底部到按钮框顶部间距（基准）

// ========== 导航球四方向定义（注册表，为机动节点预留扩展位） ==========
// key 与 RENDER_DATA.directions 字段名对应
const NAV_DIRECTIONS = [
    { key: 'prograde',   label: t('sas.prograde'),   color: DIR_PROGRADE_COLOR },
    { key: 'retrograde', label: t('sas.retrograde'), color: DIR_PROGRADE_COLOR },
    { key: 'radialIn',   label: t('sas.radialIn'),   color: DIR_RADIAL_COLOR },
    { key: 'radialOut',  label: t('sas.radialOut'),  color: DIR_RADIAL_COLOR }
    // 未来：{ key: 'maneuverNode', label: '机动节点', color: '#4FC3F7' }
];

// ========== SAS 圆盘方向按钮（X 斜角布局） ==========
const DIR_CIRCLES = [
    { mode: 'radial_in',  dx: -DIR_OFFSET, dy: -DIR_OFFSET, color: DIR_RADIAL_COLOR, label: t('sas.radialIn') },
    { mode: 'prograde',   dx:  DIR_OFFSET, dy: -DIR_OFFSET, color: DIR_PROGRADE_COLOR, label: t('sas.prograde') },
    { mode: 'retrograde', dx: -DIR_OFFSET, dy:  DIR_OFFSET, color: DIR_PROGRADE_COLOR, label: t('sas.retrograde') },
    { mode: 'radial_out', dx:  DIR_OFFSET, dy:  DIR_OFFSET, color: DIR_RADIAL_COLOR, label: t('sas.radialOut') }
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
        this._tooltipTimer = 0;    // 悬停累计时间（秒）
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
        //  b) 按钮框（圆盘下方：圆盘半径 + 间距 + 主钮高 + 框内边距）距底 ≥ 16
        const bottomPad = Math.max(
            THROTTLE_ARC_OUTER + 16 - NAVBALL_RADIUS,
            SAS_PANEL_RADIUS + BOTTOM_BTN_GAP_BELOW + BOTTOM_MAIN_SIZE + BOTTOM_FRAME_PAD * 2 + 16 - NAVBALL_RADIUS
        ) * this._scale;
        const navY = canvas.height - bottomPad - NAVBALL_RADIUS * this._scale;
        this._navballCenter = {
            x: margin,
            y: navY
        };
        this._panelCenter = {
            x: margin + (NAVBALL_RADIUS + SAS_PANEL_GAP + SAS_PANEL_RADIUS) * this._scale,
            y: navY
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

        // 悬停计时（超过阈值后显示提示）
        if (this._hovered !== null) {
            this._tooltipTimer += dt;
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

        // 悬停提示（延迟 0.3 秒后显示）
        if (this._hovered !== null && this._tooltipTimer >= 0.3) {
            this._drawTooltip(ctx, s);
        }
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
     * 绘制导航球（左下角，纯显示）
     * - 圆框：深色半透明底 + 蓝色描边，固定
     * - 中心：姿态三角形，顶点指向 heading
     * - 圆上：四方向小圆标记，位置随实时角度（SAS 开启时淡入）
     */
    _drawNavball(ctx, cx, cy, s, appearance, heading, directions) {
        // ---- 圆框（统一游戏面板风格：半透明黑底 + #555 细描边） ----
        ctx.beginPath();
        ctx.arc(cx, cy, NAVBALL_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = PANEL_BG;
        ctx.fill();
        ctx.strokeStyle = PANEL_BORDER_COLOR;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();

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
            ctx.strokeStyle = isMajor ? 'rgba(136,204,255,0.85)'
                : (isMedium ? 'rgba(136,204,255,0.45)' : 'rgba(136,204,255,0.22)');
            ctx.lineWidth = (isMajor ? 2 : 1) * s;
            ctx.stroke();
        }
        // ---- 主方向读数（0/90/180/270，位于刻度内侧） ----
        ctx.font = `${11 * s}px monospace`;
        ctx.fillStyle = 'rgba(136,204,255,0.75)';
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
        ctx.strokeStyle = 'rgba(136,204,255,0.15)';
        ctx.lineWidth = 1 * s;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, R - 23, this._pulsePhase, this._pulsePhase + Math.PI * 1.2);
        ctx.setLineDash([4 * s, 9 * s]);
        ctx.strokeStyle = 'rgba(136,204,255,0.40)';
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // ---- 中心白色姿态三角形 ----
        this._drawTriangle(ctx, cx, cy, s, heading, NAVBALL_MARKER_SIZE, MARKER_COLOR);

        // ---- 圆上四方向标记（常驻，角度有效时显示） ----
        if (appearance > 0.01) {
            const dirR = NAVBALL_DIR_R * s;
            const markerR = MARKER_RADIUS * s * appearance;
            for (const dir of NAV_DIRECTIONS) {
                const d = directions ? directions[dir.key] : null;
                if (!d || typeof d.angle !== 'number') continue;
                const rad = this._toNavAngle(d.angle) * Math.PI / 180;
                const mx = cx + Math.cos(rad) * dirR;
                const my = cy + Math.sin(rad) * dirR;

                ctx.beginPath();
                ctx.arc(mx, my, markerR, 0, Math.PI * 2);
                ctx.fillStyle = dir.color;
                ctx.globalAlpha = 0.9 * appearance;
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
        }
    }

    /**
     * 绘制 SAS 控制圆盘（导航球右侧）
     * - 圆框 + 中心姿态三角形（纯显示）
     * - 四方向按钮（X 斜角布局），当前 SAS 模式对应按钮高亮
     */
    _drawSasPanel(ctx, cx, cy, s, sasMode, heading) {
        // ---- 圆框（统一游戏面板风格：半透明黑底 + #555 细描边） ----
        ctx.beginPath();
        ctx.arc(cx, cy, SAS_PANEL_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = PANEL_BG;
        ctx.fill();
        ctx.strokeStyle = PANEL_BORDER_COLOR;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();

        // ---- 中心白色圆 ----
        ctx.beginPath();
        ctx.arc(cx, cy, SAS_PANEL_CENTER_RADIUS * s, 0, Math.PI * 2);
        ctx.fillStyle = MARKER_COLOR;
        ctx.fill();

        // ---- 四方向按钮 ----
        const btnR = DIR_BTN_RADIUS * s;
        for (const dir of DIR_CIRCLES) {
            const bx = cx + dir.dx * s;
            const by = cy + dir.dy * s;
            const isSelected = sasMode === dir.mode;

            ctx.beginPath();
            ctx.arc(bx, by, btnR, 0, Math.PI * 2);
            ctx.strokeStyle = dir.color;
            ctx.globalAlpha = isSelected ? 1.0 : 0.4;
            ctx.lineWidth = 2 * s;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
    }

    /**
     * 绘制悬停提示框（延迟 0.3 秒后显示）
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} s - 缩放比例
     */
    _drawTooltip(ctx, s) {
        const cx = this._panelCenter.x;
        const cy = this._panelCenter.y;
        let text;
        let tipX, tipY;

        if (this._hovered === 'center') {
            text = t('sas.stability');
            tipX = cx;
            tipY = cy - (SAS_PANEL_CENTER_RADIUS + 12) * s;
        } else {
            const dir = DIR_CIRCLES.find(d => d.mode === this._hovered);
            if (!dir) return;
            text = SASModeLabels[this._hovered] || this._hovered;
            tipX = cx + dir.dx * s;
            tipY = cy + dir.dy * s - (DIR_BTN_RADIUS + 10) * s;
        }

        // 测量文字宽度
        ctx.font = `${14 * s}px monospace`;
        const textWidth = ctx.measureText(text).width;
        const paddingH = 10 * s;
        const paddingV = 6 * s;
        const boxW = textWidth + paddingH * 2;
        const boxH = 14 * s + paddingV * 2;
        const boxX = tipX - boxW / 2;
        const boxY = tipY - boxH + paddingV;

        // 背景（与建造菜单统一：rgba(0,0,0,0.92) + #555 边框 + 4px 圆角）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.beginPath();
        const r = 4 * s;
        ctx.moveTo(boxX + r, boxY);
        ctx.lineTo(boxX + boxW - r, boxY);
        ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
        ctx.lineTo(boxX + boxW, boxY + boxH - r);
        ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH, r);
        ctx.lineTo(boxX + r, boxY + boxH);
        ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - r, r);
        ctx.lineTo(boxX, boxY + r);
        ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
        ctx.closePath();
        ctx.fill();

        // 边框
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 文字
        ctx.fillStyle = '#88ccff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, tipX, tipY);
    }

    // ========== 悬停检测（SAS 圆盘交互） ==========

    /**
     * 处理鼠标移动，更新悬停目标（仅检测 SAS 圆盘；导航球纯显示不响应）
     * @param {number} x - 鼠标相对 canvas 的 X 坐标
     * @param {number} y - 鼠标相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     */
    handleHover(x, y, currentSasMode) {
        const cx = this._panelCenter.x;
        const cy = this._panelCenter.y;
        const s = this._scale;

        // 圆盘中心
        const distCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distCenter < SAS_PANEL_CENTER_RADIUS * s + 4 * s) {
            this._setHovered('center');
            return;
        }

        // 四方向按钮
        for (const dir of DIR_CIRCLES) {
            const bx = cx + dir.dx * s;
            const by = cy + dir.dy * s;
            const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
            if (dist < DIR_BTN_RADIUS * s + 4 * s) {
                this._setHovered(dir.mode);
                return;
            }
        }

        // 不在任何可悬停区域
        this._setHovered(null);
    }

    /**
     * 设置悬停目标（若变化则重置计时器）
     */
    _setHovered(target) {
        if (this._hovered !== target) {
            this._hovered = target;
            this._tooltipTimer = 0;
        }
    }

    /**
     * 清除悬停状态（鼠标离开 canvas 时调用）
     */
    clearHover() {
        this._hovered = null;
        this._tooltipTimer = 0;
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

        // 未填充部分（半透明黑，保留凹槽视觉）
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, fillRad, endRad);
        ctx.arc(cx, cy, innerR, endRad, fillRad, true);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fill();

        // 填充部分（绿色渐变，从底部到当前油门角）
        if (throttle > 0.01) {
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startRad, fillRad);
            ctx.arc(cx, cy, innerR, fillRad, startRad, true);
            ctx.closePath();
            const grad = ctx.createLinearGradient(cx, cy + outerR, cx, cy - outerR);
            grad.addColorStop(0, '#2e7d32');
            grad.addColorStop(1, '#66bb6a');
            ctx.fillStyle = grad;
            ctx.fill();
        }

        // ---- 弧形外缘/内缘描边（游戏面板风格 #555，避免与导航球黑底融为一体） ----
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
        const sC = Math.cos(startRad), sS = Math.sin(startRad);
        const eC = Math.cos(endRad), eS = Math.sin(endRad);
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
     * 按钮定义（tex 为未来导入的 1x1 图片纹理 key，就绪时优先显示图片，否则 emoji 占位）
     */
    _getBottomBtnDefs() {
        return [
            { id: 'sas',          label: t('sas.main'),          emoji: '🛰', tex: 'icon_sas',          main: true },
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
            btn.title = def.label;
            btn.dataset.btnId = def.id;
            btn.dataset.btnMain = def.main ? '1' : '0';

            // 内容：纹理就绪用 1:1 图片（预留接口），否则 emoji 占位
            const tex = def.tex ? textureManager.get(def.tex) : null;
            if (tex) {
                const img = document.createElement('img');
                img.src = tex.src;
                img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                btn.appendChild(img);
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
     * @param {string} sasMode
     */
    _updateBottomButtonsState(sasMode) {
        if (!this._sasBtnEl) return;
        const active = sasMode !== 'off' ? 1 : 0;
        if (active !== this._bottomLastSas) {
            this._bottomLastSas = active;
            if (active) {
                this._sasBtnEl.style.borderColor = '#88ccff';
                this._sasBtnEl.style.color = '#88ccff';
            } else {
                this._sasBtnEl.style.borderColor = '#555';
                this._sasBtnEl.style.color = '#ddd';
            }
        }
    }

    // ========== 可见性筛选面板（DOM，保留原逻辑） ==========

    /**
     * 创建或显示右下角可见性筛选面板
     */
    showVisibilityPanel() {
        if (!this._visibilityPanel) {
            this._createVisibilityPanel();
        }
        this._visibilityPanel.style.display = 'block';
        this._updateVisibilityCheckboxes();
    }

    /**
     * 隐藏可见性筛选面板
     */
    hideVisibilityPanel() {
        if (this._visibilityPanel) {
            this._visibilityPanel.style.display = 'none';
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

        panel.appendChild(content);
        document.body.appendChild(panel);

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
