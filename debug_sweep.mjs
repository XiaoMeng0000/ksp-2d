globalThis.window = { _soiDiag: false };

import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getSOIHost, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { stateToKepler, keplerToState } from './src/physics/orbitalMechanics.js';

const gmK = 3.5316e12;
const gmS = 1.1723328e18;
const SOI_K = 84159286;
const A_K = 13599840256;

const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');

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
        const d2 = deriv({ x: s.x + d1.x * h / 2, y: s.y + d1.y * h / 2, vx: s.vx + d1.vx * h / 2, vy: s.vy + d1.vy * h / 2 }, gm);
        const d3 = deriv({ x: s.x + d2.x * h / 2, y: s.y + d2.y * h / 2, vx: s.vx + d2.vx * h / 2, vy: s.vy + d2.vy * h / 2 }, gm);
        const d4 = deriv({ x: s.x + d3.x * h, y: s.y + d3.y * h, vx: s.vx + d3.vx * h, vy: s.vy + d3.vy * h }, gm);
        s.x += h / 6 * (d1.x + 2 * d2.x + 2 * d3.x + d4.x);
        s.y += h / 6 * (d1.y + 2 * d2.y + 2 * d3.y + d4.y);
        s.vx += h / 6 * (d1.vx + 2 * d2.vx + 2 * d3.vx + d4.vx);
        s.vy += h / 6 * (d1.vy + 2 * d2.vy + 2 * d3.vy + d4.vy);
    }
    return s;
}

// ===== Part D：扫描逃逸方向/速度，找"出 SOI 后解析推进落回 Kerbin SOI 内"的条件 =====
console.log('========== Part D: exit-direction sweep -> does analytic Kerbol propagation fall back inside Kerbin SOI? ==========');
// Kerbin 轨道：位置随 t 沿圆轨运动。飞船在 t0 从 SOI 边界出逃。
// 简化：Kerbin t0 位置在 (A_K, 0)，飞船相对 Kerbin 在边界外一点，方向为 dirDeg（相对 Kerbin 位置方向 +x 逆时针）
function sweepExit(dirDeg, vInf) {
    updateCelestialBodies(0);
    const kerbin = KERBIN();
    // Kerbin 位置在 t=0 是 (A_K,0)（orbitTheta0=0,e=0）
    // 飞船在 Kerbin SOI 边界外 rExit 处，方向 dirDeg
    const dir = dirDeg * Math.PI / 180;
    const rExit = SOI_K * 1.0005;
    const ex = Math.cos(dir), ey = Math.sin(dir);
    const absPos = { x: A_K + rExit * ex, y: rExit * ey };
    // 逃逸速度：Kerbin 帧内沿 dir 方向（径向向外+切向）偏转 beta 的弱逃逸
    const vEsc = Math.sqrt(2 * gmK / rExit);
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    // 速度方向：相对位置方向 dir 作为径向，betaV 为速度与径向夹角
    // 简化：直接让 Kerbin 帧速度 = 沿 dir（径向）方向 v 的一部分 + 切向
    const relVel = { x: v * ex, y: v * ey }; // 纯径向向外
    const absVel = { x: relVel.x + kerbin.velocity.x, y: relVel.y + kerbin.velocity.y };

    const kep = stateToKepler(absPos, absVel, gmS);
    if (!kep) return null;
    const Tship = 2 * Math.PI * Math.sqrt(kep.a ** 3 / gmS);
    const nKer = Math.sqrt(gmS / A_K ** 3);

    let minD = Infinity, minT = -1;
    for (const t of [4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 1024000]) {
        const ana = keplerPositionAtTime2(kep, gmS, t);
        const kt = nKer * t;
        const kx = A_K * Math.cos(kt), ky = A_K * Math.sin(kt);
        const d = Math.hypot(ana.x - kx, ana.y - ky);
        if (d < minD) { minD = d; minT = t; }
    }
    return { minD, minT, kep, Tship };
}
function keplerPositionAtTime2(kep, gm, t) {
    const s = keplerToState(kep, gm, t);
    return s.pos;
}

// 注意：Kerbin 实际会绕 Kerbol 转，飞船在 Kerbin SOI 边界外的位置也随 Kerbin 转。
// 这里 t=0 时刻 Kerbin 在 (A_K,0)，dir=0 表示飞船在 Kerbin 的 +x 方向（背向 Kerbol）
for (const dirDeg of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]) {
    for (const vInf of [30, 100]) {
        const res = sweepExit(dirDeg, vInf);
        if (!res) {
            console.log('dir=' + dirDeg + ' vInf=' + vInf + ': stateToKepler null');
            continue;
        }
        const flag = res.minD < SOI_K ? ' <<<<< RE-ENTER (inside Kerbin SOI)' : '';
        console.log('dir=' + String(dirDeg).padStart(3) + ' vInf=' + String(vInf).padStart(3) + ': a=' + res.kep.a.toExponential(3) + ' e=' + res.kep.e.toFixed(3) + ' minDistToKerbin=' + (res.minD/1e6).toFixed(2) + 'M @t=' + res.minT + flag);
    }
}
