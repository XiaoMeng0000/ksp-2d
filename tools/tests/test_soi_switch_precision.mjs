'use strict';
// SOI 切换点速度量化噪声回归测试（node 环境）
// 用法: node tools/tests/test_soi_switch_precision.mjs
//
// 背景（缺陷）：预测链与真实物理在 SOI 切换点求速度时，用「绝对世界坐标 + dt=1ms 前向差商」：
//   位置量级 1e10~1e11 m 的浮点分辨率约 1e-6 m，而 1ms 位移仅 |v|·1e-3 ≈ 0.5~30 m，
//   两者量级接近 → 灾难性抵消，速度噪声实测 2e-3 ~ 6e-2 m/s 且随 t 伪随机变化。
//   orbitalPrediction.bodyFutureVel / patchedStep 椭圆分支切换点 absVel /
//   timeToNextSOISwitch 探针速度 / physics.updateCelestialBodies 的 body.velocity 同源同病。
// 期望（修复后）：同一批切换点速度改用解析式（keplerToState 的 vel 分量，与位置严格同源），
//   Eve SOI 段离心率帧间抖动降到 1e-6 以下、段末端世界坐标帧间二阶差分降到 1 m 以下。
//
// 注：浏览器全局 window 在 node 下缺失，注入最小垫片后再动态导入业务模块；
//     模块命名空间取值（而非具名解构）以便修复前的旧模块也能跑出 FAIL 而非链接错误。
globalThis.window = globalThis.window || {};

const physics = await import('../../src/physics/physics.js');
const om = await import('../../src/physics/orbitalMechanics.js');
const prediction = await import('../../src/physics/orbitalPrediction.js');
const physicsUpdate = await import('../../src/physics/physicsUpdate.js');
const bus = await import('../../src/eventBus.js');

const { celestialBodies, updateCelestialBodies } = physics;
const { stateToKepler, keplerPositionAtTime, keplerToState } = om;
const { predictTrajectoryPatched, predictTrajectoryBurned, bodyFuturePos, getCachedTime } = prediction;
const { updateShipPhysics } = physicsUpdate;
const { eventBus, Events } = bus;
// 修复后新增导出；修复前不存在 → 对应断言按不通过处理（测试需能同时跑在修复前/后）
const bodyFutureState = typeof prediction.bodyFutureState === 'function' ? prediction.bodyFutureState : null;

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
    cond ? pass++ : fail++;
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : '   ' + extra));
};
const byName = (n) => celestialBodies.find(b => b.name === n);

// ===== 存档「检查点 2」真实状态 =====
// 来源：用户存档 ksp2d「检查点 2」——Kerbin→Eve 转移，掠 Eve SOI（预测链含 Kerbin 逃逸与 Eve 段）
const T0 = 4818704.6965978;
const CHECKPOINT = {
    id: 'ship_1791645436978_7tg0t',
    pos: { x: 914854.955833659, y: 41236.90626401326 },
    vel: { x: 412.4470061117708, y: 2949.827362457047 },
    currentSOI: 'Kerbin', currentGM: 3531600000000,
    kepler: { a: -3047485.472046731, e: 1.291580161904607, theta: 0.3260738310000609, omega: -0.2810295182708577, dir: 1 },
    orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
};
const mkShip = () => ({
    id: CHECKPOINT.id,
    pos: { x: CHECKPOINT.pos.x, y: CHECKPOINT.pos.y },
    vel: { x: CHECKPOINT.vel.x, y: CHECKPOINT.vel.y },
    currentSOI: CHECKPOINT.currentSOI, currentGM: CHECKPOINT.currentGM,
    kepler: { ...CHECKPOINT.kepler },
    orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
});

const DT = 1 / 60;
const FRAMES = 300;   // 要求 ≥60 帧；取 300 帧与独立验收者的基线口径对齐（同 60fps、1x）

