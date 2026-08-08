// 验证：1) 椭圆/圆轨道逆行 h<0 解析方向是否错误  2) F6 径向逃逸的状态链
globalThis.window = { _soiDiag: false };
import { stateToKepler, keplerPositionAtTime } from './src/physics/orbitalMechanics.js';
import { rk4Integrate } from './src/physics/integrator.js';

function rk4Prop(p0, v0, t, gm) {
    let p = { x: p0.x, y: p0.y }, v = { x: v0.x, y: v0.y };
    let rem = t;
    while (rem > 1e-9) {
        const st = rk4Integrate(p, v, Math.min(rem, 0.05), gm, { ax: 0, ay: 0 });
        p = st.pos; v = st.vel;
        rem -= Math.min(rem, 0.05);
    }
    return p;
}

function check(label, pos, vel, gm, t, note) {
    const k = stateToKepler(pos, vel, gm);
    let pA = null, err = null, dirOk = null;
    if (k) {
        try { pA = keplerPositionAtTime(k, gm, t, k.omega); } catch (e) { pA = { x: NaN, y: NaN }; }
        const pR = rk4Prop(pos, vel, t, gm);
        err = Math.hypot(pA.x - pR.x, pA.y - pR.y);
        // 方向判据：解析位移与 RK4 位移同向？
        const dA = { x: pA.x - pos.x, y: pA.y - pos.y };
        const dR = { x: pR.x - pos.x, y: pR.y - pos.y };
        const dot = dA.x * dR.x + dA.y * dR.y;
        dirOk = dot >= 0;
    }
    console.log('--- ' + label + (note ? '  [' + note + ']' : ''));
    console.log('    kepler: ' + (k ? 'a=' + k.a.toExponential(3) + ' e=' + k.e.toFixed(6) + ' theta0=' + k.theta.toFixed(4) + ' omega=' + k.omega.toFixed(4) : 'null'));
    if (k) console.log('    t=' + t + ' analytic=(' + pA.x.toExponential(3) + ',' + pA.y.toExponential(3) + ') rk4=(' + (rk4Prop(pos, vel, t, gm).x).toExponential(3) + ',' + (rk4Prop(pos, vel, t, gm).y).toExponential(3) + ') err=' + err.toExponential(2) + ' 方向' + (dirOk ? '同向[OK]' : '相反[BAD]'));
}

const gmK = 3.5316e12;
// 1. Kerbin 系圆轨道：v_circ = sqrt(gmK/6e6)
const rc = 6e6;
const vc = Math.sqrt(gmK / rc);
console.log('v_circ =', vc.toFixed(1), 'm/s');
check('圆轨道 顺行(h>0)', { x: rc, y: 0 }, { x: 0, y: vc }, gmK, 1000);
check('圆轨道 逆行(h<0)', { x: rc, y: 0 }, { x: 0, y: -vc }, gmK, 1000);
// 2. Kerbin 系椭圆（速度 > 圆速度）
check('椭圆 顺行(1.3x)', { x: rc, y: 0 }, { x: 0, y: 1.3 * vc }, gmK, 2000);
check('椭圆 逆行(1.3x)', { x: rc, y: 0 }, { x: 0, y: -1.3 * vc }, gmK, 2000);
// 3. F6 链：Kerbin 系径向逃逸
const r0 = 4e7;
const vEscK = Math.sqrt(2 * gmK / r0);
const kF6 = stateToKepler({ x: r0, y: 0 }, { x: vEscK * 1.006, y: 0 }, gmK);
console.log('--- F6径向逃逸 Kerbin系: vEsc*1.006=' + (vEscK * 1.006).toFixed(1));
console.log('    kepler: ' + (kF6 ? 'a=' + kF6.a.toExponential(3) + ' e=' + kF6.e.toFixed(6) : 'null'));
if (kF6) {
    for (const t of [100, 10000]) {
        let p;
        try { p = keplerPositionAtTime(kF6, gmK, t, kF6.omega); }
        catch (e) { p = { x: NaN, y: NaN }; }
        console.log('    t=' + t + ' analytic=(' + p.x.toExponential(2) + ',' + p.y.toExponential(2) + ')');
    }
}