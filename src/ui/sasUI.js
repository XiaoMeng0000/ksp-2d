// SAS系统 — SAS UI Canvas 渲染、点击检测、拖拽交互与动画系统

import { SASModeLabels } from '../ship/sasModes.js';

// ========== 布局常量（1920x1080 基准） ==========
const SAS_RADIUS = 117;
const CENTER_RADIUS = 29;
const DIR_RADIUS = 23;
const DIR_OFFSET = 55;
const THROTTLE_ARC_OUTER = 137;
const THROTTLE_ARC_INNER = 120;
const ARC_DEG_START = 225;
const ARC_DEG_END = 135;
const ARC_COLOR = '#44cc44';
const ARC_FILL_COLOR = 'rgba(68, 204, 68, 0.6)';
const MAIN_BORDER_COLOR = '#4FC3F7';
const MAIN_BG_COLOR = 'rgba(30, 30, 30, 0.85)';
const CENTER_COLOR_OFF = '#666666';
const CENTER_COLOR_IDLE = '#00FF88';
const CENTER_COLOR_ACTIVE = '#006633';
const MARGIN = 182;

// ========== 方向圈配置（X 布局） ==========
const DIR_CIRCLES = [
    { mode: 'radial_in',  dx: -51, dy: -51, color: '#FF69B4', label: '径向内' },
    { mode: 'prograde',    dx:  51, dy: -51, color: '#FFD700', label: '顺向' },
    { mode: 'retrograde',  dx: -51, dy:  51, color: '#FFD700', label: '逆向' },
    { mode: 'radial_out',  dx:  51, dy:  51, color: '#FF69B4', label: '径向外' }
];

// ========== 动画时间常量 ==========
const APPEAR_TIME = 0.3;   // 出现动画时长（秒）
const DISAPPEAR_TIME = 0.2; // 消失动画时长（秒）
const PULSE_PERIOD = 2.0;  // 脉冲周期（秒）

class SASUI {
    constructor() {
        this._appearance = 0;      // 方向圈出现度 [0, 1]
        this._pulsePhase = 0;      // 中心开关脉冲相位（弧度）
        this._centerPos = { x: 0, y: 0 };
        this._scale = 1.0;
        this._isDragging = false;
        this._hovered = null;      // 当前悬停目标: 'center' | 方向圈 mode 名 | null
        this._tooltipTimer = 0;    // 悬停累计时间（秒），>0.3 秒后显示提示
        this._visibilityExpanded = false;  // 可见性筛选面板是否展开
        this._visibilityPanel = null;      // DOM 容器
        this._visibilityContent = null;     // 展开后的内容区
    }

    // ========== 布局 ==========

    /**
     * 每帧根据 canvas 尺寸重新计算圆心位置和缩放比例
     * @param {HTMLCanvasElement} canvas
     */
    updateLayout(canvas) {
        this._scale = Math.min(canvas.width / 1920, canvas.height / 1080, 1.0);
        const margin = MARGIN * this._scale;
        this._centerPos = {
            x: margin,
            y: canvas.height - margin
        };
    }

    // ========== 动画更新 ==========

    /**
     * 每帧更新动画状态
     * @param {number} dt - 时间步长（秒）
     * @param {string} sasMode - 当前 SAS 模式（'off' / 'stability' / ...）
     * @param {number} throttle - 油门值 [0, 1]
     */
    update(dt, sasMode, throttle) {
        // 方向圈出现/消失
        if (sasMode !== 'off') {
            this._appearance = Math.min(1.0, this._appearance + dt / APPEAR_TIME);
        } else {
            this._appearance = Math.max(0.0, this._appearance - dt / DISAPPEAR_TIME);
        }

        // 中心开关脉冲（仅 STABILITY 模式）
        if (sasMode === 'stability') {
            this._pulsePhase += dt * (2.0 * Math.PI / PULSE_PERIOD);
            if (this._pulsePhase > 2.0 * Math.PI) {
                this._pulsePhase -= 2.0 * Math.PI;
            }
        }

        // 悬停计时（超过阈值后显示提示）
        if (this._hovered !== null) {
            this._tooltipTimer += dt;
        }
    }

    // ========== 渲染 ==========

