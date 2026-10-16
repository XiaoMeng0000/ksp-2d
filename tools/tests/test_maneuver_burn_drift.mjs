// 机动线"漂移 + 回弹"根因回归（node 环境，零依赖）
// 场景：存档「检查点 2」（Kerbin→Eve 转移，节点时刻已过，处于点火燃烧期）真实走帧
// 用法: node tools/tests/test_maneuver_burn_drift.mjs
//
// 修复前基线（probe12/probe14 实测）：
//   · 机动线末端平滑漂移 217 km/帧（根因①：节点质量快照被实时质量逐帧覆盖）；
//   · 每 ~4.83 s 单帧 ~60,605 km 反向台阶（根因②：planBurnArc 燃烧时长量化到 burnDt=0.05 网格）；
//   · 台阶帧唯一离散变化 = 燃烧时长 100.400 → 100.350 s（恰一档）。
// 本用例覆盖：(a) 机动线末端帧间位移 ≤1 m（Kerbol/Eve 锚定段；Kerbin 段剥离"随宿主移动"分量后同样 ≤1 m）；
// (b) 燃烧时长序列连续（无 0.05 台阶）；(c) 全程无 ≥1 km 级台阶；另复核 mWet 扫描下 |applied − dvTarget| ≤1e-6。
//
// 注：浏览器全局 window 在 node 下缺失，注入最小垫片后再动态导入业务模块
globalThis.window = globalThis.window || {};
const noop = () => {};
globalThis.window.addEventListener = noop;
globalThis.window.removeEventListener = noop;
globalThis.window.devicePixelRatio = 1;
globalThis.window.showNotification = noop;

const { celestialBodies, updateCelestialBodies } = await import('../../src/physics/physics.js');
const { bodyFuturePos } = await import('../../src/physics/orbitalPrediction.js');
const { updateShipPhysics } = await import('../../src/physics/physicsUpdate.js');
const { eventBus, Events } = await import('../../src/eventBus.js');
const { getTotalMass, drainResource } = await import('../../src/resources/resourceSystem.js');
const { getEngineType } = await import('../../src/config/entities/engineConfig.js');
const { planBurnArc } = await import('../../src/physics/maneuverPrediction.js');
const { updateManeuverChain, getChainNodes, getBaseChain } = await import('../../src/ship/maneuverChain.js');
const { maneuverSystem } = await import('../../src/ship/maneuverSystem.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
    cond ? pass++ : fail++;
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '   [' + detail + ']' : ''));
};

// ===== 检查点 2 存档快照（只读复制，勿改数值）=====
const T0 = 4818704.6965978;
const engineDef = getEngineType('chemical');
const ship = {
    id: 'ship_1791645436978_7tg0t', displayName: '初始飞船',
    pos: { x: 914854.955833659, y: 41236.90626401326 },
    vel: { x: 412.4470061117708, y: 2949.827362457047 },
    currentSOI: 'Kerbin', currentGM: 3531600000000,
    kepler: { a: -3047485.472046731, e: 1.291580161904607, theta: 0.3260738310000609, omega: -0.2810295182708577, dir: 1 },
    orbitTime: 0, mode: 'thrust', thrust: { ax: 0, ay: 0 },
    dryMass: 3, isp: 9999, maxThrust: 10000000, engineType: 'chemical',
    resources: {
        hydrogen: { amount: 109924.07462854762, capacity: 111111 },
        oxygen: { amount: 879392.597028381, capacity: 888888 }
    },
    cargo: {}, modules: [], throttle: 1, heading: 0, angularVelocity: 0, engineOut: false,
    maneuverNodes: [{
        id: 'mv2_4818665548', time: 4818574.175299613,
        deltaV: { x: 328.0506582135245, y: 965.6269580592024 },
        dvPro: 1019.8250776099349, dvRadial: -0.8999999999999999, executed: false,
        relX: 842231.5813494395, relY: -291399.5460650095, anchorBody: 'Kerbin',
        relVelX: 645.6057337539071, relVelY: 1894.8679311872902,
        massWet: 989319.6716569286, massFuel: 989316.6716569286, _rev: 0
    }]
};
const node = ship.maneuverNodes[0];
ship.heading = Math.atan2(node.deltaV.x, node.deltaV.y);

updateCelestialBodies(T0);
eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: T0, dt: 0 });

