globalThis.window = { _soiDiag: false };
import { stateToKepler, keplerToState } from './src/physics/orbitalMechanics.js';

const gmK = 3.5316e12;
const SOI_K = 84159286;

function deriv(s, gm) {
    const r = Math.hypot(s.x, s.y);
    const k = -gm / (r * r * r);
    return { x: s.vx, y: s.vy, vx: k * s.x, vy: k * s.y };
}
function rk4Truth(pos0, vel0, gm, totalT, h) {
    let s = { x: pos0.x, y: pos0.y, vx: vel0.x, vy: vel0.y };
    const steps = Math.round(totalT / h);
    for (let i = 0; i < steps; i++) {
        const d1 = deriv(s, gm);
        const d2 = deriv({ x: s.x + d1.x*h/2, y: s.y + d1.y*h/2, vx: s.vx + d1.vx*h/2, vy: s.vy + d1.vy*h/2 }, gm);
        const d3 = deriv({ x: s.x + d2.x*h/2, y: s.y + d2.y*h/2, vx: s.vx + d2.vx*h/2, vy: s.vy + d2.vy*h/2 }, gm);
        const d4 = deriv({ x: s.x + d3.x*h, y: s.y + d3.y*h, vx: s.vx + d3.vx*h, vy: s.vy + d3.vy*h }, gm);
        s.x += h/6*(d1.x+2*d2.x+2*d3.x+d4.x);
        s.y += h/6*(d1.y+2*d2.y+2*d3.y+d4.y);
        s.vx += h/6*(d1.vx+2*d2.vx+2*d3.vx+d4.vx);
        s.vy += h/6*(d1.vy+2*d2.vy+2*d3.vy+d4.vy);
    }
    return s;
}

// 构造高离心率 Kerbin 椭圆轨道，在 SOI 边界内一点（接近远拱点）拟合，
// 验证椭圆分支解析推进 vs RK4
console.log('========== Part G: high-e elliptical branch accuracy near apoapsis ==========');
for (const e of [0.9, 0.95, 0.97, 0.99, 0.995]) {
    const r_p = 700000;
    const a = r_p / (1 - e);
    const r_a = a * (1 + e);
    if (r_a < SOI_K) continue; // 不捅出 SOI 的忽略
    // 在 r = SOI*0.9995 处（远拱点一侧），从椭圆方程解 true anomaly theta
    const r0 = SOI_K * 0.9995;
    const cosT = (a * (1 - e*e) / r0 - 1) / e;
    const theta = Math.acos(cosT); // 0..pi，接近 pi（远拱点侧）
    const pos = { x: r0 * Math.cos(theta), y: r0 * Math.sin(theta) };
    // 速度：径向 + 切向
    const p = a * (1 - e*e);
    const sqrtGMp = Math.sqrt(gmK / p);
    const vr = sqrtGMp * e * Math.sin(theta);
    const vt = sqrtGMp * (1 + e * Math.cos(theta));
    const vel = {
        x: vr * Math.cos(theta) - vt * Math.sin(theta),
        y: vr * Math.sin(theta) + vt * Math.cos(theta)
    };
    const kep = stateToKepler(pos, vel, gmK);
    if (!kep) { console.log('e=' + e + ' r_a=' + (r_a/1e6).toFixed(1) + 'M: stateToKepler null'); continue; }
    console.log('e=' + e + ' a=' + (a/1e6).toFixed(2) + 'M r_a=' + (r_a/1e6).toFixed(2) + 'M theta0=' + theta.toFixed(3) + ' fitted e=' + kep.e.toFixed(5));
    for (const t of [100, 1000, 5000, 20000]) {
        const ana = keplerToState(kep, gmK, t);
        const truth = rk4Truth(pos, vel, gmK, t, 1.0);
        const dPos = Math.hypot(ana.pos.x - truth.x, ana.pos.y - truth.y);
        console.log('  t=' + t + ': analytic|r|=' + Math.hypot(ana.pos.x, ana.pos.y).toFixed(0) + ' RK4|r|=' + Math.hypot(truth.x, truth.y).toFixed(0) + ' posErr=' + dPos.toFixed(0) + 'm');
    }
}

// 直接测试"在 SOI 边界外拟合椭圆、解析推进后是否落回 SOI 内" —— 高偏心轨道重现场景
console.log('========== Part H: bound ellipse with apoapsis > SOI, full loop re-entry ==========');
import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');

function runBound(rApoMul, warp) {
    updateCelestialBodies(0);
    const r_p = 700000;
    const rApo = SOI_K * rApoMul;
    const a = (r_p + rApo) / 2;
    const e = (rApo - r_p) / (rApo + r_p);
    const vApo = Math.sqrt(gmK * (2 / rApo - 1 / a));
    // 远拱点：位置 (-rApo, 0)，速度纯切向逆行
    const ship = {
        id: 's', pos: { x: -rApo, y: 0 }, vel: { x: 0, y: -vApo },
        currentSOI: 'Kerbin', currentGM: gmK,
        kepler: stateToKepler({ x: -rApo, y: 0 }, { x: 0, y: -vApo }, gmK),
        orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
    };
    let gameTime = 0, warpNow = warp;
    let exitFrame = -1, reentries = 0, maxJump = 0;
    let prevAbs = getAbsolutePosition(ship);
    let prevSOI = ship.currentSOI;
    let detail = [];
    console.log('  [rApo=' + (rApo/1e6).toFixed(1) + 'M e=' + e.toFixed(4) + ' warp=' + warp + ']');
    for (let frame = 0; frame < 2000; frame++) {
        if (exitFrame < 0 && ship.currentSOI === 'Kerbin') warpNow = Math.min(warpNow, 100);
        const simDt = 0.016 * warpNow;
        gameTime += simDt;
        updateCelestialBodies(gameTime);
        const absBefore = getAbsolutePosition(ship);
        const soiBefore = ship.currentSOI;
        updateShipPhysics(ship, simDt, true);
        const absAfter = getAbsolutePosition(ship);
        const jump = Math.hypot(absAfter.x - absBefore.x, absAfter.y - absBefore.y);
        if (jump > maxJump) maxJump = jump;
        if (ship.currentSOI !== soiBefore) {
            const d = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
            const k = ship.kepler;
            const ki = k ? ('a=' + k.a.toExponential(2) + ' e=' + k.e.toFixed(4)) : 'null(RK4)';
            detail.push('    frame=' + frame + ' t=' + gameTime.toExponential(3) + ' ' + soiBefore + '->' + ship.currentSOI + ' distKerbin=' + (d/1e6).toFixed(2) + 'M vRel=' + Math.hypot(ship.vel.x, ship.vel.y).toFixed(1) + ' kepler=' + ki);
            if (soiBefore === 'Kerbin' && ship.currentSOI !== 'Kerbin') exitFrame = frame;
            if (soiBefore !== 'Kerbin' && ship.currentSOI === 'Kerbin') reentries++;
        }
        if (reentries >= 1) break;
    }
    for (const line of detail) console.log(line);
    console.log('    => exit@' + exitFrame + ' reentries=' + reentries + ' maxJump=' + maxJump.toFixed(0) + 'm');
}
runBound(1.05, 1000000);
runBound(1.02, 1000000);
runBound(1.05, 100000);
