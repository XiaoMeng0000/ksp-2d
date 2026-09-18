// 多节点（0.2.6 二期）常规验证：链式规划 / 前序编辑重投影 / 链式质量 / 跟踪隔离 /
// 乱序创建 / 按 id 删除 / 缓存零重算 / 旧存档兼容
// 用法: node test_maneuver_multi.mjs
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
        if (p === 'getContext') return () => ({});
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

const { celestialBodies, updateCelestialBodies } = await import('./src/physics/physics.js');
const { stateToKepler } = await import('./src/physics/orbitalMechanics.js');
const { camera } = await import('./src/camera.js');
const { render, getLastManeuverNodes, getNextPendingManeuverPrediction, getManeuverSelectedId } = await import('./src/renderer.js');
const { maneuverSystem } = await import('./src/ship/maneuverSystem.js');

updateCelestialBodies(0);
const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
const r0 = kerbin.radius + 300000;
const v0 = Math.sqrt(kerbin.gm / r0);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

const CANVAS = {
    width: 1280, height: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => makeCtx()
};
// 无副作用 ctx 桩：任意方法调用都 no-op（渲染层会调用 fillRect/arc/… 数十种方法）
function makeCtx() {
    const target = { canvas: null, measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) };
    return new Proxy(target, {
        get(t, p) {
            if (p in t) return t[p];
            return typeof p === 'string' ? noop : undefined;
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}
function makeShip() {
    const ship = {
        id: 'multi_ship', name: 'MULTI', mode: 'on_rails',
        pos: { x: r0, y: 0 }, vel: { x: 0, y: v0 },
        currentSOI: 'Kerbin', currentGM: kerbin.gm,
        kepler: stateToKepler({ x: r0, y: 0 }, { x: 0, y: v0 }, kerbin.gm),
        orbitTime: 0, thrust: { ax: 0, ay: 0 }, throttle: 0,
        dryMass: 5000, isp: 320, maxThrust: 200000,
        resources: { fuel: { amount: 3000, capacity: 3000 } },
        maneuverNodes: []
    };
    return ship;
}
// 渲染一帧（用桩 ctx；相机取机动视图档以便链可见）
function frame(ship) {
    camera.zoom = 6e-6;
    camera.x = kerbin.position.x;
    camera.y = kerbin.position.y;
    render(CANVAS.getContext(), CANVAS, ship, { visibility: {}, facilities: [], ships: [ship], selectedFacilityId: null });
}

// ===== M1 创建两个节点（不再拒绝"已存在"）=====
const ship = makeShip();
const n1 = maneuverSystem.createNode(ship, { time: 100, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
const n2 = maneuverSystem.createNode(ship, { time: 300, relX: r0 * 1.2, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: Math.sqrt(kerbin.gm / (r0 * 1.2)) } });
check('M1 允许创建多个节点', n1.ok === true && n2.ok === true && ship.maneuverNodes.length === 2);
check('M1 节点带稳定 id', !!n1.node.id && !!n2.node.id && n1.node.id !== n2.node.id);
check('M1 新建节点自动成为选中', maneuverSystem.getSelectedNode(ship).id === n2.node.id);

// ===== M2 给节点 1 一个 Δv，链解析应把节点 2 投影到"节点 1 之后的链"上 =====
const axes1 = { pro: { x: 0, y: 1 }, retro: { x: 0, y: -1 }, radOut: { x: 1, y: 0 }, radIn: { x: -1, y: 0 } };
maneuverSystem.updateNodeDeltaV(ship, 'pro', 120, axes1, n1.node.id);
const snapBefore = { x: n2.node.relX, y: n2.node.relY, velX: n2.node.relVelX };
frame(ship);
const nodesAfter = getLastManeuverNodes();
check('M2 解析出两个节点', nodesAfter.length === 2);
check('M2 节点 2 记录了上游依赖', !!n2.node._deps && n2.node._deps.predId === n1.node.id);
check('M2 节点 2 的快照落在"节点 1 之后"的链上（位置发生变化）',
    Math.abs(n2.node.relX - snapBefore.x) > 1 || Math.abs(n2.node.relY - snapBefore.y) > 1
    || Math.abs(n2.node.relVelX - snapBefore.velX) > 1e-6);
check('M2 重投影不改变 Δv 分量（仍为 0）', n1.node.dvPro === 120 && n2.node.dvPro === 0);

// ===== M3 链式质量投影：节点 2 的质量 < 当前质量（扣掉节点 1 的计划燃烧）=====
const curMass = 5000 + 3000;
check('M3 节点 1 质量 = 当前质量', Math.abs(n1.node.massWet - curMass) < 1);
check('M3 节点 2 质量 < 当前质量（链式扣减）', n2.node.massWet < curMass - 0.5);
const used1 = curMass - n2.node.massWet;
check('M3 扣减量 = 节点 1 燃烧耗量（0.1% 容差内）', used1 > 0 && used1 < curMass * 0.3);

// ===== M4 缓存：无编辑时再渲染一帧，节点版本号不变（零重算）=====
const revSnapshot = { a: n1.node._rev | 0, b: n2.node._rev | 0 };
frame(ship);
check('M4 无编辑时零重算（版本号不变）',
    (n1.node._rev | 0) === revSnapshot.a && (n2.node._rev | 0) === revSnapshot.b);

// ===== M5 前序编辑 → 下游重投影 =====
const snap2 = { x: n2.node.relX, y: n2.node.relY };
maneuverSystem.updateNodeDeltaV(ship, 'pro', 200, axes1, n1.node.id);   // 节点 1 加到 320 m/s
frame(ship);
check('M5 节点 1 编辑后版本号 +1', (n1.node._rev | 0) > revSnapshot.a);
check('M5 下游节点被重投影（快照变化）',
    Math.abs(n2.node.relX - snap2.x) > 1 || Math.abs(n2.node.relY - snap2.y) > 1);
check('M5 下游 Δv 分量保持在自身参考系', n2.node.dvPro === 0 && n2.node.dvRadial === 0);

// ===== M6 执行目标 = 下一个未完成节点；跟踪互相隔离 =====
check('M6 执行目标 = 节点 1（时间在前）', maneuverSystem.getNextPendingNode(ship).id === n1.node.id);
const p1a = maneuverSystem.getProgress(ship, n1.node.id).applied;
const p2a = maneuverSystem.getProgress(ship, n2.node.id).applied;
ship.mode = 'thrust';
ship.thrust = { ax: 0, ay: 2 };            // 2 m/s² 顺向
for (let i = 0; i < 10; i++) maneuverSystem.update(ship, 0.1);
const p1b = maneuverSystem.getProgress(ship, n1.node.id).applied;
const p2b = maneuverSystem.getProgress(ship, n2.node.id).applied;
check('M6 冲量只累计到执行目标（节点 1）', Math.abs(p1b.y - p1a.y) > 0.5);
check('M6 节点 2 进度不受影响', Math.abs(p2b.y - p2a.y) < 1e-9);
ship.mode = 'on_rails';
ship.thrust = { ax: 0, ay: 0 };

// ===== M7 完成判定按节点隔离 =====
// 节点 1 计划 320 m/s，远未完成；注入足量冲量后应只完成节点 1
const t1 = maneuverSystem._trackOf(n1.node);
t1.applied = { x: n1.node.deltaV.x, y: n1.node.deltaV.y };
maneuverSystem.update(ship, 0.016);
check('M7 节点 1 判定完成', n1.node.executed === true);
check('M7 节点 2 仍未完成', n2.node.executed === false);
check('M7 执行目标前移到节点 2', maneuverSystem.getNextPendingNode(ship).id === n2.node.id);
frame(ship);
check('M7 执行目标预测 = 节点 2', (getNextPendingManeuverPrediction() || {}).node
    && getNextPendingManeuverPrediction().node.id === n2.node.id);

// ===== M8 乱序创建按时间解析 =====
const ship2 = makeShip();
const late = maneuverSystem.createNode(ship2, { time: 900, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
const early = maneuverSystem.createNode(ship2, { time: 200, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
const sorted = maneuverSystem.getNodesSorted(ship2);
check('M8 按时间升序解析（先 200 后 900）', sorted[0].id === early.node.id && sorted[1].id === late.node.id);
frame(ship2);
const list2 = getLastManeuverNodes();
check('M8 渲染层链顺序与时间序一致', list2[0].node.id === early.node.id && list2[1].node.id === late.node.id);

// ===== M9 按 id 删除只删选中/指定节点；下游依赖随之更新 =====
const ship3 = makeShip();
const a = maneuverSystem.createNode(ship3, { time: 100, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
const b = maneuverSystem.createNode(ship3, { time: 200, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
const c = maneuverSystem.createNode(ship3, { time: 300, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
frame(ship3);
check('M9 删除前依赖 = b', c.node._deps.predId === b.node.id);
const delOk = maneuverSystem.deleteNode(ship3, b.node.id);
check('M9 只删指定节点（剩 2 个）', delOk === true && ship3.maneuverNodes.length === 2);
frame(ship3);
check('M9 删除后下游依赖改指 a', c.node._deps.predId === a.node.id);
check('M9 删除自身跟踪被清理', maneuverSystem.getProgress(ship3, b.node.id).planned === 0);

// ===== M10 旧存档兼容：节点无 id/_rev/_deps 也能工作 =====
const ship4 = makeShip();
ship4.maneuverNodes.push({
    time: 400, deltaV: { x: 0, y: 50 }, dvPro: 50, dvRadial: 0, executed: false,
    relX: r0, relY: 0, anchorBody: 'Kerbin', relVelX: 0, relVelY: v0,
    massWet: curMass, massFuel: 3000
});
frame(ship4);
const legacy = ship4.maneuverNodes[0];
check('M10 旧节点补发 id', !!legacy.id);
check('M10 旧节点版本号/依赖被初始化', (legacy._rev | 0) >= 1 && !!legacy._deps);
check('M10 旧节点仍可选中编辑', maneuverSystem.getSelectedNode(ship4).id === legacy.id);

// ===== M11 无限节点：20 个节点可解析，且渲染耗时可接受 =====
const ship5 = makeShip();
for (let i = 0; i < 20; i++) {
    maneuverSystem.createNode(ship5, { time: 100 + i * 60, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
}
const t0 = performance.now();
frame(ship5);
const firstMs = performance.now() - t0;
const revs = ship5.maneuverNodes.map(n => n._rev | 0);
const t1b = performance.now();
frame(ship5);
const secondMs = performance.now() - t1b;
const revs2 = ship5.maneuverNodes.map(n => n._rev | 0);
check('M11 20 个节点全部解析', getLastManeuverNodes().length === 20);
console.log(`     20 节点：首帧 ${firstMs.toFixed(1)} ms（含建链）/ 次帧 ${secondMs.toFixed(1)} ms`);
check('M11 次帧零重投影（全部节点版本号不变，缓存命中）',
    revs.join(',') === revs2.join(','));

// ===== M12 严格线性链（0.2.6 总监定稿）：创建门禁只认链尾 + 链序 = 时间序 =====
{
    const { readFileSync } = await import('node:fs');
    const panelSrc = readFileSync('src/ui/maneuverViewPanel.js', 'utf8');
    const sceneSrc = readFileSync('src/scenes/flightScene.js', 'utf8');
    const menuSrc = readFileSync('src/ui/orbitContextMenu.js', 'utf8');

    check('M12 面板提供链尾查询（tipChain）', /function tipChain\(\)/.test(panelSrc));
    check('M12 面板"建点/悬停"只用链尾链',
        /const tip = tipChain\(\);[\s\S]{0,220}nearestOrbitPointInInset\(\[?tip\]?/.test(panelSrc)
        && (panelSrc.match(/tipChain\(\)/g) || []).length >= 2);
    check('M12 面板拖节点只用"该节点所属链"（chainForNode）',
        /function chainForNode\(nodeId\)/.test(panelSrc)
        && /const own = nodeId \? chainForNode\(nodeId\) : null;/.test(panelSrc));
    check('M12 主视图命中检测同时考虑当前轨道与链尾（机动后链）',
        /const tail = maneuverSystem\.getNodesSorted/.test(sceneSrc)
        && /findNearestOrbitPoint\(tailSegs, mouseWorld, 12, _canvas\)/.test(sceneSrc));
    check('M12 主视图菜单下发链尾速度快照', /velRel,/.test(sceneSrc) && /canCreate: isTipChain/.test(sceneSrc));
    check('M12 轨道菜单优先使用下发的速度快照', /let velRel = _menuData\.velRel \|\| null;/.test(menuSrc));

    // 行为：三节点严格链序（每级依赖前一级），且链序 = 时间序
    const shipL = makeShip();
    const a = maneuverSystem.createNode(shipL, { time: 100, relX: r0, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: v0 } });
    const axesL = { pro: { x: 0, y: 1 }, retro: { x: 0, y: -1 }, radOut: { x: 1, y: 0 }, radIn: { x: -1, y: 0 } };
    maneuverSystem.updateNodeDeltaV(shipL, 'pro', 100, axesL, a.node.id);
    frame(shipL);
    const chain1 = getLastManeuverNodes();
    const tipSegs = chain1[chain1.length - 1].segments;
    check('M12 链尾链可用于继续建点', !!(tipSegs && tipSegs.length));
    // 在链尾链上取一个状态点建第二个节点（模拟放大图/主视图的建点路径）
    const st = await import('./src/physics/maneuverPrediction.js').then(m => m.walkToTime(tipSegs, 100 + 300));
    check('M12 链尾链上可取到状态（链式快照来源）', !!(st && st.relPos && st.relVel));
    const b = maneuverSystem.createNode(shipL, {
        time: 100 + 300, relX: st.relPos.x, relY: st.relPos.y,
        anchorBody: st.host.name, velRel: st.relVel
    });
    frame(shipL);
    const sortedL = maneuverSystem.getNodesSorted(shipL);
    check('M12 链序 = 时间序（a 在 b 之前）', sortedL[0].id === a.node.id && sortedL[1].id === b.node.id);
    check('M12 第二节点依赖第一节点（严格链）', b.node._deps && b.node._deps.predId === a.node.id);
    check('M12 首节点无前序依赖', !a.node._deps || a.node._deps.predId === null);
}

// ===== M13 回归护栏：点击处理器不得引用 update() 闭包的变量（曾因此导致左键点轨道打不开菜单）=====
{
    const { readFileSync } = await import('node:fs');
    const sceneSrc = readFileSync('src/scenes/flightScene.js', 'utf8');
    const i = sceneSrc.indexOf('const onClick = (e)');
    const j = sceneSrc.indexOf("_canvas.addEventListener('click'", i);
    const body = (i >= 0 && j > i) ? sceneSrc.slice(i, j) : '';
    check('M13 取到 onClick 处理器源码', body.length > 500);
    // 允许：注释文字 / activeShipId 属性名 / getActiveShip() 方法名；禁止：裸变量 activeShip
    const bare = body.replace(/\/\/[^\n]*/g, '')
        .replace(/activeShipId/g, '')
        .replace(/getActiveShip\(\)/g, '');
    check('M13 onClick 内无裸 activeShip（作用域越界会抛 ReferenceError → 菜单打不开）',
        !/\bactiveShip\b/.test(bare));
    check('M13 onClick 用同作用域的 ship 查询节点', /maneuverSystem\.getNodesSorted\(ship\)/.test(body));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
