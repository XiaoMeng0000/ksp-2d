globalThis.window = { _soiDiag: false };
import { celestialBodies, updateCelestialBodies, getAbsolutePosition, getSOIHost } from "./src/physics/physics.js";
import { updateShipPhysics } from "./src/physics/physicsUpdate.js";
import { stateToKepler } from "./src/physics/orbitalMechanics.js";

const dt = 1 / 60;
const KERBIN_SOI = celestialBodies.find(b => b.name === 'Kerbin').soiRadius;
const GM_KERBIN = celestialBodies.find(b => b.name === 'Kerbin').gm;
const WARP_RATES = [0,1,2,3,4,10,50,100,1000,10000,100000,1000000,10000000];

// 飞船在边界附近，穿越位置在 Kerbin 轨道运动方向(+y)上 → S ∥ Kerbin 运动
// exitPos: 穿越点相对 Kerbin 的偏移方向 ('prograde'=+y, 'retrograde'=-y, 'radial'=+x, 'anti'=-x)
function runScenario(name, exitPos, vInf, postWarp, framesAfterSwitch) {
    console.log("\n========== " + name + " ==========");
    updateCelestialBodies(0);
    const r0 = KERBIN_SOI - 100000; // 边界内侧一点
    const p = exitPos;
    const shipPos = { x: p.x * r0, y: p.y * r0 };
    const vEsc = Math.sqrt(2 * GM_KERBIN / r0);
    const v = Math.sqrt(vInf * vInf + vEsc * vEsc);
    // 逃逸速度沿退出方向
    const shipVel = { x: p.x * v, y: p.y * v };
    const ship = {
        id: 'ship-test', pos: shipPos, vel: shipVel,
        currentSOI: 'Kerbin', currentGM: GM_KERBIN, kepler: null, orbitTime: 0,
        mode: 'on_rails', throttle: 0
    };
    ship.kepler = stateToKepler(ship.pos, ship.vel, GM_KERBIN);
    if (!ship.kepler) { console.log("stateToKepler=null"); return; }
    console.log("kepler a=" + ship.kepler.a.toExponential(4) + " e=" + ship.kepler.e.toFixed(8));

    let t = 0, switched = false, switchFrame = -1;

    for (let frame = 0; frame < 30; frame++) {
        // 档位：切换前 100x；切换后 postWarp 帧后升到 postWarp 档
        let warp = 100;
        if (switched) {
            warp = (frame - switchFrame > 1) ? WARP_RATES[postWarp] : WARP_RATES[7];
        } else {
            warp = WARP_RATES[7]; // 穿越前保持 100x
        }
        const simDt = dt * warp;
        t += simDt;
        updateCelestialBodies(t);

        // 帧开始时的检测状态（游戏用上一帧 pos + 本帧天体位置）
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
            " | 帧首检测: SOI=" + (hostBefore ? hostBefore.name : 'null') + " 距K=" + dBefore.toFixed(0) +
            " | 帧后: SOI=" + (ship.currentSOI || 'null') + " 距K=" + dAfter.toFixed(0) +
            " |pos|=" + Math.hypot(ship.pos.x, ship.pos.y).toFixed(0) + tag);
        if (switched && frame - switchFrame >= 1 && dAfter < KERBIN_SOI) {
            console.log("  >>>>> 复现：切换后 " + (frame - switchFrame) + " 帧，距 Kerbin " + dAfter.toFixed(0) + " < SOI(" + KERBIN_SOI + ")，飞船回到 Kerbin SOI 内！");
            break;
        }
    }
}

runScenario("前向穿越+弱逃逸 vInf=50, 切换后升 1e6x", {x:0,y:1}, 50, 11, 2);
runScenario("前向穿越+弱逃逸 vInf=50, 切换后升 1e5x", {x:0,y:1}, 50, 10, 2);
runScenario("前向穿越+弱逃逸 vInf=50, 切换后升 1e4x", {x:0,y:1}, 50, 9, 2);
runScenario("后向穿越+弱逃逸 vInf=50, 切换后升 1e6x", {x:0,y:-1}, 50, 11, 2);
runScenario("径向穿越+弱逃逸 vInf=50, 切换后升 1e6x", {x:1,y:0}, 50, 11, 2);
runScenario("前向穿越+中等逃逸 vInf=300, 切换后升 1e6x", {x:0,y:1}, 300, 11, 2);
runScenario("前向穿越+弱逃逸 vInf=50, 切换后保持100x", {x:0,y:1}, 50, 7, 999);