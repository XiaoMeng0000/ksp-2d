'use strict';

// 轨道机动视图规划面板（0.2.5）— 右侧悬浮纵板
//   上块：局部放大图（1:1 正方形；纯线 / 轨道绿 / 信息化作战 HUD 风；动态缩放）
//   下块：机动节点详细修改（聚焦天体下拉 / 四向 Δv 步进 / 节点时刻 / 按周期平移 / 计划读数）
// 交互：
//   · 图内可拖节点（沿轨道改时间）与四向手柄（改 Δv 分量），与下方数值双向联动
//   · 动态缩放规则（总监定稿）：参照半径 R = 当前轨道在 SOI 内的最大半径；
//     绘满绘图区（板块面积 3/4）；逃逸/超 SOI → R 退化为 SOI 半径（"极限缩到 SOI 程度"）
//   · 图内仍按 SOI 截断（超出 SOI 的段被裁掉）
// 数据来源：渲染层本帧缓存（getLastOrbitSegments / getLastManeuverPrediction），UI 不直连物理

import { t } from '../config/ui/strings.js';
import { flightView } from '../flightView.js';
import { maneuverSystem } from '../ship/maneuverSystem.js';
import { shipSystem } from '../ship/shipSystem.js';
import { getLastOrbitSegments, getLastManeuverPrediction, getLastManeuverNodes } from '../renderer.js';
import { celestialBodies, getSOIHost, getAbsolutePosition } from '../physics/physics.js';
import { getOrbitalDirectionAngles } from '../physics/orbitalMechanics.js';
import { walkToTime, getNodeOrbitPeriod } from '../physics/maneuverPrediction.js';
import { getCachedTime, bodyFuturePos } from '../physics/orbitalPrediction.js';
import { computeDeltaV } from '../resources/resourceSystem.js';
import { formatTCountdown } from '../utils/format.js';
import { MANEUVER_CONFIG } from '../config/gameplay/maneuverConfig.js';
import { VIEW_CONFIG } from '../config/gameplay/viewConfig.js';
import { timeWarp } from '../timeWarp.js';

// ===== 模块状态 =====
let _panel = null;
let _canvas = null;         // 主画布（view 切换/聚焦用）
let _insetCanvas = null;    // 放大图画布
let _insetCtx = null;
let _els = {};              // 动态读数元素引用
let _initialized = false;
let _hit = null;            // 本帧绘制产出的命中几何（节点/手柄位置）
let _drag = null;           // { mode:'node' } | { mode:'dv', axis, startClientX, startClientY, dist, axes }
let _focusOpen = false;     // 聚焦下拉是否展开
let _focusSig = '';         // 聚焦列表内容签名（层级+名称+当前聚焦）——未变化则不重建
let _lastTickTs = 0;        // 速率制 Δv 累积用的上一帧时间戳

// ===== 性能相关缓存（0.2.5：Kerbolar 系（天体多/轨道大）机动视图掉帧优化）=====
// ① 放大图重绘与读数刷新节流（30fps 足够；速率制 Δv 累积仍逐帧执行，不受影响）
// ② 布局矩形缓存（getBoundingClientRect 会强制重排，逐帧读取代价高）
// ③ 读数文本去重（innerHTML 赋值较贵，值未变则不写）
let _lastHeavyTs = 0;       // 上次重绘放大图/刷新读数的时间戳
let _rectCache = { t: 0, canvas: null, bar: null, card: null, scaleK: 1 };
let _readoutCache = { tl: '', tr: '', bl: '', br: '' };
let _refCache = { segs: null, hostName: null, R: 0 };
const HEAVY_INTERVAL_MS = 33;    // 放大图/读数刷新间隔（≈30fps）
const RECT_TTL_MS = 300;         // 布局矩形缓存有效期

// 步进档位（可后续挪配置；当前为面板专用）
const DV_STEP = 0.1;        // 四向 Δv 步进（m/s）
const TIME_STEP_BIG = 10;   // 节点时刻大步进（秒）
const TIME_STEP_SMALL = 1;  // 节点时刻小步进（秒）

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

// 布局矩形缓存（避免逐帧 getBoundingClientRect 强制重排）；窗口尺寸变化时失效
function getRects(force) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!force && _rectCache.canvas && (now - _rectCache.t) < RECT_TTL_MS) return _rectCache;
    const cardEl = _panel ? _panel.querySelector('.maneuver-card') : null;
    const barEl = _panel ? _panel.querySelector('.maneuver-bar-wrap') : null;
    const cvRect = _insetCanvas ? _insetCanvas.getBoundingClientRect() : null;
    _rectCache = {
        t: now,
        canvas: cvRect,
        bar: barEl ? barEl.getBoundingClientRect() : null,
        card: cardEl ? cardEl.getBoundingClientRect() : null,
        scaleK: cvRect ? Math.max(0.5, Math.min(1, Math.min(cvRect.width, cvRect.height) / 400)) : 1
    };
    return _rectCache;
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => { _rectCache.canvas = null; });
}

