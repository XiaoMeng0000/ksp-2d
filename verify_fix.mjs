// t7 全面验证脚本 — 修复后状态（dir 字段 / 病态回退 / 先推进后检测 / 预测线 dir 适配）
// 运行：node verify_fix.mjs
globalThis.window = { _soiDiag: false };
import { stateToKepler, keplerPositionAtTime, keplerPositionAtTheta, keplerToState, findSOIIntersection, getOrbitalInfo } from './src/physics/orbitalMechanics.js';
import { rk4Integrate } from './src/physics/integrator.js';
import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { predictTrajectoryPatched } from './src/physics/orbitalPrediction.js';

let pass = 0, fail = 0;
function ok(cond, label, detail) {
    if (cond) { pass++; console.log(`  [PASS] ${label}`); }
    else { fail++; console.log(`  [FAIL] ${label}  ${detail || ''}`); }
}

const gmK = 3.5316e12;
const KERBIN_SOI = 84159286;
const r0 = 6e6;
const vEsc = Math.sqrt(2 * gmK / r0);
const vc = Math.sqrt(gmK / r0);

// RK4 子步对拍（与 physicsUpdate 一致：step=0.05s）
function rk4Prop(p0, v0, t, gm) {
    let p = { x: p0.x, y: p0.y }, v = { x: v0.x, y: v0.y };
    let rem = t;
    while (rem > 1e-9) {
        const st = Math.min(rem, 0.05);
        const s = rk4Integrate(p, v, st, gm, { ax: 0, ay: 0 });
        p = s.pos; v = s.vel;
        rem -= st;
    }
    return p;
}

function checkPair(label, pos, vel, gm, t) {
    const k = stateToKepler(pos, vel, gm);
    if (!k) { ok(false, `${label}: stateToKepler null`, `pos=(${pos.x},${pos.y}) vel=(${vel.x},${vel.y})`); return; }
    const h = pos.x * vel.y - pos.y * vel.x;
    ok(k.dir === (h < 0 ? -1 : 1), `${label}: dir=${k.dir} 与 h 符号一致`, `h=${h}`);
    const pA = keplerPositionAtTime(k, gm, t, k.omega);
    const pR = rk4Prop(pos, vel, t, gm);
    const err = Math.hypot(pA.x - pR.x, pA.y - pR.y);
    const dA = { x: pA.x - pos.x, y: pA.y - pos.y };
    const dR = { x: pR.x - pos.x, y: pR.y - pos.y };
    const dirOk = dA.x * dR.x + dA.y * dR.y >= 0;
    const rScale = Math.hypot(pA.x, pA.y);
    ok(Number.isFinite(pA.x) && Number.isFinite(pA.y), `${label}: 解析结果无 NaN`, `(${pA.x},${pA.y})`);
    ok(err < 5000 || err / rScale < 1e-4, `${label}: 解析≈RK4 err=${err.toExponential(2)}`, `rk4=(${pR.x.toFixed(1)},${pR.y.toFixed(1)}) analytic=(${pA.x.toFixed(1)},${pA.y.toFixed(1)})`);
    ok(dirOk, `${label}: 运动方向一致(解析与 RK4 同向)`, `dot=${(dA.x * dR.x + dA.y * dR.y).toExponential(2)}`);
    const p0 = keplerPositionAtTime(k, gm, 0, k.omega);
    ok(Math.hypot(p0.x - pos.x, p0.y - pos.y) < 1e-3, `${label}: t=0 锚定 |Δ|=${Math.hypot(p0.x - pos.x, p0.y - pos.y).toExponential(2)}`);
}

