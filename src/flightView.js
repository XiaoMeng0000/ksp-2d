'use strict';

// 飞行视图档位管理（0.3.0）— 普通聚焦视图 ↔ 轨道机动视图
// 职责：
//   ① 视图状态机（切换、可用性、场景重置）
//   ② 机动视图相机：聚焦所选中心天体（默认恒星）+ 缩放上限 = "刚好容纳该中心系统"的 fit
//   ③ 聚焦中心候选：**完全由天体层级数据推导**（不写死任何天体名），预留跨星系扩展位
// 交互约定（总监定稿）：
//   · V 键循环切换；机动视图初值 = 放大上限；切回普通视图恢复切换前缩放
//   · 切换聚焦中心时缩放重置为新上限
//   · 宿主无父轨道（绕恒星/深空）→ 机动视图不可用
//   · 宿主无卫星 → 候选只有恒星；宿主有卫星 → 候选 = [宿主自身(最远卫星轨道), 恒星]
//   · 机动视图内时间加速不受限；滚动滚轮始终作用于相机缩放（含面板区域）

import { camera, setZoomLimits, setZoom } from './camera.js';
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

// 玩家所在分支：从宿主向上到 star 的路径上、star 的直接子天体（= "往上看一层"看的那一环）
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
 * 聚焦中心候选（数据驱动）
 * 规则：
 *   · 宿主有子天体 → 候选1 = 宿主自身，fit = 其全部子天体轨道远心距的最大值（"最远卫星轨道"）
 *   · 恒星 → 候选 = 玩家分支上那一环的轨道远心距（例：宿主 Kerbin → Kerbin 绕 Kerbol 的轨道；
 *            宿主 Mun → 仍取 Kerbin 的轨道）
 *   · 宿主无子天体 → 只给恒星候选
 *   · 宿主无父轨道（绕恒星/深空）→ 返回空数组（机动视图不可用）
 * 跨星系扩展位：未来其他星系条目直接在此数组追加 { body, fitRadius, kind:'system' }，
 *   绝对坐标已由星系列表 computeSystemPosition 统一布局，无需改相机侧代码。
 * @returns {Array<{body:Object, fitRadius:number, kind:'host'|'star'}>}
 */
export function getFocusCandidates(host) {
    if (!host || !host.orbitParent) return [];
    const list = [];

    const children = getChildren(host);
    if (children.length > 0) {
        let fit = 0;
        for (const c of children) fit = Math.max(fit, apoapsisOf(c));
        if (fit > 0) list.push({ body: host, fitRadius: fit, kind: 'host' });
    }

    const star = findStarAncestor(host);
    if (star && star.name !== host.name) {
        const branch = branchChildOfStar(host);
        const fit = branch ? apoapsisOf(branch) : (host.soiRadius || 0);
        if (fit > 0) list.push({ body: star, fitRadius: fit, kind: 'star' });
    }
    return list;
}

// 放大上限 = fitMargin × min(屏宽,屏高) / 2 ÷ fit 半径（"刚好容纳"该中心系统）
export function computeFitZoom(fitRadius, canvas) {
    if (!canvas || !(fitRadius > 0)) return VIEW_CONFIG.zoomMaxFocus;
    const half = Math.min(canvas.width, canvas.height) / 2;
    return (VIEW_CONFIG.fitMargin * half) / fitRadius;
}

// 机动视图可用性：宿主存在且有父轨道，且能推导出至少一个聚焦候选
export function isManeuverAvailable(host) {
    return !!(host && host.orbitParent && getFocusCandidates(host).length > 0);
}

// 解析飞船当前宿主（无活动飞船 → null）
function resolveHost(ship) {
    if (!ship) return null;
    return getSOIHost(getAbsolutePosition(ship));
}

// ===== 视图状态机（单例） =====

class FlightView {
    constructor() {
        this._view = VIEW_CONFIG.defaultView;
        this._candidates = [];      // 当前候选（[{body, fitRadius, kind}]）
        this._focusIndex = 0;       // 当前聚焦中心索引
        this._prevZoom = null;      // 进入机动视图前的缩放（切回时恢复）
        this._hostName = null;      // 候选对应的宿主（宿主变化时重算）
    }

    getView() {
        return this._view;
    }

    isManeuver() {
        return this._view === VIEW_IDS.MANEUVER;
    }

    /** 当前候选列表（面板/工具栏读取；未进入机动视图时按飞船现算） */
    getCandidates(ship) {
        if (this._candidates.length > 0) return this._candidates;
        return getFocusCandidates(resolveHost(ship));
    }

    getFocusIndex() {
        return this._focusIndex;
    }

    getFocusBody() {
        const c = this._candidates[this._focusIndex];
        return c ? c.body : null;
    }