// ===== DOM 构建（懒初始化） =====
function ensureDom() {
    if (_initialized) return;

    _panel = el('div');
    _panel.id = 'maneuverViewPanel';
    _panel.style.display = 'none';

    // 头
    const header = el('div', 'mvp-header');
    header.appendChild(el('div', 'mvp-title', t('mvp.title')));
    header.appendChild(el('div', 'mvp-header-line'));
    header.appendChild(el('div', 'mvp-header-mode', 'MANEUVER'));
    _panel.appendChild(header);

    // 上块：局部放大图（1:1）
    const inset = el('div', 'mvp-inset');
    for (const c of ['tl', 'tr', 'bl', 'br']) inset.appendChild(el('span', 'mvp-corner ' + c));
    inset.appendChild(el('div', 'mvp-ruler-x'));
    inset.appendChild(el('div', 'mvp-ruler-y'));
    const plot = el('div', 'mvp-inset-plot');
    _insetCanvas = document.createElement('canvas');
    _insetCanvas.className = 'mvp-inset-canvas';
    plot.appendChild(_insetCanvas);
    inset.appendChild(plot);
    _els.readoutTL = el('div', 'mvp-readout tl');
    _els.readoutTR = el('div', 'mvp-readout tr');
    _els.readoutBL = el('div', 'mvp-readout bl');
    _els.readoutBR = el('div', 'mvp-readout br');
    inset.appendChild(_els.readoutTL);
    inset.appendChild(_els.readoutTR);
    inset.appendChild(_els.readoutBL);
    inset.appendChild(_els.readoutBR);
    _panel.appendChild(inset);
    _insetCtx = _insetCanvas.getContext('2d');

    // 下块：详情编辑
    const editor = el('div', 'mvp-editor');

    // —— 聚焦天体（圆点触发 + 层级列表）
    const focusSec = el('div', 'mvp-section');
    focusSec.appendChild(el('div', 'mvp-section-label', t('mvp.focusLabel')));
    const trigger = el('div', 'mvp-focus-trigger');
    trigger.appendChild(el('span', 'mvp-focus-dot'));
    _els.focusName = el('span', 'mvp-focus-name', '--');
    trigger.appendChild(_els.focusName);
    trigger.appendChild(el('span', 'mvp-focus-caret', '▾'));
    trigger.addEventListener('click', () => { _focusOpen = !_focusOpen; });
    focusSec.appendChild(trigger);
    _els.focusList = el('div', 'mvp-focus-list');
    _els.focusList.style.display = 'none';
    // 事件委托：列表项会随数据变化重建，处理器必须挂在**持久容器**上——
    // 否则"鼠标按下 → 抬起"之间元素被换掉，click 事件落不到项上（表现为"点不动"）
    _els.focusList.addEventListener('click', (e) => {
        const item = e.target && e.target.closest ? e.target.closest('.mvp-focus-item') : null;
        if (!item) return;
        const name = item.getAttribute('data-body');
        if (!name) return;
        flightView.setFocusByName(name, _canvas);
        _focusOpen = false;
    });
    focusSec.appendChild(_els.focusList);
    editor.appendChild(focusSec);

    // 点击面板外任意处 → 收起下拉 / 关闭轨道点菜单
    window.addEventListener('pointerdown', (e) => {
        const inMenu = _nodeMenu && _nodeMenu.el && e.target && _nodeMenu.el.contains(e.target);
        if (_nodeMenu && !inMenu) closeNodeMenu();
        if (!_focusOpen) return;
        const sec = _els.focusList ? _els.focusList.parentElement : null;
        if (sec && e.target && sec.contains(e.target)) return;
        _focusOpen = false;
    }, true);

    // —— 四向 Δv（− 数值 +）
    const dvSec = el('div', 'mvp-section');
    dvSec.appendChild(el('div', 'mvp-section-label', t('mvp.dvLabel')));
    const rows = [
        { key: 'pro', sign: 1, axisKey: 'pro', label: t('mvp.dvPro') },
        { key: 'retro', sign: -1, axisKey: 'retro', label: t('mvp.dvRetro') },
        { key: 'radIn', sign: -1, axisKey: 'radIn', label: t('mvp.dvRadIn') },
        { key: 'radOut', sign: 1, axisKey: 'radOut', label: t('mvp.dvRadOut') }
    ];
    _els.dvRows = {};
    for (const r of rows) {
        const row = el('div', 'mvp-dv-row');
        row.appendChild(el('span', 'mvp-dv-label', r.label));
        const group = el('span', 'mvp-dv-group');
        const minus = el('span', 'mvp-step', '−');
        const value = el('span', 'mvp-dv-value', '0.0');
        const unit = el('span', 'mvp-dv-unit', 'm/s');
        const plus = el('span', 'mvp-step', '+');
        // 该行分量 = sign × 分量值；＋ 按钮 → 分量 += sign×step；− 按钮 → 分量 −= sign×step
        minus.addEventListener('click', () => applyDvStep(r, false));
        plus.addEventListener('click', () => applyDvStep(r, true));
        group.appendChild(minus);
        group.appendChild(value);
        group.appendChild(unit);
        group.appendChild(plus);
        row.appendChild(group);
        dvSec.appendChild(row);
        _els.dvRows[r.key] = { value, rowDef: r };
    }
    editor.appendChild(dvSec);

    // —— 节点时刻 / 按周期平移
    const timeSec = el('div', 'mvp-section');
    timeSec.appendChild(el('div', 'mvp-section-label', t('mvp.timeLabel')));
    const timeRow = el('div', 'mvp-time-row');
    timeRow.appendChild(el('span', 'mvp-time-label', 'T−'));
    _els.timeValue = el('span', 'mvp-time-value', '--');
    timeRow.appendChild(_els.timeValue);
    const tMinus = el('span', 'mvp-step', '−');
    const tPlus = el('span', 'mvp-step', '+');
    tMinus.addEventListener('click', () => stepNodeTime(-TIME_STEP_SMALL));
    tPlus.addEventListener('click', () => stepNodeTime(TIME_STEP_SMALL));
    timeRow.appendChild(tMinus);
    timeRow.appendChild(tPlus);
    _els.utInput = document.createElement('input');
    _els.utInput.className = 'mvp-input';
    _els.utInput.spellcheck = false;
    _els.utInput.placeholder = 'UT 秒';
    _els.utInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyUtInput();
    });
    timeRow.appendChild(_els.utInput);
    timeSec.appendChild(timeRow);

    const periodRow = el('div', 'mvp-time-row');
    periodRow.style.marginTop = '4px';
    periodRow.appendChild(el('span', 'mvp-time-label', t('mvp.periodLabel')));
    for (const frac of [-1, -0.1, 0.1, 1]) {
        const b = el('span', 'mvp-btn-wide', (frac > 0 ? '+' : '−') + Math.abs(frac) + ' ' + t('mvp.periodUnit'));
        b.addEventListener('click', () => shiftNodeByPeriod(frac));
        periodRow.appendChild(b);
    }
    timeSec.appendChild(periodRow);
    editor.appendChild(timeSec);

    // —— 计划读数
    const planSec = el('div', 'mvp-section');
    planSec.style.marginBottom = '0';
    const planRow = el('div', 'mvp-time-row');
    planRow.appendChild(el('span', 'mvp-time-label', t('mvp.planDv')));
    _els.planValue = el('span', 'mvp-time-value', '--');
    planRow.appendChild(_els.planValue);
    planSec.appendChild(planRow);
    const fuelRow = el('div', 'mvp-time-row');
    fuelRow.appendChild(el('span', 'mvp-time-label', t('mvp.fuelMargin')));
    _els.fuelValue = el('span', 'mvp-time-value', '--');
    fuelRow.appendChild(_els.fuelValue);
    planSec.appendChild(fuelRow);
    editor.appendChild(planSec);

    _panel.appendChild(editor);
    document.body.appendChild(_panel);

    // 图内交互：节点 / 四向手柄
    _insetCanvas.addEventListener('pointerdown', onInsetPointerDown);
    _insetCanvas.addEventListener('click', onInsetClick);
    _insetCanvas.addEventListener('pointermove', onInsetHover);
    _insetCanvas.addEventListener('pointerleave', onInsetLeave);
    window.addEventListener('pointermove', onInsetPointerMove);
    window.addEventListener('pointerup', onInsetPointerUp);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeNodeMenu();
            _focusOpen = false;
        }
    });

    _initialized = true;
}