// ===== 断言 5a：mWet 扫描下燃烧时长连续 + 末态达成量精确 =====
{
    const dvMag = Math.hypot(node.deltaV.x, node.deltaV.y);
    const params = {
        dirX: node.deltaV.x / dvMag, dirY: node.deltaV.y / dvMag,
        maxThrust: ship.maxThrust, isp: ship.isp,
        mWet: node.massWet, mDry: Math.max(node.massWet - node.massFuel, 1), dvTarget: dvMag
    };
    const relPos = { x: node.relX, y: node.relY };
    const relVel = { x: node.relVelX, y: node.relVelY };
    const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
    const N = 100, SPAN = 500;                       // kg（整档跨度，单点 5 kg）
    let prev = null, maxJump = 0, maxAppliedErr = 0, gridHits = 0;
    for (let k = 0; k < N; k++) {
        const mWet = node.massWet + SPAN * k / (N - 1);
        const res = planBurnArc(relPos, relVel, kerbin, { ...params, mWet, mDry: Math.max(mWet - node.massFuel, 1) }, node.time);
        maxAppliedErr = Math.max(maxAppliedErr, Math.abs(res.appliedDv - dvMag));
        // 量化判据：burnDuration 若仍量化到 burnDt 网格，则会精确等于 0.05 的整数倍
        if (Math.abs(res.burnDuration - Math.round(res.burnDuration / 0.05) * 0.05) < 1e-9) gridHits++;
        if (prev !== null) maxJump = Math.max(maxJump, Math.abs(res.burnDuration - prev));
        prev = res.burnDuration;
    }
    console.log(`  [5a] mWet 扫 ${N} 点（跨度 ${SPAN} kg）：最大 |ΔburnDuration| = ${maxJump.toExponential(3)} s`
        + ` / 最大 |applied−dvTarget| = ${maxAppliedErr.toExponential(3)} m/s / 落网格点数 = ${gridHits}/${N}`);
    check('5a 燃烧时长连续（|ΔburnDuration| < 0.005 s，无 0.05 台阶）', maxJump < 0.005,
        '最大阶跃 ' + maxJump.toFixed(6) + ' s');
    check('5a 各点 |applied − dvTarget| ≤ 1e-6 m/s', maxAppliedErr <= 1e-6,
        '最大误差 ' + maxAppliedErr.toExponential(3) + ' m/s');
    check('5a 不再落在 burnDt=0.05 整数倍网格上', gridHits <= 1, gridHits + '/' + N + ' 点恰好落网格');

    // ===== 结构回归（改动 A 不得破坏既有语义）=====
    const tiny = planBurnArc(relPos, relVel, kerbin, { ...params, dvTarget: 1e-3 }, node.time);
    check('6 极小 Δv 不产生 0 时长/NaN（末步收口下界）',
        tiny.burnDuration > 0 && isFinite(tiny.burnDuration) && isFinite(tiny.finalRelPos.x)
        && tiny.appliedDv >= 1e-3 - 1e-9, 'dur=' + tiny.burnDuration.toExponential(3) + 's');
    const mid = planBurnArc(relPos, relVel, kerbin, { ...params, dvTarget: dvMag / 2 }, node.time);
    const monoOk = (r) => {
        let ok = true;
        for (let k = 1; k < r.relPoints.length; k++) if (!(r.relPoints[k].t >= r.relPoints[k - 1].t)) ok = false;
        const last = r.relPoints[r.relPoints.length - 1];
        return ok && last.t === r.burnDuration && r.relPoints[0].t === 0;
    };
    check('6 relPoints 时间单调、首点 t=0、末点 t=burnDuration（渲染接口不变）', monoOk(mid),
        mid.relPoints.length + ' 点，末点 t=' + mid.relPoints[mid.relPoints.length - 1].t.toFixed(6));

    // ===== 点存储节流（回归护栏：上界防爆炸、下界防"退化成弦"）=====
    // 历史缺陷：判档曾误用浮点累加时间 t（`t % 3 === 0` 恒不命中 —— 60 步后 t=2.9999999999999973），
    // 点数从 671 掉到 2 点 → real/ghost 分色子段失效、弧上命中退化成弦。
    // 修复前基线（daefe74 冻结树，同口径实测）：基准 100.4s=671 点 / SOI 退出=2342 / 超长燃烧=4190 /
    // ghost 燃料受限=3224（real 2117 + ghost 1107）。
    const full = planBurnArc(relPos, relVel, kerbin, params, node.time);                        // 基准口径（Δv=目标）
    const soi = planBurnArc(relPos, relVel, kerbin, { ...params, dvTarget: 1e6 }, node.time);   // SOI 上限退出
    const longBurn = planBurnArc(relPos, relVel, kerbin, {                                      // 超长燃烧（∼10000 s）
        ...params, maxThrust: 100, isp: 3000, mWet: 1e9, mDry: 1, dvTarget: 2000
    }, node.time);
    const stepsOf = (r) => Math.round(r.burnDuration / 0.05);
    // 下界锚定"修复前基线的一半"（且不高于 步数/3）：修复前基线 = 671 / 2342 / 4190 / 337，
    // 而退回 t%3 的坏版本只有 2 点 —— 两类量级差 2~3 个数量级，不会误判也不会漏判；
    // 上界 = 900 + 降频后增量 + 收尾 2 点（点存储节流硬上限）。
    for (const [label, r, refLo] of [
        ['基准 100.4s 燃烧', full, 671],
        ['SOI 上限退出', soi, 2342],
        ['超长燃烧 10000s', longBurn, 4190],
        ['中等 Δv', mid, 337]
    ]) {
        const n = r.relPoints.length;
        const st = stepsOf(r);
        const lo = Math.max(2, Math.min(Math.floor(refLo / 2), Math.floor(st / 3) - 5));
        const hi = 900 + Math.max(0, (st - 2700) / 60) + 3;
        check('6 点存储节流 [' + label + '] 点数在区间 [' + lo + ',' + Math.round(hi) + ']（下界防退化 / 上界防爆炸）',
            n >= lo && n <= hi, n + ' 点 / ' + st + ' 步（修复前基线 ' + refLo + ' 点）');
    }
    check('6 基准口径点数不退化（修复前 671 点）', full.relPoints.length >= 600,
        full.relPoints.length + ' 点');

    // 燃料受限（Δv 远超能力）→ 真实段耗尽 + 虚拟段续烧语义保持
    // 注：检查点 2 的推力过大，Δv 拉满会先撞 SOI 上限退出；这里改用"低推力 / 极小干质量"
    // 的构造让真实段先在燃料上耗尽（本用例只验语义，不验具体轨道）
    const limited = planBurnArc(relPos, relVel, kerbin, {
        ...params, maxThrust: 700, isp: 300, mWet: 1000, mDry: 100, dvTarget: 30000
    }, node.time);
    check('6 燃料耗尽：记录耗尽点 + 虚拟段续烧仍生效',
        limited.ghostUsed === true && !!limited.fuelOutPoint && limited.appliedDv >= 30000 - 1e-9,
        'ghost=' + limited.ghostUsed + ' 耗尽点 t=' + (limited.fuelOutPoint ? limited.fuelOutPoint.t.toFixed(2) : '-'));
    const realPts = limited.relPoints.filter(p => !p.ghost).length;
    const ghostPts = limited.relPoints.filter(p => p.ghost).length;
    check('6 ghost 分色子段非空（real ≥2 点、ghost ≥2 点；修复前 2117 + 1107）',
        realPts >= 2 && ghostPts >= 2, 'real=' + realPts + ' 点 / ghost=' + ghostPts + ' 点');
    check('6 ghost 分色子段点数不退化（两段各 ≥ 100 点）',
        realPts >= 100 && ghostPts >= 100, 'real=' + realPts + ' / ghost=' + ghostPts);
    // 极低推力 / 超长燃烧 → SOI 半径上限退出仍然生效（不越过 burnSoiRadiusLimit）
    const soiOut = planBurnArc(relPos, relVel, kerbin, { ...params, dvTarget: 1e6 }, node.time);
    check('6 SOI 半径上限退出仍生效（不越过 burnSoiRadiusLimit）',
        Math.hypot(soiOut.finalRelPos.x, soiOut.finalRelPos.y) <= kerbin.soiRadius * 1.5 * 1.02,
        '末半径=' + (Math.hypot(soiOut.finalRelPos.x, soiOut.finalRelPos.y) / 1e6).toFixed(1) + 'Mm'
        + ' / 上限=' + (kerbin.soiRadius * 1.5 / 1e6).toFixed(1) + 'Mm');

    // ===== 验收对照：53.0 s / 355 点的"SOI 退出早于达成"几何（验收者口径）=====
    // 参数由标定得到（mWet=120000 / mDry=1000 / F=1e6 / isp=45.4159 / Δv=2100 → 时长 52.98 s、1060 步）
    // 点数可由公式核对：点数 = floor(步数/3) + 2（+ 收尾点）= floor(1060/3)+2 = 355；退化版本为 2 点。
    const soi53 = planBurnArc(relPos, relVel, kerbin, {
        ...params, mWet: 120000, mDry: 1000, maxThrust: 1e6, isp: 45.4159, dvTarget: 2100
    }, node.time);
    const st53 = Math.round(soi53.burnDuration / 0.05);
    const expectPts = Math.floor(st53 / 3) + 2;
    check('6 53.0s 燃烧几何点数 = floor(步数/3)+2（验收对照 355 点；退化版本为 2 点）',
        Math.abs(soi53.burnDuration - 53.0) < 0.2 && soi53.relPoints.length === expectPts
        && soi53.relPoints.length >= 300,
        'dur=' + soi53.burnDuration.toFixed(4) + 's 步数=' + st53
        + ' 点数=' + soi53.relPoints.length + '（公式值 ' + expectPts + '）');
}