// ===== T1：逐帧推进 + 预测链，采集 Eve 段离心率与段末端世界坐标 =====
// 段末端世界坐标口径同 renderer.getSegmentAnchor：bodyFuturePos(anchorBody, getCachedTime()) + 末点相对坐标
const ship = mkShip();
let T = T0;
const hist = [];
for (let f = 0; f < FRAMES; f++) {
    T += DT;
    updateCelestialBodies(T);
    eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: T, dt: DT });
    updateShipPhysics(ship, DT, true);
    const segs = predictTrajectoryPatched(ship, 5);
    const now = getCachedTime();
    const rec = { f, T, shipSOI: ship.currentSOI, hosts: segs.map(s => s.anchorBody).join('>'), segs: [] };
    for (const seg of segs) {
        const b = byName(seg.anchorBody);
        const anchor = b ? bodyFuturePos(b, now) : { x: 0, y: 0 };
        const last = seg.relPoints[seg.relPoints.length - 1];
        const k = (seg.startState && b) ? stateToKepler(seg.startState.relPos, seg.startState.relVel, b.gm) : null;
        rec.segs.push({
            host: seg.anchorBody,
            e: k ? k.e : null,
            wTail: { x: anchor.x + last.x, y: anchor.y + last.y }
        });
    }
    hist.push(rec);
}

// 断言①：取 anchorBody==='Eve' 的段，其离心率帧间平均 |Δe| ≤ 1e-6（修复前实测 ≈5.4e-3）
const eveSegs = hist.map(h => h.segs.find(s => s.host === 'Eve') || null);
const eSeries = eveSegs.map(s => (s && s.e !== null) ? s.e : null);
const eValid = eSeries.filter(v => v !== null);
let eJitter = 0, eSteps = 0;
for (let i = 1; i < eSeries.length; i++) {
    if (eSeries[i] !== null && eSeries[i - 1] !== null) { eJitter += Math.abs(eSeries[i] - eSeries[i - 1]); eSteps++; }
}
eJitter = eSteps ? eJitter / eSteps : NaN;
const eSpread = eValid.length ? Math.max(...eValid) - Math.min(...eValid) : NaN;
check('T1 Eve 段存在且覆盖全部帧', eValid.length === FRAMES, `帧数=${eValid.length}/${FRAMES}`);
check('T1 Eve 段离心率帧间平均 |Δe| ≤ 1e-6', eJitter <= 1e-6, `实测 ${eJitter.toExponential(3)}（修复前约 5.4e-3）`);

// 断言②：该段末端世界坐标帧间二阶差分 ≤ 1 m（修复前实测 1.8e6 m）
const d2List = [];
for (let i = 1; i < hist.length - 1; i++) {
    const a = eveSegs[i - 1], b = eveSegs[i], c = eveSegs[i + 1];
    if (!a || !b || !c) continue;
    d2List.push(Math.hypot(c.wTail.x - 2 * b.wTail.x + a.wTail.x, c.wTail.y - 2 * b.wTail.y + a.wTail.y));
}
const d2Max = d2List.length ? Math.max(...d2List) : NaN;
check('T1 Eve 段末端世界坐标帧间二阶差分 ≤ 1 m', d2Max <= 1, `实测 ${d2Max.toExponential(3)} m（修复前约 1.8e6）`);

// 断言③：每帧宿主序列恒为 Kerbin>Kerbol>Eve>Kerbol
const seqs = [...new Set(hist.map(h => h.hosts))];
check('T1 每帧宿主序列恒为 Kerbin>Kerbol>Eve>Kerbol', seqs.length === 1 && seqs[0] === 'Kerbin>Kerbol>Eve>Kerbol',
    `实际种类=${seqs.length} [${seqs.join(' | ')}]`);

