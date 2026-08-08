// 修复验证：把 SOI 检测从"推进前"改为"推进后"，对照原版跑 F1-F6
globalThis.window = { _soiDiag: false };
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from './src/physics/physics.js';
import { getSOIHost, convertVelocityFrame } from './src/physics/physics.js';
import { stateToKepler, keplerToState } from './src/physics/orbitalMechanics.js';
import { rk4Integrate } from './src/physics/integrator.js';

const gmK = 3.5316e12;
const KERBIN = () => celestialBodies.find(b => b.name === 'Kerbin');

// ===== 修复版：先推进，后检测 =====
function updateShipPhysicsFixed(ship, dt, isActive) {
    if (!isActive || ship.mode === 'on_rails') {
        if (!ship.kepler) {
            let remaining = dt, p = ship.pos, v = ship.vel;
            while (remaining > 1e-9) {
                const step = Math.min(remaining, 0.05);
                const state = rk4Integrate(p, v, step, ship.currentGM, { ax: 0, ay: 0 });
                p = state.pos; v = state.vel;
                remaining -= step;
            }
            ship.pos.x = p.x; ship.pos.y = p.y;
            ship.vel.x = v.x; ship.vel.y = v.y;
        } else {
            ship.orbitTime += dt;
            const state = keplerToState(ship.kepler, ship.currentGM, ship.orbitTime);
            ship.pos.x = state.pos.x; ship.pos.y = state.pos.y;
            ship.vel.x = state.vel.x; ship.vel.y = state.vel.y;
        }
    }
    const absPos = getAbsolutePosition(ship);
    const host = getSOIHost(absPos);
    if (host) {
        if (host.name !== ship.currentSOI) {
            const oldSOI = ship.currentSOI;
            const oldHost = oldSOI ? celestialBodies.find(b => b.name === oldSOI) : null;
            const oldHostPos = oldHost ? oldHost.position : { x: 0, y: 0 };
            ship.pos.x = (oldHostPos.x + ship.pos.x) - host.position.x;
            ship.pos.y = (oldHostPos.y + ship.pos.y) - host.position.y;
            convertVelocityFrame(ship.vel, oldSOI, host.name);
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            const newKepler = stateToKepler(ship.pos, ship.vel, host.gm);
            ship.kepler = newKepler;
            ship.orbitTime = 0;
        }
    } else {
        if (ship.currentSOI !== null) {
            const oldHost = celestialBodies.find(b => b.name === ship.currentSOI);
            if (oldHost) {
                ship.pos.x = oldHost.position.x + ship.pos.x;
                ship.pos.y = oldHost.position.y + ship.pos.y;
            }
            convertVelocityFrame(ship.vel, ship.currentSOI, null);
            ship.currentSOI = null;
            ship.currentGM = 0;
            ship.kepler = null;
        }
    }
}

// 原版（照抄 physicsUpdate.js 逻辑顺序）
function updateShipPhysicsOriginal(ship, dt, isActive) {
    const absPos = getAbsolutePosition(ship);
    const host = getSOIHost(absPos);
    if (host) {
        if (host.name !== ship.currentSOI) {
            const oldSOI = ship.currentSOI;
            const oldHost = oldSOI ? celestialBodies.find(b => b.name === oldSOI) : null;
            const oldHostPos = oldHost ? oldHost.position : { x: 0, y: 0 };
            ship.pos.x = (oldHostPos.x + ship.pos.x) - host.position.x;
            ship.pos.y = (oldHostPos.y + ship.pos.y) - host.position.y;
            convertVelocityFrame(ship.vel, oldSOI, host.name);
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            const newKepler = stateToKepler(ship.pos, ship.vel, host.gm);
            ship.kepler = newKepler;
            ship.orbitTime = 0;
        }
    } else {
        if (ship.currentSOI !== null) {
            const oldHost = celestialBodies.find(b => b.name === ship.currentSOI);
            if (oldHost) {
                ship.pos.x = oldHost.position.x + ship.pos.x;
                ship.pos.y = oldHost.position.y + ship.pos.y;
            }
            convertVelocityFrame(ship.vel, ship.currentSOI, null);
            ship.currentSOI = null;
            ship.currentGM = 0;
            ship.kepler = null;
        }
    }
    if (!isActive || ship.mode === 'on_rails') {
        if (!ship.kepler) {
            let remaining = dt, p = ship.pos, v = ship.vel;
            while (remaining > 1e-9) {
                const step = Math.min(remaining, 0.05);
                const state = rk4Integrate(p, v, step, ship.currentGM, { ax: 0, ay: 0 });
                p = state.pos; v = state.vel;
                remaining -= step;
            }
            ship.pos.x = p.x; ship.pos.y = p.y;
            ship.vel.x = v.x; ship.vel.y = v.y;
        } else {
            ship.orbitTime += dt;
            const state = keplerToState(ship.kepler, ship.currentGM, ship.orbitTime);
            ship.pos.x = state.pos.x; ship.pos.y = state.pos.y;
            ship.vel.x = state.vel.x; ship.vel.y = state.vel.y;
        }
    }
}

