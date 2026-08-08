globalThis.window = { _soiDiag: false };
import { celestialBodies, updateCelestialBodies, getAbsolutePosition } from "./src/physics/physics.js";
import { updateShipPhysics } from "./src/physics/physicsUpdate.js";
import { stateToKepler } from "./src/physics/orbitalMechanics.js";

const dt = 1 / 60;
const KERBIN_SOI = celestialBodies.find(b => b.name === 'Kerbin').soiRadius;
const GM_KERBIN = celestialBodies.find(b => b.name === 'Kerbin').gm;

const WARP_RATES = [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000];
const ESCAPE_MAX_INDEX = 7; // 100x

function computeSimDt(ship, playerIndex) {
    let maxIndex = playerIndex;
    if (ship.currentSOI) {
        const warpHost = celestialBodies.find(b => b.name === ship.currentSOI);
        if (warpHost) {
            const distToHost = Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y);
            if (distToHost > warpHost.soiRadius * 0.99) {
                maxIndex = Math.min(maxIndex, ESCAPE_MAX_INDEX);
            }
        }
    }
    return dt * WARP_RATES[maxIndex];
}

function runScenario(name, r0, vInf, escapeTangentialSign, playerIndex, raiseAfterSwitchFrames) {
    console.log("\n========== " + name + " ==========");
    updateCelestialBodies(0);
    console.log("Kerbin gm=" + GM_KERBIN + " SOI=" + KERBIN_SOI);

    const vEsc = Math.sqrt(2 * GM_KERBIN / r0);
    const v = Math.sqrt(vInf * vInf + vEsc * vEsc);
    const ship = {
        id: 'ship-test', pos: { x: r0, y: 0 }, vel: { x: 0, y: escapeTangentialSign * v },
        currentSOI: 'Kerbin', currentGM: GM_KERBIN, kepler: null, orbitTime: 0,
        mode: 'on_rails', throttle: 0
    };
    ship.kepler = stateToKepler(ship.pos, ship.vel, GM_KERBIN);
    if (!ship.kepler) { console.log("stateToKepler=null (aMag>1e12)"); return; }
    console.log("初始 kepler: a=" + ship.kepler.a.toExponential(4) + " e=" + ship.kepler.e.toFixed(10) + " theta=" + ship.kepler.theta.toFixed(5) + " | vel=(" + ship.vel.x.toFixed(2) + "," + ship.vel.y.toFixed(2) + ")");

    let t = 0;
    let everLeft = false;
    let framesSinceSwitch = 999;
    let switchCount = 0;
    const switchLog = [];

    for (let frame = 0; frame < 20000; frame++) {
        let playerIndexNow = playerIndex;
        const simDt = computeSimDt(ship, playerIndexNow);

        t += simDt;
        updateCelestialBodies(t);

        const prevSOI = ship.currentSOI;
        updateShipPhysics(ship, simDt, false);

        if (prevSOI !== ship.currentSOI) {
            switchCount++;
            framesSinceSwitch = 0;
            const abs = getAbsolutePosition(ship);
            const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
            const dK = Math.hypot(abs.x - kerbin.position.x, abs.y - kerbin.position.y);
            switchLog.push("[帧" + frame + "] t=" + t.toFixed(0) + "s " + prevSOI + "->" + ship.currentSOI + " | 距Kerbin=" + dK.toFixed(0) + " warp=" + (simDt / dt));
            if (switchCount > 1) {
                console.log("  >>>>> 二次切换(瞬移?): " + switchLog[switchLog.length - 1]);
                console.log("      全部切换记录: " + JSON.stringify(switchLog));
                return;
            }
        } else if (framesSinceSwitch < 999) {
            framesSinceSwitch++;
        }

        const abs = getAbsolutePosition(ship);
        const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
        const dK = Math.hypot(abs.x - kerbin.position.x, abs.y - kerbin.position.y);
        if (ship.currentSOI !== 'Kerbin' && everLeft === false && dK > KERBIN_SOI) everLeft = true;
        if (everLeft && dK < KERBIN_SOI && ship.currentSOI === 'Kerbin') {
            console.log("  >>>>> 帧" + frame + " t=" + t.toFixed(0) + "s: 瞬移回 Kerbin SOI! 距=" + dK.toFixed(0) + " warp=" + (simDt / dt));
            console.log("      ship绝对=(" + abs.x.toFixed(0) + "," + abs.y.toFixed(0) + ") Kerbin=(" + kerbin.position.x.toFixed(0) + "," + kerbin.position.y.toFixed(0) + ")");
            console.log("      切换记录: " + JSON.stringify(switchLog));
            return;
        }
        if (!isFinite(abs.x) || !isFinite(abs.y)) {
            console.log("  >>>>> 帧" + frame + " t=" + t.toFixed(0) + "s: NaN/Inf 位置! currentSOI=" + ship.currentSOI + " kepler=" + (ship.kepler ? JSON.stringify(ship.kepler) : 'null'));
            console.log("      切换记录: " + JSON.stringify(switchLog));
            return;
        }
    }
    console.log("  循环结束 未复现瞬移。切换记录: " + JSON.stringify(switchLog));
}

runScenario("弱逃逸顺行 vInf=50 @8.3e7, 玩家档 1e6x", 8.3e7, 50, +1, 11, 2);
runScenario("弱逃逸顺行 vInf=50 @8.3e7, 玩家档 1e7x", 8.3e7, 50, +1, 12, 2);
runScenario("弱逃逸顺行 vInf=50 @8.4e7(已近边界), 1e7x", 8.4e7, 50, +1, 12, 2);
runScenario("中等逃逸 vInf=300 @8.3e7, 1e6x", 8.3e7, 300, +1, 11, 2);
runScenario("弱逃逸 vInf=10 @8.3e7, 1e7x", 8.3e7, 10, +1, 12, 2);
runScenario("弱逃逸 vInf=2 @8.3e7, 1e7x", 8.3e7, 2, +1, 12, 2);