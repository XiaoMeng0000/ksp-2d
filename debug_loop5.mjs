globalThis.window = { _soiDiag: false };
import { celestialBodies, updateCelestialBodies, getAbsolutePosition, getSOIHost } from "./src/physics/physics.js";
import { updateShipPhysics } from "./src/physics/physicsUpdate.js";
import { stateToKepler } from "./src/physics/orbitalMechanics.js";

const dt = 1 / 60;
const KERBIN_SOI = celestialBodies.find(b => b.name === 'Kerbin').soiRadius;
const GM_KERBIN = celestialBodies.find(b => b.name === 'Kerbin').gm;
const WARP_RATES = [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000];

// exitPos: 穿越点相对 Kerbin 的偏移方向。速度垂直于位置向量(保证 h!=0)
function runScenario(name, exitPos, vInf, postWarpIdx) {
    console.log("\n========== " + name + " ==========");
    updateCelestialBodies(0);
    const r0 = KERBIN_SOI - 100000;
    const p = exitPos;
    const shipPos = { x: p.x * r0, y: p.y * r0 };
    const vEsc = Math.sqrt(2 * GM_KERBIN / r0);
    const v = Math.sqrt(vInf * vInf + vEsc * vEsc);
    // 垂直方向的速度（绕 +90°）
    const shipVel = { x: -p.y * v, y: p.x * v };
    const ship = {
        id: 'ship-test', pos: shipPos, vel: shipVel,
        currentSOI: 'Kerbin', currentGM: GM_KERBIN, kepler: null, orbitTime: 0,
        mode: 'on_rails', throttle: 0
    };
    ship.kepler = stateToKepler(ship.pos, ship.vel, GM_KERBIN);
    if (!ship.kepler) { console.log("stateToKepler=null"); return; }
    console.log("kepler a=" + ship.kepler.a.toExponential(4) + " e=" + ship.kepler.e.toFixed(8) + " pos=(" + ship.pos.x.toFixed(0) + "," + ship.pos.y.toFixed(0) + ") vel=(" + shipVel.x.toFixed(1) + "," + shipVel.y.toFixed(1) + ")");

    let t = 0, switched = false, switchFrame = -1;

    for (let frame = 0; frame < 40; frame++) {
        let warp = 100;
        if (switched) {
            warp = (frame - switchFrame > 1) ? WARP_RATES[postWarpIdx] : WARP_RATES[7];
        }
        const simDt = dt * warp;
        t += simDt;
        updateCelestialBodies(t);

        const absBefore = getAbsolutePosition(ship);
        const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
        const dBefore = Math.hypot(absBefore.x - kerbin.position.x, absBefore.y - kerbin.position.y);
        const hostBefore = getSOIHost(absBefore);

        const prevSOI = ship.currentSOI;
        updateShipPhysics(ship, simDt, false);
        const switchedNow = prevSOI !== ship.currentSOI;
        if (switchedNow && !switched) { switched = true; switchFrame = frame; }

        const absAfter = getAbsolutePosition(ship);
        const dAfter = Math.hypot(absAfter.x - kerbin.position.x, absAfter.y - kerbin.position.y);
        const tag = switchedNow ? " <-- 切换!" : "";
        console.log("帧" + frame + " t=" + t.toFixed(0) + "s warp=" + warp +
            " | 帧首: SOI=" + (hostBefore ? hostBefore.name : 'null') + " 距K=" + dBefore.toFixed(0) +
            " | 帧后: SOI=" + (ship.currentSOI || 'null') + " 距K=" + dAfter.toFixed(0) +
            " |pos|=" + Math.hypot(ship.pos.x, ship.pos.y).toFixed(0) + tag);
        if (switched && frame - switchFrame >= 1 && dBefore < KERBIN_SOI && hostBefore && hostBefore.name === 'Kerbin') {
            console.log("  >>>>> 复现!!! 切换后 " + (frame - switchFrame) + " 帧，帧首检测到距Kerbin " + dBefore.toFixed(0) + " < SOI，飞船被判定回 Kerbin SOI！");
            break;
        }
        if (!isFinite(dAfter)) { console.log("  >>>>> NaN/Inf 出现，中止"); break; }
    }
}

runScenario("前向穿越(穿越点+前) vInf=50, 切换后 1e6x", {x:0,y:1}, 50, 11);
runScenario("前向穿越(穿越点+前) vInf=50, 切换后 1e5x", {x:0,y:1}, 50, 10);
runScenario("前向穿越(穿越点+前) vInf=50, 切换后 1e4x", {x:0,y:1}, 50, 9);
runScenario("前向穿越(穿越点+前) vInf=300, 切换后 1e6x", {x:0,y:1}, 300, 11);
runScenario("后向穿越(穿越点-前) vInf=50, 切换后 1e6x", {x:0,y:-1}, 50, 11);
runScenario("径向穿越(穿越点+右) vInf=50, 切换后 1e6x", {x:1,y:0}, 50, 11);
runScenario("前向穿越 vInf=50, 切换后保持100x", {x:0,y:1}, 50, 7);
runScenario("前向穿越 vInf=10, 切换后 1e6x", {x:0,y:1}, 10, 11);