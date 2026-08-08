globalThis.window = { _soiDiag: false };
import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { stateToKepler } from './src/physics/orbitalMechanics.js';

const gmK = 3.5316e12;
const gmS = 1.1723328e18;
const SOI_K = 84159286;
const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');

// 忠实复刻 flightScene 帧循环：档位上限检查(用上一帧pos) -> 天体推进 -> 飞船SOI检测+推进
function runFaithful(label, startR, vInf, betaDeg, userWarp, maxFrames) {
    updateCelestialBodies(0);
    const vEsc = Math.sqrt(2 * gmK / startR);
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    const beta = betaDeg * Math.PI / 180;
    const pos = { x: startR, y: 0 };
    const vel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };
    const ship = {
        id: 's', pos: {...pos}, vel: {...vel}, currentSOI: 'Kerbin', currentGM: gmK,
        kepler: stateToKepler(pos, vel, gmK), orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
    };

    let gameTime = 0, dt = 0.016;
    let exitFrame = -1, exitDetails = null;
    let reentryFrames = [];
    let warpNow = userWarp;

    console.log('[' + label + '] startR=' + (startR/1e6).toFixed(1) + 'M vInf=' + vInf + ' beta=' + betaDeg + ' userWarp=' + userWarp);

    for (let frame = 0; frame < maxFrames; frame++) {
        // 1. 档位上限检查（flightScene 用上一帧 pos）
        let warpMax = 12; // 索引
        if (ship.currentSOI) {
            const h = celestialBodies.find(b => b.name === ship.currentSOI);
            if (h) {
                const d = Math.hypot(ship.pos.x, ship.pos.y);
                if (d > h.soiRadius * 0.99) warpMax = Math.min(warpMax, 7); // 100x 索引7
            }
        }
        warpNow = Math.min(warpNow, [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000][warpMax]);
        if (warpNow < userWarp && exitFrame >= 0) warpNow = userWarp; // 出SOI后档位放开

        const simDt = dt * warpNow;
        gameTime += simDt;

        // 2. 天体推进
        updateCelestialBodies(gameTime);
        // 3. 飞船物理
        const absBefore = getAbsolutePosition(ship);
        const soiBefore = ship.currentSOI;
        updateShipPhysics(ship, simDt, true);
        const absAfter = getAbsolutePosition(ship);
        const soiAfter = ship.currentSOI;

        if (soiBefore !== soiAfter) {
            const d = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
            if (soiBefore === 'Kerbin' && soiAfter !== 'Kerbin') {
                exitFrame = frame;
                exitDetails = { t: gameTime, dist: d, warp: warpNow, frameMove: Math.hypot(absAfter.x-absBefore.x, absAfter.y-absBefore.y) };
            } else if (soiBefore !== 'Kerbin' && soiAfter === 'Kerbin') {
                reentryFrames.push({ frame, t: gameTime, dist: d, warp: warpNow, velRel: Math.hypot(ship.vel.x, ship.vel.y), kepler: ship.kepler ? ('a=' + ship.kepler.a.toExponential(2) + ' e=' + ship.kepler.e.toFixed(5)) : 'null' });
            }
        }
        if (exitFrame >= 0 && reentryFrames.length >= 1) break;
    }
    if (exitDetails) {
        console.log('  exit@frame=' + exitFrame + ' t=' + exitDetails.t.toExponential(3) + ' warp=' + exitDetails.warp + ' exitDist=' + (exitDetails.dist/1e6).toFixed(2) + 'M frameMove=' + exitDetails.frameMove.toFixed(0));
    } else {
        console.log('  did not exit');
    }
    if (reentryFrames.length > 0) {
        for (const r of reentryFrames) {
            console.log('  *** RE-ENTRY frame=' + r.frame + ' t=' + r.t.toExponential(3) + ' distKerbin=' + (r.dist/1e6).toFixed(2) + 'M vRel=' + r.velRel.toFixed(1) + ' kepler=' + r.kepler + ' <<<<< 瞬移回 Kerbin SOI');
        }
    } else {
        console.log('  no re-entry');
    }
}

runFaithful('F1', 40000000, 80, 30, 1000000, 5000);
runFaithful('F2', 40000000, 80, 60, 1000000, 5000);
runFaithful('F3', 40000000, 80, 90, 1000000, 5000);
runFaithful('F4', 70000000, 50, 30, 10000000, 5000);
runFaithful('F5', 40000000, 200, 45, 1000000, 5000);
runFaithful('F6', 40000000, 80, 0, 1000000, 5000);
