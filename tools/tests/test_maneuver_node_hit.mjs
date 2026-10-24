// 机动节点"命中"自测（node 环境，零依赖）：
//   ① 真实曲线最近时刻解析（折线只做粗筛 + P(t) 精化）
//   ② 节点快照原子写入（relPos/relVel/anchorBody/time 同一次求值）
//   ③ 机动后链命中的段索引不再错配（命中 tailSegs 就必须在 tailSegs 上取段）
// 用法: node tools/tests/test_maneuver_node_hit.mjs
// 注：浏览器全局 window 在 node 下缺失，注入最小垫片后再动态导入业务模块
globalThis.window = globalThis.window || {};
const noop = () => {};
globalThis.window.addEventListener = globalThis.window.addEventListener || noop;
globalThis.window.removeEventListener = globalThis.window.removeEventListener || noop;
globalThis.window.devicePixelRatio = 1;

const { celestialBodies, updateCelestialBodies } = await import('../../src/physics/physics.js');
const { stateToKepler } = await import('../../src/physics/orbitalMechanics.js');
const { predictTrajectoryPatched, bodyFuturePos, getCachedTime } = await import('../../src/physics/orbitalPrediction.js');
const {
    predictManeuverTrajectories, walkToTime, segmentStateAtTime
} = await import('../../src/physics/maneuverPrediction.js');
const { resolveNearestPointOnChain, findNearestChainPoint } = await import('../../src/ship/maneuverChain.js');
const { maneuverSystem } = await import('../../src/ship/maneuverSystem.js');

// 天体位置初始化（浏览器侧由 main.js 每帧推进；node 测试需手动初始化）
updateCelestialBodies(0);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const fmt = (v) => (isFinite(v) ? v.toExponential(2) : String(v));

const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
if (!kerbin) { console.error('找不到 Kerbin'); process.exit(1); }
const rK = kerbin.radius + 300000;
const vK = Math.sqrt(kerbin.gm / rK);

// 轨道参考系轴（手柄注入用；与 maneuverSystem.updateNodeDeltaV 同构）
const AXES = {
    pro: { x: 0, y: 1 }, retro: { x: 0, y: -1 },
    radOut: { x: 1, y: 0 }, radIn: { x: -1, y: 0 }
};

function makeShip(id, host, r, v, gm) {
    return {
        id, name: id.toUpperCase(), mode: 'on_rails',
        pos: { x: r, y: 0 }, vel: { x: 0, y: v },
        currentSOI: host.name, currentGM: gm,
        kepler: stateToKepler({ x: r, y: 0 }, { x: 0, y: v }, gm),
        orbitTime: 0, thrust: { ax: 0, ay: 0 }, throttle: 0,
        dryMass: 5000, isp: 320, maxThrust: 200000,
        resources: { fuel: { amount: 3000, capacity: 3000 } },
        maneuverNodes: []
    };
}

// 段内 tLocal（相对段起点秒）→ 世界点（命中口径：段点 + 宿主当前时刻位置，与渲染轨道线同锚）
function worldOnSegment(seg, tLocal, offsetRadial) {
    const st = segmentStateAtTime(seg, seg.anchorTime + tLocal);
    if (!st) return null;
    const hp = bodyFuturePos(st.host, getCachedTime());
    let wx = st.relPos.x + hp.x;
    let wy = st.relPos.y + hp.y;
    if (offsetRadial) {
        const r = Math.hypot(st.relPos.x, st.relPos.y) || 1;
        wx += st.relPos.x / r * offsetRadial;
        wy += st.relPos.y / r * offsetRadial;
    }
    return { x: wx, y: wy, state: st };
}

// 节点快照与"该时刻真实曲线状态"的偏差（原子性判据）
function atomicityError(segments, node) {
    const st = walkToTime(segments, node.time);
    if (!st) return null;
    return {
        dPos: Math.hypot(node.relX - st.relPos.x, node.relY - st.relPos.y),
        dVel: Math.hypot(node.relVelX - st.relVel.x, node.relVelY - st.relVel.y),
        host: st.host ? st.host.name : null
    };
}

