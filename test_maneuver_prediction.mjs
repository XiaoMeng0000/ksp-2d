// 机动节点预测引擎自测（node 环境，临时脚本）
// 用法: node test_maneuver_prediction.mjs
// 注：浏览器全局 window 在 node 下缺失，注入最小垫片后再动态导入业务模块
globalThis.window = globalThis.window || {};

const { celestialBodies, updateCelestialBodies } = await import('./src/physics/physics.js');
const { stateToKepler, keplerPositionAtTime } = await import('./src/physics/orbitalMechanics.js');
const { predictTrajectoryPatched } = await import('./src/physics/orbitalPrediction.js');
const { predictManeuverTrajectories, walkToTime, planBurnArc } = await import('./src/physics/maneuverPrediction.js');

// 天体位置初始化（浏览器侧由 main.js 每帧推进；node 测试需手动初始化）
updateCelestialBodies(0);

const home = celestialBodies.find(b => b.isHomeworld);
if (!home) { console.error('找不到母星'); process.exit(1); }

const r0 = home.radius + home.defaultOrbitAltitude;
const v0 = Math.sqrt(home.gm / r0);

const ship = {
    id: 'test_ship', mode: 'on_rails',
    pos: { x: r0, y: 0 }, vel: { x: 0, y: v0 },
    currentSOI: home.name, currentGM: home.gm,
    kepler: null, orbitTime: 0,
    thrust: { ax: 0, ay: 0 },
    dryMass: 5000, isp: 320, maxThrust: 200000,
    resources: { fuel: { amount: 3000, capacity: 3000 } },
    maneuverNodes: []
};
ship.kepler = stateToKepler(ship.pos, ship.vel, home.gm);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// T1: 预测链生成 + 段带 startState
const segments = predictTrajectoryPatched(ship);
check('T1 预测链生成', segments.length > 0);
check('T1 段带 startState', !!segments[0].startState && !!segments[0].startState.relVel);

// T2: walkToTime 解析精度（60s 后位置 vs 直接 kepler 推进）
const tNode = 60;
const walked = walkToTime(segments, tNode);
const expectPos = keplerPositionAtTime(ship.kepler, home.gm, tNode, ship.kepler.omega);
check('T2 walk 命中', !!walked);
const posErr = walked ? Math.hypot(walked.relPos.x - expectPos.x, walked.relPos.y - expectPos.y) : -1;
check('T2 位置误差 < 1m (err=' + posErr.toExponential(2) + ')', posErr >= 0 && posErr < 1);

// T3: 正常 Δv 节点预测（顺向 50 m/s）
const dvPro = walked ? Math.atan2(walked.relVel.y, walked.relVel.x) : 0;
const node1 = { time: tNode, deltaV: { x: 50 * Math.cos(dvPro), y: 50 * Math.sin(dvPro) }, executed: false };
const r1 = predictManeuverTrajectories(ship, node1, segments);
check('T3 燃烧弧存在', !!r1.burnArc && r1.burnArc.relPoints.length >= 2);
check('T3 燃烧时长>0', r1.plan.burnDuration > 0);
check('T3 机动后段存在', r1.plan.segments.length > 0);
check('T3 无燃料耗尽点(Δv充足)', r1.fuelOutPoint === null);
check('T3 未用虚拟段', r1.plan.burnResult.ghostUsed === false);
const dvMax = r1.plan.dvMax;
console.log('  [T3] dvMag=50 dvMax=' + dvMax.toFixed(1) + ' burnT=' + r1.plan.burnDuration.toFixed(2) + 's');

// T4: 超能力 Δv → 真实段耗尽 + 虚拟续烧段 + 燃料耗尽点
const node2 = { time: tNode, deltaV: { x: (dvMax + 200) * Math.cos(dvPro), y: (dvMax + 200) * Math.sin(dvPro) }, executed: false };
const r2 = predictManeuverTrajectories(ship, node2, segments);
check('T4 fuelLimited 判定', r2.plan.fuelLimited === true);
check('T4 燃料耗尽点存在', r2.fuelOutPoint !== null && r2.fuelOutPoint.body === home.name);
check('T4 虚拟段启用', r2.plan.burnResult.ghostUsed === true);
const ghostPts = r2.burnArc.relPoints.filter(p => p.ghost);
check('T4 轨迹含虚拟段点', ghostPts.length > 0);
check('T4 达成量≥目标', r2.plan.burnResult.appliedDv >= r2.plan.dvMag - 1e-6);
console.log('  [T4] dvMag=' + r2.plan.dvMag.toFixed(1) + ' applied=' + r2.plan.burnResult.appliedDv.toFixed(1)
    + ' fuelOutT=' + r2.fuelOutPoint.t.toFixed(2) + 's burnT=' + r2.plan.burnDuration.toFixed(2) + 's');

// T5: 链外时间 → walk null、预测退化（面板仍可用）
const r3 = predictManeuverTrajectories(ship, { time: 1e9, deltaV: { x: 1, y: 0 }, executed: false }, segments);
check('T5 链外预测退化(无段但计划可读)', r3.segments.length === 0 && r3.plan.dvMag === 1);

// T6: planBurnArc 病态输入防御
const sick = planBurnArc({ x: 0, y: 0 }, { x: 0, y: 0 }, home, { dirX: 1, dirY: 0, maxThrust: 0, isp: 320, mWet: 100, mDry: 10, dvTarget: 10 }, 0);
check('T6 无推力输入不爆炸', sick.burnDuration === 0 && isFinite(sick.finalRelPos.x));

// T7: 零 Δv 节点 → axes 可用（手柄从零建立 Δv 的前提）、无燃烧弧
const r4 = predictManeuverTrajectories(ship, { time: tNode, deltaV: { x: 0, y: 0 }, executed: false }, segments);
check('T7 零Δv节点 axes 可用', !!r4.plan.axes && !!r4.plan.axes.pro);
check('T7 零Δv节点无燃烧弧/时长null', r4.segments.length === 0 && r4.plan.burnDuration === null);

// T8: 节点时刻已过（walk 链外）→ 冻结快照重建状态，预测线保持（永不失效）
const snap = { relX: walked.relPos.x, relY: walked.relPos.y, relVelX: walked.relVel.x, relVelY: walked.relVel.y };
const nodePast = {
    time: -60, deltaV: { x: 50 * Math.cos(dvPro), y: 50 * Math.sin(dvPro) }, executed: false,
    relX: snap.relX, relY: snap.relY, relVelX: snap.relVelX, relVelY: snap.relVelY,
    anchorBody: home.name
};
const r5 = predictManeuverTrajectories(ship, nodePast, segments);
check('T8 冻结快照优先（燃烧后不漂移）', r5.segments.length > 0 && !!r5.burnArc);
check('T8 快照状态标记 pinned', r5.plan.nodeState && r5.plan.nodeState.pinned === true);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