// ===== 断言 5b/5c：点火燃烧 200 帧（复制 flightScene 的燃料 drain 口径）=====
const FRAMES = 200;
const DT = 1 / 60;
const totalRatio = engineDef.props.reduce((s, p) => s + p.ratio, 0);
const relTail = (seg) => seg.relPoints[seg.relPoints.length - 1];
const worldTail = (seg, time) => {
    const b = celestialBodies.find(x => x.name === seg.anchorBody);
    const an = bodyFuturePos(b, time);
    const lp = relTail(seg);
    return { x: an.x + lp.x, y: an.y + lp.y };
};
const record = (segs, time) => segs.filter(s => !s.isBurnArc).map(s => ({
    anchor: s.anchorBody,
    world: worldTail(s, time),                                  // 世界向位移（含宿主天体公转分量）
    rel: { x: relTail(s).x, y: relTail(s).y }                   // 宿主参考系位移（剥离宿主移动）
}));

let T = T0;
const rows = [];
const bodyPos = [];                    // 每帧各天体世界位置（用于剥离"宿主自移"分量）
const bodyMove = [null];               // bodyMove[i] = 第 i 帧各天体相对上一帧的位移 Map
for (let f = 0; f < FRAMES; f++) {
    T += DT;
    updateCelestialBodies(T);
    eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: T, dt: DT });
    const totalMass = getTotalMass(ship);
    const a = ship.throttle * ship.maxThrust / Math.max(totalMass, 1e-9);
    ship.thrust = { ax: Math.sin(ship.heading) * a, ay: Math.cos(ship.heading) * a };
    // 燃料 drain 口径与 flightScene 一致：massFlow = throttle·maxThrust/(isp·g)，按引擎 props 比例分配
    const massFlow = ship.throttle * ship.maxThrust / (ship.isp * 9.81);
    for (const prop of engineDef.props) drainResource(ship, prop.id, massFlow * prop.ratio / totalRatio * DT);
    updateShipPhysics(ship, DT, true);
    maneuverSystem.update(ship, DT);
    updateManeuverChain(ship);

    const entry = getChainNodes()[0];
    const segs = entry && entry.segments ? entry.segments : [];
    const base = getBaseChain() || [];
    rows.push({
        f, time: T, mass: totalMass, nodeMass: node.massWet,
        dur: entry && entry.plan ? entry.plan.burnDuration : null,
        hosts: segs.map(s => s.anchorBody + (s.isBurnArc ? '(B)' : '')).join('>'),
        post: record(segs, T),
        baseTail: base.length ? relTail(base[base.length - 1]) : null
    });
    const cur = new Map(celestialBodies.map(b => [b.name, { x: b.position.x, y: b.position.y }]));
    if (f > 0) {
        const move = new Map();
        for (const [name, p] of cur) {
            const q = bodyPos[f - 1].get(name);
            move.set(name, q ? Math.hypot(p.x - q.x, p.y - q.y) : 0);
        }
        bodyMove.push(move);
    }
    bodyPos.push(cur);
}

