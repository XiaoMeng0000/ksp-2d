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
import { textureManager } from '../graphics/textureManager.js';
import { escapeHtml } from './uiComponents.js';

let _container = null;
let _hoveredTypes = new Set();   // 悬停临时展开的标签 key 集合（key = m.id || m.type）
let _lockedTypes = new Set();    // 右键锁定展开的标签 key 集合

// 标签实例唯一 key：SOI 标签同 type 可出现多次（多次穿越），必须用实例 id 区分
function labelKey(m) {
    return m.id || m.type;
}

// SOI 标签图标（0.3.0 图标替换，纹理标准化流程：textureConfig → textureManager → <img>；
// 白色箭头正式素材为横向长图（450x207），按自然比例定宽显示，未加载时回退箭头字符）
function soiIconHtml(m, size) {
    if (m.type !== 'soi_exit' && m.type !== 'soi_entry') return '';
    const key = m.type === 'soi_exit' ? 'icon_soi_exit' : 'icon_soi_enter';
    const fallback = m.type === 'soi_exit' ? '↖' : '↗';
    const tex = textureManager.get(key);
    if (tex && tex.naturalWidth > 0 && tex.naturalHeight > 0) {
        const h = size || 16;
        // 长图按自然长宽比定宽（object-fit 方形 contain 会压成 ~7px 高，不可读）
        const w = Math.round(h * tex.naturalWidth / tex.naturalHeight);
        return '<img src="' + tex.src + '" style="width:' + w + 'px;height:' + h + 'px;vertical-align:middle;">';
    }
    return fallback;
}

function ensureContainer() {
    if (_container) return _container;
    _container = document.createElement('div');
    _container.id = 'orbitLabels';
    document.body.appendChild(_container);
    return _container;
}

// 展开判定：锁定 或 悬停 任一满足即展开
function isExpanded(key) {
    return _lockedTypes.has(key) || _hoveredTypes.has(key);
}

// 收起态 HTML：SOI 标签 = 纯图标（进入/离开箭头，天体名不再显示）；
// Ap/Pe 标签 = 纯名称
function buildCollapsedHTML(m) {
    // 0.3.0：SOI 收起标签图标缩至 21.6px（原 24 的 -10%）；宽度按素材自然比例
    const icon = soiIconHtml(m, 21.6);
    if (icon) {
        return icon;
    }
    return escapeHtml(m.label);
}

// 收起态指纹
function collapsedKey(m) {
    return (m.name || m.label) + '|' + m.type;
}

// 展开面板 HTML（行结构由 CSS 类控制颜色区分）：
//   [标题（SOI=纯图标 / Ap/Pe=中文全称，类型色）]
//   T-0年:0天:01时:16分:20秒   ← 距离到达（T- 倒计时，HUD 绿）
//   499,999 m / 正在离开 Mun   ← 高度行（Ap/Pe）或状态行（SOI 标签纯文字）
// 注意：本项目约定 innerHTML 不含 onclick 字符串（事件挂 body 本身，重建不丢）
function buildExpandedHTML(m) {
    const def = ORBIT_POINT_TYPES[m.type];
    const titleColor = def && def.color ? def.color : '';
    // 标题：SOI 标签纯图标（进入/离开箭头）；Ap/Pe 标签中文全称（无参数模板）
    const title = (def && m.name !== undefined)
        ? soiIconHtml(m, 16)
        : escapeHtml(t(def ? def.labelFullKey : m.label));

    let html = '<div class="olb-title"' + (titleColor ? ' style="color:' + titleColor + '"' : '') + '>' + title + '</div>';
    if (m.tToNext !== null && m.tToNext !== undefined) {
        html += '<div class="olb-t">T-' + formatGameDurationLong(m.tToNext) + '</div>';
    }
    // 状态行（SOI 标签）优先于高度行（Ap/Pe 标签）：纯文字"正在离开 X"/"正在遭遇 X"（不带图标）
    if (m.statusText) {
        html += '<div class="olb-alt">' + escapeHtml(m.statusText) + '</div>';
    } else {
        html += '<div class="olb-alt">' + formatMeters(m.altM) + '</div>';
    }
    return html;
}

// 展开面板内容指纹：内容变化时重建（每帧比对，未变不重建）
function expandedKey(m) {
    return m.type + '|' + (m.name || m.label) + '|' + (m.statusText || '') + '|'
        + (m.tToNext === null || m.tToNext === undefined ? 'n' : m.tToNext)
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
 *   [{ id, type, bodyX, bodyY, icon, label, value, tToNext, arrivalUt, statusText, isHover }]；
 *   id 为实例唯一标识（SOI 标签同 type 可出现多次），空数组/null 清空全部
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
        if (!markers.some(m => labelKey(m) === el.dataset.key)) el.remove();
    }

    for (const m of markers) {
        const def = ORBIT_POINT_TYPES[m.type];
        if (!def) continue;
        const key = labelKey(m);

        let el = container.querySelector('.orbit-label[data-key="' + key + '"]');
        if (!el) {
            el = document.createElement('div');
            el.className = 'orbit-label';
            el.dataset.key = key;
            const body = document.createElement('div');
            body.className = 'orbit-label-body';
            // 悬停临时展开 / 移开收起（锁定状态下移开不收起）
            body.addEventListener('mouseenter', () => _hoveredTypes.add(key));
            body.addEventListener('mouseleave', () => _hoveredTypes.delete(key));
            // 右键锁定展开（再右键解锁；拦截浏览器原生菜单；标签在 canvas 上层，
            // 右键事件不会落入 canvas 的 SAS/轨道处理，天然隔离）
            body.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (_lockedTypes.has(key)) {
                    _lockedTypes.delete(key);
                } else {
                    _lockedTypes.add(key);
                }
            });
            el.appendChild(body);
            container.appendChild(el);
        }

        const body = el.querySelector('.orbit-label-body');

        // 收起态：SOI 标签 = 图标+天体名 / Ap/Pe = 纯名称（innerHTML，指纹未变不重建）
        // 展开态：三行结构面板（指纹未变不重建，保持 DOM 稳定）
        if (isExpanded(key)) {
            const fp = expandedKey(m);
            if (body.dataset.expandedKey !== fp) {
                body.innerHTML = buildExpandedHTML(m);
                body.dataset.expandedKey = fp;
                delete body.dataset.collapsedKey;
            }
        } else {
            const ck = collapsedKey(m);
            if (body.dataset.collapsedKey !== ck) {
                body.innerHTML = buildCollapsedHTML(m);
                body.dataset.collapsedKey = ck;
                delete body.dataset.expandedKey;
            }
        }

        // 文字色 = 类型区分色（注册表单源，内联注入）；边框统一走 flight.css
        // 的 var(--toolbar-border)（= ORBIT_MARKER_COLOR，与 Canvas 锚点/折线一致）
        if (def.color) {
            body.style.color = def.color;
        }

        // 展开态样式标记（CSS 调整光标/内边距）
        el.classList.toggle('expanded', isExpanded(key));

        // 坐标同步：锚点偏移后的本体位置（fixed 容器 0,0 + transform 平移）
        el.style.transform = 'translate(' + Math.round(m.bodyX) + 'px,' + Math.round(m.bodyY) + 'px)';
        // 0.3.0：标签本体悬停高亮已去除（isHover 数据流保留，供未来交互使用）
    }
}
