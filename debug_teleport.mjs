globalThis.window = { _soiDiag: false };

import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getSOIHost, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { stateToKepler, keplerToState, keplerPositionAtTime } from './src/physics/orbitalMechanics.js';

const gmK = 3.5316e12;
const gmS = 1.1723328e18;
const SOI_K = 84159286;

const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');
const KERBOL = () => celestialBodies.find(b => b.name === 'Kerbol');

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

console.log('========== Part A: Kerbin weak-escape hyperbola: analytic vs RK4 ==========');
function testHyperbola(vInf, betaDeg, label) {
    const r0 = SOI_K * 0.999;
    const vEsc = Math.sqrt(2 * gmK / r0);
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    const beta = betaDeg * Math.PI / 180;
    const pos = { x: r0, y: 0 };
    const vel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };

    const kep = stateToKepler(pos, vel, gmK);
    if (!kep) {
        console.log('[' + label + '] vInf=' + vInf + ' beta=' + betaDeg + ': stateToKepler returns null (|a|>1e12 clamp)');
        return;
    }
    console.log('[' + label + '] vInf=' + vInf + ' beta=' + betaDeg + ': a=' + kep.a.toExponential(4) + ' e=' + kep.e.toFixed(6) + ' theta0=' + kep.theta.toFixed(4));

    const s0 = keplerToState(kep, gmK, 0);
    const dr0 = Math.hypot(s0.pos.x - pos.x, s0.pos.y - pos.y);
    const dv0 = Math.hypot(s0.vel.x - vel.x, s0.vel.y - vel.y);
    console.log('  t=0 anchor err: pos=' + dr0.toExponential(2) + 'm vel=' + dv0.toExponential(2) + 'm/s');

    for (const t of [10, 1000, 50000, 200000]) {
        const ana = keplerToState(kep, gmK, t);
        const truth = rk4Truth(pos, vel, gmK, t, 1.0);
        const dPos = Math.hypot(ana.pos.x - truth.x, ana.pos.y - truth.y);
        const rAna = Math.hypot(ana.pos.x, ana.pos.y);
        const rTru = Math.hypot(truth.x, truth.y);
        console.log('  t=' + t + ': analytic|r|=' + rAna.toFixed(0) + ' RK4|r|=' + rTru.toFixed(0) + ' posErr=' + dPos.toFixed(0) + 'm');
    }
}

testHyperbola(50, 30, 'A1');
testHyperbola(50, 90, 'A2');
testHyperbola(50, 135, 'A3');
testHyperbola(20, 45, 'A4');
testHyperbola(300, 60, 'A5');
testHyperbola(10, 30, 'A6');

console.log('========== Part B: after exit, Kerbol-frame ellipse: analytic vs RK4 ==========');
function testKerbolEllipse() {
    updateCelestialBodies(0);
    const kerbin = KERBIN();
    const rExit = SOI_K * 1.001;
    const vEsc = Math.sqrt(2 * gmK / rExit);
    const v = Math.sqrt(vEsc * vEsc + 50 * 50);
    const beta = 30 * Math.PI / 180;
    const relPos = { x: rExit, y: 0 };
    const relVel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };
    const absPos = { x: kerbin.position.x + relPos.x, y: kerbin.position.y + relPos.y };
    const absVel = { x: relVel.x + kerbin.velocity.x, y: relVel.y + kerbin.velocity.y };

    const kep = stateToKepler(absPos, absVel, gmS);
    if (!kep) {
        console.log('  stateToKepler(Kerbol) returns null');
        return;
    }
    console.log('  fitted ellipse: a=' + kep.a.toExponential(5) + ' e=' + kep.e.toExponential(3) + ' theta0=' + kep.theta.toFixed(4));
    console.log('  Kerbin orbit: a=13599840256 e=0 T=' + (2*Math.PI*Math.sqrt(13599840256**3/gmS)).toFixed(0) + 's');

    for (const t of [16000, 160000, 1600000]) {
        const ana = keplerToState(kep, gmS, t);
        const truth = rk4Truth(absPos, absVel, gmS, t, 50.0);
        const dPos = Math.hypot(ana.pos.x - truth.x, ana.pos.y - truth.y);
        const kerT = t * Math.sqrt(gmS / 13599840256 ** 3);
        const kx = 13599840256 * Math.cos(kerT), ky = 13599840256 * Math.sin(kerT);
        const dKerbin = Math.hypot(ana.pos.x - kx, ana.pos.y - ky);
        console.log('  t=' + t + ': analyticVsRK4=' + dPos.toFixed(0) + 'm | distToKerbin=' + (dKerbin/1e6).toFixed(2) + 'M (SOI=84.2M) ' + (dKerbin < SOI_K ? '[RE-ENTERED Kerbin SOI]' : ''));
    }
}
testKerbolEllipse();

