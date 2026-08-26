'use strict';

import { sceneManager } from '../sceneManager.js';
import { textureManager } from '../graphics/textureManager.js';
import { solarSystemData, starSystemMeta } from '../config/starSystemIndex.js';
import { t } from '../config/strings.js';

// ========== 样式常量（Canvas 绘制用；色值与 CSS 变量保持一致）
// 注意：Canvas 无法读取 CSS 变量，此处实色为 --theme-bg / --ut-gold / --text-* 的对应值 ==========
const TEXT_MAIN = 'rgba(255, 255, 255, 0.92)';
const TEXT_DIM = '#666';        // 数据小字（--text-dim）
const CARD_BG = '#2e3540';      // 卡片实色底（--theme-bg，恒星渐隐落到卡上）
const STAR_LABEL = '#d4c86a';   // 恒星名称标注（--ut-gold）
const FONT_MONO = 'monospace';

// 对比图绘制常量
const CHART_HEIGHT_BASE = 260;     // 对比图画布基础高度（行星中轴 + 上下留白 + 卫星区）
const SAT_VSTEP = 30;              // 卫星垂直排列步长（直径 + 名称标注 + 间隙）
const CHART_TEXTURE_SUFFIX = '_surface';  // 贴图 key 后缀：textureKey + '_surface'
const PLANET_MIN_SIZE = 26;        // 行星最小直径（px，对数刻度下限，保证小行星可见）
const PLANET_MAX_SIZE = 84;        // 行星最大直径上限（px，对数刻度上限，受画布高度限制）
const PLANET_SPACING = 40;         // 相邻行星间距（px）
const SAT_MIN_SIZE = 14;           // 卫星最小直径（px，保证 Jool 小卫星可见）
const SAT_REL_SCALE = 0.6;         // 卫星直径相对母行星的额外缩放（层级区分）
const SAT_GAP = 30;                // 行星下缘到第一颗卫星的间隙（px）
const STAR_OVERSCALE = 2.6;        // 恒星直径 = 画布高度 × 该倍数（远超画布，暗示塞不下）
const STAR_EXPOSE_RATIO = 0.32;    // 恒星露出宽度 = 画布高度 × 该倍数（更靠左，不侵占行星区）
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
        const map = { star: t('galaxies.star'), planet: t('galaxies.planet'), moon: t('galaxies.moon') };
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

    // 方案A：恒星"塞不下"裁切 + 行星/卫星层级分组排列（行星一行，卫星跟母行星下方）
    function _drawComparisonChart(ctx, width, height, bodies) {
        ctx.clearRect(0, 0, width, height);

        const star = bodies.find(b => b.type === 'star') || null;
        const planets = bodies.filter(b => b.type === 'planet');

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
            ctx.fillStyle = STAR_LABEL;
            ctx.font = '12px ' + FONT_MONO;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(star.name, 10, height - 10);
        }

        // ===== 行星 + 卫星：层级分组排列 =====
        // 行星位于画布水平中轴线上；卫星按相对半径等比缩小，垂直竖排在母行星正下方。
        // 行星直径采用对数刻度（log 插值）：避免 Jool 的巨半径压扁中小行星，
        // 使 Moho/Dres/Eeloo 等小天体与 Kerbin/Eve 等中型行星都保持可读尺寸。
        const radii = planets.map(p => p.radius);
        const rMin = Math.min(...radii);
        const rMax = Math.max(...radii);
        const logSpan = Math.log(rMax / rMin);
        const maxD = Math.min(PLANET_MAX_SIZE, height * 0.40);

        // 预计算每列：行星直径 + 卫星尺寸（卫星垂直排列，不占横向宽度）
        const cols = planets.map(p => {
            const t = logSpan > 0 ? Math.log(p.radius / rMin) / logSpan : 0;
            const d = PLANET_MIN_SIZE + (maxD - PLANET_MIN_SIZE) * t;
            const sats = bodies.filter(b => b.orbitParent === p.name);
            const satSizes = sats.map(s =>
                Math.max(SAT_MIN_SIZE, (s.radius / p.radius) * d * SAT_REL_SCALE)
            );
            return { p, d, sats, satSizes };
        });

        // 行星区总宽（直径 + 间距）：紧贴恒星露出区右侧排列，与恒星留出间距
        const totalW = cols.reduce((s, c) => s + c.d, 0) + (cols.length - 1) * PLANET_SPACING;
        const starExposed = star ? height * STAR_EXPOSE_RATIO : 0;
        let x = starExposed + 110;   // 行星区起点：恒星露出区右侧留出 110px
        const planetCy = height * 0.5;   // 行星水平中轴线

        for (const col of cols) {
            const cx = x + col.d / 2;

            // 行星（母天体，位于水平中轴）
            _drawBodyImage(ctx, col.p, col.d, cx, planetCy);
            ctx.fillStyle = TEXT_MAIN;
            ctx.font = '12px ' + FONT_MONO;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            // 名称标注在行星上方，避免与下方卫星区重叠
            ctx.fillText(col.p.name, cx, planetCy - col.d / 2 - 12);
            ctx.fillStyle = TEXT_DIM;
            ctx.fillText(_formatRadius(col.p.radius), cx, planetCy + col.d / 2 + 16);

            // 卫星：垂直竖排在母行星正下方
            let sy = planetCy + col.d / 2 + SAT_GAP;
            for (let i = 0; i < col.sats.length; i++) {
                const sat = col.sats[i];
                const sd = col.satSizes[i];
                _drawBodyImage(ctx, sat, sd, cx, sy);
                ctx.fillStyle = TEXT_DIM;
                ctx.fillText(sat.name, cx, sy + sd / 2 + 12);
                sy += SAT_VSTEP;
            }

            x += col.d + PLANET_SPACING;
        }
    }

    // 占位星系：绘制"无数星光中一颗突出的亮点"效果（无真实天体数据，仅视觉占位）
    function _drawPlaceholderStar(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);

        // ===== 背景：大量暗淡小星点（伪随机固定分布，每次渲染一致） =====
        for (let i = 0; i < 130; i++) {
            const px = ((i * 137 + 371) % 997) / 997 * width;
            const py = ((i * 251 + 619) % 991) / 991 * height;
            const pr = 0.4 + ((i * 31) % 10) / 10 * 0.9;
            const a = 0.12 + ((i * 17) % 40) / 100;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
            ctx.fill();
        }

        const cx = width / 2;
        const cy = height * 0.42;

        // ===== 中心亮点：小核心 + 柔和光晕（小而亮，不放大） =====
        const coreR = 4.5;
        const glowR = 30;
        const glow = ctx.createRadialGradient(cx, cy, coreR * 0.4, cx, cy, glowR);
        glow.addColorStop(0, 'rgba(255, 245, 220, 0.55)');
        glow.addColorStop(0.35, 'rgba(255, 225, 170, 0.18)');
        glow.addColorStop(1, 'rgba(255, 225, 170, 0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
        ctx.restore();

        // ===== 亮核（中心最亮） =====
        const core = ctx.createRadialGradient(cx - 1, cy - 1, 0, cx, cy, coreR);
        core.addColorStop(0, 'rgba(255, 255, 255, 1)');
        core.addColorStop(0.6, 'rgba(255, 244, 220, 0.95)');
        core.addColorStop(1, 'rgba(255, 230, 185, 0.7)');
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.fill();

        // 底部提示文字
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = TEXT_DIM;
        ctx.font = '12px ' + FONT_MONO;
        ctx.fillText(t('galaxies.notOpen'), cx, height - 22);
    }

    // 构建星系卡片：蓝灰卡壳（框住）+ 紫头 + 深色二级背景卡体（与设施分组卡同构）
    function _buildStarSystemCard(meta, chartWidth) {
        const card = document.createElement('div');
        card.className = 'galaxies-card';

        // 星系名标题（紫头顶条）
        const title = document.createElement('h2');
        title.textContent = meta.name;
        title.className = 'galaxies-card-title';
        card.appendChild(title);

        // 二级背景卡体：chart / 描述 / 已加载天体 全部落于此（被蓝灰卡壳"框住"）
        const body = document.createElement('div');
        body.className = 'galaxies-card-body';
        card.appendChild(body);

        // ===== 占位星系：占位恒星图；正常星系：天体大小对比图 =====
        if (meta.placeholder) {
            // 占位星系：无真实天体数据，绘制遥远的恒星光点效果
            const chart = document.createElement('canvas');
            chart.width = chartWidth;
            chart.height = 160;
            chart.className = 'galaxies-chart';
            const chartCtx = chart.getContext('2d');
            _drawPlaceholderStar(chartCtx, chart.width, chart.height);
            body.appendChild(chart);
        } else {
            // 正常星系：星体大小对比（Canvas 动态绘制，方案A）
            // 高度随最大卫星数增长（行星中轴 + 卫星垂直竖排）
            const maxSatCount = solarSystemData.reduce((m, b) => {
                const n = solarSystemData.filter(x => x.orbitParent === b.name).length;
                return Math.max(m, n);
            }, 0);
            const chart = document.createElement('canvas');
            chart.width = chartWidth;
            chart.height = CHART_HEIGHT_BASE + maxSatCount * SAT_VSTEP;
            chart.className = 'galaxies-chart';
            const chartCtx = chart.getContext('2d');
            _drawComparisonChart(chartCtx, chart.width, chart.height, solarSystemData);
            body.appendChild(chart);
        }

        // 描述（百科天体档案文风）
        const desc = document.createElement('p');
        desc.textContent = meta.description;
        desc.className = 'galaxies-desc';
        body.appendChild(desc);

        // 已加载天体：可展开区域（展开时流式推挤下方卡片）
        body.appendChild(_buildCollapsibleBodies(meta));

        return card;
    }

    // 可展开的"已加载天体"区域（占位星系显示 0 与占位文案）
    function _buildCollapsibleBodies(meta) {
        const wrapper = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'galaxies-collapse-header';

        const bodyCount = (meta && meta.placeholder) ? 0 : solarSystemData.length;
        header.textContent = t('galaxies.loadedBodies', { n: bodyCount, arrow: '▸' });

        const content = document.createElement('div');
        content.className = 'galaxies-collapse-content';

        if (meta && meta.placeholder) {
            const empty = document.createElement('div');
            empty.textContent = t('galaxies.noBodies');
            empty.className = 'galaxies-empty';
            content.appendChild(empty);
        } else {
            for (const body of solarSystemData) {
                content.appendChild(_buildBodyDataRow(body));
            }
        }

        header.addEventListener('click', () => {
            const expanded = content.style.display === 'block';
            content.style.display = expanded ? 'none' : 'block';
            header.textContent = t('galaxies.loadedBodies', { n: bodyCount, arrow: (expanded ? '▸' : '▾') });
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);
        return wrapper;
    }

    // 单个天体的数据行：标题 + 数据小字（仅展示已加载信息，不放档案文案）
    function _buildBodyDataRow(body) {
        const row = document.createElement('div');
        row.className = 'galaxies-row';

        const title = document.createElement('h3');
        title.textContent = body.name;
        title.className = 'galaxies-row-title';
        row.appendChild(title);

        const dataLine = document.createElement('div');
        dataLine.textContent = t('galaxies.typeLabel') + _typeName(body.type)
            + t('galaxies.radiusLabel') + _formatRadius(body.radius)
            + t('galaxies.atmosphereLabel') + (body.hasAtmosphere ? t('galaxies.hasAtmosphere') : t('galaxies.noAtmosphere'));
        dataLine.className = 'galaxies-row-data';
        row.appendChild(dataLine);

        return row;
    }

    sceneManager.registerScene('galaxies', {
        enter() {
            panel = document.createElement('div');
            panel.id = 'galaxiesPanel';
            panel.className = 'scene-fullscreen';

            // ========== 顶栏：返回按钮 + 标题 ==========
            const topBar = document.createElement('div');
            topBar.className = 'galaxies-topbar';

            const backBtn = document.createElement('button');
            backBtn.textContent = t('galaxies.back');
            backBtn.className = 'galaxies-back-btn';
            backBtn.addEventListener('click', () => {
                _close();
            });
            topBar.appendChild(backBtn);

            const topTitle = document.createElement('span');
            topTitle.textContent = t('galaxies.title');
            topTitle.className = 'galaxies-title';
            topBar.appendChild(topTitle);

            panel.appendChild(topBar);

            // ========== 内容滚动区（全宽，卡片横向展开） ==========
            const scrollArea = document.createElement('div');
            scrollArea.className = 'galaxies-scroll';

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'galaxies-content';

            scrollArea.appendChild(contentWrapper);
            panel.appendChild(scrollArea);
            document.body.appendChild(panel);

            // 对比图画布宽度跟随内容区实际可用宽度（全宽布局下大幅加宽）
            const chartWidth = Math.max(560, contentWrapper.clientWidth);

            for (const meta of starSystemMeta) {
                if (!meta.enabled) {
                    continue;
                }
                contentWrapper.appendChild(_buildStarSystemCard(meta, chartWidth));
            }

            // 底部统计
            const stat = document.createElement('div');
            stat.textContent = t('galaxies.summary', { galaxies: starSystemMeta.length, bodies: solarSystemData.length });
            stat.className = 'galaxies-stat';
            contentWrapper.appendChild(stat);

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
