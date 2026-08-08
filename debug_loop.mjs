import { stateToKepler, keplerPositionAtTime, keplerToState } from "./src/physics/orbitalMechanics.js";

const GM_KERBIN = 3.5316e12;
const GM_KERBOL = 1.1723328e18;
const KERBIN_SOI = 84159286;
const KERBIN_ORBIT_A = 13599840256;

// ---------- 天体（Kerbol + Kerbin，Kerbin 绕 Kerbol 圆轨道） ----------
const bodies = {
    Kerbol: { gm: GM_KERBOL, soiRadius: 1e13, type: 'star', position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } },
    Kerbin: { gm: GM_KERBIN, soiRadius: KERBIN_SOI, type: 'planet', position: { x: KERBIN_ORBIT_A, y: 0 }, velocity: { x: 0, y: 9284.5 } },
};

function updateCelestialBodies(t) {
    const ang = t * Math.sqrt(GM_KERBOL / (KERBIN_ORBIT_A ** 3));
    const c = Math.cos(ang), s = Math.sin(ang);
    const vK = Math.sqrt(GM_KERBOL / KERBIN_ORBIT_A);
    bodies.Kerbin.position = { x: KERBIN_ORBIT_A * c, y: KERBIN_ORBIT_A * s };
    bodies.Kerbin.velocity = { x: -vK * s, y: vK * c };
}

function getAbsolutePosition(ship) {
    if (!ship.currentSOI) return { x: ship.pos.x, y: ship.pos.y };
    const host = bodies[ship.currentSOI];
    if (!host) return { x: ship.pos.x, y: ship.pos.y };
    return { x: host.position.x + ship.pos.x, y: host.position.y + ship.pos.y };
}

function getSOIHost(absPos) {
    let starHost = null, closestNonStar = null, closestDist = Infinity;
    for (const b of Object.values(bodies)) {
        const r = Math.hypot(b.position.x - absPos.x, b.position.y - absPos.y);
        if (r < b.soiRadius) {
            if (b.type === 'star') starHost = b;
            else if (r < closestDist) { closestDist = r; closestNonStar = b; }
        }
    }
    return closestNonStar || starHost;
}

function convertVelocityFrame(vel, fromName, toName) {
    const oldHost = fromName ? bodies[fromName] : null;
    const newHost = toName ? bodies[toName] : null;
    const ov = oldHost ? oldHost.velocity : { x: 0, y: 0 };
    const nv = newHost ? newHost.velocity : { x: 0, y: 0 };
    vel.x = vel.x + ov.x - nv.x;
    vel.y = vel.y + ov.y - nv.y;
}

function rk4Integrate(pos, vel, dt, gm, thrust = { ax: 0, ay: 0 }) {
    const clampedDt = Math.min(dt, 0.05);
    const f = ({ x, y, vx, vy }) => {
        const r = Math.hypot(x, y);
        let ax = 0, ay = 0;
        if (r > 0.001) { const a = gm / (r * r); ax = -a * x / r; ay = -a * y / r; }
        return { vx, vy, ax: ax + thrust.ax, ay: ay + thrust.ay };
    };
    const k1 = f({ x: pos.x, y: pos.y, vx: vel.x, vy: vel.y });
    const k2 = f({ x: pos.x + k1.vx * clampedDt / 2, y: pos.y + k1.vy * clampedDt / 2, vx: vel.x + k1.ax * clampedDt / 2, vy: vel.y + k1.ay * clampedDt / 2 });
    const k3 = f({ x: pos.x + k2.vx * clampedDt / 2, y: pos.y + k2.vy * clampedDt / 2, vx: vel.x + k2.ax * clampedDt / 2, vy: vel.y + k2.ay * clampedDt / 2 });
    const k4 = f({ x: pos.x + k3.vx * clampedDt, y: pos.y + k3.vy * clampedDt, vx: vel.x + k3.ax * clampedDt, vy: vel.y + k3.ay * clampedDt });
    return {
        pos: { x: pos.x + (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx) * clampedDt / 6, y: pos.y + (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy) * clampedDt / 6 },
        vel: { x: vel.x + (k1.ax + 2 * k2.ax + 2 * k3.ax + k4.ax) * clampedDt / 6, y: vel.y + (k1.ay + 2 * k2.ay + 2 * k3.ay + k4.ay) * clampedDt / 6 }
    };
}

