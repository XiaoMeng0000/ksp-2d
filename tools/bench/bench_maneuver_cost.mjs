// 机动节点开销基准（常规验证）：定位"Kerbolar 系 + 存在机动节点"时机动视图掉帧的热点
// 用法: node tools/bench/bench_maneuver_cost.mjs
globalThis.window = globalThis.window || {};
const noop = () => {};
globalThis.window.addEventListener = noop;
globalThis.window.removeEventListener = noop;
globalThis.window.devicePixelRatio = 1;
globalThis.window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
const elStub = () => new Proxy({}, {
    get(t, p) {
        if (p === 'style') return {};
        if (p === 'dataset') return {};
        if (p === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
        if (p === 'getContext') return () => makeCtx();
        if (p === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 1280, height: 720 });
        if (p === 'querySelector') return () => elStub();
        if (p === 'querySelectorAll') return () => [];
        if (p === 'children') return [];
        if (p === 'textContent' || p === 'innerHTML' || p === 'className') return '';
        if (p === 'offsetHeight' || p === 'offsetWidth') return 0;
        if (p === 'getAttribute') return () => null;
        if (p === 'contains') return () => false;
        if (p === 'parentElement' || p === 'parentNode' || p === 'firstChild') return null;
        return typeof p === 'string' ? noop : undefined;
    },
    set() { return true; }
});
globalThis.document = {
    documentElement: { style: { setProperty: noop } },
    createElement: () => elStub(), createElementNS: () => elStub(), body: elStub(),
    addEventListener: noop, removeEventListener: noop,
    getElementById: () => elStub(), querySelector: () => elStub(), querySelectorAll: () => []
};
globalThis.localStorage = { getItem: () => null, setItem: noop };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

