globalThis.window = { _soiDiag: false };

import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { stateToKepler } from './src/physics/orbitalMechanics.js';

const gmK = 3.5316e12;
const gmS = 1.1723328e18;
const SOI_K = 84159286;
const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');

// 全循环模拟。returns {exited, reentries, exitFrame, firstReentryFrame, frameMoveLog}
function runLoop(ship, warpAfterExit, maxFrames, dt) {
    updateCelestialBodies(0);
    let gameTime = 0;
    let warp = 100;
    let exitFrame = -1;
    let reentryCount = 0;
    let firstReentryFrame = -1;
    let exitDist = null;

    for (let frame = 0; frame < maxFrames; frame++) {
        if (ship.currentSOI) {
            const host = celestialBodies.find(b => b.name === ship.currentSOI);
            if (host && Math.hypot(ship.pos.x, ship.pos.y) > host.soiRadius * 0.99) warp = Math.min(warp, 100);
        }
        if (exitFrame >= 0 && frame > exitFrame + 2) warp = warpAfterExit;

        const simDt = dt * warp;
        gameTime += simDt;

        updateCelestialBodies(gameTime);
        const absBefore = getAbsolutePosition(ship);
        const soiBefore = ship.currentSOI;

        updateShipPhysics(ship, simDt, true);

        const absAfter = getAbsolutePosition(ship);
        const soiAfter = ship.currentSOI;

        if (soiBefore !== soiAfter) {
            if (soiBefore === 'Kerbin' && soiAfter !== 'Kerbin') {
                exitFrame = frame;
                exitDist = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
            } else if (soiBefore !== 'Kerbin' && soiAfter === 'Kerbin') {
                reentryCount++;
                if (firstReentryFrame < 0) firstReentryFrame = frame;
                const d = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
                const vRel = Math.hypot(ship.vel.x, ship.vel.y);
                const kep = ship.kepler;
                const keplerInfo = kep ? ('a=' + kep.a.toExponential(2) + ' e=' + kep.e.toFixed(5)) : 'null(RK4)';
                console.log('    >> RE-ENTER frame=' + frame + ' t=' + gameTime.toExponential(3) + ' distKerbin=' + (d/1e6).toFixed(3) + 'M vRel=' + vRel.toFixed(1) + 'm/s kepler=' + keplerInfo);
            }
        }
        if (reentryCount >= 2) break;
    }
    return { exited: exitFrame >= 0, reentries: reentryCount, exitFrame, firstReentryFrame, exitDist };
}

console.log('========== Part E: escape-parameter sweep (full loop) ==========');
for (const vInf of [10, 30, 80, 200]) {
    for (const betaDeg of [0, 30, 60, 90, 120, 150]) {
        const r0 = SOI_K * 0.9995;
        const vEsc = Math.sqrt(2 * gmK / r0);
        const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
        const beta = betaDeg * Math.PI / 180;
        const pos = { x: r0, y: 0 };
        const vel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };
        const ship = {
            id: 's', pos: {...pos}, vel: {...vel}, currentSOI: 'Kerbin', currentGM: gmK,
            kepler: stateToKepler(pos, vel, gmK), orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
        };
        const r = runLoop(ship, 1000000, 30000, 0.016);
        if (r.exited && r.reentries > 0) {
            console.log('*** vInf=' + vInf + ' beta=' + betaDeg + ': EXITED@' + r.exitFrame + ' RE-ENTRY x' + r.reentries + ' (first@' + r.firstReentryFrame + ')');
        } else if (!r.exited) {
            // 未出 SOI 的弱逃逸：提高 warp 或加长帧数后再试一次
            // console.log('    vInf=' + vInf + ' beta=' + betaDeg + ': 未出SOI');
        }
    }
}
console.log('escape sweep done');

console.log('========== Part F: bound ellipse poking out of SOI ==========');
// 大椭圆：r_p=700km, r_a=1.05*SOI（近拱点在 Kerbin 表面附近，远拱点捅出 SOI）
function runBoundEllipse(rApo, warp) {
    const r_p = 700000;
    const a = (r_p + rApo) / 2;
    const e = (rApo - r_p) / (r_p + rApo);
    const vApo = Math.sqrt(gmK * (2 / rApo - 1 / a));
    // 在远拱点处放置飞船（theta=pi），速度纯切向（逆行）
    const ship = {
        id: 's', pos: { x: -rApo, y: 0 }, vel: { x: 0, y: -vApo },
        currentSOI: 'Kerbin', currentGM: gmK,
        kepler: stateToKepler({ x: -rApo, y: 0 }, { x: 0, y: -vApo }, gmK),
        orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
    };
    console.log('  rApo=' + (rApo/1e6).toFixed(1) + 'M a=' + (a/1e6).toFixed(1) + 'M e=' + e.toFixed(4) + ' warp=' + warp);
    const r = runLoop(ship, warp, 6000, 0.016);
    console.log('  result: exited=' + r.exited + ' exitFrame=' + r.exitFrame + ' reentries=' + r.reentries + (r.firstReentryFrame>=0 ? ' firstReentry@' + r.firstReentryFrame : ''));
}
runBoundEllipse(SOI_K * 1.05, 1000000);
runBoundEllipse(SOI_K * 1.02, 1000000);
runBoundEllipse(SOI_K * 1.05, 100000);
