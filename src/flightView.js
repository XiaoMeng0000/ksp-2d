'use strict';

// 飞行视图档位管理（0.3.0）— 普通聚焦视图 ↔ 轨道机动视图
// 职责：
//   ① 视图状态机（切换、可用性、场景重置）
//   ② 机动视图相机：聚焦所选天体（默认恒星）+ 缩放上限 = "刚好容纳该天体系统"的 fit
//   ③ 聚焦目标：**当前星系全部天体**（恒星/行星/卫星，按层级有序），完全由天体数据推导；
//      预留跨星系扩展位（未来把其他星系天体追加进列表即可，相机侧无需改动）
// 交互约定（总监定稿）：
//   · V 键循环切换；机动视图初值 = 放大上限；切回普通视图恢复切换前缩放
//   · 切换聚焦天体时缩放重置为新上限；下拉菜单可选任意天体
//   · 可用性：只要有活动飞船即可用（无活动飞船时不可用）
//   · 机动视图内时间加速不受限；滚轮始终作用于相机缩放（含面板区域）

import { camera, setZoomLimits, setZoom, animateCameraTo, isCameraAnimating, cancelCameraAnimation } from './camera.js';
import { VIEW_IDS, VIEW_CONFIG } from './config/viewConfig.js';
import { celestialBodies, getSOIHost, getAbsolutePosition } from './physics/physics.js';

// ===== 纯函数：层级数据推导（可单测） =====

// 天体相对其父轨道的远心距（无父/数据缺失返回 0）
export function apoapsisOf(body) {
    if (!body || !isFinite(body.orbitA)) return 0;
    return Math.abs(body.orbitA) * (1 + (body.orbitE || 0));
}

// 直接子天体（orbitParent === body.name）
export function getChildren(body) {
    if (!body) return [];
    return celestialBodies.filter(b => b.orbitParent === body.name);
}

// 沿父链找到恒星（type === 'star'）；找不到返回 null
export function findStarAncestor(body) {
    let cur = body;
    const seen = new Set();
    while (cur && !seen.has(cur.name)) {
        seen.add(cur.name);
        if (cur.type === 'star') return cur;
        cur = cur.orbitParent ? (celestialBodies.find(b => b.name === cur.orbitParent) || null) : null;
    }
    return null;
}

// 玩家所在分支：从宿主向上到 star 的路径上、star 的直接子天体（"往上看一层"看的那一环）
export function branchChildOfStar(host) {
    let cur = host;
    const seen = new Set();
    while (cur && !seen.has(cur.name)) {
        seen.add(cur.name);
        const parent = cur.orbitParent
            ? (celestialBodies.find(b => b.name === cur.orbitParent) || null)
            : null;
        if (!parent) return null;
        if (parent.type === 'star') return cur;   // cur 即 star 的直接子天体（玩家分支）
        cur = parent;
    }
    return null;
}

/**
 * 单个天体的 fit 半径（放大上限据此换算）= "刚好容纳它所在的这一层系统"：
 *   · 有子天体（非恒星）→ 其全部子天体轨道远心距的最大值（例：Kerbin → Minmus 轨道）
 *   · 恒星 → **玩家分支那一环**的轨道远心距（例：宿主 Kerbin → Kerbin 绕 Kerbol 的轨道，
 *           保留"一眼看两颗行星相对位置"的体验）；无宿主（深空）→ 退化为其最远子天体
 *   · 无子天体 → 其自身绕父轨道的远心距（例：Mun → Mun 绕 Kerbin 的轨道）
 *   · 孤立天体（无父无子，理论上不存在）→ SOI 半径兜底
 */
export function computeBodyFitRadius(body, host) {
    if (!body) return 0;
    const children = getChildren(body);
    if (children.length > 0) {
        if (body.type === 'star') {
            const branch = host ? branchChildOfStar(host) : null;
            if (branch && branch.orbitParent === body.name) return apoapsisOf(branch);
        }
        let max = 0;
        for (const c of children) max = Math.max(max, apoapsisOf(c));
        return max;
    }
    const own = apoapsisOf(body);
    if (own > 0) return own;
    return body.soiRadius || 0;
}

/**
 * 当前星系的聚焦目标列表（层级有序：恒星 → 行星 → 卫星…，供下拉菜单缩进显示）
 * 数据驱动：从宿主所属恒星出发 DFS；宿主缺失（深空）时取距飞船最近的恒星。
 * 跨星系扩展位：未来在返回值末尾追加其他星系条目即可（body.position 已由星系列表统一布局）。
 * @returns {Array<{body:Object, depth:number, fitRadius:number, kind:'star'|'planet'|'moon'}>}
 */
export function getFocusTargets(host) {
    const star = host ? findStarAncestor(host) : null;
    if (!star) return [];
    const list = [];
    const walk = (body, depth) => {
        list.push({
            body,
            depth,
            fitRadius: computeBodyFitRadius(body, host),
            kind: depth === 0 ? 'star' : (depth === 1 ? 'planet' : 'moon')
        });
        for (const c of getChildren(body)) walk(c, depth + 1);
    };
    walk(star, 0);
    return list;
}