// ---------- 忠实复刻 updateShipPhysics ----------
function updateShipPhysics(ship, dt) {
    const absPos = getAbsolutePosition(ship);
    const host = getSOIHost(absPos);

    if (host) {
        if (host.name !== ship.currentSOI) {
            const oldSOI = ship.currentSOI;
            const oldHost = oldSOI ? bodies[oldSOI] : null;
            const oldHostPos = oldHost ? oldHost.position : { x: 0, y: 0 };
            ship.pos.x = (oldHostPos.x + ship.pos.x) - host.position.x;
            ship.pos.y = (oldHostPos.y + ship.pos.y) - host.position.y;
            convertVelocityFrame(ship.vel, oldSOI, host.name);
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            const newKepler = stateToKepler(ship.pos, ship.vel, host.gm);
            if (newKepler) { ship.kepler = newKepler; ship.orbitTime = 0; }
            else { ship.kepler = null; ship.orbitTime = 0; }
            ship.switchFrame = true;
        }
    } else {
        if (ship.currentSOI !== null) {
            const oldHost = bodies[ship.currentSOI];
            if (oldHost) { ship.pos.x = oldHost.position.x + ship.pos.x; ship.pos.y = oldHost.position.y + ship.pos.y; }
            convertVelocityFrame(ship.vel, ship.currentSOI, null);
            ship.currentSOI = null; ship.currentGM = 0; ship.kepler = null; ship.orbitTime = 0;
            ship.switchFrame = true;
        }
    }

    if (ship.kepler) {
        ship.orbitTime += dt;
        const state = keplerToState(ship.kepler, ship.currentGM, ship.orbitTime);
        ship.pos.x = state.pos.x; ship.pos.y = state.pos.y;
        ship.vel.x = state.vel.x; ship.vel.y = state.vel.y;
    } else {
        let remaining = dt, p = ship.pos, v = ship.vel;
        while (remaining > 1e-9) {
            const step = Math.min(remaining, 0.05);
            const state = rk4Integrate(p, v, step, ship.currentGM);
            p = state.pos; v = state.vel; remaining -= step;
        }
        ship.pos.x = p.x; ship.pos.y = p.y; ship.vel.x = v.x; ship.vel.y = v.y;
    }
}

