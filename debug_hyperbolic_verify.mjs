// 双曲线病态区间验证 v2：RK4 子步循环（<=0.05s），与 physicsUpdate.js 一致
globalThis.window = { _soiDiag: false };
import { stateToKepler, keplerPositionAtTime } from './src/physics/orbitalMechanics.js';
import { rk4Integrate } from './src/physics/integrator.js';

const GM = 1.1723328e18;
const POS = { x: 1.36e10, y: 0 };
const r = 1.36e10;
const vEsc = Math.sqrt(2 * GM / r);

function rk4Propagate(p0, v0, t) {
    let p = { x: p0.x, y: p0.y }, v = { x: v0.x, y: v0.y };
    let remaining = t;
    while (remaining > 1e-9) {
        const step = Math.min(remaining, 0.05);
        const st = rk4Integrate(p, v, step, GM, { ax: 0, ay: 0 });
        p = st.pos; v = st.vel;
        remaining -= step;
    }
    return { pos: p, vel: v };
}

function test(label, dirVec, times) {
    const v = 1.006 * vEsc;
    const vel = { x: dirVec.x * v, y: dirVec.y * v };
    const k = stateToKepler(POS, vel, GM);
    console.log('--- ' + label + '  v=(' + vel.x.toFixed(1) + ',' + vel.y.toFixed(1) + ')  kepler: ' + (k ? 'a=' + k.a.toExponential(3) + ' e=' + k.e.toFixed(6) : 'null'));
    if (!k) {
        console.log('    stateToKepler => null (直接落入 RK4)');
        return;
    }
    for (const t of times) {
        const pAnal = keplerPositionAtTime(k, GM, t, k.omega);
        const rk4 = rk4Propagate(POS, vel, t);
        const err = Math.hypot(rk4.pos.x - pAnal.x, rk4.pos.y - pAnal.y);
        console.log('    t=' + t + '  analytic=(' + pAnal.x.toExponential(2) + ',' + pAnal.y.toExponential(2) + ') rk4=(' + rk4.pos.x.toExponential(2) + ',' + rk4.pos.y.toExponential(2) + ') err=' + err.toExponential(2) + (isFinite(pAnal.x) && err < 1000 ? '  [OK]' : '  <<< BAD'));
    }
}

const TIMES = [100, 1000, 10000];
const U = 1 / Math.SQRT2;
test('径向出 (沿径矢)', { x: 1, y: 0 }, TIMES);
test('径向入', { x: -1, y: 0 }, TIMES);
test('切向逆行', { x: 0, y: -1 }, TIMES);
test('切向顺行', { x: 0, y: 1 }, TIMES);
test('混合 45°', { x: U, y: U }, TIMES);

console.log('--- 强径向逃逸 1.5x');
const v15 = 1.5 * vEsc;
const k15 = stateToKepler(POS, { x: v15, y: 0 }, GM);
console.log('    kepler: ' + (k15 ? 'a=' + k15.a.toExponential(3) + ' e=' + k15.e.toFixed(6) : 'null'));
if (k15) {
    for (const t of [100, 1000]) {
        const pAnal = keplerPositionAtTime(k15, GM, t, k15.omega);
        const rk4 = rk4Propagate(POS, { x: v15, y: 0 }, t);
        const err = Math.hypot(rk4.pos.x - pAnal.x, rk4.pos.y - pAnal.y);
        console.log('    t=' + t + '  analytic=(' + pAnal.x.toExponential(2) + ',' + pAnal.y.toExponential(2) + ') rk4=(' + rk4.pos.x.toExponential(2) + ',' + rk4.pos.y.toExponential(2) + ') err=' + err.toExponential(2) + (isFinite(pAnal.x) && err < 1000 ? '  [OK]' : '  <<< BAD'));
    }
}