console.log('===== 1. h 符号对拍（顺行/逆行 × 圆/椭圆/双曲线）=====');
checkPair('圆 顺行', { x: r0, y: 0 }, { x: 0, y: vc }, gmK, 800);
checkPair('圆 逆行', { x: r0, y: 0 }, { x: 0, y: -vc }, gmK, 800);
// 椭圆（apoapsis 超出 Kerbin SOI 84.16M，用于后续交点测试）
const vEll = Math.sqrt(gmK * (2 / r0 - 1 / 46e6)); // a≈46e6, apoapsis≈86M > SOI
checkPair('椭圆 顺行', { x: r0, y: 0 }, { x: 0, y: vEll }, gmK, 2500);
checkPair('椭圆 逆行', { x: r0, y: 0 }, { x: 0, y: -vEll }, gmK, 2500);
const vHyp = 1.25 * vEsc;
checkPair('双曲线 顺行', { x: r0, y: 0 }, { x: 0, y: vHyp }, gmK, 900);
checkPair('双曲线 逆行', { x: r0, y: 0 }, { x: 0, y: -vHyp }, gmK, 900);

console.log('===== 2. 病态区间回退（stateToKepler 返回 null）=====');
const kRadial = stateToKepler({ x: r0, y: 0 }, { x: vEsc * 0.8, y: 0 }, gmK);
ok(kRadial === null, '径向弹道 h≈0 → null', `k=${kRadial}`);
const kNearPara = stateToKepler({ x: r0, y: 0 }, { x: vEsc * 1.006, y: 0 }, gmK);
ok(kNearPara === null, '近抛物线双曲线 e-1≈0.006 → null', `k=${kNearPara}`);
// 健康双曲线：切向速度（h≠0）且远离 e≈1 病态区，不应被回退误伤
const kHealthy = stateToKepler({ x: r0, y: 0 }, { x: 0, y: vHyp }, gmK);
ok(kHealthy !== null && kHealthy.a < 0 && kHealthy.e - 1 > 0.02, '健康双曲线不受回退影响', `a=${kHealthy?.a} e=${kHealthy?.e}`);
const kHealthyEll = stateToKepler({ x: r0, y: 0 }, { x: 0, y: vEll }, gmK);
ok(kHealthyEll !== null && kHealthyEll.a > 0, '健康椭圆不受回退影响', `a=${kHealthyEll?.a}`);

console.log('===== 3. findSOIIntersection（顺行/逆行方向一致性）=====');
for (const [label, vel, expectDir] of [
    ['椭圆顺行', { x: 0, y: vEll }, 1],
    ['椭圆逆行', { x: 0, y: -vEll }, -1],
    ['双曲顺行', { x: 0, y: vHyp }, 1],
    ['双曲逆行', { x: 0, y: -vHyp }, -1]
]) {
    const k = stateToKepler({ x: r0, y: 0 }, vel, gmK);
    const inter = findSOIIntersection(k, gmK, KERBIN_SOI);
    ok(!!inter, `${label}: 存在交点`, `inter=${JSON.stringify(inter)}`);
    if (!inter) continue;
    const rInt = Math.hypot(inter.pos.x, inter.pos.y);
    ok(Math.abs(rInt - KERBIN_SOI) < 1e-2, `${label}: 交点半径=${rInt.toFixed(2)} == SOI ${KERBIN_SOI}`);
    const hInt = inter.pos.x * inter.vel.y - inter.pos.y * inter.vel.x;
    ok(Math.sign(hInt) === Math.sign(expectDir), `${label}: 交点处角动量=${Math.sign(hInt)} 与 dir=${expectDir} 一致`);
    const pGeom = keplerPositionAtTheta(k, gmK, inter.theta);
    ok(Math.hypot(pGeom.x - inter.pos.x, pGeom.y - inter.pos.y) < 1e-3, `${label}: 交点 θ=${inter.theta.toFixed(4)} 几何自洽`);
}

