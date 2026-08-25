'use strict';

// 轨道标签 DOM 组件（0.3.0）— Canvas 锚点 + DOM 文字本体
// 职责：把 renderer 算好的 markers（含屏幕坐标/文字）同步为 DOM 标签。
// 纯渲染展现层：创建 / 更新 / 销毁 + transform 坐标同步 + 展开/收起切换。
// 结构：
//   #orbitLabels（fixed 容器，位于视口 0,0）
//     .orbit-label[data-type]（absolute 0,0 + transform 平移）
//       .orbit-label-body  ← 文字面板（可点击展开/收起）
// 锚点与折线由 renderer 在 Canvas 绘制（世界元素，与轨道线同层像素级对齐）；
// 本体是 UI 文字 → DOM（UI 开发规范：一切 UI 文字都是 DOM）。
// 展开/收起（0.3.0）：默认收起只显示类型名（Ap/Pe）；
//   鼠标悬停 → 临时展开（显示 高度 / 到达时刻 UT / 剩余时间 T+），移开收起；
//   展开中右键点击面板 → 锁定展开（保持展开直至再次右键解锁；解锁后移开鼠标即收起）。
//   展开状态按 type 记录在模块级（悬停/锁定两个集合），退出场景（clearOrbitLabels）时重置。
// 惰性初始化：容器在首次 sync 时创建（顶层不碰 DOM，便于 node 环境加载）。

import { t } from '../config/strings.js';
import { ORBIT_POINT_TYPES } from '../config/orbitPointTypes.js';
import { formatGameDurationLong, formatMeters } from '../utils/format.js';

let _container = null;
let _hoveredTypes = new Set();   // 鼠标悬停临时展开的 type 集合
let _lockedTypes = new Set();    // 右键锁定展开的 type 集合

function ensureContainer() {
    if (_container) return _container;
    _container = document.createElement('div');
    _container.id = 'orbitLabels';
    document.body.appendChild(_container);
    return _container;
}

// 展开判定：锁定 或 悬停 任一满足即展开
function isExpanded(type) {
    return _lockedTypes.has(type) || _hoveredTypes.has(type);
}

// 展开面板 HTML（行结构由 CSS 类控制颜色区分）：
//   [标题（中文全称，类型色）]
//   T-0年:0天:01时:16分:20秒   ← 距离到达（T- 倒计时，HUD 绿）
//   499,999 m                  ← 精确海拔（千分位，--text-main）
// 注意：本项目约定 innerHTML 不含 onclick 字符串（事件挂 body 本身，重建不丢）
function buildExpandedHTML(m) {
    const def = ORBIT_POINT_TYPES[m.type];
    const titleColor = def && def.color ? def.color : '';
    const title = (def && def.labelFullKey) ? t(def.labelFullKey) : m.label;

    let html = '<div class="olb-title"' + (titleColor ? ' style="color:' + titleColor + '"' : '') + '>' + title + '</div>';
    if (m.tToNext !== null && m.tToNext !== undefined) {
        html += '<div class="olb-t">T-' + formatGameDurationLong(m.tToNext) + '</div>';
    }
    html += '<div class="olb-alt">' + formatMeters(m.altM) + '</div>';
    return html;
}

// 展开面板内容指纹：内容变化时重建（每帧比对，未变不重建）
function expandedKey(m) {
    return m.type + '|' + (m.label) + '|' + (m.tToNext === null || m.tToNext === undefined ? 'n' : m.tToNext)
        + '|' + (m.altM === null || m.altM === undefined ? 'n' : m.altM);
}

/**
 * 清空全部轨道标签并重置展开状态（场景退出时调用，防标签残留其他场景）
 */
export function clearOrbitLabels() {
    if (_container) _container.textContent = '';
    _hoveredTypes.clear();
    _lockedTypes.clear();
}

/**
 * 同步轨道标签 DOM：与 markers 列表全量对齐（创建缺失 / 更新已有 / 移除多余）
 * 坐标为视口 CSS 像素（markers.bodyX/bodyY 由 renderer 按锚点偏移计算）
 * @param {Array} markers - renderOrbitMarkers 产出
 *   [{ type, bodyX, bodyY, icon, label, value, tToNext, arrivalUt, isHover }]；空数组/null 清空全部
 * @param {HTMLCanvasElement} canvas - 保留签名对称，当前坐标已为视口系，不使用
 */
export function syncOrbitLabels(markers, canvas) {
    if (!markers || markers.length === 0) {
        clearOrbitLabels();
        return;
    }

    const container = ensureContainer();

    // 移除本帧不再存在的标签（简单优先：每帧全量对齐，数量极少）
    const existing = container.querySelectorAll('.orbit-label');
    for (const el of existing) {
        if (!markers.some(m => m.type === el.dataset.type)) el.remove();
    }

    for (const m of markers) {
        const def = ORBIT_POINT_TYPES[m.type];
        if (!def) continue;

        let el = container.querySelector('.orbit-label[data-type="' + m.type + '"]');
        if (!el) {
            el = document.createElement('div');
            el.className = 'orbit-label';
            el.dataset.type = m.type;
            const body = document.createElement('div');
            body.className = 'orbit-label-body';
            // 悬停临时展开 / 移开收起（锁定状态下移开不收起）
            body.addEventListener('mouseenter', () => _hoveredTypes.add(m.type));
            body.addEventListener('mouseleave', () => _hoveredTypes.delete(m.type));
            // 右键锁定展开（再右键解锁；拦截浏览器原生菜单；标签在 canvas 上层，
            // 右键事件不会落入 canvas 的 SAS/轨道处理，天然隔离）
            body.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (_lockedTypes.has(m.type)) {
                    _lockedTypes.delete(m.type);
                } else {
                    _lockedTypes.add(m.type);
                }
            });
            el.appendChild(body);
            container.appendChild(el);
        }

        const body = el.querySelector('.orbit-label-body');

        // 收起态：纯名称文本（textContent 赋值同时清除展开面板子元素）
        // 展开态：三行结构面板（指纹未变不重建，保持 DOM 稳定）
        if (isExpanded(m.type)) {
            const key = expandedKey(m);
            if (body.dataset.expandedKey !== key) {
                body.innerHTML = buildExpandedHTML(m);
                body.dataset.expandedKey = key;
            }
        } else {
            if (body.textContent !== m.label) body.textContent = m.label;
            delete body.dataset.expandedKey;
        }

        // 文字色 = 类型区分色（注册表单源，内联注入）；边框统一走 flight.css
        // 的 var(--toolbar-border)（= ORBIT_MARKER_COLOR，与 Canvas 锚点/折线一致）
        if (def.color) {
            body.style.color = def.color;
        }

        // 展开态样式标记（CSS 调整光标/内边距）
        el.classList.toggle('expanded', isExpanded(m.type));

        // 坐标同步：锚点偏移后的本体位置（fixed 容器 0,0 + transform 平移）
        el.style.transform = 'translate(' + Math.round(m.bodyX) + 'px,' + Math.round(m.bodyY) + 'px)';
        el.classList.toggle('hovered', !!m.isHover);
    }
}