const THR = 30000;          // 命中阈值（世界长度 30 km，相当于缩放后十余像素）
const SNAP_TOL = 1e-6;      // 原子性容差（m / m/s）：同一次求值应为 0（留浮点余量）

// ===== 断言1a：主视图"建点"路径（基础链命中 → createNode 原子写入）=====
const shipA = makeShip('hit_a', kerbin, rK, vK, kerbin.gm);
const chainA = predictTrajectoryPatched(shipA);
const segA = chainA[0];
const spanA = segA.relPoints[segA.relPoints.length - 1].t;
const T0A = Math.min(240, spanA * 0.05);
{
    const w = worldOnSegment(segA, T0A, 8000);           // 鼠标点在曲线外侧 8 km（非精确重合）
    const near = resolveNearestPointOnChain(chainA, w, THR);
    check('A1 基础链命中成功（非空）', !!near);
    check('A1 解析段走 kepler 传播（exact=true）', !!near && near.exact === true);
    const createRes = maneuverSystem.createNode(shipA, {
        time: near.time, relX: near.relPos.x, relY: near.relPos.y,
        anchorBody: near.anchorBody, velRel: near.relVel
    });
    const nodeA = createRes.node;
    check('A1 节点创建成功', createRes.ok === true && !!nodeA);
    const err = atomicityError(chainA, nodeA);
    console.log(`     [A1] 建点 Δpos=${fmt(err.dPos)} m / Δvel=${fmt(err.dVel)} m/s`);
    check('A1 节点位置与 stateAt(node.time) 一致（原子性）', err.dPos <= SNAP_TOL);
    check('A1 节点速度与 stateAt(node.time) 一致（原子性）', err.dVel <= SNAP_TOL);
    check('A1 节点宿主 = 段宿主（anchorBody 同一次求值）', err.host === nodeA.anchorBody);

    // ===== 断言1b：主视图"拖节点"路径（解析器结果 → updateNodeTime 一次性写入）=====
    const T1A = Math.min(420, spanA * 0.08);
    const w1 = worldOnSegment(segA, T1A, -6000);
    const near1 = resolveNearestPointOnChain(chainA, w1, THR);
    check('A1 拖动命中成功', !!near1);
    maneuverSystem.updateNodeTime(shipA, {
        time: near1.time, relX: near1.relPos.x, relY: near1.relPos.y,
        anchorBody: near1.anchorBody, velRel: near1.relVel
    }, nodeA);
    const err1 = atomicityError(chainA, nodeA);
    console.log(`     [A1] 拖动 Δpos=${fmt(err1.dPos)} m / Δvel=${fmt(err1.dVel)} m/s`);
    check('A1 拖动后位置原子一致', err1.dPos <= SNAP_TOL);
    check('A1 拖动后速度原子一致', err1.dVel <= SNAP_TOL);
}

// ===== 断言2：命中精度（已知时刻 T0 的曲线点 → 返回 time ≈ T0）=====
{
    const cases = [Math.min(60, spanA * 0.9), Math.min(240, spanA * 0.9), Math.min(480, spanA * 0.9)];
    let worstExact = 0;
    let worstOffset = 0;
    for (const T of cases) {
        const w = worldOnSegment(segA, T, 0);
        const near = resolveNearestPointOnChain(chainA, w, THR);
        if (near) worstExact = Math.max(worstExact, Math.abs(near.time - (segA.anchorTime + T)));
        // 径向偏移 0.5 个阈值：最近时刻理论上仍是 T（径向偏移与圆轨道曲线正交）
        const wo = worldOnSegment(segA, T, THR * 0.5);
        const nearO = resolveNearestPointOnChain(chainA, wo, THR);
        if (nearO) worstOffset = Math.max(worstOffset, Math.abs(nearO.time - (segA.anchorTime + T)));
    }
    console.log(`     [A2] 精确点最差 Δt=${fmt(worstExact)} s / 径向偏移点最差 Δt=${fmt(worstOffset)} s`);
    check('A2 精确曲线点返回时刻偏差 ≤ 1e-3 s', worstExact <= 1e-3);
    check('A2 径向偏移（0.5 阈值）时刻偏差 ≤ 0.05 s', worstOffset <= 0.05);
}