console.log('===== 4. getOrbitalInfo 逆行 tToAp/tToPe 合理性 =====');
{
    // 构造逆行椭圆（a=46e6, 近拱点 rp=6e6, omega=0）：飞船位于 θ=π/2，顺时针运动
    const aT = 46e6, rpT = 6e6;
    const eT = 1 - rpT / aT;                 // ≈0.8696
    const pT = aT * (1 - eT * eT);           // 半通径
    const spT = Math.sqrt(gmK / pT);
    // 逆行（h<0）速度：prograde=(-spT, eT·spT)，取反得 (spT, -eT·spT)
    const pos = { x: 0, y: pT };
    const vel = { x: spT, y: -eT * spT };
    const k = stateToKepler(pos, vel, gmK);
    ok(!!k && Math.abs(k.theta - Math.PI / 2) < 1e-9 && k.dir === -1,
        `逆行构造正确: a=${k?.a?.toFixed(1)} e=${k?.e?.toFixed(4)} theta=${k?.theta?.toFixed(6)} dir=${k?.dir}`, `k=${JSON.stringify(k)}`);
    if (k && Math.abs(k.theta - Math.PI / 2) < 1e-9) {
        const body = { radius: 600000 };
        const info = getOrbitalInfo(k, gmK, body, pos);
        ok(info.tToAp !== null && info.tToPe !== null, `逆行 tToAp=${info.tToAp?.toFixed(0)} tToPe=${info.tToPe?.toFixed(0)} 有限`);
        if (info.tToAp !== null && info.tToPe !== null) {
            const T = 2 * Math.PI * Math.sqrt(k.a ** 3 / gmK);
            const n = 2 * Math.PI / T;
            // 独立实现（不经 getOrbitalInfo）：运动坐标 θm=π/2 处 E/M
            const Ehalf = 2 * Math.atan2(Math.sqrt(1 - k.e) * Math.sin(Math.PI / 4), Math.sqrt(1 + k.e) * Math.cos(Math.PI / 4));
            const Mhalf = Ehalf - k.e * Math.sin(Ehalf);
            // 从 θm=-π/2 到近拱点 θm=0：ΔM=M(π/2)；到远拱点 θm=π：ΔM=π+M(π/2)
            const tPeExp = Mhalf / n;
            const tApExp = T / 2 + Mhalf / n;
            ok(Math.abs(info.tToPe - tPeExp) / T < 1e-6, `逆行 tToPe≈独立计算 (${info.tToPe.toFixed(0)} vs ${tPeExp.toFixed(0)})`);
            ok(Math.abs(info.tToAp - tApExp) / T < 1e-6, `逆行 tToAp≈独立计算 (${info.tToAp.toFixed(0)} vs ${tApExp.toFixed(0)})`);
        }
    }
}

console.log('===== 5. 瞬移回归（真实 updateShipPhysics：先推进后检测 + t6 限档）=====');
function makeShip(startR, vInf, betaDeg) {
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    const beta = betaDeg * Math.PI / 180;
    const pos = { x: startR, y: 0 };
    const vel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };
    return {
        id: 's', pos: { ...pos }, vel: { ...vel }, currentSOI: 'Kerbin', currentGM: gmK,
        kepler: stateToKepler(pos, vel, gmK), orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
    };
}
const RATES = [0, 1, 2, 3, 4, 10, 50, 100, 1000, 10000, 100000, 1000000, 10000000];
function runScenario(label, startR, vInf, betaDeg, userWarp) {
    updateCelestialBodies(0);
    const ship = makeShip(startR, vInf, betaDeg);
    let gameTime = 0, dt = 0.016, warpNow = userWarp;
    let exitFrame = -1, reentry = null;
    for (let frame = 0; frame < 6000; frame++) {
        let warpMax = RATES.length - 1;
        if (ship.currentSOI) {
            const h = celestialBodies.find(b => b.name === ship.currentSOI);
            if (h) {
                const d = Math.hypot(ship.pos.x, ship.pos.y);
                if (d > h.soiRadius * 0.99) warpMax = Math.min(warpMax, RATES.indexOf(100));
            }
        }
        if (!ship.kepler && ship.currentGM > 0) warpMax = Math.min(warpMax, RATES.indexOf(50)); // t6 限档
        warpNow = Math.min(warpNow, RATES[warpMax]);
        const simDt = dt * warpNow;
        gameTime += simDt;
        updateCelestialBodies(gameTime);
        const soiBefore = ship.currentSOI;
        updateShipPhysics(ship, simDt, true);
        const soiAfter = ship.currentSOI;
        if (soiBefore !== soiAfter) {
            if (soiBefore === 'Kerbin') { exitFrame = frame; }
            else if (soiAfter === 'Kerbin') {
                const k = celestialBodies.find(b => b.name === 'Kerbin');
                const d = Math.hypot(ship.pos.x - k.position.x, ship.pos.y - k.position.y);
                reentry = { frame, d: d / 1e6 };
                break;
            }
        }
        if (exitFrame >= 0 && reentry) break;
    }
    if (reentry) {
        ok(false, `[${label}] 瞬移回 Kerbin @frame=${reentry.frame} dist=${reentry.d.toFixed(2)}M`, '回归失败');
    } else {
        ok(true, `[${label}] 无瞬移回归 exit@${exitFrame}`);
    }
}
const scenarios = [
    ['F1', 40000000, 80, 30, 1000000],
    ['F2', 40000000, 80, 60, 1000000],
    ['F3', 40000000, 80, 90, 1000000],
    ['F4', 70000000, 50, 30, 10000000],
    ['F5', 40000000, 200, 45, 1000000],
    ['F6', 40000000, 80, 0, 1000000]
];
for (const s of scenarios) runScenario(...s);