// ---------- 场景：弱逃逸出 Kerbin SOI，穿越后立即拉升倍率 ----------
function runScenario(name, r0, vInf, escapeAngDeg, playerWarp) {
    console.log("\n===== " + name + " (r0=" + r0 + " vInf=" + vInf + " ang=" + escapeAngDeg + " warp=" + playerWarp + ") =====");

    // 初始：Kerbin 时间 t=0，飞船在 Kerbin SOI 内 r0 处逃逸
    updateCelestialBodies(0);
    const vEsc = Math.sqrt(2 * GM_KERBIN / r0);
    const v = Math.sqrt(vInf * vInf + vEsc * vEsc);
    const ang = escapeAngDeg * Math.PI / 180;
    // 位置在 Kerbin 轨道切向方向（+y 局部），速度 = 切向 + 逃逸分量，构造实际逃逸轨道
    const ship = {
        pos: { x: r0, y: 0 }, vel: { x: v * Math.cos(ang), y: v * Math.sin(ang) },
        currentSOI: 'Kerbin', currentGM: GM_KERBIN,
        kepler: null, orbitTime: 0, mode: 'on_rails'
    };
    ship.kepler = stateToKepler(ship.pos, ship.vel, GM_KERBIN);
    if (!ship.kepler) { console.log("stateToKepler=null"); return; }
    console.log("初始 kepler: a=" + ship.kepler.a.toExponential(4) + " e=" + ship.kepler.e.toFixed(8) + " theta0=" + ship.kepler.theta.toFixed(5));
    console.log("Kerbin 初始位置=(" + bodies.Kerbin.position.x.toFixed(0) + "," + bodies.Kerbin.position.y.toFixed(0) + ") 飞船相对=(" + ship.pos.x.toFixed(0) + "," + ship.pos.y.toFixed(0) + ")");

    const dt = 1 / 60;
    const WARP_100_IDX = 100;
    let t = 0;
    let warp = 1;
    let teleportedBack = false;
    let lastKerbinDist = Infinity;

    for (let frame = 0; frame < 6000; frame++) {
        // 场景逻辑：飞船在 Kerbin SOI 内且距边界>99% 时按 playerWarp，否则限到 100x
        let currentWarp = playerWarp;
        if (ship.currentSOI === 'Kerbin') {
            const distToHost = Math.hypot(ship.pos.x, ship.pos.y);
            if (distToHost > KERBIN_SOI * 0.99) currentWarp = Math.min(playerWarp, WARP_100_IDX);
        }
        // 一旦离开 Kerbin 就恢复 playerWarp（模拟玩家在出 SOI 后立即拉升）
        warp = currentWarp;
        const simDt = dt * warp;

        // 天体先推进
        t += simDt;
        updateCelestialBodies(t);

        // 飞船后推进
        ship.switchFrame = false;
        const hostBefore = ship.currentSOI;
        updateShipPhysics(ship, simDt);

        // 诊断：每次切换打印
        if (ship.switchFrame) {
            const abs = getAbsolutePosition(ship);
            const distK = Math.hypot(abs.x - bodies.Kerbin.position.x, abs.y - bodies.Kerbin.position.y);
            console.log("  [帧" + frame + "] t=" + t.toFixed(0) + "s 切换 " + hostBefore + " -> " + ship.currentSOI +
                "  距 Kerbin=" + distK.toFixed(0) + " (SOI=" + KERBIN_SOI + ")  | vel=(" + ship.vel.x.toFixed(1) + "," + ship.vel.y.toFixed(1) + ")  warp=" + warp);
        }

        // 检测瞬移回 Kerbin SOI：曾离开过（曾切换为 Kerbol/深空），现在又在 Kerbin SOI 内
        const abs = getAbsolutePosition(ship);
        const distK = Math.hypot(abs.x - bodies.Kerbin.position.x, abs.y - bodies.Kerbin.position.y);
        if (ship.everLeft !== true && (ship.currentSOI === 'Kerbol' || ship.currentSOI === null)) ship.everLeft = true;
        if (ship.everLeft === true && distK < KERBIN_SOI) {
            if (!teleportedBack) {
                console.log("  >>>>>> 瞬移回 Kerbin SOI! 帧" + frame + " t=" + t.toFixed(0) + "s 距 Kerbin=" + distK.toFixed(0) + " currentSOI=" + ship.currentSOI + " warp=" + warp);
                console.log("        abs=(" + abs.x.toFixed(0) + "," + abs.y.toFixed(0) + ") Kerbin=(" + bodies.Kerbin.position.x.toFixed(0) + "," + bodies.Kerbin.position.y.toFixed(0) + ")");
            }
            teleportedBack = true;
        }
        if (!isFinite(abs.x) || !isFinite(abs.y)) {
            console.log("  >>>>>> NaN/Inf 出现! 帧" + frame + " t=" + t.toFixed(0) + "s abs=(" + abs.x + "," + abs.y + ") currentSOI=" + ship.currentSOI + " warp=" + warp);
            return;
        }
    }
    console.log("  结果: " + (teleportedBack ? "!!! 复现瞬移回 SOI" : "未复现瞬移"));
}

// 弱逃逸顺行（出 SOI 后 10000x）
runScenario("弱逃逸顺行 vInf=50", 8.3e7, 50, 0, 10000);
runScenario("弱逃逸顺行 vInf=50", 8.3e7, 50, 0, 100000);
runScenario("弱逃逸顺行 vInf=50", 8.3e7, 50, 0, 1000000);
runScenario("弱逃逸混合30 vInf=50", 8.3e7, 50, 30, 100000);
runScenario("弱逃逸 vInf=10", 8.3e7, 10, 0, 100000);