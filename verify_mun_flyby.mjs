globalThis.window = { _soiDiag: false };
import { stateToKepler, keplerPositionAtTime } from './src/physics/orbitalMechanics.js';
import { rk4Integrate } from './src/physics/integrator.js';

const gmMun = 6.5138398e10;
const POS = { x: -18385.288720665307, y: 146133.778186412 };
const VEL = { x: -942.4058497316056, y: 18.718607379330795 };
const r0 = Math.hypot(POS.x, POS.y);
const v0 = Math.hypot(VEL.x, VEL.y);
console.log(`状态: r=${r0.toFixed(1)} v=${v0.toFixed(1)} v_esc=${Math.sqrt(2*gmMun/r0).toFixed(1)}`);

const k = stateToKepler(POS, VEL, gmMun);
console.log('stateToKepler:', k ? `a=${k.a.toExponential(3)} e=${k.e.toFixed(6)} dir=${k.dir}` : 'null');

function rk4Prop(p0, v0, t) {
    let p = { x: p0.x, y: p0.y }, v = { x: v0.x, y: v0.y };
    let rem = t;
    while (rem > 1e-9) {
        const st = Math.min(rem, 0.05);
        const s = rk4Integrate(p, v, st, gmMun, { ax: 0, ay: 0 });
        p = s.pos; v = s.vel;
        rem -= st;
    }
    return p;
}

console.log('=== e-1 阈值扫描（t=2000s）===');
const rTest = 147286;
const vEscTest = Math.sqrt(2 * gmMun / rTest);
for (const ratio of [1.002, 1.005, 1.0086, 1.01, 1.02, 1.05, 1.1, 1.25]) {
    const v = vEscTest * ratio;
    const pos = { x: rTest, y: 0 };
    const vel = { x: 0, y: v };
    const kk = stateToKepler(pos, vel, gmMun);
    let tag;
    if (!kk) {
        tag = 'null(回退)';
    } else {
        const pA = keplerPositionAtTime(kk, gmMun, 2000, kk.omega);
        const pR = rk4Prop(pos, vel, 2000);
        const err = Math.hypot(pA.x - pR.x, pA.y - pR.y);
        tag = `e-1=${(kk.e - 1).toExponential(2)} err=${err.toExponential(2)}m`;
    }
    console.log(`  v=${ratio}x_vEsc  ->  ${tag}`);
}

if (k) {
    console.log('=== 存档状态多时间点对拍 ===');
    for (const t of [100, 500, 1000, 2000, 5000]) {
        const pA = keplerPositionAtTime(k, gmMun, t, k.omega);
        const pR = rk4Prop(POS, VEL, t);
        const err = Math.hypot(pA.x - pR.x, pA.y - pR.y);
        console.log(`  t=${t}  err=${err.toExponential(2)}m  r_analytic=${Math.hypot(pA.x, pA.y).toFixed(0)}`);
    }
}