    /**
     * 渲染 SAS UI 到 Canvas
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} sasMode - 当前 SAS 模式
     * @param {number} throttle - 油门值 [0, 1]
     */
    render(ctx, sasMode, throttle) {
        const cx = this._centerPos.x;
        const cy = this._centerPos.y;
        const s = this._scale;
        const appearance = this._appearance;
        const sasActive = sasMode !== 'off';

        // ---- 主圆（蓝色框架） ----
        this._drawMainCircle(ctx, cx, cy, s);

        // ---- 连接线（方向圈可见度 > 0.5 时绘制） ----
        if (appearance > 0.5) {
            this._drawConnectionLines(ctx, cx, cy, s, appearance);
        }

        // ---- 方向圈 ----
        if (appearance > 0.01) {
            this._drawDirectionCircles(ctx, cx, cy, s, appearance, sasMode);
        }

        // ---- 中心开关 ----
        this._drawCenterSwitch(ctx, cx, cy, s, sasMode);

        // ---- 节流阀弧 ----
        this._drawThrottleArc(ctx, cx, cy, s, throttle);

        // ---- 悬停提示 ----
        if (this._hovered !== null && this._tooltipTimer >= 0.3) {
            this._drawTooltip(ctx, cx, cy, s, sasMode);
        }
    }

    /**
     * 绘制主圆蓝色框架
     */
    _drawMainCircle(ctx, cx, cy, s) {
        const r = SAS_RADIUS * s;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = MAIN_BG_COLOR;
        ctx.fill();

        ctx.strokeStyle = MAIN_BORDER_COLOR;
        ctx.lineWidth = 4 * s;
        ctx.stroke();
    }

    /**
     * 绘制中心到各方向圈的连接线
     */
    _drawConnectionLines(ctx, cx, cy, s, appearance) {
        const lineAlpha = 0.15 * appearance;

        ctx.strokeStyle = `rgba(255, 255, 255, ${lineAlpha})`;
        ctx.lineWidth = 1;

        for (const dir of DIR_CIRCLES) {
            const dx = cx + dir.dx * s * appearance;
            const dy = cy + dir.dy * s * appearance;

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(dx, dy);
            ctx.stroke();
        }
    }