// ===== T2：SOI 切换点/未来时刻的解析速度 vs 独立高阶参考 =====
// 参考口径：对「天体相对父天体的位置函数」做 Richardson 4 阶外推（D(h) 为中心差分）：
//   R(h) = (4·D(h/2) − D(h)) / 3，h² 截断项被消去，余项 O((n·h)⁴/480)
// 步长取该天体自身轨道周期 P 的 1/1000（n·h = 2π/1000 ⇒ 相对截断 ≈ 3e-12，可忽略）。
// 为何不用固定 h=20 s 的裸中心差分做参考：参考自身误差就超过阈值 ——
//   截断误差 ≈ h²/6·r·ω³（Laythe 实测 3.0e-3 m/s），且绝对坐标 ~1e11 m 的 ulp 经 1/h 放大
//   也到 1e-6 量级（Eeloo 实测 2.7e-6 m/s）→ 会把正确实现判成错误。
//   逐级（相对系）高阶外推后参考自身误差实测 ≤ 7.9e-8 m/s（60 帧内最大），阈值 1e-6 留 12 倍余量。
const HARMONIC_K = 1000;
const refPeriod = (b) => 2 * Math.PI * Math.sqrt(b.orbitA * b.orbitA * b.orbitA / byName(b.orbitParent).gm);
function richRelVel(body, t) {
    const p = byName(body.orbitParent);
    const kepler = { a: body.orbitA, e: body.orbitE, theta: body.orbitTheta0, omega: body.orbitOmega };
    const h = refPeriod(body) / HARMONIC_K;
    const D = (hh) => {
        const p1 = keplerPositionAtTime(kepler, p.gm, t + hh, body.orbitOmega);
        const p0 = keplerPositionAtTime(kepler, p.gm, t - hh, body.orbitOmega);
        return { x: (p1.x - p0.x) / (2 * hh), y: (p1.y - p0.y) / (2 * hh) };
    };
    const d1 = D(h), d2 = D(h / 2);
    return { x: (4 * d2.x - d1.x) / 3, y: (4 * d2.y - d1.y) / 3 };
}
// 沿父链累加参考相对速度 → 独立于被测实现的绝对速度参考
function refAbsVel(body, t) {
    let v = { x: 0, y: 0 }, cur = body;
    while (cur && cur.orbitParent) {
        const r = richRelVel(cur, t);
        v = { x: v.x + r.x, y: v.y + r.y };
        cur = byName(cur.orbitParent);
    }
    return v;
}

// 断言④a：updateCelestialBodies 写入的 body.velocity（真实 SOI 切换换系所用值）
updateCelestialBodies(T0);
{
    let worst = { name: '', err: 0 };
    for (const b of celestialBodies) {
        const ref = refAbsVel(b, T0);
        const err = Math.hypot(b.velocity.x - ref.x, b.velocity.y - ref.y);
        if (err > worst.err) worst = { name: b.name, err };
    }
    check('T2 updateCelestialBodies 解析速度 vs 高阶参考 < 1e-6 m/s（17 天体）', worst.err < 1e-6,
        `最大 ${worst.name} ${worst.err.toExponential(3)} m/s（修复前实测 3.8e-2）`);
}

// 断言④b：bodyFutureState（预测链 SOI 切换点所用的"未来时刻解析速度"）
{
    const tFuture = T0 + 3.0e6;   // 约 34.7 天后：覆盖 Kerbin→Eve 转移的预测时长尺度
    let err = null, note = '';
    if (!bodyFutureState) {
        note = 'bodyFutureState 未导出（修复前状态）';
    } else {
        let worst = { name: '', err: 0 };
        for (const b of celestialBodies) {
            const st = bodyFutureState(b, tFuture);
            const ref = refAbsVel(b, tFuture);
            const e = Math.hypot(st.vel.x - ref.x, st.vel.y - ref.y);
            if (e > worst.err) worst = { name: b.name, err: e };
        }
        err = worst.err;
        note = `最大 ${worst.name} ${worst.err.toExponential(3)} m/s @T+3e6s`;
    }
    check('T2 bodyFutureState 未来时刻解析速度 vs 高阶参考 < 1e-6 m/s（17 天体）', err !== null && err < 1e-6, note);
}

// 断言④c（附加）：解析速度与「位置方程的解析导数」互证 —— 用不依赖差分的守恒量恒等式：
//   vis-viva：|v|² == gm·(2/r − 1/a)；角动量：|r × v| == √(gm·p)，p = a(1−e²)
// 二者对解析速度是恒等式，折算成速度量纲（Δv_mag = |残差|/(2|v|)、Δv_dir = |残差|/r）后
// 只受位置函数精度限制（实测 ~1e-11 m/s），故阈值取 1e-8 m/s。
{
    let worst = { name: '', err: 0 };
    for (const b of celestialBodies) {
        if (!b.orbitParent) continue;
        const p = byName(b.orbitParent);
        const kepler = { a: b.orbitA, e: b.orbitE, theta: b.orbitTheta0, omega: b.orbitOmega };
        const st = keplerToState(kepler, p.gm, T0);
        const r = Math.hypot(st.pos.x, st.pos.y);
        const v2 = st.vel.x * st.vel.x + st.vel.y * st.vel.y;
        const pSem = kepler.a * (1 - kepler.e * kepler.e);
        const dvMag = Math.abs(v2 - p.gm * (2 / r - 1 / kepler.a)) / (2 * Math.sqrt(v2));
        const hCross = st.pos.x * st.vel.y - st.pos.y * st.vel.x;
        const dvDir = Math.abs(Math.abs(hCross) - Math.sqrt(p.gm * pSem)) / r;
        const err = Math.max(dvMag, dvDir);
        if (err > worst.err) worst = { name: b.name, err };
    }
    check('T2 解析速度与位置方程解析导数互证（vis-viva + 角动量）< 1e-8 m/s', worst.err < 1e-8,
        `最大 ${worst.name} ${worst.err.toExponential(3)} m/s`);
}