// ===== 断言3：检查点 8 类场景（Eve 双曲近点）=====
// 真实轨道 a=-2418387 m / e=1.579（近点半径 ≈ 1.4e6 m）；旧实现"弦位置 + walkToTime 速度"
// 混写出 a=3027261 m / e=0.660 的无关椭圆，本段断言修复后不再退化。
const eve = celestialBodies.find(b => b.name === 'Eve');
if (!eve) { console.error('找不到 Eve'); process.exit(1); }
const RP = 1401987;                 // 近点半径（检查点 8 的保存位置半径）
const A_TRUE = -2418387;
const E_TRUE = 1.579;
const VP = Math.sqrt(eve.gm * (2 / RP - 1 / A_TRUE));
{
    const shipE = makeShip('hit_eve', eve, RP, VP, eve.gm);
    const chainE = predictTrajectoryPatched(shipE);
    check('E1 双曲轨道链生成（带起始状态快照）',
        chainE.length > 0 && !!chainE[0].startState && chainE[0].relPoints.length >= 2);
    const kBase = stateToKepler(chainE[0].startState.relPos, chainE[0].startState.relVel, eve.gm);
    console.log(`     [E1] 基础轨道 a=${kBase.a.toFixed(0)} m / e=${kBase.e.toFixed(4)}`);
    check('E1 基础轨道为双曲（a<0）',
        Math.abs(kBase.a - A_TRUE) < 2000 && Math.abs(kBase.e - E_TRUE) < 0.002);

    const spanE = chainE[0].relPoints[chainE[0].relPoints.length - 1].t;
    const T0E = Math.min(300, spanE * 0.2);
    const w = worldOnSegment(chainE[0], T0E, 5000);
    const near = resolveNearestPointOnChain(chainE, w, THR);
    check('E2 双曲段命中成功', !!near && near.exact === true);
    const res = maneuverSystem.createNode(shipE, {
        time: near.time, relX: near.relPos.x, relY: near.relPos.y,
        anchorBody: near.anchorBody, velRel: near.relVel
    });
    const nodeE = res.node;
    const errE = atomicityError(chainE, nodeE);
    console.log(`     [E2] 建点 Δpos=${fmt(errE.dPos)} m / Δvel=${fmt(errE.dVel)} m/s`);
    check('E2 双曲节点位置原子一致', errE.dPos <= SNAP_TOL);
    check('E2 双曲节点速度原子一致', errE.dVel <= SNAP_TOL);

    const kNode = stateToKepler(
        { x: nodeE.relX, y: nodeE.relY }, { x: nodeE.relVelX, y: nodeE.relVelY }, eve.gm);
    console.log(`     [E3] 节点快照反算 a=${kNode.a.toFixed(0)} m / e=${kNode.e.toFixed(4)}`);
    check('E3 节点快照反算 a 与基础轨道同量级（不退化为无关椭圆）',
        Math.abs(kNode.a - A_TRUE) < 2000);
    check('E3 节点快照反算 e 与基础轨道一致（不得退化到 e≈0.66）',
        Math.abs(kNode.e - E_TRUE) < 0.002);

    // 加 0.1 m/s 级 Δv：Δv 只改变计划，不改快照 → 快照轨道必须仍是原双曲轨道
    maneuverSystem.updateNodeDeltaV(shipE, 'pro', 0.1, AXES, nodeE);
    const kAfter = stateToKepler(
        { x: nodeE.relX, y: nodeE.relY }, { x: nodeE.relVelX, y: nodeE.relVelY }, eve.gm);
    const planDv = Math.hypot(nodeE.deltaV.x, nodeE.deltaV.y);
    console.log(`     [E3] 加 Δv=${planDv.toFixed(2)} m/s 后反算 a=${kAfter.a.toFixed(0)} m / e=${kAfter.e.toFixed(4)}`);
    check('E3 加 0.1 m/s Δv 后仍是同一双曲轨道', Math.abs(kAfter.a - A_TRUE) < 2000 && Math.abs(kAfter.e - E_TRUE) < 0.002);

    // 反证（敏感性）：位置与速度来自**不同时刻** → 反算轨道退化成无关椭圆（检查点 8 的形态）。
    // 说明本断言确实能发现原 bug，而不是恒真。
    const stMismatch = segmentStateAtTime(chainE[0], chainE[0].anchorTime + T0E - 8182);
    const kBad = stateToKepler(
        { x: stMismatch.relPos.x, y: stMismatch.relPos.y },
        { x: nodeE.relVelX, y: nodeE.relVelY }, eve.gm);
    console.log(`     [E3] 反证（跨时刻混写）反算 a=${kBad.a.toFixed(0)} m / e=${kBad.e.toFixed(4)}`);
    check('E3 反证：跨时刻混写确实会退化（断言非恒真）',
        kBad.a > 0 || Math.abs(kBad.e - E_TRUE) > 0.1);
}