// 逐帧增量：只比较"段结构完全相同"的相邻帧（段数 / 锚定宿主变化 = SOI 切换，跳过避免假台阶）
// 判定口径（与验收标准 1 一致）：
//   · dRel  = 段末端在**该段宿主参考系**内的位移 —— 该段轨迹自身的运动（必须 ≈0，修复前 217 km/帧）；
//   · dWorld= 段末端**世界坐标**位移 = dRel + 宿主天体公转位移 —— 锚在 Kerbin 的段本就随之移动，
//             Eve 锚定段随之移动 180.9 m/帧（Eve 公转速度 ≈ 10.8 km/s ÷ 60），均属正常分量；
//   · 另有独立断言：世界向位移 ≤ 该宿主天体自身位移 + 1 m（证明"线相对宿主静止"）。
function frameDelta(p, c, bodyMove) {
    if (p.post.length !== c.post.length || p.post.length === 0) return null;
    for (let i = 0; i < c.post.length; i++) {
        if (p.post[i].anchor !== c.post[i].anchor) return null;
    }
    let maxWorld = 0, maxRel = 0, maxHostRel = 0;
    for (let i = 0; i < c.post.length; i++) {
        const dw = Math.hypot(c.post[i].world.x - p.post[i].world.x, c.post[i].world.y - p.post[i].world.y);
        const dr = Math.hypot(c.post[i].rel.x - p.post[i].rel.x, c.post[i].rel.y - p.post[i].rel.y);
        maxWorld = Math.max(maxWorld, dw);
        maxRel = Math.max(maxRel, dr);
        // 世界向位移 − 宿主自移 = 该段相对世界的"额外"运动（必须 ≈0）
        maxHostRel = Math.max(maxHostRel, dw - (bodyMove.get(c.post[i].anchor) || 0));
    }
    return { maxWorld, maxRel, maxHostRel, f: c.f, dur: c.dur, prevDur: p.dur, hosts: c.hosts };
}
const deltas = [];
for (let i = 1; i < rows.length; i++) {
    const d = frameDelta(rows[i - 1], rows[i], bodyMove[i]);
    if (d) deltas.push(d);
}
// 基链（飞船自身轨道线）位移：与段结构无关，直接逐帧算
const baseMoves = [];
for (let i = 1; i < rows.length; i++) {
    if (rows[i].baseTail && rows[i - 1].baseTail) {
        baseMoves.push(Math.hypot(rows[i].baseTail.x - rows[i - 1].baseTail.x,
            rows[i].baseTail.y - rows[i - 1].baseTail.y));
    }
}
const maxOf = (arr) => arr.length ? Math.max(...arr) : 0;
const maxWorldMove = maxOf(deltas.map(d => d.maxWorld));
const maxRelMove = maxOf(deltas.map(d => d.maxRel));
const maxHostRelMove = maxOf(deltas.map(d => d.maxHostRel));
const maxDurJump = maxOf(deltas.filter(d => d.dur !== null && d.prevDur !== null)
    .map(d => Math.abs(d.dur - d.prevDur)));