// ===== T3：径向弹道回归（patchedRadialLine 内 velRel 未定义 → 必抛 ReferenceError）=====
// 触发条件：stateToKepler 因 |h| < hMin 返回 null（纯径向弹道），走径向解析直线分支。
// 该分支曾引用未定义标识符 velRel（形参名为 relVel），每次预测必抛错；渲染链路无中间 try，
// 结果是该帧 update+render 整体丢弃、画面永久定格。此处断言"不抛错 + 段点全为有限值"。
{
    const mun = byName('Mun');
    const r0 = 450000;                                  // Mun 系 r = 450 km
    const vEsc = Math.sqrt(2 * mun.gm / r0);            // ≈ 538 m/s
    const cases = [
        { label: '径向束缚 300 m/s', speed: 300 },
        { label: '径向逃逸 1.15·v_esc', speed: 1.15 * vEsc }
    ];
    updateCelestialBodies(T);
    eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: T, dt: DT });
    for (const c of cases) {
        const radialShip = {
            id: 'radial_' + Math.round(c.speed), mode: 'on_rails',
            pos: { x: r0, y: 0 }, vel: { x: c.speed, y: 0 },
            currentSOI: 'Mun', currentGM: mun.gm,
            kepler: null, orbitTime: 0, thrust: { ax: 0, ay: 0 }
        };
        let segs = null, err = null;
        try {
            segs = predictTrajectoryPatched(radialShip, 5);
        } catch (e) {
            err = e;
        }
        check(`T3 ${c.label}: 预测不抛错`, err === null, err ? String(err.message || err) : `段数=${segs.length}`);
        let finite = segs !== null && segs.length > 0;
        if (segs) {
            for (const seg of segs) {
                for (const p of seg.relPoints) {
                    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.t)) finite = false;
                }
                const st = seg.startState;
                if (st && (!isFinite(st.relPos.x) || !isFinite(st.relPos.y)
                    || !isFinite(st.relVel.x) || !isFinite(st.relVel.y))) finite = false;
            }
        }
        check(`T3 ${c.label}: 段点与起始状态全为有限值`, finite);
    }
}

// ===== T4：模式 B（燃烧弧）回归 =====
// R1：integrateThrustArc 曾按 thrustAccel.x/.y 读取推力分量（全项目约定为 {ax, ay}）→ 推力为
// undefined，整条燃烧弧恒 NaN，并经 patchedStep 续段扩散（验收者取证：燃烧弧 801 点中 800 非法、
// 全链 1402 点中 1401 非法，逐位相同 NaN）。断言：燃烧弧非空 + 全链所有点均为有限值。
{
    updateCelestialBodies(T);
    eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: T, dt: DT });
    const burnShip = { ...mkShip(), thrust: { ax: 2.0, ay: 0.5 }, burnDuration: 120 };
    let segs = null, err = null;
    try {
        segs = predictTrajectoryBurned(burnShip, true);
    } catch (e) {
        err = e;
    }
    const burnSeg = segs ? segs.find(s => s.isBurnArc) : null;
    let badPts = 0, totalPts = 0;
    if (segs) {
        for (const seg of segs) {
            for (const p of seg.relPoints) {
                totalPts++;
                if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.t)) badPts++;
            }
        }
    }
    check('T4 模式 B 燃烧弧非空且不抛错', err === null && !!burnSeg && burnSeg.relPoints.length > 1,
        err ? String(err.message || err) : `段数=${segs.length} 弧点=${burnSeg ? burnSeg.relPoints.length : 0}`);
    check('T4 模式 B 全链点全为有限值（NaN 计数 0）', err === null && badPts === 0, `非法点=${badPts}/${totalPts}`);
}

// ===== 汇总 =====
console.log('\n关键指标: Eve 段 e 帧间平均抖动=' + eJitter.toExponential(3)
    + '  e 极差=' + eSpread.toExponential(3)
    + '  段末端二阶差分 max=' + d2Max.toExponential(3) + ' m');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
