// 虚线展开量基准（决定性测量）：统计每帧 "路径长度 ÷ 虚线周期" 的总和
// —— 浏览器把虚线按弧长逐段展开，段数爆炸是 2D canvas 掉帧的经典元凶。
// 用法: node bench_dash_cost.mjs
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

// —— 统计 ctx：路径长度 + 虚线展开量 + 半径分布
let STATS = null;
function resetStats() {
    STATS = {
        dashUnits: 0,          // Σ 路径长 / 虚线周期（虚线展开段数）
        pathLen: 0,            // Σ 路径总长（px）
        longestDashPath: 0,
        bigRadiusArcs: 0,      // 半径 > 2000px 的圆
        arcs: 0, lineTos: 0
    };
}
resetStats();

function makeCtx() {
    const st = { dash: null, len: 0, maxLen: 0, last: null, cx: null, cy: null };
    const target = { canvas: null, save: noop, restore: noop, measureText: () => ({ width: 10 }) };
    const impl = {
        beginPath: () => { st.len = 0; st.last = null; },
        moveTo: (x, y) => { st.last = { x, y }; },
        lineTo: (x, y) => {
            if (st.last) {
                const d = Math.hypot(x - st.last.x, y - st.last.y);
                if (isFinite(d)) st.len += d;
            }
            st.last = { x, y };
            STATS.lineTos++;
        },
        arc: (cx, cy, r) => {
            STATS.arcs++;
            if (r > 2000) STATS.bigRadiusArcs++;
            st.len += 2 * Math.PI * r;
        },
        setLineDash: (arr) => { st.dash = (arr && arr.length >= 2) ? (arr[0] + arr[1]) : null; },
        stroke: () => {
            STATS.pathLen += st.len;
            if (st.dash) {
                STATS.dashUnits += st.len / st.dash;
                if (st.len > STATS.longestDashPath) STATS.longestDashPath = st.len;
            }
        },
        fill: noop, fillRect: noop, strokeRect: noop, clearRect: noop, clip: noop,
        translate: noop, rotate: noop, scale: noop, setTransform: noop, save: noop, restore: noop,
        drawImage: noop, fillText: noop, createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null,
        ellipse: (cx, cy, rx, ry) => { STATS.arcs++; st.len += Math.PI * (rx + ry); }
    };
    return new Proxy(target, {
        get(t, p) {
            if (p in impl) return impl[p];
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            return noop;
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}
const CANVAS = {
    width: 1280, height: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => makeCtx()
};

const { celestialBodies, setActiveSystems, updateCelestialBodies } = await import('./src/physics/physics.js');
const { stateToKepler } = await import('./src/physics/orbitalMechanics.js');
const { camera } = await import('./src/camera.js');
const { render } = await import('./src/renderer.js');

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
const node = {
    time: 300, relX: r0, relY: 0, anchorBody: 'Kerbin', relVelX: 0, relVelY: g0,
    dvPro: 860, dvRadial: 0, deltaV: { x: 0, y: 860 }, massWet: 20000, massFuel: 3000, executed: false
};

function measure(label, camBody, zoom, withNode) {
    ship.maneuverNodes = withNode ? [node] : [];
    camera.zoom = zoom;
    camera.x = camBody.position.x;
    camera.y = camBody.position.y;
    const ctx = makeCtx();
    const opts = { visibility: {}, facilities: [], ships: [ship], selectedFacilityId: null };
    render(ctx, CANVAS, ship, opts);           // 预热（含预测缓存）
    resetStats();
    const N = 6;
    for (let i = 0; i < N; i++) {
        updateCelestialBodies((i + 1) * 0.016);
        render(ctx, CANVAS, ship, opts);
    }
    const dash = Math.round(STATS.dashUnits / N);
    const len = Math.round(STATS.pathLen / N);
    console.log(`  ${label.padEnd(26)} 虚线展开≈${String(dash).padStart(8)}/帧   路径总长≈${String(len).padStart(9)}px/帧   lineTo=${Math.round(STATS.lineTos / N)}   大半径圆=${Math.round(STATS.bigRadiusArcs / N)}`);
    return dash;
}

const star = 0.9 * Math.min(CANVAS.width, CANVAS.height) / 2 / Math.abs(kerbin.orbitA);
const minmus = celestialBodies.find(b => b.name === 'Minmus');
const kerbin3 = celestialBodies.find(b => b.name === 'Kerbin');
const planet = 0.9 * Math.min(CANVAS.width, CANVAS.height) / 2 / (Math.minmus ? 1 : 1);
const planetFit = 0.9 * Math.min(CANVAS.width, CANVAS.height) / 2 / (Math.abs(minmus.orbitA) * (1 + (minmus.orbitE || 0)));

console.log('===== 虚线展开量扫描（Kerbolar 系，300 km 圆轨道）=====');
console.log('— 无机动节点 —');
measure('恒星档 zoom=2.4e-8', kerbol, star, false);
measure('中间档 zoom=1e-6', kerbin3, 1e-6, false);
measure('中间档 zoom=1e-5', kerbin3, 1e-5, false);
measure('Kerbin 档 zoom=6.9e-6', kerbin3, planetFit, false);
console.log('— 有机动节点（860 m/s 逃逸）—');
const d1 = measure('恒星档 zoom=2.4e-8', kerbol, star, true);
const d2 = measure('中间档 zoom=1e-6', kerbin3, 1e-6, true);
const d3 = measure('中间档 zoom=1e-5', kerbin3, 1e-5, true);
const d4 = measure('Kerbin 档 zoom=6.9e-6', kerbin3, planetFit, true);
console.log('\n结论参考：虚线展开 ≈10 万/帧以上即会明显掉帧；≈100 万/帧基本卡死。');
