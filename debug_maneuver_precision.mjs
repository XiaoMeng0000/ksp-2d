// 机动节点精度研究（模式A 调研脚本，node 环境）
// 数值实验：① 双燃料按配方停机 vs 全燃料烧尽 的 Δv 高估
//          ② 预测 Euler(dt=0.05) vs 物理 RK4(dt=0.05) 燃烧弧终点偏差
//          ③ 过节点后指向：当前实现 vs 同半径最近点方案 的角度差与帧间抖动
// 用法: node debug_maneuver_precision.mjs
globalThis.window = globalThis.window || {};

const { celestialBodies, updateCelestialBodies } = await import('./src/physics/physics.js');
const { stateToKepler } = await import('./src/physics/orbitalMechanics.js');
const { rk4Integrate } = await import('./src/physics/integrator.js');

updateCelestialBodies(0);
const home = celestialBodies.find(b => b.isHomeworld);

const G0 = 9.81;
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// ===== E1: 双燃料按配方停机 vs 全燃料烧尽 =====
{
    const isp = 320, F = 200000;
    const c = isp * G0;                       // 有效排气速度 3139.2
    const dry = 5000, cargo = 0;
    // 不平衡燃料：氢 200kg / 氧 2666.7kg（总量 2866.7，但氢只够烧 1/9）
    const slots = { hydrogen: { amount: 200 }, oxygen: { amount: 2666.7 } };
    const mWet = dry + cargo + slots.hydrogen.amount + slots.oxygen.amount;

    // 现状（预测用）：烧完全部燃料 → mDry = mWet - 总燃料
    const dvNow = c * Math.log(mWet / dry);

    // 真实（按配方）：min_i(amount_i/ratio_i) × Σratio = 可烧质量
    const R = 9;                              // Σratio (1+8)
    const limiter = Math.min(slots.hydrogen.amount / 1, slots.oxygen.amount / 8);
    const burnable = R * limiter;             // 9×200 = 1800kg
    const mEnd = mWet - burnable;
    const dvReal = c * Math.log(mWet / mEnd);

    console.log(`[E1] 氢200/氧2667(1:8): 预测dvMax=${dvNow.toFixed(1)}  实际dvMax=${dvReal.toFixed(1)}  高估=${(dvNow - dvReal).toFixed(1)} m/s (${(100 * (dvNow - dvReal) / dvNow).toFixed(1)}%)`);
    check('E1 不平衡燃料时预测显著高估(>5%)', dvNow - dvReal > 0.05 * dvNow);

    // 平衡满罐（游戏初始）：两者应一致 → 验证公式
    const balanced = { hydrogen: { amount: 333.3 }, oxygen: { amount: 2666.7 } };
    const R2 = R;
    const lim2 = Math.min(balanced.hydrogen.amount / 1, balanced.oxygen.amount / 8);
    const burnable2 = R2 * lim2;
    const dvBal = c * Math.log((dry + 3000) / (dry + 3000 - burnable2));
    const dvFull = c * Math.log((dry + 3000) / dry);
    console.log(`[E1] 平衡满罐: 按配方=${dvBal.toFixed(1)}  全燃料=${dvFull.toFixed(1)}  差=${Math.abs(dvBal - dvFull).toFixed(2)}`);
    check('E1 平衡满罐时两口径一致(<0.5%)', Math.abs(dvBal - dvFull) < 0.005 * dvFull);
}

// ===== E2: Euler vs RK4 燃烧弧终点偏差 =====
{
    const r0 = home.radius + 300000;
    const v0 = Math.sqrt(home.gm / r0);
    const pos = { x: r0, y: 0 }, vel = { x: 0, y: v0 };
    const gm = home.gm;
    const a = 15;                              // 推力加速度 m/s²（近似低推重比）
    const dir = { x: 0, y: 1 };                // 顺向（世界系 +Y）
    const dt = 0.05;
    const burnT = 60;                          // 60s 长燃烧（模拟节点大 Δv）

    // 预测口径：半隐式欧拉
    let ep = { x: pos.x, y: pos.y }, ev = { x: vel.x, y: vel.y };
    for (let t = 0; t < burnT; t += dt) {
        const r = Math.sqrt(ep.x * ep.x + ep.y * ep.y);
        const ga = gm / (r * r);
        ev.x += (-ga * ep.x / Math.max(r, 0.001) + dir.x * a) * dt;
        ev.y += (-ga * ep.y / Math.max(r, 0.001) + dir.y * a) * dt;
        ep.x += ev.x * dt;
        ep.y += ev.y * dt;
    }
    // 物理口径：RK4 子步（同 0.05）
    let rp = { x: pos.x, y: pos.y }, rv = { x: vel.x, y: vel.y };
    for (let t = 0; t < burnT; t += dt) {
        const st = rk4Integrate(rp, rv, dt, gm, { ax: dir.x * a, ay: dir.y * a });
        rp = st.pos; rv = st.vel;
    }
    const dPos = Math.hypot(ep.x - rp.x, ep.y - rp.y);
    const dVel = Math.hypot(ev.x - rv.x, ev.y - rv.y);
    console.log(`[E2] 60s 燃烧弧终点: 位置偏差=${dPos.toFixed(0)} m, 速度偏差=${dVel.toFixed(2)} m/s (v0=${v0.toFixed(1)})`);
    check('E2 长燃烧下 Euler vs RK4 位置偏差 >10m（需改进）', dPos > 10);
}

