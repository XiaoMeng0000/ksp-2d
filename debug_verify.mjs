import { stateToKepler, keplerPositionAtTime, keplerToState } from "./src/physics/orbitalMechanics.js";

const GM_KERBIN = 3.5316e12;
const GM_KERBOL = 1.1723328e18;
const KERBIN_SOI = 84159286;
const KERBIN_ORBIT_A = 13599840256;

function rk4Truth(pos, vel, gm, t, step = 1.0) {
    let p = { x: pos.x, y: pos.y }, v = { x: vel.x, y: vel.y };
    const steps = Math.max(1, Math.round(t / step));
    const dt = t / steps;
    const acc = (px, py) => {
        const r = Math.sqrt(px * px + py * py);
        const a = -gm / (r * r * r);
        return { x: a * px, y: a * py };
    };
    for (let i = 0; i < steps; i++) {
        const a1 = acc(p.x, p.y);
        const k1vx = a1.x, k1vy = a1.y, k1px = v.x, k1py = v.y;
        const a2 = acc(p.x + k1px * dt / 2, p.y + k1py * dt / 2);
        const k2vx = a2.x, k2vy = a2.y, k2px = v.x + k1vx * dt / 2, k2py = v.y + k1vy * dt / 2;
        const a3 = acc(p.x + k2px * dt / 2, p.y + k2py * dt / 2);
        const k3vx = a3.x, k3vy = a3.y, k3px = v.x + k2vx * dt / 2, k3py = v.y + k2vy * dt / 2;
        const a4 = acc(p.x + k3px * dt, p.y + k3py * dt);
        const k4vx = a4.x, k4vy = a4.y, k4px = v.x + k3vx * dt, k4py = v.y + k3vy * dt;
        v.x += dt / 6 * (k1vx + 2 * k2vx + 2 * k3vx + k4vx);
        v.y += dt / 6 * (k1vy + 2 * k2vy + 2 * k3vy + k4vy);
        p.x += dt / 6 * (k1px + 2 * k2px + 2 * k3px + k4px);
        p.y += dt / 6 * (k1py + 2 * k2py + 2 * k3py + k4py);
    }
    return { pos: p, vel: v };
}

console.log("========== Part 1: Kerbin 逃逸双曲线解析推进 vs RK4 ==========");

function makeEscapeState(r0, vInf, angDeg) {
    const vEsc = Math.sqrt(2 * GM_KERBIN / r0);
    const v = Math.sqrt(vInf * vInf + vEsc * vEsc);
    const ang = angDeg * Math.PI / 180;
    return {
        pos: { x: r0, y: 0 },
        vel: { x: v * Math.cos(ang), y: v * Math.sin(ang) }
    };
}

const scenarios = [
    { name: "弱逃逸 顺行 vInf=50 ang=0", r0: 8.0e7, vInf: 50, ang: 0 },
    { name: "弱逃逸 混合30deg vInf=50", r0: 8.0e7, vInf: 50, ang: 30 },
    { name: "弱逃逸 径向90deg vInf=50", r0: 8.0e7, vInf: 50, ang: 90 },
    { name: "中等逃逸 顺行 vInf=300", r0: 7.0e7, vInf: 300, ang: 0 },
    { name: "强逃逸 混合45deg vInf=2000", r0: 6.0e7, vInf: 2000, ang: 45 },
];

for (const sc of scenarios) {
    const s0 = makeEscapeState(sc.r0, sc.vInf, sc.ang);
    const k = stateToKepler(s0.pos, s0.vel, GM_KERBIN);
    if (!k) { console.log("\n[" + sc.name + "] stateToKepler=null"); continue; }
    console.log("\n[" + sc.name + "] a=" + k.a.toExponential(5) + " e=" + k.e.toFixed(8) + " theta0=" + k.theta.toFixed(6));

    const anchor = keplerToState(k, GM_KERBIN, 0);
    const dp0 = Math.hypot(anchor.pos.x - s0.pos.x, anchor.pos.y - s0.pos.y);
    const dv0 = Math.hypot(anchor.vel.x - s0.vel.x, anchor.vel.y - s0.vel.y);
    console.log("  t=0 anchor: dpos=" + dp0.toExponential(3) + "m dvel=" + dv0.toExponential(3) + "m/s");

    for (const t of [1, 100, 1000, 10000, 100000]) {
        const ana = keplerPositionAtTime(k, GM_KERBIN, t, k.omega);
        const ref = rk4Truth(s0.pos, s0.vel, GM_KERBIN, t, 0.5);
        const dp = Math.hypot(ana.x - ref.pos.x, ana.y - ref.pos.y);
        const rAna = Math.hypot(ana.x, ana.y);
        const rRef = Math.hypot(ref.pos.x, ref.pos.y);
        const flag = !isFinite(dp) ? "NaN" : (dp < 50 ? "OK" : dp < 5000 ? "ERR" : "BIG");
        console.log("  t=" + String(t).padStart(7) + " err=" + dp.toExponential(3) + "m rAna=" + rAna.toFixed(0) + " rRK4=" + rRef.toFixed(0) + " " + flag);
    }
}

console.log("\n========== Part 1b: 日心轨道（Kerbol 参考系）椭圆分支 ==========");
const vKerbinOrbit = Math.sqrt(GM_KERBOL / KERBIN_ORBIT_A);
console.log("Kerbin orbit speed = " + vKerbinOrbit.toFixed(1) + " m/s");
const helioCases = [
    { name: "prograde +50", dvx: vKerbinOrbit + 50, dvy: 0 },
    { name: "prograde +300", dvx: vKerbinOrbit + 300, dvy: 0 },
    { name: "mixed +50,+50", dvx: vKerbinOrbit + 50, dvy: 50 },
];
for (const hc of helioCases) {
    const pos0 = { x: KERBIN_ORBIT_A, y: 0 };
    const vel0 = { x: hc.dvx, y: hc.dvy };
    const k = stateToKepler(pos0, vel0, GM_KERBOL);
    if (!k) { console.log("\n[" + hc.name + "] stateToKepler=null"); continue; }
    console.log("\n[" + hc.name + "] a=" + k.a.toExponential(6) + " e=" + k.e.toFixed(8) + " theta0=" + k.theta.toFixed(6));

    const anchor = keplerToState(k, GM_KERBOL, 0);
    const dp0 = Math.hypot(anchor.pos.x - pos0.x, anchor.pos.y - pos0.y);
    const dv0 = Math.hypot(anchor.vel.x - vel0.x, anchor.vel.y - vel0.y);
    console.log("  t=0 anchor: dpos=" + dp0.toExponential(3) + "m dvel=" + dv0.toExponential(3) + "m/s");

    for (const t of [100, 1000, 10000, 100000]) {
        const ana = keplerPositionAtTime(k, GM_KERBOL, t, k.omega);
        const ref = rk4Truth(pos0, vel0, GM_KERBOL, t, 1.0);
        const dp = Math.hypot(ana.x - ref.pos.x, ana.y - ref.pos.y);
        const rAna = Math.hypot(ana.x, ana.y);
        const rRef = Math.hypot(ref.pos.x, ref.pos.y);
        const flag = !isFinite(dp) ? "NaN" : (dp < 50 ? "OK" : dp < 5000 ? "ERR" : "BIG");
        console.log("  t=" + String(t).padStart(7) + " err=" + dp.toExponential(3) + "m rAna=" + rAna.toFixed(0) + " rRK4=" + rRef.toFixed(0) + " " + flag);
    }
}