// ===== 编辑动作 =====

// 四向 Δv 步进（与手柄/图内拖拽共用 updateNodeDeltaV：写分量 + 重建世界矢量）
function applyDvStep(rowDef, plus) {
    const ship = getShip();
    if (!ship) return;
    const pred = getLastManeuverPrediction();
    const axes = pred && pred.plan ? pred.plan.axes : null;
    if (!axes) return;
    const amount = (plus ? 1 : -1) * rowDef.sign * DV_STEP;
    maneuverSystem.updateNodeDeltaV(ship, rowDef.axisKey, amount, axes);
}

// 节点时刻步进（纯时间编辑，解析传播）
function stepNodeTime(deltaSec) {
    const ship = getShip();
    if (!ship) return;
    const node = maneuverSystem.getNode(ship);
    if (!node) return;
    maneuverSystem.updateNodeTimeByTime(ship, node.time + deltaSec);
}

// 按周期平移（±1 圈 / ±0.1 圈）：整圈平移不改变局部几何，只扫转移窗口
function shiftNodeByPeriod(frac) {
    const ship = getShip();
    if (!ship) return;
    const node = maneuverSystem.getNode(ship);
    if (!node) return;
    const period = getNodeOrbitPeriod(node);
    if (!period) return;                     // 逃逸轨道无周期 → 不可用
    maneuverSystem.updateNodeTimeByTime(ship, node.time + period * frac);
}

// UT 输入（支持 "秒" 或 "D:H:M:S" 紧凑格式）
function applyUtInput() {
    const ship = getShip();
    if (!ship) return;
    const node = maneuverSystem.getNode(ship);
    if (!node || !_els.utInput) return;
    const raw = String(_els.utInput.value || '').trim().replace(/^UT/i, '').trim();
    let sec = null;
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
        sec = parseFloat(raw);
    } else if (/^\d+(:\d+){1,3}$/.test(raw)) {
        const parts = raw.split(':').map(Number);
        sec = parts.reduce((acc, v) => acc * 60 + v, 0);
    }
    if (sec === null || !isFinite(sec)) return;
    maneuverSystem.updateNodeTimeByTime(ship, sec);
}

function getShip() {
    return shipSystem.getActiveShip();
}

// ===== 放大图内轨道点菜单（HUD 风格；总监定稿：**仅**"创建机动节点"一项，0.2.5）=====
// 与主视图轨道菜单同语义（冻结节点时刻速度快照 → maneuverSystem.createNode），
// 但样式走面板 HUD 风格（黑底 / 轨道绿细线 / 等宽小字），且只提供创建节点一个动作。
let _nodeMenu = null;        // { el, data }
let _dragMoved = false;      // 本次拖拽是否发生过位移（用于忽略拖拽末尾的那次 click）
let _hover = null;           // 放大图悬停点 { x, y, absTime }（HUD 悬停标记 + 指针图标用）

// 悬停反馈（0.2.5）：手柄/节点 = grab（可拖拽）；轨道线 = pointer（可点出轨道点菜单）；
// 其余 = default。拖拽中切换为 grabbing。仅在变化时写 style.cursor（避免逐帧样式写入）。
function onInsetHover(e) {
    if (!_insetCanvas) return;
    if (_drag) {
        if (_insetCanvas.style.cursor !== 'grabbing') _insetCanvas.style.cursor = 'grabbing';
        return;
    }
    const p = toInsetLocal(e);
    let cursor = 'default';
    let hover = null;

    if (_hit) {
        for (const axis of ['pro', 'retro', 'radIn', 'radOut']) {
            const h = _hit.handles[axis];
            if (h && Math.hypot(p.x - h.x, p.y - h.y) <= MANEUVER_CONFIG.handleHitRadius) {
                cursor = 'grab';
                break;
            }
        }
        if (cursor === 'default' && _hit.nodes) {
            for (const n of _hit.nodes) {
                if (Math.hypot(p.x - n.x, p.y - n.y) <= MANEUVER_CONFIG.nodeHitRadius) {
                    cursor = 'grab';
                    break;
                }
            }
        }
    }

    if (cursor === 'default') {
        const ship = getShip();
        const host = ship && ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
        // 指针提示同样只给"链尾"：其他链不接受建点（严格线性链），故不显示可点击光标
        const tip = tipChain();
        if (host && tip) {
            const near = nearestOrbitPointInInset([tip], p, host, 24);
            if (near) {
                cursor = 'pointer';
                hover = { x: p.x, y: p.y, absTime: near.absTime };
            }
        }
    }

    _hover = hover;
    if (_insetCanvas.style.cursor !== cursor) _insetCanvas.style.cursor = cursor;
}

function onInsetLeave() {
    _hover = null;
    if (_insetCanvas && _insetCanvas.style.cursor !== 'default') _insetCanvas.style.cursor = 'default';
}

function closeNodeMenu() {
    if (!_nodeMenu) return;
    if (_nodeMenu.el && _nodeMenu.el.parentNode) _nodeMenu.el.parentNode.removeChild(_nodeMenu.el);
    _nodeMenu = null;
}