console.log('===== 6. 预测线（patchedStep）dir 适配无 NaN =====');
function predictShip(startR, vInf, betaDeg) {
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    const beta = betaDeg * Math.PI / 180;
    const pos = { x: startR, y: 0 };
    const vel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };
    return {
        id: 'p', pos: { ...pos }, vel: { ...vel }, currentSOI: 'Kerbin', currentGM: gmK,
        kepler: stateToKepler(pos, vel, gmK), orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
    };
}
for (const [label, startR, vInf, betaDeg] of [
    ['双曲顺行 F1', 40000000, 80, 30],
    ['双曲逆行', 40000000, 80, 30 + 180],
    ['双曲纯径向 F6(病态→RK4预测)', 40000000, 80, 0],
    ['抛物径向(RK4预测)', 6000000, 0, 90]
]) {
    const ship = predictShip(startR, vInf, betaDeg);
    const segs = predictTrajectoryPatched(ship, 5);
    let nPts = 0, nNaN = 0;
    for (const seg of segs) for (const p of seg.points) { nPts++; if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) nNaN++; }
    ok(nNaN === 0 && nPts > 0, `[${label}] 预测段=${segs.length} 点数=${nPts} NaN=${nNaN}`, '预测线无 NaN 且非空');
}
// 椭圆穿越 SOI（顺行/逆行）：apoapsis 86M > SOI 84.16M
for (const [label, dirV] of [['椭圆穿越SOI 顺行', vEll], ['椭圆穿越SOI 逆行', -vEll]]) {
    const ship = predictShip(6000000, 0, 0);
    ship.vel = { x: 0, y: dirV };
    ship.kepler = stateToKepler(ship.pos, ship.vel, gmK);
    const segs = predictTrajectoryPatched(ship, 5);
    let nNaN = 0, nPts = 0;
    for (const seg of segs) for (const p of seg.points) { nPts++; if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) nNaN++; }
    ok(nNaN === 0 && nPts > 0, `[${label}] 预测段=${segs.length} 点数=${nPts} NaN=${nNaN}`, '椭圆穿越 SOI 预测无 NaN 且非空');
}

console.log('===== 7. keplerToState 逆行速度方向 =====');
{
    const k = stateToKepler({ x: r0, y: 0 }, { x: 0, y: -vEll }, gmK);
    const { pos, vel } = keplerToState(k, gmK, 0.01);
    // 微小时间内逆行：θ 减小 → pos 从 (r0,0) 顺时针移动（y<0, x<r0）
    ok(pos.y < 1e-6 && pos.x < r0, `逆行 keplerToState 沿 θ 减小方向 pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)})`, '逆行推进方向错误');
    ok(vel.y < 0, `逆行 keplerToState 速度 vy=${vel.y.toFixed(1)} < 0`);
}

console.log(`\n===== 结果：${pass} PASS / ${fail} FAIL =====`);
process.exit(fail > 0 ? 1 : 0);