function makeShip(startR, vInf, betaDeg) {
    const vEsc = Math.sqrt(2 * gmK / startR);
    const v = Math.sqrt(vEsc * vEsc + vInf * vInf);
    const beta = betaDeg * Math.PI / 180;
    const pos = { x: startR, y: 0 };
    const vel = { x: v * Math.cos(beta), y: v * Math.sin(beta) };
    return {
        id: 's', pos: { ...pos }, vel: { ...vel }, currentSOI: 'Kerbin', currentGM: gmK,
        kepler: stateToKepler(pos, vel, gmK), orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 }
    };
}

function run(label, startR, vInf, betaDeg, userWarp, maxFrames, updateFn) {
    updateCelestialBodies(0);
    const ship = makeShip(startR, vInf, betaDeg);
    let gameTime = 0, dt = 0.016;
    let exitFrame = -1, reentryFrames = [];
    let warpNow = userWarp;

    for (let frame = 0; frame < maxFrames; frame++) {
        let warpMax = 12;
        if (ship.currentSOI) {
            const h = celestialBodies.find(b => b.name === ship.currentSOI);
            if (h) {
                const d = Math.hypot(ship.pos.x, ship.pos.y);
                if (d > h.soiRadius * 0.99) warpMax = Math.min(warpMax, 7);
            }
        }
        warpNow = Math.min(warpNow, [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000][warpMax]);

        const simDt = dt * warpNow;
        gameTime += simDt;
        updateCelestialBodies(gameTime);

        const soiBefore = ship.currentSOI;
        updateFn(ship, simDt, true);
        const absAfter = getAbsolutePosition(ship);
        const soiAfter = ship.currentSOI;

        if (soiBefore !== soiAfter) {
            const d = Math.hypot(absAfter.x - KERBIN().position.x, absAfter.y - KERBIN().position.y);
            if (soiBefore === 'Kerbin' && soiAfter !== 'Kerbin') {
                exitFrame = frame;
            } else if (soiBefore !== 'Kerbin' && soiAfter === 'Kerbin') {
                reentryFrames.push({ frame, t: gameTime, dist: d / 1e6, kepler: ship.kepler ? ('a=' + ship.kepler.a.toExponential(2)) : 'null' });
            }
        }
        if (exitFrame >= 0 && reentryFrames.length >= 1) break;
    }
    if (reentryFrames.length > 0) {
        console.log(`[${label}] RE-ENTRY @ ${JSON.stringify(reentryFrames[0])} <<< BUG`);
    } else {
        console.log(`[${label}] no re-entry (exit@${exitFrame}) OK`);
    }
}

const scenarios = [
    ['F1', 40000000, 80, 30, 1000000],
    ['F2', 40000000, 80, 60, 1000000],
    ['F3', 40000000, 80, 90, 1000000],
    ['F4', 70000000, 50, 30, 10000000],
    ['F5', 40000000, 200, 45, 1000000],
    ['F6', 40000000, 80, 0, 1000000]
];

console.log('===== ORIGINAL (detect-then-advance) =====');
for (const s of scenarios) run(...s, 3000, updateShipPhysicsOriginal);
console.log('===== FIXED (advance-then-detect) =====');
for (const s of scenarios) run(...s, 3000, updateShipPhysicsFixed);