// ===== E3: 过节点后指向：当前实现 vs 同半径最近点 + 抖动 =====
{
    // 目标轨道：近地点 320km / 远地点 1000km 椭圆
    const rPe = home.radius + 320000, rAp = home.radius + 1000000;
    const aT = (rPe + rAp) / 2;
    const eT = (rAp - rPe) / (rAp + rPe);
    const omegaT = Math.PI / 4;                // 人为旋转目标轨道
    const gm = home.gm;

    // 当前轨道：圆 500km，飞船位于某角
    const rc = home.radius + 500000;
    const vc = Math.sqrt(gm / rc);

    // 当前实现：目标轨道在当前空间角 θp 的速度 − 当前速度
    const curImpl = (thetaP, vel) => {
        const local = thetaP - omegaT;
        const denom = 1 + eT * Math.cos(local);
        if (!(denom > 1e-9)) return null;
        const p = aT * (1 - eT * eT);
        const sqrtGMp = Math.sqrt(gm / p);
        const vr = sqrtGMp * eT * Math.sin(local);
        const vtheta = sqrtGMp * (1 + eT * Math.cos(local));
        const vtx = vr * Math.cos(thetaP) - vtheta * Math.sin(thetaP);
        const vty = vr * Math.sin(thetaP) + vtheta * Math.cos(thetaP);
        const dvx = vtx - vel.x, dvy = vty - vel.y;
        return Math.hypot(dvx, dvy) > 0.1 ? Math.atan2(dvx, dvy) : null;
    };
    // 改进方案：目标轨道上"同半径最近点"处速度 − 当前速度
    const improved = (thetaP, vel) => {
        const p = aT * (1 - eT * eT);
        const r = rc;
        const cosv = (p / r - 1) / eT;
        if (Math.abs(cosv) > 1) return null;   // 半径不相交
        const base = Math.acos(cosv);
        const cand = [omegaT + base, omegaT - base];
        let best = null, bestD = Infinity;
        for (const th of cand) {
            const px = r * Math.cos(th), py = r * Math.sin(th);
            const d2 = (px - r * Math.cos(thetaP)) ** 2 + (py - r * Math.sin(thetaP)) ** 2;
            if (d2 < bestD) { bestD = d2; best = th; }
        }
        if (best === null) return null;
        const local = best - omegaT;
        const sqrtGMp = Math.sqrt(gm / p);
        const vr = sqrtGMp * eT * Math.sin(local);
        const vtheta = sqrtGMp * (1 + eT * Math.cos(local));
        const vtx = vr * Math.cos(best) - vtheta * Math.sin(best);
        const vty = vr * Math.sin(best) + vtheta * Math.cos(best);
        const dvx = vtx - vel.x, dvy = vty - vel.y;
        return Math.hypot(dvx, dvy) > 0.1 ? Math.atan2(dvx, dvy) : null;
    };

    // 滑行模拟：当前圆轨上从 θ=0 起 13 个采样点（每 15°），比较两种指向
    let maxDiff = 0, valid = 0;
    let prevCur = null;
    let maxJitterCur = 0;
    for (let i = 0; i <= 12; i++) {
        const thetaP = i * Math.PI / 12;
        const vel = { x: -vc * Math.sin(thetaP), y: vc * Math.cos(thetaP) };
        const c1 = curImpl(thetaP, vel);
        const c2 = improved(thetaP, vel);
        if (c1 !== null && c2 !== null) {
            valid++;
            const diff = Math.abs(Math.atan2(Math.sin(c1 - c2), Math.cos(c1 - c2))) * 180 / Math.PI;
            maxDiff = Math.max(maxDiff, diff);
        }
        if (c1 !== null && prevCur !== null) {
            const j = Math.abs(Math.atan2(Math.sin(c1 - prevCur), Math.cos(c1 - prevCur))) * 180 / Math.PI;
            maxJitterCur = Math.max(maxJitterCur, j);
        }
        prevCur = c1;
    }
    console.log(`[E3] 当前实现 vs 同半径最近点: 最大角差=${maxDiff.toFixed(1)}°（有效样本 ${valid}/13）`);
    console.log(`[E3] 当前实现每15°滑行步的最大帧间角变化: ${maxJitterCur.toFixed(1)}°`);
    check('E3 两种指向方案存在显著角度差(>5°)', maxDiff > 5);
}

// ===== E4: 过节点瞬间方向突变（指向跳变幅度） =====
{
    const r0 = home.radius + 300000;
    const v0 = Math.sqrt(home.gm / r0);
    const dirNode = Math.atan2(0, 1);          // 顺向（heading 约定 0=+Y）
    const thetaP = 0;                          // 飞船在 +X，速度 +Y（圆轨）
    const vel = { x: 0, y: v0 };
    // 过节点后指向（目标轨道 = 圆轨速率 +50m/s 的新圆轨）
    const gm = home.gm;
    const vT = Math.sqrt(gm / r0) + 50;
    const vtx = -vT * Math.sin(thetaP), vty = vT * Math.cos(thetaP);
    const dvx = vtx - vel.x, dvy = vty - vel.y;
    const dirAfter = Math.atan2(dvx, dvy);
    const jump = Math.abs(Math.atan2(Math.sin(dirAfter - dirNode), Math.cos(dirAfter - dirNode))) * 180 / Math.PI;
    console.log(`[E4] 过节点瞬间: 节点加速方向与'目标轨道方向'夹角 = ${jump.toFixed(1)}°`);
    check('E4 两态方向在节点时刻存在跳变(>3°)', jump > 3);
}

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail > 0 ? 1 : 0);