    /** 场景重置：回默认视图 + 恢复普通视图缩放范围（不改缩放值本身） */
    reset() {
        this._view = VIEW_CONFIG.defaultView;
        this._candidates = [];
        this._focusIndex = 0;
        this._prevZoom = null;
        this._hostName = null;
        setZoomLimits(VIEW_CONFIG.zoomMin, VIEW_CONFIG.zoomMaxFocus);
    }

    /**
     * V 键循环切换
     * @returns {{view:string, changed:boolean, reason:'ok'|'unavailable'}}
     *   changed=true 表示视图确实切换了（调用方据此弹通知）；reason='unavailable' 表示被拒
     */
    cycleView(ship, canvas) {
        if (this.isManeuver()) {
            this.exitManeuver();
            return { view: this._view, changed: true, reason: 'ok' };
        }
        const host = resolveHost(ship);
        if (!isManeuverAvailable(host)) {
            return { view: this._view, changed: false, reason: 'unavailable' };
        }
        this.enterManeuver(host, canvas);
        return { view: this._view, changed: true, reason: 'ok' };
    }

    /** 进入机动视图：缓存当前缩放 → 默认聚焦恒星（无恒星候选取第一个）→ 缩放初值 = 上限 */
    enterManeuver(host, canvas) {
        const candidates = getFocusCandidates(host);
        if (candidates.length === 0) return false;
        this._prevZoom = camera.zoom;
        this._hostName = host.name;
        this._candidates = candidates;
        const starIdx = candidates.findIndex(c => c.kind === 'star');
        this._focusIndex = starIdx >= 0 ? starIdx : 0;
        this._view = VIEW_IDS.MANEUVER;
        this._applyFocus(canvas, true);
        return true;
    }

    /** 切回普通聚焦视图：恢复进入前的缩放 + 普通视图缩放范围 */
    exitManeuver() {
        this._view = VIEW_IDS.FOCUS;
        this._candidates = [];
        this._focusIndex = 0;
        this._hostName = null;
        setZoomLimits(VIEW_CONFIG.zoomMin, VIEW_CONFIG.zoomMaxFocus);
        if (this._prevZoom !== null) {
            setZoom(this._prevZoom);
        }
        this._prevZoom = null;
    }

    /**
     * 切换聚焦中心（面板选择器调用）：缩放重置为新上限（总监定稿）
     * @param {number} index - 候选索引
     */
    setFocusIndex(index, canvas) {
        if (!this.isManeuver()) return false;
        if (!(index >= 0 && index < this._candidates.length)) return false;
        this._focusIndex = index;
        this._applyFocus(canvas, true);
        return true;
    }

    /** 相机落到当前聚焦中心；resetZoom=true 时把缩放设为该中心的上限（进入/切换中心） */
    _applyFocus(canvas, resetZoom) {
        const c = this._candidates[this._focusIndex];
        if (!c || !c.body) return;
        const cap = computeFitZoom(c.fitRadius, canvas);
        camera.x = c.body.position.x;
        camera.y = c.body.position.y;
        setZoomLimits(VIEW_CONFIG.zoomMin, cap);
        if (resetZoom) setZoom(cap);
    }

    /**
     * 每帧更新（flightScene 在相机跟随之后调用）
     * 机动视图：宿主/候选随 SOI 切换刷新，相机聚焦中心天体，放大上限实时保持"刚好容纳"；
     *           宿主变为不可用（飞出 SOI / 换船到恒星轨道或深空）→ 自动回退普通视图并恢复缩放。
     * @returns {boolean} 是否处于机动视图（true 表示本帧相机已由本模块接管）
     */
    updateCamera(ship, canvas) {
        if (!this.isManeuver()) return false;
        const host = resolveHost(ship);
        if (!isManeuverAvailable(host)) {
            this.exitManeuver();
            return false;
        }
        // 宿主变化（SOI 切换 / 切换飞船）→ 重算候选并沿用原 kind 选择
        if (host.name !== this._hostName) {
            const prevKind = this._candidates[this._focusIndex] ? this._candidates[this._focusIndex].kind : 'star';
            this._hostName = host.name;
            this._candidates = getFocusCandidates(host);
            const idx = this._candidates.findIndex(c => c.kind === prevKind);
            this._focusIndex = idx >= 0 ? idx : 0;
            this._applyFocus(canvas, true);
            return true;
        }
        const c = this._candidates[this._focusIndex];
        if (!c) {
            this.exitManeuver();
            return false;
        }
        // 相机聚焦中心天体；上限随屏尺寸/候选刷新（放大不越界，缩小不限）
        camera.x = c.body.position.x;
        camera.y = c.body.position.y;
        const cap = computeFitZoom(c.fitRadius, canvas);
        setZoomLimits(VIEW_CONFIG.zoomMin, cap);
        if (camera.zoom > cap) setZoom(cap);
        return true;
    }
}

// 导出单例
export const flightView = new FlightView();