// 放大上限 = fitMargin × min(屏宽,屏高) / 2 ÷ fit 半径（"刚好容纳"该天体系统）
export function computeFitZoom(fitRadius, canvas) {
    if (!canvas || !(fitRadius > 0)) return VIEW_CONFIG.zoomMaxFocus;
    const half = Math.min(canvas.width, canvas.height) / 2;
    return (VIEW_CONFIG.fitMargin * half) / fitRadius;
}

// 解析飞船当前宿主（无活动飞船 → null）
function resolveHost(ship) {
    if (!ship) return null;
    return getSOIHost(getAbsolutePosition(ship));
}

// 普通聚焦视图的相机目标 = 活动飞船绝对位置（无飞船 → null：退化为"只恢复缩放"不位移）
function resolveFocusViewTarget(ship) {
    if (!ship) return null;
    const abs = getAbsolutePosition(ship);
    if (!abs || !isFinite(abs.x) || !isFinite(abs.y)) return null;
    return { x: abs.x, y: abs.y };
}

// 星系解析：宿主所属恒星；宿主缺失（深空）时取距飞船最近的恒星
export function resolveCurrentStar(ship) {
    const host = resolveHost(ship);
    if (host) return findStarAncestor(host);
    if (!ship) return null;
    const abs = getAbsolutePosition(ship);
    let best = null;
    let bestDist = Infinity;
    for (const b of celestialBodies) {
        if (b.type !== 'star') continue;
        const d = Math.hypot(b.position.x - abs.x, b.position.y - abs.y);
        if (d < bestDist) { bestDist = d; best = b; }
    }
    return best;
}

// 机动视图可用性（总监定稿 0.3.0）：只要有活动飞船即可用（深空/绕恒星不再禁用）
export function isManeuverAvailable(ship) {
    return !!ship && !!resolveCurrentStar(ship);
}

// ===== 视图状态机（单例） =====

class FlightView {
    constructor() {
        this._view = VIEW_CONFIG.defaultView;
        this._targets = [];         // 当前星系的聚焦目标（层级有序）
        this._focusName = null;     // 当前聚焦天体名（跨星系/换船时按名字保持选择）
        this._starName = null;      // 目标列表对应的恒星名（变化即重算）
        this._prevZoom = null;      // 进入机动视图前的缩放（切回时恢复）
    }

    getView() {
        return this._view;
    }

    isManeuver() {
        return this._view === VIEW_IDS.MANEUVER;
    }

    /** 当前聚焦目标列表（下拉菜单数据源） */
    getTargets() {
        return this._targets;
    }

    /** 当前聚焦天体名（收起态显示用） */
    getFocusName() {
        return this._focusName;
    }

    /** 当前聚焦目标的 fit 半径（面板读数用） */
    getFocusFitRadius() {
        const t = this._targets.find(x => x.body.name === this._focusName);
        return t ? t.fitRadius : 0;
    }

    /** 场景重置：回默认视图 + 恢复普通视图缩放范围（不改缩放值本身；中止进行中的过渡动画） */
    reset() {
        this._view = VIEW_CONFIG.defaultView;
        this._targets = [];
        this._focusName = null;
        this._starName = null;
        this._prevZoom = null;
        cancelCameraAnimation();
        setZoomLimits(VIEW_CONFIG.zoomMin, VIEW_CONFIG.zoomMaxFocus);
    }

    /**
     * V 键循环切换
     * @returns {{view:string, changed:boolean, reason:'ok'|'unavailable'}}
     */
    cycleView(ship, canvas) {
        if (this.isManeuver()) {
            this.exitManeuver(ship, canvas);
            return { view: this._view, changed: true, reason: 'ok' };
        }
        if (!isManeuverAvailable(ship)) {
            return { view: this._view, changed: false, reason: 'unavailable' };
        }
        this.enterManeuver(ship, canvas);
        return { view: this._view, changed: true, reason: 'ok' };
    }

    /** 进入机动视图：缓存当前缩放 → 默认聚焦恒星 → **平滑过渡**到该天体（位置 + 缩放） */
    enterManeuver(ship, canvas) {
        const star = resolveCurrentStar(ship);
        if (!star) return false;
        const targets = getFocusTargets(resolveHost(ship));
        if (targets.length === 0) return false;
        this._prevZoom = camera.zoom;
        this._starName = star.name;
        this._targets = targets;
        this._focusName = star.name;      // 默认聚焦恒星（总监定稿）
        this._view = VIEW_IDS.MANEUVER;
        this._applyFocus(canvas, true);
        return true;
    }

