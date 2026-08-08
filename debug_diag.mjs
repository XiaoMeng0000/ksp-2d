globalThis.window = { _soiDiag: false };
import { updateShipPhysics } from './src/physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { stateToKepler } from './src/physics/orbitalMechanics.js';

const gmK = 3.5316e12;
const gmS = 1.1723328e18;
const SOI_K = 84159286;
const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');
const KERBOL = () => celestialBodies.find(b => b.name === 'Kerbol');
const RATES = [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000];

function diag(label, startR, vInf, betaDeg, userWarp, forceFullWarpAfterExit, maxFrames) {
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
    let gameTime = 0, dt = 0.016, warpNow = userWarp, exitFrame = -1;

    console.log('=== ' + label + ' forceFullWarpAfterExit=' + forceFullWarpAfterExit + ' ===');
    for (let frame = 0; frame < maxFrames; frame++) {
        let warpMax = 12;
        if (ship.currentSOI) {
            const h = celestialBodies.find(b => b.name === ship.currentSOI);
            if (h) {
                const d = Math.hypot(ship.pos.x, ship.pos.y);
                if (d > h.soiRadius * 0.99) warpMax = Math.min(warpMax, 7);
            }
        }
        warpNow = Math.min(warpNow, RATES[warpMax]);
        if (forceFullWarpAfterExit && warpNow < userWarp && exitFrame >= 0) warpNow = userWarp;
        const simDt = dt * warpNow;
        gameTime += simDt;
        updateCelestialBodies(gameTime);

        const absBefore = getAbsolutePosition(ship);
        const soiBefore = ship.currentSOI;
        updateShipPhysics(ship, simDt, true);
        const absAfter = getAbsolutePosition(ship);
        const soiAfter = ship.currentSOI;

        const dKerbinBefore = Math.hypot(absBefore.x - KERBIN().position.x, absBefore.y - KERBIN().position.y);
        const dKerbinAfter = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
        const line = 'f=' + frame + ' t=' + gameTime.toExponential(3) +
            ' warp=' + warpNow +
            ' SOI=' + soiBefore + '->' + soiAfter +
            ' dKB(前)=' + (dKerbinBefore/1e6).toFixed(2) + 'M' +
            ' dKB(后)=' + (dKerbinAfter/1e6).toFixed(2) + 'M' +
            ' vRel=' + Math.hypot(ship.vel.x, ship.vel.y).toFixed(1);
        if (soiBefore !== soiAfter) {
            console.log(line + ' <<< SWITCH');
            if (soiBefore === 'Kerbin' && soiAfter !== 'Kerbin') exitFrame = frame;
            if (soiBefore !== 'Kerbin' && soiAfter === 'Kerbin') console.log(line + ' <<< RE-ENTRY BUG');
        } else if (frame >= exitFrame && exitFrame >= 0) {
            console.log(line);
        }
        if (exitFrame >= 0 && soiAfter === 'Kerbin' && frame > exitFrame) break;
        if (frame > exitFrame + 3 && exitFrame >= 0) break;
    }
}

diag('A-真实行为(出SOI后保持100x)', 40000000, 80, 90, 1000000, false, 300);
diag('B-模拟全开(出SOI后跳1e6x)', 40000000, 80, 90, 1000000, true, 300);