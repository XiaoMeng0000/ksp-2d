// 渲染开销基准（常规验证用，无需浏览器）：
// 用"计数 Proxy ctx"跑真实 render()，统计每帧 canvas 调用次数与 JS 耗时，
// 对比 Kerbolar 系（17 天体）与测试星系（少数天体）在**同一缩放档**下的开销差异。
// 用法: node tools/bench/bench_render_cost.mjs
globalThis.window = globalThis.window || {};

// —— 最小 DOM 桩（与 test_module_graph 同风格）
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
        if (p === 'appendChild' || p === 'removeChild' || p === 'setAttribute' || p === 'removeAttribute'
            || p === 'addEventListener' || p === 'removeEventListener' || p === 'remove' || p === 'insertBefore') return noop;
        if (p === 'querySelector') return () => elStub();
        if (p === 'querySelectorAll') return () => [];
        if (p === 'children') return [];
        if (p === 'textContent' || p === 'innerHTML' || p === 'className') return '';
        if (p === 'offsetHeight' || p === 'offsetWidth' || p === 'offsetTop' || p === 'offsetLeft') return 0;
        if (p === 'getAttribute') return () => null;
        if (p === 'contains') return () => false;
        if (p === 'parentElement' || p === 'parentNode' || p === 'firstChild' || p === 'nextSibling') return null;
        return typeof p === 'string' ? noop : undefined;
    },
    set() { return true; }
});
globalThis.document = {
    documentElement: { style: { setProperty: noop } },
    createElement: () => elStub(),
    createElementNS: () => elStub(),
    body: elStub(),
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => elStub(),
    querySelector: () => elStub(),
    querySelectorAll: () => []
};
globalThis.localStorage = { getItem: () => null, setItem: noop };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// —— 计数 ctx：统计每帧各类绘制调用次数
function makeCtx() {
    const counts = {};
    const target = {
        canvas: { width: 1280, height: 720 },
        save: noop, restore: noop,
        measureText: () => ({ width: 10 })
    };
    return new Proxy(target, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            return (...args) => { counts[p] = (counts[p] || 0) + 1; return undefined; };
        },
        set(t, p, v) { t[p] = v; return true; }
    });
    // 注：counts 通过闭包返回给调用方（见下）
}

const { celestialBodies, setActiveSystems, updateCelestialBodies } = await import('../../src/physics/physics.js');
const { stateToKepler } = await import('../../src/physics/orbitalMechanics.js');
const { camera } = await import('../../src/camera.js');
const { render } = await import('../../src/renderer.js');

const CANVAS = {
    width: 1280,
    height: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => makeCtx()
};

// 通过代理内联统计（每次 render 前重置计数）
let COUNTS = {};
function makeCountingCtx() {
    const target = {
        canvas: CANVAS,
        save: noop, restore: noop,
        measureText: () => ({ width: 10 })
    };
    return new Proxy(target, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            return () => { COUNTS[p] = (COUNTS[p] || 0) + 1; };
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}

function bench(label, systems, shipSoi) {
    setActiveSystems(systems);
    updateCelestialBodies(0);
    const host = celestialBodies.find(b => b.name === shipSoi);
    if (!host) { console.log(`\n[${label}] 跳过：宿主 ${shipSoi} 不在该星系`); return null; }
    const r0 = (host.radius || 600000) + 300000;
    const g0 = Math.sqrt(host.gm / r0);
    const ship = {
        id: 'bench_ship', name: 'BENCH', mode: 'on_rails',
        pos: { x: r0, y: 0 }, vel: { x: 0, y: g0 },
        currentSOI: host.name, currentGM: host.gm,
        kepler: null, orbitTime: 0,
        thrust: { ax: 0, ay: 0 },
        dryMass: 5000, isp: 320, maxThrust: 200000,
        resources: { fuel: { amount: 3000, capacity: 3000 } },
        maneuverNodes: []
    };
    ship.kepler = stateToKepler(ship.pos, ship.vel, host.gm);

    // 相机：模拟机动视图档（聚焦恒星，缩放到"容纳宿主轨道"）
    const star = celestialBodies.find(b => b.type === 'star');
    const hostOrbit = Math.abs(host.orbitA || host.soiRadius) * (1 + (host.orbitE || 0));
    camera.zoom = 0.9 * Math.min(CANVAS.width, CANVAS.height) / 2 / (hostOrbit || host.soiRadius);
    camera.x = star ? star.position.x : 0;
    camera.y = star ? star.position.y : 0;

    const ctx = makeCountingCtx();
    const opts = { visibility: {}, facilities: [], ships: [ship], selectedFacilityId: null };
    COUNTS = {};
    render(ctx, CANVAS, ship, opts);        // 预热
    COUNTS = {};
    const N = 12;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
        updateCelestialBodies((i + 1) * 0.016);
        render(ctx, CANVAS, ship, opts);
    }
    const ms = (performance.now() - t0) / N;
    const total = Object.values(COUNTS).reduce((a, b) => a + b, 0);
    const top = Object.entries(COUNTS).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => k + '=' + v).join(' ');
    console.log(`\n[${label}]  天体数=${celestialBodies.length}  zoom=${camera.zoom.toExponential(2)}`);
    console.log(`  JS 每帧 ${ms.toFixed(2)} ms   canvas 调用/帧 ≈ ${Math.round(total / N)}`);
    console.log(`  调用明细: ${top}`);
    return { label, bodies: celestialBodies.length, msPerFrame: +ms.toFixed(2), callsPerFrame: Math.round(total / N) };
}

const rows = [];
rows.push(bench('Kerbolar 系', ['kerbolar'], 'Kerbin'));
rows.push(bench('测试星系', ['testbolar'], 'Kerbin (test)'));
rows.push(bench('Debdeb 测试系', ['debdebTest'], null) );

console.log('\n===== 对比 =====');
console.log('星系'.padEnd(16) + '天体数'.padEnd(8) + 'JS ms/帧'.padEnd(12) + 'canvas 调用/帧');
for (const r of rows) {
    if (!r) continue;
    console.log(r.label.padEnd(16) + String(r.bodies).padEnd(8) + String(r.msPerFrame).padEnd(12) + r.callsPerFrame);
}
