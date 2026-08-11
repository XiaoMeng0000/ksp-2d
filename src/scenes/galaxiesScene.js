'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { solarSystemData, starSystemMeta } from '../config/solarSystem.js';

// ========== 样式常量（与游戏百科/制作人员面板风格统一） ==========
const PANEL_BG = 'rgba(0, 0, 0, 0.92)';
const ACCENT_COLOR = '#A04040';
const TEXT_MAIN = 'rgba(255, 255, 255, 0.92)';
const TEXT_BODY = '#999';       // 正文段落（与百科一致）
const TEXT_DIM = '#666';        // 数据小字
const CARD_BG = '#1e1e24';      // 卡片实色底
const CARD_BORDER = '#3a3a3a';  // 卡片边框
const FONT_MONO = 'monospace';

// 对比图绘制常量
const CHART_HEIGHT = 240;          // 对比图画布高度
const CHART_TEXTURE_SUFFIX = '_surface';  // 贴图 key 后缀：textureKey + '_surface'
const PLANET_MIN_SIZE = 10;        // 行星最小可见尺寸兜底（px，保证 Mun/Minmus 可见）
const PLANET_MAX_SIZE = 76;        // 最大行星绘制直径上限（px）
const PLANET_SPACING = 34;         // 相邻行星间距（px）
const STAR_OVERSCALE = 2.6;        // 恒星直径 = 画布高度 × 该倍数（远超画布，暗示塞不下）
const STAR_EXPOSE_RATIO = 0.45;    // 恒星露出宽度 = 画布高度 × 该倍数
const FADE_WIDTH = 36;             // 恒星右缘渐隐过渡带宽度（px）