let COUNTS = {};
function makeCtx() {
    const target = { canvas: null, save: noop, restore: noop, measureText: () => ({ width: 10 }) };
    return new Proxy(target, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            return () => { COUNTS[p] = (COUNTS[p] || 0) + 1; };
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}
const CANVAS = {
    width: 1280, height: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => makeCtx()
};

const { celestialBodies, setActiveSystems, updateCelestialBodies } = await import('../../src/physics/physics.js');
const { stateToKepler } = await import('../../src/physics/orbitalMechanics.js');
const { predictTrajectoryPatched, bodyFuturePos, getCachedTime } = await import('../../src/physics/orbitalPrediction.js');
const { predictManeuverTrajectories } = await import('../../src/physics/maneuverPrediction.js');
const { camera } = await import('../../src/camera.js');
const rendererMod = await import('../../src/renderer.js');

const { render } = rendererMod;

setActiveSystems(['kerbolar']);
updateCelestialBodies(0);
const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
const kerbol = celestialBodies.find(b => b.name === 'Kerbol');
const r0 = kerbin.radius + 300000;
const g0 = Math.sqrt(kerbin.gm / r0);
const ship = {
    id: 'bench', name: 'BENCH', mode: 'on_rails',
    pos: { x: r0, y: 0 }, vel: { x: 0, y: g0 },
    currentSOI: 'Kerbin', currentGM: kerbin.gm,
    kepler: stateToKepler({ x: r0, y: 0 }, { x: 0, y: g0 }, kerbin.gm),
    orbitTime: 0, thrust: { ax: 0, ay: 0 },
    dryMass: 5000, isp: 320, maxThrust: 200000,
    resources: { fuel: { amount: 3000, capacity: 3000 } },
    maneuverNodes: []
};

function timeIt(label, fn, n = 20) {
    fn();                       // 预热
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    const ms = (performance.now() - t0) / n;
    return { label, ms: +ms.toFixed(3) };
}

function countPoints(segs) {
    let total = 0;
    const anchors = {};
    for (const s of segs || []) {
        total += (s.relPoints || []).length;
        anchors[s.anchorBody] = (anchors[s.anchorBody] || 0) + (s.relPoints || []).length;
    }
    return { total, anchors };
}

console.log('===== 1) 预测链规模（Kerbolar 系，300 km 圆轨道）=====');
let baseSegs = [];
const tBase = timeIt('base chain', () => {
    camera.x = kerbol.position.x; camera.y = kerbol.position.y; camera.zoom = 2.4e-8;
    baseSegs = predictTrajectoryPatched(ship, 0);
});
const baseInfo = countPoints(baseSegs);
console.log(`  基础链: ${tBase.ms} ms  段数=${baseSegs.length}  点数=${baseInfo.total}  锚点分布=${JSON.stringify(baseInfo.anchors)}`);

// 加机动节点：860 m/s 顺向（Mun 转移量级）
const node = {
    time: 300, relX: r0, relY: 0, anchorBody: 'Kerbin',
    relVelX: 0, relVelY: g0,
    dvPro: 860, dvRadial: 0,
    deltaV: { x: 0, y: 860 },
    massWet: 20000, massFuel: 3000, executed: false
};
ship.maneuverNodes = [node];

console.log('\n===== 2) 机动预测链规模 =====');
let pred = null;
const tPred = timeIt('maneuver prediction', () => {
    pred = predictManeuverTrajectories(ship, node, baseSegs);
});
const predSegs = (pred && pred.plan && pred.plan.segments) || [];
const predInfo = countPoints(predSegs);
console.log(`  机动链: ${tPred.ms} ms  段数=${predSegs.length}  点数=${predInfo.total}  锚点分布=${JSON.stringify(predInfo.anchors)}`);
if (pred && pred.burnArc) console.log(`  燃烧弧点数=${(pred.burnArc.relPoints || []).length}`);
console.log(`  段明细: ${predSegs.map(s => (s.anchorBody || '?') + ':' + (s.relPoints || []).length).join('  ')}`);

console.log('\n===== 3) 面板侧逐帧换算开销（换系段逐点 bodyFuturePos）=====');
// 模拟 segmentPointsInHostFrame + referenceRadius + 抽稀 的每帧成本
function panelPerFrameCost(segs, host, withConvert) {
    let total = 0;
    for (const seg of segs) {
        const anchorName = seg.anchorBody || seg.segSoiName;
        if (!anchorName || anchorName === host.name) {
            for (const p of seg.relPoints) total += Math.hypot(p.x, p.y);
            continue;
        }
        if (!withConvert) continue;
        const anchorBody = celestialBodies.find(b => b.name === anchorName);
        if (!anchorBody) continue;
        for (const p of seg.relPoints) {
            const t = (p.t !== undefined && isFinite(seg.anchorTime)) ? seg.anchorTime + p.t : null;
            const ap = t !== null ? bodyFuturePos(anchorBody, t) : anchorBody.position;
            const hp = t !== null ? bodyFuturePos(host, t) : host.position;
            total += Math.hypot(p.x + ap.x - hp.x, p.y + ap.y - hp.y);
        }
    }
    return total;
}
const tPanelBase = timeIt('panel base chain', () => panelPerFrameCost(baseSegs, kerbin, true), 30);
const tPanelPred = timeIt('panel maneuver chain', () => panelPerFrameCost(predSegs, kerbin, true), 30);
console.log(`  基础链换算: ${tPanelBase.ms} ms/帧`);
console.log(`  机动链换算: ${tPanelPred.ms} ms/帧  (含换系段逐点 Kepler 求解)`);

console.log('\n===== 4) 主渲染器每帧开销（有/无节点 × 聚焦恒星/行星）=====');
function benchRender(label, focusBody, zoom) {
    camera.zoom = zoom;
    camera.x = focusBody.position.x;
    camera.y = focusBody.position.y;
    const ctx = makeCtx();
    const opts = { visibility: {}, facilities: [], ships: [ship], selectedFacilityId: null };
    COUNTS = {};
    render(ctx, CANVAS, ship, opts);
    COUNTS = {};
    const N = 10;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
        updateCelestialBodies((i + 1) * 0.016);
        render(ctx, CANVAS, ship, opts);
    }
    const ms = (performance.now() - t0) / N;
    const total = Object.values(COUNTS).reduce((a, b) => a + b, 0);
    const top = Object.entries(COUNTS).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + '=' + v).join(' ');
    console.log(`  [${label}] ${ms.toFixed(2)} ms/帧  canvas≈${Math.round(total / N)}/帧  ${top}`);
    return +ms.toFixed(2);
}
const fitStar = 0.9 * Math.min(CANVAS.width, CANVAS.height) / 2 / Math.abs(kerbin.orbitA);
// 聚焦 Kerbin 的上限 = 刚好容纳 Minmus 轨道
const minmus = celestialBodies.find(b => b.name === 'Minmus');
const fitKerbin = 0.9 * Math.min(CANVAS.width, CANVAS.height) / 2 / (Math.abs(minmus.orbitA) * (1 + (minmus.orbitE || 0)));
console.log(`  缩放档: 聚焦恒星 zoom=${fitStar.toExponential(2)}  聚焦 Kerbin zoom=${fitKerbin.toExponential(2)}`);

ship.maneuverNodes = [];
const noNodeStar = benchRender('无节点·恒星档', kerbol, fitStar);
const noNodeKerbin = benchRender('无节点·Kerbin档', kerbin, fitKerbin);
ship.maneuverNodes = [node];
const withNodeStar = benchRender('有节点·恒星档', kerbol, fitStar);
const withNodeKerbin = benchRender('有节点·Kerbin档', kerbin, fitKerbin);

console.log('\n===== 汇总 =====');
console.log(`  主渲染 JS: 无节点·恒星 ${noNodeStar} | 无节点·Kerbin ${noNodeKerbin} | 有节点·恒星 ${withNodeStar} | 有节点·Kerbin ${withNodeKerbin} ms/帧`);
console.log(`  面板换算:  基础链 ${tPanelBase.ms} | 机动链 ${tPanelPred.ms} ms/帧`);
console.log(`  机动预测计算: ${tPred.ms} ms（缓存命中时不再重算）`);