console.log('========== Part C: full game-loop reproduction ==========');
function runFullLoop(label, vInf, betaDeg, warpAfterExit, dt) {
    updateCelestialBodies(0);
    const r0 = SOI_K * 0.999;
    const vEsc = Math.sqrt(2 * gmK / r0);
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    const beta = betaDeg * Math.PI / 180;

    const ship = {
        id: 'test-ship',
        pos: { x: r0, y: 0 },
        vel: { x: v * Math.cos(beta), y: v * Math.sin(beta) },
        currentSOI: 'Kerbin',
        currentGM: gmK,
        kepler: stateToKepler({ x: r0, y: 0 }, { x: v * Math.cos(beta), y: v * Math.sin(beta) }, gmK),
        orbitTime: 0,
        mode: 'on_rails',
        thrust: { ax: 0, ay: 0 }
    };

    let gameTime = 0;
    let warp = 100;
    let exitFrame = -1;
    let reentryCount = 0;
    let maxPosJump = 0;

    console.log('[' + label + '] vInf=' + vInf + ' beta=' + betaDeg + ' warpAfterExit=' + warpAfterExit);

    for (let frame = 0; frame < 3000; frame++) {
        if (ship.currentSOI) {
            const host = celestialBodies.find(b => b.name === ship.currentSOI);
            if (host && Math.hypot(ship.pos.x, ship.pos.y) > host.soiRadius * 0.99) {
                warp = Math.min(warp, 100);
            }
        }
        if (exitFrame >= 0 && frame > exitFrame + 2) {
            warp = warpAfterExit;
        }

        const simDt = dt * warp;
        gameTime += simDt;

        updateCelestialBodies(gameTime);
        const absBefore = getAbsolutePosition(ship);
        const soiBefore = ship.currentSOI;

        updateShipPhysics(ship, simDt, true);

        const absAfter = getAbsolutePosition(ship);
        const soiAfter = ship.currentSOI;
        const jump = Math.hypot(absAfter.x - absBefore.x, absAfter.y - absBefore.y);
        if (jump > maxPosJump) maxPosJump = jump;

        if (soiBefore !== soiAfter) {
            const distToKerbin = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
            console.log('  frame=' + frame + ' t=' + gameTime.toExponential(3) + ' SOI: ' + soiBefore + ' -> ' + soiAfter + ' | frameMove=' + jump.toFixed(0) + 'm | distKerbin=' + (distToKerbin/1e6).toFixed(2) + 'M');
            if (soiBefore === 'Kerbin' && soiAfter !== 'Kerbin') exitFrame = frame;
            if (soiBefore !== 'Kerbin' && soiAfter === 'Kerbin') reentryCount++;
        }

        if (reentryCount >= 3) break;
        if (frame > 500 && exitFrame < 0) {
            console.log('  did not exit within 500 frames');
            return;
        }
    }
    console.log('  [' + label + '] exitFrame=' + exitFrame + ' reentries=' + reentryCount + ' maxFrameMove=' + maxPosJump.toFixed(0) + 'm');
}

runFullLoop('C1', 80, 30, 1000000, 0.016);
runFullLoop('C2', 80, 90, 1000000, 0.016);
runFullLoop('C3', 50, 30, 100000, 0.016);
runFullLoop('C4', 80, 135, 1000000, 0.016);
