// TEMP: 跨 SOI 轨道线预测排查诊断脚本 — 构造多类场景 dump 段产出
// 运行：node debug_soi_predict.mjs
globalThis.window = { _soiDiag: true };
import { stateToKepler, findSOIIntersection } from './src/physics/orbitalMechanics.js';
import { updateCelestialBodies, celestialBodies } from './src/physics/physics.js';
import { predictTrajectoryPatched, getSOIHostAtTime, bodyFuturePos } from './src/physics/orbitalPrediction.js';

updateCelestialBodies(0);

function makeShip(soi, pos, vel) {
    const host = celestialBodies.find(b => b.name === soi);
    const k = stateToKepler(pos, vel, host.gm);
    return {
        id: 'd', pos: { ...pos }, vel: { ...vel }, currentSOI: soi, currentGM: host.gm,
        kepler: k, orbitTime: 0, mode: 'on_rails', thrust: { ax: 0, ay: 0 },
        _kSummary: k ? `a=${k.a.toExponential(2)} e=${k.e.toFixed(4)} dir=${k.dir}` : 'null'
    };
}

function dumpSegs(label, ship) {
    const segs = predictTrajectoryPatched(ship, 5);
    console.log(`==== ${label}  段数=${segs.length}  kepler=${ship._kSummary}`);
    segs.forEach((s, i) => {
        const pts = s.relPoints;
        const p0 = pts[0], pN = pts[pts.length - 1];
        const r0 = p0 ? Math.hypot(p0.x, p0.y) : NaN;
        const rN = pN ? Math.hypot(pN.x, pN.y) : NaN;
        // 段内半径极差（判断是否为"短直线"：半径几乎不变且点数少）
        let rMin = Infinity, rMax = 0;
        for (const p of pts) { const rr = Math.hypot(p.x, p.y); rMin = Math.min(rMin, rr); rMax = Math.max(rMax, rr); }
        console.log(
            `  [${i}] host=${s.anchorBody}  pts=${pts.length}  cur=${s.isCurrentSoi}  anchorT=${s.anchorTime}` +
            `  r0=${r0.toExponential(3)} rN=${rN.toExponential(3)}  rMin=${rMin.toExponential(3)} rMax=${rMax.toExponential(3)}`
        );
    });
    return segs;
}

const gmK = 3.5316e12;
const KERBIN_SOI = 84159286;
const vEsc = (r) => Math.sqrt(2 * gmK / r);

// 场景 1：Kerbin 低轨 椭圆穿越 Kerbin SOI（apoapsis > SOI）→ 应产出 Kerbin 截断段 + Kerbol 段
{
    const vEll = Math.sqrt(gmK * (2 / 6e6 - 1 / 46e6));
    dumpSegs('场景1 椭圆穿越SOI (低轨apoapsis86M)', makeShip('Kerbin', { x: 6e6, y: 0 }, { x: 0, y: vEll }));
}

// 场景 2：Kerbin 系 健康双曲线（r=40M, v=1.5vEsc）→ 双曲线出 SOI → Kerbol 段
{
    const v = 1.5 * vEsc(4e7);
    dumpSegs('场景2 双曲线出SOI (r=40M v=1.5ve)', makeShip('Kerbin', { x: 4e7, y: 0 }, { x: 0, y: v }));
}

// 场景 3：Kerbin 系 双曲线擦边（r 接近 SOI 边界，v 略超逃逸）
{
    const r = 8e7; // 0.95 * 84.16M
    const v = 1.1 * vEsc(r);
    dumpSegs('场景3 双曲线擦边出SOI (r=80M v=1.1ve)', makeShip('Kerbin', { x: r, y: 0 }, { x: 0, y: v }));
}

// 场景 4：currentSOI 与位置不一致（模拟物理层未及时切换/存档异常）——
// 飞船实际在 Kerbin SOI 内（距 Kerbin 20M），但 currentSOI 错误记为 Kerbol。
// 入口校正应恢复到 Kerbin 宿主并正常预测 Kerbin 系轨道。
{
    const kerbin = celestialBodies.find(b => b.name === 'Kerbin');
    const kpos = { x: kerbin.position.x + 2e7, y: kerbin.position.y };
    const vcRel = Math.sqrt(gmK / 2e7);          // 相对 Kerbin 圆速 @20M
    const velRel = { x: 0, y: vcRel };            // 相对 Kerbin 切向
    const absVel = { x: kerbin.velocity.x + velRel.x, y: kerbin.velocity.y + velRel.y };
    dumpSegs('场景4 SOI不一致校正 (实际在Kerbin内, currentSOI=Kerbol)',
        makeShip('Kerbol', kpos, absVel));
}

// 场景 5：Kerbin 系双曲线 目标掠 Mun SOI（验证嵌套 SOI 检测缺口）
{
    const mun = celestialBodies.find(b => b.name === 'Mun');
    console.log(`(Mun pos = (${mun.position.x.toExponential(3)}, ${mun.position.y.toExponential(3)}))`);
    // 构造飞船从 (6e6,0) 出发的双曲线，方向对准 Mun 附近
    const v = 1.6 * vEsc(6e6);
    dumpSegs('场景5 Kerbin双曲线掠Mun', makeShip('Kerbin', { x: 6e6, y: 0 }, { x: v * 0.15, y: v }));
}

// ===== 边界判定专项：SOI 边界处 getSOIHostAtTime 的浮点敏感性 =====
console.log('==== 边界判定专项 ====');
for (const [label, r0] of [['低轨6M', 6e6], ['中轨40M', 4e7], ['擦边80M', 8e7]]) {
    const vEll = Math.sqrt(gmK * (2 / r0 - 1 / 46e6));
    const ship = makeShip('Kerbin', { x: r0, y: 0 }, { x: 0, y: vEll });
    const host = celestialBodies.find(b => b.name === 'Kerbin');
    const inter = findSOIIntersection(ship.kepler, host.gm, host.soiRadius);
    if (!inter) { console.log(`[${label}] 无交点`); continue; }
    const rInt = Math.hypot(inter.pos.x, inter.pos.y);
    const diff = rInt - host.soiRadius;
    // 切换时刻（用椭圆 E/M 快速近似；此处只测边界判定，时刻误差影响小）
    const hostP = bodyFuturePos(host, 1);
    const absP = { x: hostP.x + inter.pos.x, y: hostP.y + inter.pos.y };
    const nh = getSOIHostAtTime(absP, 1);
    console.log(`[${label}] 交点模长=${rInt.toFixed(4)} 差=${diff.toFixed(6)}  边界判定 nextHost=${nh ? nh.name : 'null'}`);
}

// ===== 双曲线出 SOI 后 Kerbol 段缺失确认（场景2 内部） =====
{
    const ship = makeShip('Kerbin', { x: 4e7, y: 0 }, { x: 0, y: 1.5 * vEsc(4e7) });
    const host = celestialBodies.find(b => b.name === 'Kerbin');
    const inter = findSOIIntersection(ship.kepler, host.gm, host.soiRadius);
    const rInt = Math.hypot(inter.pos.x, inter.pos.y);
    const hostP = bodyFuturePos(host, 1);
    const absP = { x: hostP.x + inter.pos.x, y: hostP.y + inter.pos.y };
    const nh = getSOIHostAtTime(absP, 1);
    console.log(`[双曲线出SOI] 交点模长=${rInt.toFixed(4)} vs SOI=${host.soiRadius.toFixed(4)} 差=${(rInt - host.soiRadius).toFixed(6)} nextHost=${nh ? nh.name : 'null'}`);
}