// ===== 断言4：机动后链命中的段索引错配回归（B4）=====
{
    const shipT = makeShip('hit_tail', kerbin, rK, vK, kerbin.gm);
    const baseT = predictTrajectoryPatched(shipT);
    const nodeT = maneuverSystem.createNode(shipT, {
        time: 120, relX: rK, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: vK }
    }).node;
    maneuverSystem.updateNodeDeltaV(shipT, 'pro', 120, AXES, nodeT);
    const predT = predictManeuverTrajectories(shipT, nodeT, baseT);
    const tail = predT.segments;                       // [燃烧弧, 机动后段...]
    check('C1 机动后链生成（燃烧弧 + 机动后段）',
        tail.length >= 2 && tail[0].isBurnArc === true);

    const postSeg = tail[1];
    const spanPost = postSeg.relPoints[postSeg.relPoints.length - 1].t;
    const Tpost = spanPost * 0.3;
    const w = worldOnSegment(postSeg, Tpost, 4000);
    const near = resolveNearestPointOnChain(tail, w, THR);
    check('C2 命中机动后链', !!near && near.exact === true);
    if (near) {
        check('C2 返回的段索引落在机动后链的机动后段',
            near.segmentIndex >= 1 && tail[near.segmentIndex] === postSeg);
        // 同链同段取状态 → 与解析器结果完全一致（原子性）
        const stTail = walkToTime(tail, near.time);
        const dPos = Math.hypot(near.relPos.x - stTail.relPos.x, near.relPos.y - stTail.relPos.y);
        // 交叉验证：若像旧实现那样按**基础链**的同一下标取段 → 位置差多少
        const stBase = walkToTime(baseT, near.time);
        const wrongBy = stBase
            ? Math.hypot(near.relPos.x - stBase.relPos.x, near.relPos.y - stBase.relPos.y)
            : Infinity;
        console.log(`     [C2] 机动后链 Δpos=${fmt(dPos)} m / 若错用基础链段则偏 ${(wrongBy / 1000).toFixed(1)} km`);
        check('C2 机动后链命中点 = 该链该时刻的真实状态', dPos <= SNAP_TOL);
        check('C2 错用基础链取段会显著偏移（证明错配确实存在过）', wrongBy > 100000);

        const resT = maneuverSystem.createNode(shipT, {
            time: near.time, relX: near.relPos.x, relY: near.relPos.y,
            anchorBody: near.anchorBody, velRel: near.relVel
        });
        const errT = atomicityError(tail, resT.node);
        console.log(`     [C2] 机动后链建点 Δpos=${fmt(errT.dPos)} m / Δvel=${fmt(errT.dVel)} m/s`);
        check('C2 机动后链建点原子一致', errT.dPos <= SNAP_TOL && errT.dVel <= SNAP_TOL);
    }
    // 真实链里的非解析段（燃烧弧没有 startState）→ exact:false，但数值必须有限
    const burnSeg = tail[0];
    const burnSpan = burnSeg.relPoints[burnSeg.relPoints.length - 1].t;
    const wBurn = worldOnSegment(burnSeg, burnSpan * 0.5, 1000);
    const nearBurn = resolveNearestPointOnChain([burnSeg], wBurn, 20000);
    check('C4 燃烧弧（非解析段，无 startState）命中 exact=false',
        !!nearBurn && nearBurn.exact === false);
    check('C4 燃烧弧命中数值有限',
        !!nearBurn && isFinite(nearBurn.time) && isFinite(nearBurn.relPos.x) && isFinite(nearBurn.relVel.y));
    if (nearBurn) {
        console.log(`     [C4] 燃烧弧命中 t=${nearBurn.time.toFixed(3)} s / d=${nearBurn.distWorld.toFixed(1)} m`
            + ` / exact=${nearBurn.exact}`);
    }

    // 源码护栏：场景层必须把**真正命中的 segments** 交给解析器（不得回退到基础链按索引取段）
    const { readFileSync } = await import('node:fs');
    const sceneSrc = readFileSync(new URL('../../src/scenes/flightScene.js', import.meta.url), 'utf8');
    const uiSrc = readFileSync(new URL('../../src/ui/maneuverUI.js', import.meta.url), 'utf8');
    const panelSrc = readFileSync(new URL('../../src/ui/maneuverViewPanel.js', import.meta.url), 'utf8');
    check('C3 场景层用命中链本身做解析（hitSegs 传给解析器）',
        /resolveNearestPointOnChain\(\s*hitSegs,\s*mouseWorld/.test(sceneSrc));
    const clickBlock = (() => {
        const i = sceneSrc.indexOf('const onClick = (e)');
        const j = sceneSrc.indexOf("_canvas.addEventListener('click'", i);
        return (i >= 0 && j > i) ? sceneSrc.slice(i, j) : '';
    })();
    check('C3 场景层建点不再混用 resolveOrbitHit（只认当前轨道链）',
        clickBlock.length > 500 && !/resolveOrbitHit/.test(clickBlock)
        && !/walkToTime/.test(clickBlock));
    check('C3 主视图拖拽走解析器（不再 findNearestChainPoint / walkToTime 直取）',
        /resolveNearestPointOnChain\(chain, world/.test(uiSrc)
        && !/findNearestChainPoint/.test(uiSrc.replace(/\/\/[^\n]*/g, ''))
        && !/walkToTime\s*\(/.test(uiSrc));
    check('C3 机动视图放大图命中走解析器',
        /function nearestOrbitPointInInset\(chains, p, host, thresholdPx\)[\s\S]{0,4000}resolveNearestPointOnChain\(/.test(panelSrc));
}

// ===== 断言5：边界与失败路径（不崩、无 NaN）=====
{
    let threw = false;
    const safe = (fn) => {
        try { return fn(); } catch (e) { threw = true; return undefined; }
    };
    check('B1 空段 → null', safe(() => resolveNearestPointOnChain(null, { x: 0, y: 0 }, THR)) === null);
    check('B1 空数组 → null', safe(() => resolveNearestPointOnChain([], { x: 0, y: 0 }, THR)) === null);
    check('B1 空点 → null', safe(() => resolveNearestPointOnChain(chainA, null, THR)) === null);
    check('B1 阈值为 0 → null', safe(() => resolveNearestPointOnChain(chainA, { x: 0, y: 0 }, 0)) === null);
    check('B1 阈值为负 → null', safe(() => resolveNearestPointOnChain(chainA, { x: 0, y: 0 }, -1)) === null);
    check('B1 非有限世界点 → null',
        safe(() => resolveNearestPointOnChain(chainA, { x: NaN, y: 0 }, THR)) === null);
    // 超阈值：远离轨道线（径向 10 个阈值）
    const far = worldOnSegment(segA, T0A, THR * 10);
    check('B1 超阈值 → null', safe(() => resolveNearestPointOnChain(chainA, far, THR)) === null);
    // 段首 t=0 / 段尾 t=span
    const wStart = worldOnSegment(segA, 0, 0);
    const nearStart = safe(() => resolveNearestPointOnChain(chainA, wStart, THR));
    check('B2 段首命中非空且数值有限',
        !!nearStart && isFinite(nearStart.time) && isFinite(nearStart.relPos.x)
        && isFinite(nearStart.relVel.x) && isFinite(nearStart.distWorld));
    check('B2 段首时刻 ≈ anchorTime（Δt=' + (nearStart ? fmt(nearStart.time - segA.anchorTime) : '--') + ' s）',
        !!nearStart && Math.abs(nearStart.time - segA.anchorTime) <= 1e-2);
    const wEnd = worldOnSegment(segA, spanA, 0);
    const nearEnd = safe(() => resolveNearestPointOnChain(chainA, wEnd, THR));
    check('B2 段尾命中非空且数值有限',
        !!nearEnd && isFinite(nearEnd.time) && isFinite(nearEnd.relPos.x) && isFinite(nearEnd.relVel.x));
    check('B2 段尾时刻 ≈ anchorTime+span（Δt=' + (nearEnd ? fmt(nearEnd.time - segA.anchorTime - spanA) : '--') + ' s）',
        !!nearEnd && Math.abs(nearEnd.time - segA.anchorTime - spanA) <= 1);
    // 缺陷段防御：relPoints 不足 / anchorTime 非有限
    check('B3 缺点段 → null',
        safe(() => resolveNearestPointOnChain([{ relPoints: [{ x: 0, y: 0, t: 0 }], anchorTime: 0 }],
            { x: 0, y: 0 }, THR)) === null);
    check('B3 anchorTime 非有限 → null',
        safe(() => resolveNearestPointOnChain([{ relPoints: [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 1 }], anchorTime: NaN }],
            { x: 0, y: 0 }, THR)) === null);
    check('B1 全流程无异常抛出', threw === false);

    // "相邻采样点 t 不可全信"：给样本 t 加 ±8% 错位后，折线只当粗筛候选，
    // 精化仍在真实曲线上求时刻（窗口随边界扩展）——不得把错位的时间标签当真值用
    {
        const ptsJit = segA.relPoints.map((p, i) => ({
            x: p.x, y: p.y, t: p.t * (i % 2 === 0 ? 1.08 : 0.92)
        }));
        const segJit = {
            relPoints: ptsJit, anchorBody: segA.anchorBody, anchorTime: segA.anchorTime,
            soiName: segA.soiName, isCurrentSoi: segA.isCurrentSoi, startState: segA.startState
        };
        const Tq = spanA * 0.6;
        const wq = worldOnSegment(segA, Tq, 2000);
        const nearQ = safe(() => resolveNearestPointOnChain([segJit], wq, THR));
        const dTq = nearQ ? Math.abs(nearQ.time - (segA.anchorTime + Tq)) : Infinity;
        console.log(`     [B6] 采样 t 错位 ±8% 场景：Δt=${fmt(dTq)} s`);
        check('B6 采样点 t 错位时仍在真实曲线上找到最近时刻（窗口扩展生效）',
            !!nearQ && dTq <= 1);
    }

    // 深空段（无宿主 / 无段锚点）：不得崩，host 报 null
    const segDeep = {
        relPoints: [{ x: 0, y: 0, t: 0 }, { x: 1000, y: 0, t: 10 }, { x: 2000, y: 0, t: 20 }],
        anchorBody: null, anchorTime: 0, soiName: null, startState: null
    };
    const nearDeep = safe(() => resolveNearestPointOnChain([segDeep], { x: 500, y: 100 }, 1000));
    check('B5 深空段（无宿主）命中不崩、host=null、数值有限',
        !!nearDeep && nearDeep.host === null && isFinite(nearDeep.relPos.x) && isFinite(nearDeep.time));

    // 非解析段（径向直线 / RK4 兜底）：无 startState → 采样点插值 + exact:false（不伪装精确）
    const segNoKepler = {
        relPoints: [
            { x: 0, y: 0, t: 0 }, { x: 0, y: 1000, t: 10 },
            { x: 0, y: 2000, t: 20 }, { x: 0, y: 3000, t: 30 }
        ],
        anchorBody: 'Kerbin', anchorTime: chainA[0].anchorTime, soiName: 'Kerbin', startState: null
    };
    const hostPos = bodyFuturePos(kerbin, getCachedTime());
    const nearNoK = safe(() => resolveNearestPointOnChain([segNoKepler],
        { x: hostPos.x + 30, y: hostPos.y + 1500 }, 2000));
    check('B4 非解析段命中非空', !!nearNoK);
    check('B4 非解析段标 exact=false（不伪装精确）', !!nearNoK && nearNoK.exact === false);
    check('B4 非解析段数值有限',
        !!nearNoK && isFinite(nearNoK.time) && isFinite(nearNoK.relPos.x)
        && isFinite(nearNoK.relVel.x) && isFinite(nearNoK.relPos.y));
    if (nearNoK) {
        const errT = Math.abs(nearNoK.relPos.y - 1500);
        console.log(`     [B4] 非解析段插值：t=${nearNoK.time.toFixed(3)} s / 位置偏差 ${errT.toFixed(1)} m`);
        check('B4 非解析段插值位置在采样点附近（≤ 采样步长 500 m）', errT <= 500);
    }
}

// ===== 断言6：旧命中口径（findNearestChainPoint）仍在且语义不变（其它调用方依赖）=====
{
    const w = worldOnSegment(segA, T0A, 3000);
    const old = findNearestChainPoint(chainA, w, THR);
    check('D1 findNearestChainPoint 仍可用（粗筛接口保留）',
        !!old && isFinite(old.timeOffset) && isFinite(old.distWorld) && old.segmentIndex === 0);
}

// ===== 断言7：性能（拖动场景单次解析耗时）=====
{
    const rounds = 200;
    // 预热（JIT）
    for (let i = 0; i < 20; i++) resolveNearestPointOnChain(chainA, worldOnSegment(segA, T0A, 2000), THR);
    const t0 = performance.now();
    for (let i = 0; i < rounds; i++) {
        const w = worldOnSegment(segA, T0A + i * 0.5, 2000);
        resolveNearestPointOnChain(chainA, w, THR);
    }
    const perCall = (performance.now() - t0) / rounds;
    console.log(`     链 ${chainA.length} 段 / ${segA.relPoints.length} 点：单次解析 ${perCall.toFixed(3)} ms`
        + `（粗筛 + 精化，每帧一次拖动 = 1 次）`);
    check('D2 单次解析耗时 < 1 ms（每帧成本可控）', perCall < 1);

    // 多段链（机动后链：燃烧弧 + 机动后段）的单次解析耗时
    const shipP = makeShip('hit_perf', kerbin, rK, vK, kerbin.gm);
    const nodeP = maneuverSystem.createNode(shipP, {
        time: 120, relX: rK, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: vK }
    }).node;
    maneuverSystem.updateNodeDeltaV(shipP, 'pro', 100, AXES, nodeP);
    const tailP = predictManeuverTrajectories(shipP, nodeP, predictTrajectoryPatched(shipP)).segments;
    const wP = worldOnSegment(tailP[tailP.length - 1], 100, 2000);
    for (let i = 0; i < 20; i++) resolveNearestPointOnChain(tailP, wP, THR);
    const tP0 = performance.now();
    for (let i = 0; i < rounds; i++) resolveNearestPointOnChain(tailP, wP, THR);
    const perCallTail = (performance.now() - tP0) / rounds;
    console.log(`     机动后链 ${tailP.length} 段 / ${tailP.reduce((n, s) => n + s.relPoints.length, 0)} 点：`
        + `单次解析 ${perCallTail.toFixed(3)} ms`);
    check('D2 多段链单次解析耗时 < 1 ms', perCallTail < 1);
}

// ===== 断言8：既有测试语义回归（点数 / 链序 / pinned / burnDuration 连续）=====
{
    // 链序 = 时间序
    const shipR = makeShip('hit_reg', kerbin, rK, vK, kerbin.gm);
    const early = maneuverSystem.createNode(shipR, {
        time: 900, relX: rK, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: vK }
    }).node;
    const late = maneuverSystem.createNode(shipR, {
        time: 200, relX: rK, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: vK }
    }).node;
    const sortedR = maneuverSystem.getNodesSorted(shipR);
    check('R1 链序 = 时间序（乱序创建后按时刻排序）', sortedR[0] === late && sortedR[1] === early);

    // 预测链锚点时刻单调（分段拼接后链序不变）
    const chainR = predictTrajectoryPatched(shipR);
    let monotonic = true;
    for (let i = 1; i < chainR.length; i++) {
        if (!(chainR[i].anchorTime >= chainR[i - 1].anchorTime)) monotonic = false;
    }
    check('R1 预测链段锚点时刻单调不减', monotonic);
    check('R1 预测链点数未被破坏（首段 ≥ 100 点）', chainR[0].relPoints.length >= 100);

    // pinned 语义：有快照的节点走冻结路径（燃烧后不漂移）
    const nodeSnap = {
        id: 'snap', time: 60, deltaV: { x: 30, y: 0 }, dvPro: 30, dvRadial: 0, executed: false,
        relX: chainR[0].relPoints[0].x, relY: chainR[0].relPoints[0].y,
        relVelX: 0, relVelY: vK, anchorBody: 'Kerbin', massWet: 8000, massFuel: 3000
    };
    const predSnap = predictManeuverTrajectories(shipR, nodeSnap, chainR);
    check('R2 有快照节点走冻结路径（nodeState.pinned=true）',
        !!predSnap.plan.nodeState && predSnap.plan.nodeState.pinned === true);

    // burnDuration 连续（非 burnDt 网格量化）：Δv 微增 → 时长微增
    const mk = (dv) => predictManeuverTrajectories(shipR, {
        time: 60, deltaV: { x: dv, y: 0 }, dvPro: dv, dvRadial: 0, executed: false,
        relX: chainR[0].relPoints[0].x, relY: chainR[0].relPoints[0].y,
        relVelX: 0, relVelY: vK, anchorBody: 'Kerbin', massWet: 8000, massFuel: 3000
    }, chainR).plan.burnDuration;
    const b1 = mk(50);
    const b2 = mk(50.05);
    const dBurn = Math.abs(b2 - b1);
    // 物理期望：Δv 微增 0.05 m/s（占 50 m/s 的 0.1%）→ 时长增加约 0.1%
    const expected = Math.abs(b1) * (0.05 / 50);
    console.log(`     [R2] burnDuration ${b1.toFixed(5)} s → ${b2.toFixed(5)} s`
        + `（Δ=${fmt(dBurn)} s，线性期望 ${fmt(expected)} s）`);
    check('R2 burnDuration 随 Δv 连续变化（不落 0.05 s 网格）',
        dBurn > 0 && dBurn < 0.02 && Math.abs(dBurn - expected) <= expected * 0.1);

    // 既有测试套件（节点环境直接跑）：语义由它们兜底
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const suites = ['test_maneuver_multi.mjs', 'test_maneuver_prediction.mjs',
        'test_maneuver_burn_drift.mjs', 'test_maneuver_panel_state.mjs', 'test_025_regression.mjs'];
    for (const name of suites) {
        let out = '';
        let ok = true;
        try {
            out = execFileSync(process.execPath, [join(here, name)],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) {
            ok = false;
            out = (e && e.stdout ? String(e.stdout) : '') + (e && e.message ? e.message : '');
        }
        const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
        const passed = m ? Number(m[1]) : -1;
        const failed = m ? Number(m[2]) : -1;
        console.log(`     [R3] ${name}: ${passed} 通过 / ${failed} 失败（exit ${ok ? 0 : 1}）`);
        check('R3 既有套件全绿：' + name, ok && failed === 0 && passed > 0);
    }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