function openNodeMenu(clientX, clientY, data, ship) {
    closeNodeMenu();
    const menu = el('div', 'mvp-menu');
    const remain = Math.max(0, data.absTime - getCachedTime());
    menu.appendChild(el('div', 'mvp-menu-title',
        'T-' + formatTCountdown(remain) + t('mvp.menuTitleSuffix')));

    // 多节点（0.2.6）：允许创建多个节点，因此该项不再因"已有节点"禁用；
    // 执行目标（SAS/定点加速）始终指向下一个未完成节点
    const item = el('div', 'mvp-menu-item', '+ ' + t('mvp.createNode'));
    item.addEventListener('click', () => {
        const result = maneuverSystem.createNode(ship, {
            time: data.absTime,
            relX: data.relX,
            relY: data.relY,
            anchorBody: data.anchorBody,
            velRel: data.relVel
        });
        if (typeof window.showNotification === 'function') {
            if (result && result.ok) window.showNotification(t('maneuver.created'), 'success');
            else if (result && result.reason === 'exists') window.showNotification(t('maneuver.alreadyExists'), 'warning');
            else window.showNotification(t('maneuver.createFailed'), 'warning');
        }
        closeNodeMenu();
    });
    menu.appendChild(item);

    document.body.appendChild(menu);
    // 定位：点击处；越界回收进视口（菜单为 fixed，坐标即 client 坐标）
    const r = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(clientX, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(clientY, window.innerHeight - r.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    _nodeMenu = { el: menu, data };
}

// 放大图内点击：命中轨道（未拖拽）→ 打开轨道点菜单
function onInsetClick(e) {
    if (_drag || _dragMoved) {
        _dragMoved = false;
        return;
    }
    const ship = getShip();
    if (!ship) return;
    const host = ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
    if (!host) return;
    // 严格线性链：只有"链尾"（无节点时的当前轨道 / 最后一个节点的机动后链）可以继续建点
    const tip = tipChain();
    const chains = tip ? [tip] : [];
    if (chains.length === 0) return;
    const p = toInsetLocal(e);
    const near = nearestOrbitPointInInset(chains, p, host, 24);
    if (!near) {
        closeNodeMenu();
        return;
    }
    // 快照取自链尾那条链（链式规划：新节点自动承接上一节点的机动后状态）
    const st = walkToTime(near.segs, near.absTime);
    if (!st) return;
    openNodeMenu(e.clientX, e.clientY, {
        absTime: near.absTime,
        relX: st.relPos.x,
        relY: st.relPos.y,
        relVel: st.relVel,
        anchorBody: st.host.name
    }, ship);
}

// ===== 图内拖拽（节点 / 四向手柄）=====
function onInsetPointerDown(e) {
    _dragMoved = false;
    if (!_hit || !_insetCanvas) return;
    const p = toInsetLocal(e);
    const pred = getLastManeuverPrediction();
    const axes = pred && pred.plan ? pred.plan.axes : null;
    // 手柄优先（比节点标记小，先判）
    for (const axis of ['pro', 'retro', 'radIn', 'radOut']) {
        const h = _hit.handles[axis];
        if (!h) continue;
        if (Math.hypot(p.x - h.x, p.y - h.y) <= MANEUVER_CONFIG.handleHitRadius) {
            // 速率制（与主视图手柄同源语义）：记录按下点，向外拖拽距离 → 注入速率
            _drag = {
                mode: 'dv', axis, axes,
                startClientX: e.clientX, startClientY: e.clientY, dist: 0
            };
            e.preventDefault();
            return;
        }
    }
    // 节点标记：命中的那个即成为选中目标并开始拖动（多节点 0.2.6；手柄仍只属于选中节点）
    const hitNode = (_hit.nodes || []).find(n => Math.hypot(p.x - n.x, p.y - n.y) <= MANEUVER_CONFIG.nodeHitRadius);
    if (hitNode) {
        if (!hitNode.selected) {
            maneuverSystem.setSelectedNode(ship, hitNode.id);
        }
        _drag = { mode: 'node', nodeId: hitNode.id };
        e.preventDefault();
    }
}

function onInsetPointerMove(e) {
    if (!_drag) return;
    _dragMoved = true;                  // 拖拽开始 → 随后的 click 不作为"点轨道"处理
    const ship = getShip();
    if (!ship) { _drag = null; return; }

    if (_drag.mode === 'dv') {
        // 拖拽距离 = 从按下点沿该轴屏幕方向的投影位移；反向 clamp 0（仅允许向外拖），
        // 与主视图 maneuverUI 完全一致：rate = min(dist, range) / range × maxRate
        const dir = _hit && _hit.axisDirs ? _hit.axisDirs[_drag.axis] : null;
        if (!dir) return;
        const signed = (e.clientX - _drag.startClientX) * dir.x + (e.clientY - _drag.startClientY) * dir.y;
        _drag.dist = Math.max(0, signed);
        return;
    }

    if (_drag.mode === 'node') {
        // 沿轨道拖动：把指针映射到放大图内的最近轨道点 → 反解时刻（与主视图同思路）
        const nodeId = _drag.nodeId || (maneuverSystem.getNode(ship) || {}).id;
        // 严格线性链：拖节点只在**它自己所属的那条链**上解析（时间必然在前序燃烧之后）
        const own = nodeId ? chainForNode(nodeId) : null;
        const chains = own ? [own] : collectChains();
        if (!nodeId || chains.length === 0 || !_hit) return;
        const hostBody = ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
        const p = toInsetLocal(e);
        const near = nearestOrbitPointInInset(chains, p, hostBody);
        if (!near) return;
        const st = walkToTime(near.segs, near.absTime);
        if (!st) return;
        // 拖动的是被按下的那个节点（多节点），新状态取自光标所在链
        maneuverSystem.updateNodeTime(ship, {
            time: near.absTime,
            relX: st.relPos.x,
            relY: st.relPos.y,
            anchorBody: st.host.name,
            velRel: st.relVel
        }, nodeId);
    }
}

function onInsetPointerUp() {
    _drag = null;
}

// 放大图内的手柄视觉比例（k）：按放大图尺寸等比缩放，使"拖到最大位置 = 最大注入速率"的手感一致
// 用布局矩形缓存（拖拽期间逐帧调用，避免 getBoundingClientRect 强制重排）
function insetHandleScale() {
    if (!_insetCanvas) return 1;
    return getRects().scaleK;
}

// 速率制 Δv 累积（每帧调用）：与主视图手柄同一公式，范围取放大图专用短范围
function accumulateHandleDv(ship, dtReal) {
    if (!_drag || _drag.mode !== 'dv' || !ship || !_drag.axes) return;
    const k = insetHandleScale();
    const range = Math.max(16, (VIEW_CONFIG.insetHandleDragRange || 64) * k);
    const rate = (Math.min(_drag.dist, range) / range) * MANEUVER_CONFIG.handleMaxRate;
    if (rate > 0.001) {
        maneuverSystem.updateNodeDeltaV(ship, _drag.axis, rate * dtReal, _drag.axes);
    }
}

function toInsetLocal(e) {
    const r = _insetCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// 放大图内最近轨道点（含到达时刻）：只沿**宿主系**段搜索（换系段的坐标不属于本地轨道，
// 参与搜索会把节点吸附到错误时刻）
// 本帧可用链（多节点 0.2.6）：基础链（当前轨道）+ 各节点的机动后链。
// 建点 / 拖节点 / 悬停都按"光标所在链"解析 → 在预测链上操作时快照自动取自该链（链式规划）
function collectChains() {
    const list = [];
    const base = getLastOrbitSegments();
    if (base && base.length) list.push({ segs: base, ownerId: null });
    for (const e of (getLastManeuverNodes() || [])) {
        if (e.segments && e.segments.length) list.push({ segs: e.segments, ownerId: e.node.id });
    }
    return list;
}

// 链尾（唯一允许继续规划的那条链）：无节点 = 基础链（当前轨道）；
// 有节点 = 时间序**最后一条节点的机动后链** —— 严格线性链（0.2.6 总监定稿）：
// 节点 2 只能建在节点 1 的链路上、节点 3 只能建在 2 的链路上，每一级只允许一个，不可分支。
function tipChain() {
    const entries = getLastManeuverNodes() || [];
    if (entries.length === 0) {
        const base = getLastOrbitSegments();
        return (base && base.length) ? { segs: base, ownerId: null } : null;
    }
    const last = entries[entries.length - 1];
    if (last && last.segments && last.segments.length) {
        return { segs: last.segments, ownerId: last.node.id };
    }
    return null;
}

// 某节点**所属的那条链**（严格线性链）：首节点 = 基础链；其余 = 其前一个节点的机动后链。
// 拖节点只在这条链上解析 → 时间必然落在"前序燃烧结束之后"，不会把节点拖到前序之前打乱链序。
function chainForNode(nodeId) {
    const entries = getLastManeuverNodes() || [];
    const idx = entries.findIndex(e => e.node && e.node.id === nodeId);
    if (idx <= 0) {
        const base = getLastOrbitSegments();
        return (base && base.length) ? { segs: base, ownerId: null } : null;
    }
    const prevEntry = entries[idx - 1];
    if (prevEntry && prevEntry.segments && prevEntry.segments.length) {
        return { segs: prevEntry.segments, ownerId: prevEntry.node.id };
    }
    return null;
}

function nearestOrbitPointInInset(chains, p, host, thresholdPx) {
    if (!_hit || !_hit.geom || !isFinite(_hit.geom.scale)) return null;
    const g = _hit.geom;
    let best = null;
    let bestD2 = (thresholdPx || 30) * (thresholdPx || 30);   // 命中阈值（CSS px，默认与主视图一致）
    for (const entry of (chains || [])) {
        const segs = entry.segs || entry;
        const ownerId = entry.ownerId !== undefined ? entry.ownerId : null;
        for (const seg of segs) {
            const anchorName = seg.anchorBody || seg.segSoiName;
            if (anchorName && host && anchorName !== host.name) continue;
            const pts = seg.relPoints;
            if (!pts || pts.length < 2) continue;
            for (let i = 1; i < pts.length; i++) {
                const a = insetPoint(pts[i - 1], g);
                const b = insetPoint(pts[i], g);
                const hit = distToSegmentSq(p.x, p.y, a.x, a.y, b.x, b.y);
                if (hit.d2 < bestD2) {
                    bestD2 = hit.d2;
                    const t0 = pts[i - 1].t;
                    const t1 = pts[i].t;
                    const tLocal = (t0 !== undefined && t1 !== undefined)
                        ? t0 + (t1 - t0) * hit.t
                        : null;
                    best = {
                        absTime: (tLocal !== null && isFinite(seg.anchorTime))
                            ? seg.anchorTime + tLocal
                            : null,
                        segs,
                        ownerId
                    };
                }
            }
        }
    }
    return (best && best.absTime !== null) ? best : null;
}

function insetPoint(relPt, g) {
    return { x: g.cx + relPt.x * g.scale, y: g.cy - relPt.y * g.scale };
}

function distToSegmentSq(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 1e-9 ? (wx * vx + wy * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + vx * t;
    const cy = ay + vy * t;
    const dx = px - cx;
    const dy = py - cy;
    return { d2: dx * dx + dy * dy, t };
}

// ===== 每帧更新 =====
export function updateManeuverViewPanel(canvas, ship) {
    _canvas = canvas;
    ensureDom();

    if (!flightView.isManeuver()) {
        if (_panel.style.display !== 'none') _panel.style.display = 'none';
        return;
    }
    _panel.style.display = 'flex';

    // 速率制手柄 Δv 累积（必须逐帧：与时间相关的注入，节流会影响手感）
    const nowTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dtReal = _lastTickTs ? Math.min(0.1, (nowTs - _lastTickTs) / 1000) : 0;
    _lastTickTs = nowTs;
    if (ship) accumulateHandleDv(ship, dtReal);

    // 放大图重绘 / 读数刷新节流到 ~30fps（Kerbolar 系天体多时显著省帧；视觉无差别）
    const heavyDue = (nowTs - _lastHeavyTs) >= HEAVY_INTERVAL_MS;
    if (heavyDue) _lastHeavyTs = nowTs;
    // 聚焦下拉展开时必须每帧刷新（需要响应当前选择），其余情况跟随节流
    refreshFocusList(heavyDue || _focusOpen);
    if (!heavyDue) return;

    const now = getCachedTime();
    const node = maneuverSystem.getNode(ship);
    const pred = getLastManeuverPrediction();
    const plan = pred && pred.plan ? pred.plan : null;

    // —— 聚焦天体下拉（数据驱动：当前星系全部天体，层级缩进）
    const focusNameText = flightView.getFocusName() || '--';
    if (_els.focusName.textContent !== focusNameText) _els.focusName.textContent = focusNameText;
    refreshFocusList(true);

    // —— 四向 Δv 读数（两个有符号分量 → 四行显示）
    const dvPro = node && isFinite(node.dvPro) ? node.dvPro : 0;
    const dvRad = node && isFinite(node.dvRadial) ? node.dvRadial : 0;
    const rows = _els.dvRows;
    if (rows) {
        rows.pro.value.textContent = Math.max(0, dvPro).toFixed(1);
        rows.retro.value.textContent = Math.max(0, -dvPro).toFixed(1);
        rows.radOut.value.textContent = Math.max(0, dvRad).toFixed(1);
        rows.radIn.value.textContent = Math.max(0, -dvRad).toFixed(1);
    }

    // —— 节点时刻 / 计划读数
    if (node) {
        _els.timeValue.textContent = formatTCountdown(Math.max(0, node.time - now));
        if (document.activeElement !== _els.utInput) {
            _els.utInput.value = isFinite(node.time) ? String(Math.round(node.time)) : '';
        }
        const progress = maneuverSystem.getProgress(ship);
        const burnT = plan && plan.burnDuration ? plan.burnDuration : 0;
        _els.planValue.textContent = progress.planned.toFixed(1) + ' m/s · T = ' + burnT.toFixed(1) + ' s';
        const shipDv = ship ? computeDeltaV(ship) : 0;
        const enough = progress.planned <= shipDv + 1e-6;
        _els.fuelValue.textContent = (enough ? t('mvp.fuelOk') : t('mvp.fuelLow'))
            + '（' + Math.round(shipDv) + ' m/s）';
        _els.fuelValue.style.color = enough ? '' : '#6B737A';
    } else {
        _els.timeValue.textContent = '--';
        _els.planValue.textContent = '--';
        _els.fuelValue.textContent = '--';
    }

    // —— 放大图重绘
    drawInset(canvas, ship, node, pred, now);
}

// 聚焦列表（展开时刷新；**内容签名未变则不重建**，避免每帧换元素导致真实点击丢失）
// shouldRefresh=false 时仅同步显隐（节流帧不重建）
function refreshFocusList(shouldRefresh) {
    const list = _els.focusList;
    if (!list) return;
    const visible = _focusOpen;
    const want = visible ? 'block' : 'none';
    if (list.style.display !== want) list.style.display = want;
    if (!visible) {
        _focusSig = '';          // 关闭时清签名 → 下次展开必定重建（保证内容最新）
        return;
    }
    if (!shouldRefresh) return;

    const targets = flightView.getTargets();
    if (!targets || targets.length === 0) {
        if (_focusSig !== 'empty') {
            _focusSig = 'empty';
            list.textContent = '';
        }
        return;
    }
    const focusName = flightView.getFocusName() || '';
    const sig = focusName + '|' + targets.map(t => t.body.name + ':' + t.depth).join(',');
    if (sig === _focusSig) return;
    _focusSig = sig;

    list.textContent = '';
    for (const tg of targets) {
        const item = el('div', 'mvp-focus-item' + (tg.body.name === focusName ? ' active' : ''));
        item.setAttribute('data-body', tg.body.name);
        item.appendChild(el('span', 'mvp-focus-branch', '\u00A0'.repeat(tg.depth * 2) + (tg.depth > 0 ? '└' : '')));
        item.appendChild(el('span', 'mvp-focus-item-name', tg.body.name));
        item.appendChild(el('span', 'mvp-focus-meta',
            t('mvp.kind.' + tg.kind) + ' · ' + formatFit(tg.fitRadius)));
        list.appendChild(item);
    }
}

function formatFit(m) {
    if (!isFinite(m) || m <= 0) return '--';
    if (m >= 1e9) return (m / 1e9).toFixed(2) + ' Gm';
    if (m >= 1e6) return (m / 1e6).toFixed(1) + ' Mm';
    if (m >= 1e3) return (m / 1e3).toFixed(1) + ' km';
    return Math.round(m) + ' m';
}

// ===== 放大图绘制 =====
// 动态缩放：R = 当前轨道在 SOI 内的最大半径（缓存，链对象不变则复用）；逃逸/超 SOI → R = SOI 半径；
// 轨道直径映射到绘图区边长（板块面积 2/3 → 边长 81.6%）；内容按 SOI 截断
function drawInset(canvas, ship, node, pred, now) {
    const cv = _insetCanvas;
    if (!cv) return;
    const rect = getRects().canvas || cv.getBoundingClientRect();
    const cssW = Math.max(60, Math.round(rect.width));
    const cssH = Math.max(60, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
        cv.width = Math.round(cssW * dpr);
        cv.height = Math.round(cssH * dpr);
    }
    const ctx = _insetCtx;
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const host = ship && ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
    if (!host) { _hit = null; return; }

    const segs = getLastOrbitSegments() || [];
    const postSegs = plan_segments(pred);

    // 参照半径 R（只看当前轨道；逃逸/超 SOI → SOI）
    const R = referenceRadius(segs, host);
    const side = Math.min(cssW, cssH) * Math.sqrt(VIEW_CONFIG.insetAreaRatio);   // 面积 2/3 → 边长 81.6%
    const scale = side / (2 * R);
    const cx = cssW / 2;
    const cy = cssH / 2;
    const geom = { cx, cy, scale, R, soiR: host.soiRadius * scale };
    _hit = { geom, node: null, handles: {}, axisDirs: {} };

    // —— HUD 底纹：十字准线
    ctx.strokeStyle = 'rgba(61,255,61,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(cssW, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, cssH);
    ctx.stroke();

    // —— SOI 边界（可见时画；含外圈刻度）
    if (geom.soiR < Math.max(cssW, cssH)) {
        ctx.strokeStyle = 'rgba(61,255,61,0.35)';
        ctx.setLineDash([5, 6]);
        ctx.beginPath(); ctx.arc(cx, cy, geom.soiR, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([1.5, 10]);
        ctx.strokeStyle = 'rgba(61,255,61,0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, geom.soiR + 8, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
    }

    // —— 内容（按 SOI 截断）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, geom.soiR, 0, Math.PI * 2);
    ctx.clip();

    // 当前轨道（实线）
    drawSegments(ctx, segs, geom, {
        stroke: 'rgba(61,255,61,0.85)', lineWidth: 1.4, dash: null
    }, host, cssW, cssH);

    // 多节点链式（0.2.6）：逐节点绘制 燃烧弧 + 机动后链；
    // 选中节点高亮（亮绿实线弧 + 亮虚线链），其余节点降一档亮度（总监定稿：全部链都画、选中高亮）
    const nodeEntries = getLastManeuverNodes() || [];
    for (const e of nodeEntries) {
        const dim = !e.selected;
        if (e.burnArc) {
            drawSegments(ctx, [e.burnArc], geom, {
                stroke: dim ? 'rgba(61,255,61,0.5)' : '#3dff3d',
                lineWidth: dim ? 1.6 : 2.6,
                dash: null
            }, host, cssW, cssH);
        }
        if (e.segments && e.segments.length) {
            drawSegments(ctx, e.segments, geom, {
                stroke: dim ? 'rgba(61,255,61,0.42)' : 'rgba(61,255,61,0.75)',
                lineWidth: dim ? 1 : 1.2,
                dash: [7, 5]
            }, host, cssW, cssH);
        }
    }
    // 兼容：无多节点数据（旧路径）时仍画单节点预测
    if (nodeEntries.length === 0 && pred && pred.burnArc) {
        drawSegments(ctx, [pred.burnArc], geom, { stroke: '#3dff3d', lineWidth: 2.6, dash: null }, host, cssW, cssH);
        drawSegments(ctx, postSegs, geom, { stroke: 'rgba(61,255,61,0.75)', lineWidth: 1.2, dash: [7, 5] }, host, cssW, cssH);
    }
    ctx.restore();

    // —— 宿主天体：中心空心圆（双环）
    const bodyR = Math.max(6, (host.radius || 0) * scale);
    ctx.strokeStyle = '#3dff3d';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, Math.min(bodyR, side / 2), 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(61,255,61,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, Math.min(bodyR + 6, side / 2 + 6), 0, Math.PI * 2); ctx.stroke();

    // —— 飞船标记（三角形，指向速度方向）
    if (ship) {
        const sp = insetPoint({ x: ship.pos.x, y: ship.pos.y }, geom);
        const head = Math.atan2(ship.vel.y, ship.vel.x);
        drawShipMarker(ctx, sp.x, sp.y, head);
    }

    // —— 机动节点（多节点 0.2.6）：所有节点画空心圆标记；**仅选中节点**画四向手柄与衔接线
    _hit.nodes = [];
    for (const e of (getLastManeuverNodes() || [])) {
        const st = e.plan && e.plan.nodeState;
        if (!st) continue;
        const p = insetPoint(st.relPos, geom);
        _hit.nodes.push({ id: e.node.id, x: p.x, y: p.y, selected: !!e.selected });
        if (e.selected) {
            _hit.node = p;
            _hit.nodeId = e.node.id;
        }
    }
    // 非选中节点标记（暗一档）
    for (const n of _hit.nodes) {
        if (n.selected) continue;
        ctx.strokeStyle = 'rgba(61,255,61,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, Math.PI * 2); ctx.stroke();
    }

    if (node && pred && pred.plan && pred.plan.nodeState) {
        const np = insetPoint(pred.plan.nodeState.relPos, geom);
        _hit.node = np;
        const axes = pred.plan.axes;
        if (axes) {
            // 手柄几何（0.2.5 调整）：
            //   · 静止偏移 / 拖拽延伸改为面板专用较短值（viewConfig.insetHandle*），按尺寸等比缩放
            //   · 可用范围 = **整个 HUD 面板块**边界（不再受 3/4 绘图区限制），仅留 HM 余量
            //   · 速率公式不受影响：仍用真实拖拽距离 × handleMaxRate
            const k = insetHandleScale();
            const offBase = (VIEW_CONFIG.insetHandleOffset || 26) * k;
            const rangeV = Math.max(16, (VIEW_CONFIG.insetHandleDragRange || 64) * k);
            const dragExtra = (_drag && _drag.mode === 'dv' && _drag.axis)
                ? Math.min(_drag.dist, rangeV)
                : 0;
            const wantOff = offBase + dragExtra;
            const HM = 10;                                   // 手柄半宽 + 余量（px）
            const avail = {
                pro: (cssW - HM) - np.x,
                retro: np.x - HM,
                radIn: (cssH - HM) - np.y,
                radOut: np.y - HM
            };
            const offOf = (axis) => Math.max(0, Math.min(wantOff, avail[axis]));
            _hit.axisDirs = {
                pro: { x: 1, y: 0 }, retro: { x: -1, y: 0 },
                radIn: { x: 0, y: 1 }, radOut: { x: 0, y: -1 }
            };
            const pos = {
                pro: { x: np.x + offOf('pro'), y: np.y },
                retro: { x: np.x - offOf('retro'), y: np.y },
                radIn: { x: np.x, y: np.y + offOf('radIn') },
                radOut: { x: np.x, y: np.y - offOf('radOut') }
            };
            // 衔接线
            ctx.strokeStyle = 'rgba(61,255,61,0.5)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            for (const k of Object.keys(pos)) {
                ctx.moveTo(np.x, np.y);
                ctx.lineTo(pos[k].x, pos[k].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            // 手柄（箭头）
            ctx.strokeStyle = '#3dff3d';
            ctx.lineWidth = 1.4;
            for (const k of Object.keys(pos)) {
                _hit.handles[k] = pos[k];
                const d = _hit.axisDirs[k];
                ctx.beginPath();
                ctx.moveTo(pos[k].x, pos[k].y);
                ctx.lineTo(pos[k].x + d.x * 7, pos[k].y + d.y * 7);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(pos[k].x + d.x * 7 - d.y * 3, pos[k].y + d.y * 7 - d.x * 3);
                ctx.lineTo(pos[k].x + d.x * 8, pos[k].y + d.y * 8);
                ctx.lineTo(pos[k].x + d.x * 7 + d.y * 3, pos[k].y + d.y * 7 + d.x * 3);
                ctx.stroke();
            }
        }
        // 节点空心圆（最后画，保证在衔接线上层）
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#3dff3d';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(np.x, np.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // —— 悬停反馈（HUD 风格，0.2.5）：轨道点十字准星 + T- 读数（指针在放大图内且未拖拽时）
    if (_hover && !_drag) {
        const hx = _hover.x;
        const hy = _hover.y;
        ctx.strokeStyle = 'rgba(61,255,61,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx - 8, hy); ctx.lineTo(hx - 4, hy);
        ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 8, hy);
        ctx.moveTo(hx, hy - 8); ctx.lineTo(hx, hy - 4);
        ctx.moveTo(hx, hy + 4); ctx.lineTo(hx, hy + 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx, hy - 3);
        ctx.lineTo(hx + 3, hy);
        ctx.lineTo(hx, hy + 3);
        ctx.lineTo(hx - 3, hy);
        ctx.closePath();
        ctx.stroke();
        const remain = Math.max(0, _hover.absTime - now);
        ctx.fillStyle = 'rgba(61,255,61,0.9)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('T-' + formatTCountdown(remain), hx + 10, hy - 10);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    // —— 装饰读数（文本去重：值未变不写 DOM）
    const progress = ship ? maneuverSystem.getProgress(ship) : null;
    const alt = Math.hypot(ship ? ship.pos.x : 0, ship ? ship.pos.y : 0) - (host.radius || 0);
    setReadout('tl', 'SOI <b>' + host.name.toUpperCase() + '</b><br>R <b>' + formatFit(host.soiRadius) + '</b>');
    setReadout('tr', 'ALT <b>' + formatFit(alt) + '</b><br>VEL <b>' + Math.round(Math.hypot(ship ? ship.vel.x : 0, ship ? ship.vel.y : 0)) + ' m/s</b>');
    setReadout('bl', 'REF R <b>' + formatFit(R) + '</b><br>SCALE <b>' + (scale * 1000).toFixed(3) + '</b>');
    setReadout('br', 'ΔV <b>' + (progress ? progress.planned.toFixed(1) : '0.0') + ' m/s</b><br>T− <b>'
        + (node ? formatTCountdown(Math.max(0, node.time - now)) : '--') + '</b>');
}

// 读数写入（值未变则跳过 DOM 写入）
function setReadout(key, html) {
    if (_readoutCache[key] === html) return;
    _readoutCache[key] = html;
    const e = _els['readout' + key.toUpperCase()];
    if (e) e.innerHTML = html;
}

function plan_segments(pred) {
    return (pred && pred.plan && pred.plan.segments) ? pred.plan.segments : [];
}

// 段点 → **宿主参考系**（0.2.5 修复：多 SOI 链每段各有 anchorBody，
// 其 relPoints 相对该段锚天体；此前一律按宿主系绘制 → 换系段（如 Mun 段）会画到错误位置）
// anchorBody === host.name 时零开销直接返回原数组。
function segmentPointsInHostFrame(seg, host) {
    const pts = seg && seg.relPoints ? seg.relPoints : null;
    if (!pts || pts.length < 2) return null;
    const anchorName = seg.anchorBody || seg.segSoiName;
    if (!anchorName || anchorName === host.name) return pts;
    const anchorBody = celestialBodies.find(b => b.name === anchorName);
    if (!anchorBody) return null;      // 锚天体缺失 → 该段不画（宁缺勿错位）
    const out = [];
    for (const p of pts) {
        const t = (p.t !== undefined && isFinite(seg.anchorTime)) ? seg.anchorTime + p.t : null;
        const ap = t !== null ? bodyFuturePos(anchorBody, t) : anchorBody.position;
        const hp = t !== null ? bodyFuturePos(host, t) : host.position;
        out.push({ x: p.x + ap.x - hp.x, y: p.y + ap.y - hp.y, t: p.t });
    }
    return out;
}

// 参照半径：当前轨道（基础预测链，换算到宿主系）在 SOI 内的最大半径；逃逸/超 SOI/无数据 → SOI 半径
// 结果按"链对象引用 + 宿主名"缓存（链未变则不重算，Kerbolar 系点数多时显著省帧）
function referenceRadius(segs, host) {
    if (_refCache.segs === segs && _refCache.hostName === host.name) return _refCache.R;
    let maxR = 0;
    for (const seg of segs) {
        const pts = segmentPointsInHostFrame(seg, host);
        if (!pts) continue;
        for (const p of pts) {
            const r = Math.hypot(p.x, p.y);
            if (r > maxR) maxR = r;
        }
    }
    const R = (!(maxR > 0) || maxR > host.soiRadius) ? host.soiRadius : maxR;
    _refCache = { segs, hostName: host.name, R };
    return R;
}

// 屏幕空间抽稀 + 可视区裁剪描边（0.2.5 性能）：
//   · 抽稀：相邻点间距 < minPx 时跳过（密集链在放大图里本就是亚像素，无视觉损失）
//   · 裁剪：只描"与画布相交"的子段（逃逸/跨系链在放大图里可达数万像素，
//     整条交给光栅器 + 虚线展开代价高）；每段两端各带一个界外点保证穿边不断
//   · 超长路径降级实线：路径长 > DASH_MAX_PATH_PX 时忽略虚线（段数有界）
const DASH_MAX_PATH_PX = 4000;

function drawPolyline(ctx, pts, geom, minPx, cssW, cssH, dashed) {
    const margin = 24;
    const inside = (p) => p.x >= -margin && p.x <= cssW + margin && p.y >= -margin && p.y <= cssH + margin;

    // 抽稀后转屏幕坐标
    const sp = [];
    let lastX = NaN;
    let lastY = NaN;
    const min2 = minPx * minPx;
    for (let i = 0; i < pts.length; i++) {
        const p = insetPoint(pts[i], geom);
        const first = sp.length === 0;
        const last = i === pts.length - 1;
        if (!first && !last) {
            const dx = p.x - lastX;
            const dy = p.y - lastY;
            if (dx * dx + dy * dy < min2) continue;
        }
        sp.push(p);
        lastX = p.x;
        lastY = p.y;
    }
    if (sp.length < 2) return;

    // 按可视区切成子段
    let run = [];
    const flush = (arr) => {
        if (arr.length < 2) return;
        // 路径长度（用于虚线降级判断）
        let len = 0;
        for (let i = 1; i < arr.length; i++) len += Math.hypot(arr[i].x - arr[i - 1].x, arr[i].y - arr[i - 1].y);
        const useDash = dashed && len <= DASH_MAX_PATH_PX;
        ctx.setLineDash(useDash ? [7, 5] : []);
        ctx.beginPath();
        ctx.moveTo(arr[0].x, arr[0].y);
        for (let i = 1; i < arr.length; i++) ctx.lineTo(arr[i].x, arr[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
    };

    for (let i = 0; i < sp.length; i++) {
        const ins = inside(sp[i]);
        if (ins && run.length === 0 && i > 0) run.push(sp[i - 1]);   // 带上界外前一点
        if (ins) run.push(sp[i]);
        if (!ins && run.length > 0) {
            run.push(sp[i]);                                          // 带上界外后一点
            flush(run);
            run = [];
        }
    }
    if (run.length > 0) flush(run);
}

function drawSegments(ctx, segs, geom, style, host, cssW, cssH) {
    if (!segs || segs.length === 0) return;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    const dashed = !!(style.dash && style.dash.length);
    for (const seg of segs) {
        const pts = segmentPointsInHostFrame(seg, host);
        if (!pts || pts.length < 2) continue;
        drawPolyline(ctx, pts, geom, 0.9, cssW, cssH, dashed);
    }
    ctx.setLineDash([]);
}

function drawShipMarker(ctx, x, y, head) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-head);
    ctx.fillStyle = '#3dff3d';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// 场景退出清理
export function hideManeuverViewPanel() {
    _drag = null;
    _focusOpen = false;
    if (_panel) _panel.style.display = 'none';
}
