globalThis.window = { _soiDiag: false };
import { celestialBodies, updateCelestialBodies, getAbsolutePosition, getSOIHost } from "./src/physics/physics.js";
import { updateShipPhysics } from "./src/physics/physicsUpdate.js";
import { stateToKepler } from "./src/physics/orbitalMechanics.js";

const dt = 1 / 60;
const KERBIN_SOI = celestialBodies.find(b => b.name === 'Kerbin').soiRadius;
const GM_KERBIN = celestialBodies.find(b => b.name === 'Kerbin').gm;
const WARP_RATES = [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000];
const ESCAPE_MAX_INDEX = 7;

// 逃逸方向：angleDeg 相对 Kerbin 轨道运动方向(局部+y)的角度。0=顺行切向, 180=逆行切向, 90=径向出
function runScenario(name, r0, vInf, angleDeg, playerIndex) {
    console.log("\n========== " + name + " ==========");
    updateCelestialBodies(0);
    const vEsc = Math.sqrt(2 * GM_KERBIN / r0);
    const v = Math.sqrt(vInf * vInf + vEsc * vEsc);
    const a = angleDeg * Math.PI / 180;
    // 位置相对 Kerbin 在 +x（径向外），速度方向按 angleDeg
    const ship = {
        id: 'ship-test', pos: { x: r0, y: 0 },
        vel: { x: v * Math.cos(a), y: v * Math.sin(a) },
        currentSOI: 'Kerbin', currentGM: GM_KERBIN, kepler: null, orbitTime: 0,
        mode: 'on_rails', throttle: 0
    };
    ship.kepler = stateToKepler(ship.pos, ship.vel, GM_KERBIN);
    if (!ship.kepler) { console.log("stateToKepler=null"); return; }

    let t = 0, everLeft = false, prevSOI = 'Kerbin', switchFrames = [];
    let logStart = -1;

    for (let frame = 0; frame < 30000; frame++) {
        // 档位：in Kerbin near boundary -> cap 100x; else player index
        let idx = playerIndex;
        if (ship.currentSOI) {
            const wh = celestialBodies.find(b => b.name === ship.currentSOI);
            if (wh) {
                const d = Math.hypot(ship.pos.x, ship.pos.y);
                if (d > wh.soiRadius * 0.99) idx = Math.min(idx, ESCAPE_MAX_INDEX);
            }
        }
        const simDt = dt * WARP_RATES[idx];
        t += simDt;
        updateCelestialBodies(t);
        const before = ship.currentSOI;
        updateShipPhysics(ship, simDt, false);
        if (before !== ship.currentSOI) {
            switchFrames.push(frame);
            if (logStart < 0) logStart = frame - 2;
        }
        // 逐帧记录 switch 前后 6 帧
        if (logStart >= 0 && frame >= logStart && frame <= logStart + 8) {
            const abs = getAbsolutePosition(ship);
            const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
            const dK = Math.hypot(abs.x - kerbin.position.x, abs.y - kerbin.position.y);
            const host = getSOIHost(abs);
            console.log("  帧" + frame + " t=" + t.toFixed(0) + "s SOI=" + (ship.currentSOI || 'null') +
                " 距Kerbin=" + dK.toFixed(0) + "(" + (dK < KERBIN_SOI ? "内" : "外") + ") host检测=" + (host ? host.name : 'null') +
                " warp=" + WARP_RATES[idx] + " |pos|=" + Math.hypot(ship.pos.x, ship.pos.y).toFixed(0));
        }
        const abs = getAbsolutePosition(ship);
        const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
        const dK = Math.hypot(abs.x - kerbin.position.x, abs.y - kerbin.position.y);
        if (ship.currentSOI !== 'Kerbin' && dK > KERBIN_SOI) everLeft = true;
        if (everLeft && ship.currentSOI === 'Kerbin' && dK < KERBIN_SOI) {
            console.log("  >>>>> 帧" + frame + " 瞬移回 Kerbin SOI! 距=" + dK.toFixed(0) + " 切换帧=" + JSON.stringify(switchFrames));
            return;
        }
        if (!isFinite(abs.x)) { console.log("  >>>>> NaN 帧" + frame + " SOI=" + ship.currentSOI); return; }
    }
    console.log("  未复现。切换帧=" + JSON.stringify(switchFrames));
}

runScenario("顺行逃逸(0°) vInf=50 @8.3e7 1e6x", 8.3e7, 50, 0, 11);
runScenario("逆行逃逸(180°) vInf=50 @8.3e7 1e6x", 8.3e7, 50, 180, 11);
runScenario("混合120° vInf=50 @8.3e7 1e6x", 8.3e7, 50, 120, 11);
runScenario("混合150° vInf=50 @8.3e7 1e6x", 8.3e7, 50, 150, 11);
runScenario("逆行逃逸(180°) vInf=50 @8.3e7 1e7x", 8.3e7, 50, 180, 12);
runScenario("混合135° vInf=50 @8.2e7 1e7x", 8.2e7, 50, 135, 12);
runScenario("混合150° vInf=100 @8.2e7 1e7x", 8.2e7, 100, 150, 12);
runScenario("逆行逃逸(180°) vInf=50 @8.4e7 1e7x", 8.4e7, 50, 180, 12);