const steps = deltas.filter(d => d.maxRel >= 1000);
const durDistinct = new Set(rows.filter(r => r.dur !== null).map(r => r.dur.toFixed(9))).size;
const gridRows = rows.filter(r => r.dur !== null
    && Math.abs(r.dur - Math.round(r.dur / 0.05) * 0.05) < 1e-9).length;
const massDrop = rows[0].mass - rows[rows.length - 1].mass;

console.log(`\n  [5b] 帧数=${rows.length} 可比帧对=${deltas.length} 段结构：${rows[0].hosts}  →  ${rows[rows.length - 1].hosts}`);
console.log(`       机动线末端（机动后段）帧间位移：宿主参考系 max=${maxRelMove.toExponential(3)} m`
    + ` / 世界向 max=${maxWorldMove.toExponential(3)} m（含宿主自移）/ 剥离宿主自移后 max=${maxHostRelMove.toExponential(3)} m`);
console.log(`       燃烧时长：首帧=${rows[0].dur === null ? 'null' : rows[0].dur.toFixed(4)}s 末帧=${rows[rows.length - 1].dur.toFixed(4)}s`
    + ` 不同取值=${durDistinct} 个 帧间最大 |Δ|=${maxDurJump.toExponential(3)}s 落 0.05 网格帧数=${gridRows}`);
console.log(`       节点质量快照：首帧=${rows[0].nodeMass.toFixed(4)} 末帧=${rows[rows.length - 1].nodeMass.toFixed(4)} kg`
    + ` ／ 飞船当前质量：${rows[0].mass.toFixed(3)} → ${rows[rows.length - 1].mass.toFixed(3)} kg（耗油 ${massDrop.toFixed(1)} kg）`);