function registerGalaxiesScene() {
    let panel = null;
    let escHandler = null;

    function _close() {
        sceneManager.switchTo('menu');
    }

    // 半径格式化：米 → km 整数
    function _formatRadius(radiusMeters) {
        return Math.round(radiusMeters / 1000) + ' km';
    }

    // 天体类型中文映射
    function _typeName(type) {
        const map = { star: '恒星', planet: '行星', moon: '卫星' };
        return map[type] || type;
    }

    // 绘制单个天体贴图（圆形裁切；贴图缺失时用颜色兜底）
    function _drawBodyImage(ctx, body, diameter, cx, cy) {
        const key = body.textureKey + CHART_TEXTURE_SUFFIX;
        const img = textureManager.get(key);
        const r = diameter / 2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();

        if (img) {
            ctx.drawImage(img, cx - r, cy - r, diameter, diameter);
        } else {
            ctx.fillStyle = body.color || '#888888';
            ctx.fillRect(cx - r, cy - r, diameter, diameter);
        }
        ctx.restore();
    }

    // 方案A：恒星"塞不下"裁切 + 行星等比排列 + 最小可见尺寸兜底
    function _drawComparisonChart(ctx, width, height, bodies) {
        ctx.clearRect(0, 0, width, height);

        const star = bodies.find(b => b.type === 'star') || null;
        const planets = bodies.filter(b => b.type !== 'star');

        // ===== 恒星：只绘制左侧边缘一段，视觉上溢出画布 =====
        if (star) {
            const starD = height * STAR_OVERSCALE;
            const exposed = height * STAR_EXPOSE_RATIO;
            const cx = -starD / 2 + exposed;
            const cy = height / 2;
            _drawBodyImage(ctx, star, starD, cx, cy);

            // 右缘平滑过渡：从透明渐变到卡片实色底
            const grad = ctx.createLinearGradient(exposed, 0, exposed + FADE_WIDTH, 0);
            grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
            grad.addColorStop(1, CARD_BG);
            ctx.fillStyle = grad;
            ctx.fillRect(exposed, 0, FADE_WIDTH, height);

            // 恒星名称标注（露出弧下方）
            ctx.fillStyle = '#ffcc44';
            ctx.font = '12px ' + FONT_MONO;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(star.name, 10, height - 10);
        }

        // ===== 行星/卫星：按真实相对半径等比排列 =====
        const rMax = planets.reduce((m, p) => Math.max(m, p.radius), 0);
        const maxD = Math.min(PLANET_MAX_SIZE, height * 0.40);

        let x = width * 0.40;
        for (const p of planets) {
            const d = Math.max(PLANET_MIN_SIZE, (p.radius / rMax) * maxD);
            const cx = x + d / 2;
            const cy = height / 2;
            _drawBodyImage(ctx, p, d, cx, cy);

            // 名称 + 半径标注
            ctx.fillStyle = TEXT_MAIN;
            ctx.font = '12px ' + FONT_MONO;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(p.name, cx, cy + d / 2 + 18);
            ctx.fillStyle = TEXT_DIM;
            ctx.fillText(_formatRadius(p.radius), cx, cy + d / 2 + 34);

            x += d + PLANET_SPACING;
        }
    }

    // 构建星系卡片：实色底，已加载天体放在卡片下侧可展开区域
    function _buildStarSystemCard(meta, chartWidth) {
        const card = document.createElement('div');
        card.style.cssText = ''
            + 'background:' + CARD_BG + ';'
            + 'border:1px solid ' + CARD_BORDER + ';'
            + 'border-radius:8px;'
            + 'margin-bottom:30px;'
            + 'padding:20px 20px 0 20px;';

        // 星系名标题
        const title = document.createElement('h2');
        title.textContent = meta.name;
        title.style.cssText = 'color:' + ACCENT_COLOR + ';font-family:' + FONT_MONO + ';font-size:22px;margin:0 0 16px 0;';
        card.appendChild(title);

        // ===== 对比图：星体大小对比（Canvas 动态绘制，方案A） =====
        const chart = document.createElement('canvas');
        chart.width = chartWidth;
        chart.height = CHART_HEIGHT;
        chart.style.cssText = 'width:100%;display:block;margin-bottom:20px;';
        const chartCtx = chart.getContext('2d');
        _drawComparisonChart(chartCtx, chart.width, chart.height, solarSystemData);
        card.appendChild(chart);

        // 描述（百科天体档案文风）
        const desc = document.createElement('p');
        desc.textContent = meta.description;
        desc.style.cssText = 'color:' + TEXT_BODY + ';font-family:' + FONT_MONO + ';font-size:13px;line-height:1.8;margin:0 0 12px 0;';
        card.appendChild(desc);

        // 已加载天体：可展开区域（展开时流式推挤下方卡片）
        card.appendChild(_buildCollapsibleBodies());

        return card;
    }

    // 可展开的"已加载天体"区域
    function _buildCollapsibleBodies() {
        const wrapper = document.createElement('div');

        const header = document.createElement('div');
        header.style.cssText = ''
            + 'display:flex;align-items:center;gap:8px;'
            + 'padding:14px 0;cursor:pointer;user-select:none;'
            + 'font-family:' + FONT_MONO + ';color:' + ACCENT_COLOR + ';font-size:14px;'
            + 'border-top:1px solid ' + CARD_BORDER + ';'
            + 'transition:background 0.15s ease;';
        header.textContent = '已加载天体 (' + solarSystemData.length + ')  ▸';

        const content = document.createElement('div');
        content.style.cssText = 'display:none;padding:4px 0 16px 0;';

        for (const body of solarSystemData) {
            content.appendChild(_buildBodyDataRow(body));
        }

        header.addEventListener('mouseenter', () => {
            header.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        header.addEventListener('mouseleave', () => {
            header.style.background = 'transparent';
        });
        header.addEventListener('click', () => {
            const expanded = content.style.display === 'block';
            content.style.display = expanded ? 'none' : 'block';
            header.textContent = '已加载天体 (' + solarSystemData.length + ')  ' + (expanded ? '▸' : '▾');
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);
        return wrapper;
    }

    // 单个天体的数据行：标题 + 数据小字（仅展示已加载信息，不放档案文案）
    function _buildBodyDataRow(body) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:12px;';

        const title = document.createElement('h3');
        title.textContent = body.name;
        title.style.cssText = 'color:' + ACCENT_COLOR + ';font-family:' + FONT_MONO + ';font-size:16px;margin:0 0 4px 0;';
        row.appendChild(title);

        const dataLine = document.createElement('div');
        dataLine.textContent = '类型: ' + _typeName(body.type)
            + ' · 半径: ' + _formatRadius(body.radius)
            + ' · 大气: ' + (body.hasAtmosphere ? '有' : '无');
        dataLine.style.cssText = 'color:' + TEXT_DIM + ';font-family:' + FONT_MONO + ';font-size:12px;';
        row.appendChild(dataLine);

        return row;
    }

    sceneManager.registerScene('galaxies', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'galaxiesPanel';
            panel.style.cssText = ''
                + 'position:fixed;inset:0;z-index:2000;'
                + 'background:' + PANEL_BG + ';backdrop-filter:blur(12px);'
                + 'display:flex;font-family:' + FONT_MONO + ';';

            // ========== 分割线 ==========
            const divider = document.createElement('div');
            divider.style.cssText = ''
                + 'width:1px;background:#333;'
                + 'align-self:stretch;flex-shrink:0;';

            // ========== 左侧 Logo 区 ==========
            const leftPanel = document.createElement('div');
            leftPanel.style.cssText = ''
                + 'width:280px;padding:0 40px;'
                + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
                + 'flex-shrink:0;';

            const logoContent = document.createElement('div');
            logoContent.style.cssText = 'text-align:center;';

            if (textureManager.isReady() && textureManager.get('title')) {
                const titleImg = document.createElement('img');
                titleImg.src = textureManager.get('title').src;
                titleImg.style.cssText = 'max-width:220px;';
                logoContent.appendChild(titleImg);
            } else {
                const titleFallback = document.createElement('div');
                titleFallback.textContent = 'KSP 2D';
                titleFallback.style.cssText = 'color:' + ACCENT_COLOR + ';font-family:' + FONT_MONO + ';font-size:36px;';
                logoContent.appendChild(titleFallback);
            }

            leftPanel.appendChild(logoContent);

            // 返回按钮 — 左下角固定
            const backBtn = document.createElement('button');
            backBtn.textContent = '返回';
            backBtn.style.cssText = ''
                + 'position:absolute;bottom:40px;left:40px;'
                + 'padding:10px 36px;'
                + 'background:rgba(30,30,30,0.8);color:white;'
                + 'border:1px solid ' + ACCENT_COLOR + ';border-radius:4px;'
                + 'font-family:' + FONT_MONO + ';font-size:14px;'
                + 'cursor:pointer;transition:all 0.2s ease;';
            backBtn.addEventListener('mouseenter', () => {
                backBtn.style.background = '#2a2a2a';
                backBtn.style.borderColor = '#c05050';
            });
            backBtn.addEventListener('mouseleave', () => {
                backBtn.style.background = 'rgba(30,30,30,0.8)';
                backBtn.style.borderColor = ACCENT_COLOR;
            });
            backBtn.addEventListener('click', () => {
                _close();
            });
            panel.appendChild(backBtn);

            // ========== 右侧内容区（垂直滚动） ==========
            const rightPanel = document.createElement('div');
            rightPanel.style.cssText = ''
                + 'flex:1;padding:0 60px 0 40px;'
                + 'overflow-y:auto;';

            const contentWrapper = document.createElement('div');
            contentWrapper.style.cssText = 'width:100%;padding:60px 0;';

            panel.appendChild(leftPanel);
            panel.appendChild(divider);
            panel.appendChild(rightPanel);
            document.body.appendChild(panel);

            // 对比图画布宽度跟随内容区实际可用宽度
            const chartWidth = Math.max(320, rightPanel.clientWidth - 40);

            for (const meta of starSystemMeta) {
                if (!meta.enabled) {
                    continue;
                }
                contentWrapper.appendChild(_buildStarSystemCard(meta, chartWidth));
            }

            // 底部统计
            const stat = document.createElement('div');
            stat.textContent = '// 已加载 ' + starSystemMeta.length + ' 个星系 · ' + solarSystemData.length + ' 个天体';
            stat.style.cssText = 'color:' + TEXT_DIM + ';font-family:' + FONT_MONO + ';font-size:13px;text-align:center;padding:10px 0 20px 0;';
            contentWrapper.appendChild(stat);

            rightPanel.appendChild(contentWrapper);

            escHandler = (event) => {
                if (event.key === 'Escape') {
                    _close();
                }
            };
            document.addEventListener('keydown', escHandler);
        },

        exit() {
            if (escHandler) {
                document.removeEventListener('keydown', escHandler);
                escHandler = null;
            }
            if (panel && panel.parentNode) {
                panel.parentNode.removeChild(panel);
            }
            panel = null;
        }
    });
}

export { registerGalaxiesScene };