    /**
     * 绘制四个方向圈（X 布局）
     */
    _drawDirectionCircles(ctx, cx, cy, s, appearance, sasMode) {
        for (const dir of DIR_CIRCLES) {
            const dx = cx + dir.dx * s * appearance;
            const dy = cy + dir.dy * s * appearance;
            const r = DIR_RADIUS * s * appearance;

            // 选中 = 亮色(alpha=1.0)，未选中 = 暗色(alpha=0.4)
            const isSelected = sasMode === dir.mode;
            const baseAlpha = isSelected ? 1.0 : 0.4;

            ctx.beginPath();
            ctx.arc(dx, dy, r, 0, Math.PI * 2);
            ctx.strokeStyle = dir.color;
            ctx.globalAlpha = baseAlpha;
            ctx.lineWidth = 2 * s;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
    }

    /**
     * 绘制中心开关（SAS 总开关）
     */
    _drawCenterSwitch(ctx, cx, cy, s, sasMode) {
        let radius = CENTER_RADIUS * s;
        let fillColor;
        let hasGlow = false;

        if (sasMode === 'off') {
            fillColor = CENTER_COLOR_OFF;
        } else if (sasMode === 'stability') {
            // 无方向选中：脉冲亮绿色
            radius += Math.sin(this._pulsePhase) * 3 * s;
            fillColor = CENTER_COLOR_IDLE;
            hasGlow = true;
        } else {
            // 有方向选中：暗绿色
            fillColor = CENTER_COLOR_ACTIVE;
        }

        // 外发光
        if (hasGlow) {
            ctx.shadowColor = fillColor;
            ctx.shadowBlur = 10 * s;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();

        // 重置阴影
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }

    /**
     * 绘制节流阀弧（左侧半环，绿色填充）
     */
    _drawThrottleArc(ctx, cx, cy, s, throttle) {
        const outerR = THROTTLE_ARC_OUTER * s;
        const innerR = THROTTLE_ARC_INNER * s;
        const startAngleRad = (ARC_DEG_START * Math.PI) / 180;  // 225° → 左下
        const endAngleRad = (ARC_DEG_END * Math.PI) / 180;      // 135° → 左上
        const totalSweep = startAngleRad - endAngleRad;          // 90°
        const throttleValue = Math.max(0, Math.min(1, throttle || 0));

        // ---- 轮廓（完整弧） ----
        ctx.strokeStyle = ARC_COLOR;
        ctx.lineWidth = 2 * s;

        // 外弧（逆时针从 225° 到 135°，走左侧短路径）
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startAngleRad, endAngleRad, true);
        ctx.stroke();

        // 内弧
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, startAngleRad, endAngleRad, true);
        ctx.stroke();

        // ---- 填充（按油门比例） ----
        if (throttleValue > 0.01) {
            const fillAngle = startAngleRad - totalSweep * throttleValue;

            ctx.beginPath();
            // 外弧：从 startAngle 逆时针到 fillAngle
            ctx.arc(cx, cy, outerR, startAngleRad, fillAngle, true);
            // 内弧：从 fillAngle 顺时针回到 startAngle
            ctx.arc(cx, cy, innerR, fillAngle, startAngleRad, false);
            ctx.closePath();

            ctx.fillStyle = ARC_FILL_COLOR;
            ctx.fill();
        }

        // ---- 百分比文字（弧左侧） ----
        const labelX = cx - outerR - 15 * s;
        const labelY = cy;
        const pct = Math.round(throttleValue * 100);

        ctx.fillStyle = ARC_COLOR;
        ctx.font = `${12 * s}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct + '%', labelX, labelY);
    }

    // ========== 工具提示 ==========

    /**
     * 绘制悬停提示（延迟 0.3 秒后显示）
     */
    _drawTooltip(ctx, cx, cy, s, sasMode) {
        // 确定提示文字和位置
        let text;
        let tipX, tipY;

        if (this._hovered === 'center') {
            text = 'SAS';
            tipX = cx;
            tipY = cy - (CENTER_RADIUS + 14) * s;
        } else {
            const dir = DIR_CIRCLES.find(d => d.mode === this._hovered);
            if (!dir) return;
            text = SASModeLabels[this._hovered] || this._hovered;
            tipX = cx + dir.dx * s * this._appearance;
            tipY = cy + dir.dy * s * this._appearance - (DIR_RADIUS + 12) * s;
        }

        // 测量文字宽度
        ctx.font = `${16 * s}px monospace`;
        const textWidth = ctx.measureText(text).width;
        const paddingH = 12 * s;
        const paddingV = 8 * s;
        const boxW = textWidth + paddingH * 2;
        const boxH = 16 * s + paddingV * 2;
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

        // 文字（与建造菜单模块名同色 #88ccff）
        ctx.fillStyle = '#88ccff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, tipX, tipY);
    }

    // ========== 悬停检测 ==========

    /**
     * 处理鼠标移动，更新悬停目标
     * @param {number} x - 鼠标相对 canvas 的 X 坐标
     * @param {number} y - 鼠标相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     */
    handleHover(x, y, currentSasMode) {
        const cx = this._centerPos.x;
        const cy = this._centerPos.y;
        const s = this._scale;

        // 中心开关
        const distCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distCenter < CENTER_RADIUS * s) {
            this._setHovered('center');
            return;
        }

        // 方向圈（visible > 0.5 时才检测）
        if (this._appearance > 0.5) {
            for (const dir of DIR_CIRCLES) {
                const dx = cx + dir.dx * s * this._appearance;
                const dy = cy + dir.dy * s * this._appearance;
                const dist = Math.sqrt((x - dx) ** 2 + (y - dy) ** 2);

                if (dist < DIR_RADIUS * s) {
                    this._setHovered(dir.mode);
                    return;
                }
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

    // ========== 右键检测 ==========

    /**
     * 处理 Canvas 右键事件（中心右键 → 回到 STABILITY）
     * @param {number} x - 点击相对 canvas 的 X 坐标
     * @param {number} y - 点击相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     * @returns {{ hit: boolean, action?: string }}
     */
    handleRightClick(x, y, currentSasMode) {
        const cx = this._centerPos.x;
        const cy = this._centerPos.y;
        const s = this._scale;

        const distCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distCenter < CENTER_RADIUS * s) {
            // 仅在锁定方向时生效（非 OFF、非 STABILITY）
            if (currentSasMode !== 'off' && currentSasMode !== 'stability') {
                return { hit: true, action: 'back_to_stability' };
            }
        }

        return { hit: false };
    }

    // ========== 点击检测 ==========

    /**
     * 处理 Canvas 点击事件
     * @param {number} x - 点击相对 canvas 的 X 坐标
     * @param {number} y - 点击相对 canvas 的 Y 坐标
     * @param {string} currentSasMode - 当前 SAS 模式
     * @returns {{ hit: boolean, action?: string, value?: any }}
     */
    handleClick(x, y, currentSasMode) {
        const cx = this._centerPos.x;
        const cy = this._centerPos.y;
        const s = this._scale;

        // ---- 1. 中心开关 ----
        const distCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distCenter < CENTER_RADIUS * s) {
            return { hit: true, action: 'toggle' };
        }

        // ---- 2. 方向圈（visible > 0.3 时可点击） ----
        if (this._appearance > 0.3) {
            for (const dir of DIR_CIRCLES) {
                const dx = cx + dir.dx * s * this._appearance;
                const dy = cy + dir.dy * s * this._appearance;
                const dist = Math.sqrt((x - dx) ** 2 + (y - dy) ** 2);

                if (dist < DIR_RADIUS * s) {
                    // 点击已选中的方向 → 回到 STABILITY
                    const newMode = (currentSasMode === dir.mode) ? 'stability' : dir.mode;
                    return { hit: true, action: 'mode', value: newMode };
                }
            }
        }

        // ---- 3. 节流阀弧 ----
        const distFromCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (distFromCenter >= THROTTLE_ARC_INNER * s && distFromCenter <= THROTTLE_ARC_OUTER * s) {
            // 计算角度（Canvas: 0°=右, 90°=下, 180°=左, 270°=上）
            // atan2(-(y-cy), x-cx): 0°=右, 90°=上, 180°=左, 270°=下
            const rawAngle = Math.atan2(-(y - cy), x - cx) * 180 / Math.PI;
            const normAngle = rawAngle < 0 ? rawAngle + 360 : rawAngle;

            // 有效范围：135°（左上）到 225°（左下）
            if (normAngle >= ARC_DEG_END && normAngle <= ARC_DEG_START) {
                const throttle = 1.0 - (normAngle - ARC_DEG_END) / (ARC_DEG_START - ARC_DEG_END);
                return { hit: true, action: 'throttle', value: Math.max(0, Math.min(1, throttle)) };
            }
        }

        return { hit: false };
    }

    /**
     * 处理拖拽节流阀
     * @param {number} x - 鼠标相对 canvas 的 X 坐标
     * @param {number} y - 鼠标相对 canvas 的 Y 坐标
     * @returns {{ throttle: number } | null}
     */
    handleDrag(x, y) {
        const cx = this._centerPos.x;
        const cy = this._centerPos.y;
        const s = this._scale;

        const distFromCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

        // 拖拽范围比点击稍宽松（扩大 10px）
        const dragPadding = 10 * s;
        if (distFromCenter >= (THROTTLE_ARC_INNER * s - dragPadding) &&
            distFromCenter <= (THROTTLE_ARC_OUTER * s + dragPadding)) {

            const rawAngle = Math.atan2(-(y - cy), x - cx) * 180 / Math.PI;
            const normAngle = rawAngle < 0 ? rawAngle + 360 : rawAngle;

            // 角度范围也稍宽松
            const anglePadding = 15;
            if (normAngle >= (ARC_DEG_END - anglePadding) && normAngle <= (ARC_DEG_START + anglePadding)) {
                const clampedAngle = Math.max(ARC_DEG_END, Math.min(ARC_DEG_START, normAngle));
                const throttle = 1.0 - (clampedAngle - ARC_DEG_END) / (ARC_DEG_START - ARC_DEG_END);
                return { throttle: Math.max(0, Math.min(1, throttle)) };
            }
        }

        return null;
    }

    // ========== 可见性筛选面板（DOM） ==========

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
     * 构建 DOM 结构（只执行一次）
     */
    _createVisibilityPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position:fixed;right:10px;bottom:10px;z-index:1000;
            font-family:monospace;font-size:11px;color:#ddd;
        `;

        // 折叠按钮
        const toggleBtn = document.createElement('div');
        toggleBtn.style.cssText = `
            width:28px;height:28px;background:rgba(0,0,0,0.75);
            border:1px solid #555;border-radius:4px;
            display:flex;align-items:center;justify-content:center;
            cursor:pointer;user-select:none;font-size:14px;
            margin-left:auto;
        `;
        toggleBtn.textContent = '👁';
        toggleBtn.title = '显示筛选';
        toggleBtn.addEventListener('click', () => {
            this._visibilityExpanded = !this._visibilityExpanded;
            if (this._visibilityExpanded) {
                this._visibilityContent.style.display = 'flex';
                toggleBtn.style.borderColor = '#88ccff';
            } else {
                this._visibilityContent.style.display = 'none';
                toggleBtn.style.borderColor = '#555';
            }
        });
        panel.appendChild(toggleBtn);

        // 展开内容区
        const content = document.createElement('div');
        content.style.cssText = `
            display:none;flex-direction:column;gap:4px;
            margin-top:4px;padding:6px 8px;
            background:rgba(0,0,0,0.85);border:1px solid #555;
            border-radius:4px;min-width:80px;
        `;

        // 飞船 toggle
        const shipsLabel = this._makeCheckbox('ships', '飞船');
        content.appendChild(shipsLabel);

        // 设施 toggle
        const facilitiesLabel = this._makeCheckbox('facilities', '设施');
        content.appendChild(facilitiesLabel);

        // 设施范围 toggle
        const rangeLabel = this._makeCheckbox('facilityRange', '设施范围');
        content.appendChild(rangeLabel);

        panel.appendChild(content);
        document.body.appendChild(panel);

        this._visibilityPanel = panel;
        this._visibilityContent = content;
    }

    /**
     * 创建一个 checkbox label
     */
    _makeCheckbox(type, labelText) {
        const label = document.createElement('label');
        label.style.cssText = `
            display:flex;align-items:center;gap:4px;
            cursor:pointer;user-select:none;padding:2px 0;
        `;

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