console.log(`       飞船自身轨道线（基链）宿主系末端位移 max=${maxOf(baseMoves).toExponential(3)} m`);

check('5b 机动线末端帧间位移 ≤ 1 m（宿主参考系；修复前 217 km/帧 + 6 万 km 台阶）',
    maxRelMove <= 1, 'max=' + maxRelMove.toExponential(3) + ' m');
check('5b 世界向位移 = 宿主天体自移（线相对宿主静止）', maxHostRelMove <= 1,
    '剥离宿主自移后 max=' + maxHostRelMove.toExponential(3) + ' m；宿主自移 0.15~0.22 km/帧');
check('5c 全程无 ≥1 km 级台阶（修复前每 4.83 s 一次 6 万 km 回弹）', steps.length === 0,
    '台阶帧数=' + steps.length + (steps.length ? ' 首个 f' + steps[0].f : ''));
check('5b 燃烧时长序列连续（帧间 |Δ| < 1e-3 s，无 0.05 台阶）', maxDurJump < 1e-3,
    'max=' + maxDurJump.toExponential(3) + ' s');
check('5b 燃烧时长不再取离散档位（帧序列取值唯一、不落 0.05 网格）',
    durDistinct === 1 && gridRows === 0, '取值数=' + durDistinct + ' 落网格=' + gridRows);
check('5b 质量快照燃烧期冻结（不再逐帧跟随当前质量）',
    Math.abs(rows[0].nodeMass - rows[rows.length - 1].nodeMass) < 1e-9,
    '节点质量 ' + rows[0].nodeMass.toFixed(4) + ' → ' + rows[rows.length - 1].nodeMass.toFixed(4));
check('5b 飞船当前质量确实在下降（燃烧在进行中，测试有效）', massDrop > 100,
    'Δm=' + massDrop.toFixed(1) + ' kg');
// 验收标准 3：机动线静态 ≠ 飞船轨道线冻结 —— 基链必须照常随飞船推进
check('5b 飞船自身轨道线不受影响（基链末端照常更新）', maxOf(baseMoves) > 1,
    'max=' + maxOf(baseMoves).toExponential(3) + ' m（远大于机动线末端 0 m）');

// ===== 验收标准 3 之二：燃烧期计划缓存键不再逐帧失效（顺带消除每帧重算开销）=====
// 机制：planCacheKey 含 node.massWet —— 修复前每帧被当前质量改写 → 每帧未命中 → 全量重算计划
//       （含 planBurnArc 2000+ 步 + patchedStep 拼链）。修复后快照冻结 → 命中缓存 → 沿用上帧计划。
{
    const durSeq = new Set(rows.filter(r => r.dur !== null).map(r => r.dur));
    check('5b 计划在燃烧期唯一（缓存键稳定 → 命中缓存、不再每帧重算）',
        durSeq.size === 1 && rows.every(r => r.dur !== null),
        'burnDuration 取值数=' + durSeq.size + '（' + Array.from(durSeq)[0].toFixed(6) + 's）');
    // 反证：若仍读"当前质量"，同一节点时刻会得到显著不同的燃烧时长（本例 200 帧漂移量）
    const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
    const dvMag = Math.hypot(node.deltaV.x, node.deltaV.y);
    const liveMassPlan = planBurnArc({ x: node.relX, y: node.relY }, { x: node.relVelX, y: node.relVelY }, kerbin, {
        dirX: node.deltaV.x / dvMag, dirY: node.deltaV.y / dvMag,
        maxThrust: ship.maxThrust, isp: ship.isp,
        mWet: rows[rows.length - 1].mass,                    // 末帧的"当前质量"
        mDry: Math.max(rows[rows.length - 1].mass - (rows[0].mass - node.massWet + node.massFuel), 1),
        dvTarget: dvMag
    }, node.time);
    check('5b 反证：若仍读当前质量，燃烧时长差 = ' + Math.abs(liveMassPlan.burnDuration - rows[0].dur).toFixed(4) + 's'
        + '（→ 每帧计划变化，即修复前漂移源）',
        Math.abs(liveMassPlan.burnDuration - rows[0].dur) > 1e-3,
        '快照 ' + rows[0].dur.toFixed(6) + 's vs 当前质量 ' + liveMassPlan.burnDuration.toFixed(6) + 's');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