    /**
     * 切回普通聚焦视图：**平滑移动回飞船**并恢复进入前的缩放（0.3.0 平滑过渡）
     * @param {Object} [ship] - 活动飞船；缺省/不存在时仅恢复缩放，不做位移动画
     * @param {Object} [canvas]
     */
    exitManeuver(ship, canvas) {
        this._view = VIEW_IDS.FOCUS;
        this._targets = [];
        this._focusName = null;
        this._starName = null;
        const restoreZoom = (this._prevZoom !== null) ? this._prevZoom : camera.zoom;
        this._prevZoom = null;

        const target = resolveFocusViewTarget(ship);
        if (target) {
            // 先启动动画（目标动态提供：飞船持续运动也能准确落点），再恢复普通视图缩放范围——
            // 顺序同 _applyFocus：先动画后设限，避免设限瞬间把当前缩放硬夹一次
            animateCameraTo(() => ({ x: target.x, y: target.y, zoom: restoreZoom }), VIEW_CONFIG.transitionMs);
            setZoomLimits(VIEW_CONFIG.zoomMin, VIEW_CONFIG.zoomMaxFocus);
        } else {
            cancelCameraAnimation();
            setZoomLimits(VIEW_CONFIG.zoomMin, VIEW_CONFIG.zoomMaxFocus);
            setZoom(restoreZoom);
        }
    }

    /**
     * 切换聚焦天体（下拉菜单调用）：**平滑移动**到目标天体 + **平滑缩放**到其上限（0.3.0）
     * @param {string} name - 天体名
     */
    setFocusByName(name, canvas) {
        if (!this.isManeuver()) return false;
        if (!this._targets.some(t => t.body.name === name)) return false;
        this._focusName = name;
        this._applyFocus(canvas, true);
        return true;
    }

    /** 按索引切换（等价于 setFocusByName，供列表点击直接使用） */
    setFocusIndex(index, canvas) {
        const t = this._targets[index];
        return t ? this.setFocusByName(t.body.name, canvas) : false;
    }

    /**
     * 相机过渡到当前聚焦天体（0.3.0：改为**平滑动画**，不再瞬移）
     * · 位置：目标天体位置每帧动态读取（天体公转中也能精确落点）
     * · 缩放：重置为该天体上限（resetZoom=true）或保持当前值；log 空间插值
     * · 顺序很重要（0.3.0 修复"先突然缩小再动画"）：**必须先启动动画、再设缩放上限**——
     *   setZoomLimits 在无动画进行时会立刻把当前缩放夹进新范围，若先设限就会硬跳一次
     */
    _applyFocus(canvas, resetZoom) {
        const t = this._targets.find(x => x.body.name === this._focusName);
        if (!t) return;
        const cap = computeFitZoom(t.fitRadius, canvas);
        const body = t.body;
        const zoomTarget = resetZoom ? cap : camera.zoom;
        // ① 先启动动画（进入动画态后，setZoomLimits 只记录不夹取）
        animateCameraTo(() => ({
            x: body.position.x,
            y: body.position.y,
            zoom: zoomTarget
        }), VIEW_CONFIG.transitionMs);
        // ② 再设置缩放上限（此时动画已接管相机，不会硬跳）
        setZoomLimits(VIEW_CONFIG.zoomMin, cap);
    }

    /**
     * 每帧更新（flightScene 在相机跟随之后调用）
     * 机动视图：星系/候选随换船与星际移动刷新；相机聚焦所选天体，放大上限实时保持"刚好容纳"；
     *           无活动飞船 → 自动回退普通视图并恢复缩放。
     * @returns {boolean} 是否处于机动视图（true 表示本帧相机已由本模块接管）
     */
    updateCamera(ship, canvas) {
        if (!this.isManeuver()) return false;
        if (!ship) {
            this.exitManeuver();
            return false;
        }
        const star = resolveCurrentStar(ship);
        if (!star) {
            this.exitManeuver(ship, canvas);
            return false;
        }
        // 星系变化（跨星系/换船）→ 重算目标列表；原选中天体若不存在则回到恒星
        if (star.name !== this._starName) {
            const host = resolveHost(ship);
            const prevFocus = this._focusName;
            this._starName = star.name;
            this._targets = getFocusTargets(host);
            this._focusName = this._targets.some(t => t.body.name === prevFocus) ? prevFocus : star.name;
            this._applyFocus(canvas, true);
            return true;
        }
        const t = this._targets.find(x => x.body.name === this._focusName);
        if (!t) {
            this._focusName = star.name;
            this._applyFocus(canvas, true);
            return true;
        }
        // 相机聚焦所选天体；上限随屏尺寸刷新（放大不越界，缩小不限）
        const cap = computeFitZoom(t.fitRadius, canvas);
        setZoomLimits(VIEW_CONFIG.zoomMin, cap);
        // 过渡动画进行中：相机由动画独占驱动（不在此处写值，否则会打断平滑移动）
        if (isCameraAnimating()) return true;
        camera.x = t.body.position.x;
        camera.y = t.body.position.y;
        if (camera.zoom > cap) setZoom(cap);
        return true;
    }
}

// 导出单例
export const flightView = new FlightView();
