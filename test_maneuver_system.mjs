// 机动节点系统（生命周期/进度）自测（node 环境，临时脚本）
// 用法: node test_maneuver_system.mjs
globalThis.window = globalThis.window || {};
globalThis.console = console;

const { eventBus, Events } = await import('./src/eventBus.js');
const { maneuverSystem } = await import('./src/ship/maneuverSystem.js');

const ship = {
    id: 'sys_ship', mode: 'on_rails',
    thrust: { ax: 0, ay: 0 },
    maneuverNodes: []
};

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// S1: 创建 / 重复创建阻止 / 删除
const r1 = maneuverSystem.createNode(ship, { time: 100, relX: 5, relY: 6, anchorBody: 'Kerbin' });
check('S1 创建成功', r1.ok === true && ship.maneuverNodes.length === 1);
const r2 = maneuverSystem.createNode(ship, { time: 200, relX: 0, relY: 0, anchorBody: 'Kerbin' });
check('S1 重复创建被阻止', r2.ok === false && r2.reason === 'exists' && ship.maneuverNodes.length === 1);

// S2: 零 Δv 节点不判完成
maneuverSystem.update(ship, 0.05);
check('S2 零Δv节点不自动完成', ship.maneuverNodes[0].executed === false);

// S3: 到达提醒（time=100 但缓存时间=0 → 不触发；改到 0 再触发）
maneuverSystem.update(ship, 0.05);
check('S3 未到时无完成/无到达事件', ship.maneuverNodes[0].executed === false);

// S4: Δv 拖拽编辑 + 进度追踪
const axes = { pro: { x: 1, y: 0 }, retro: { x: -1, y: 0 }, radIn: { x: 0, y: -1 }, radOut: { x: 0, y: 1 } };
maneuverSystem.updateNodeDeltaV(ship, 'pro', 10, axes);
const p0 = maneuverSystem.getProgress(ship);
check('S4 编辑后 planned=10', Math.abs(p0.planned - 10) < 1e-9 && Math.abs(p0.remaining - 10) < 1e-9);

// S5: 手动燃烧 10s（thrust ax=1）→ 恰好达成
ship.mode = 'thrust';
ship.thrust = { ax: 1, ay: 0 };
for (let i = 0; i < 200; i++) maneuverSystem.update(ship, 0.05);
check('S5 燃烧达成 → executed=true', ship.maneuverNodes[0].executed === true);
const p1 = maneuverSystem.getProgress(ship);
check('S5 剩余≈0', p1.remaining < 1e-6);

// S6: 完成事件广播
let completed = false;
eventBus.on(Events.MANEUVER_COMPLETED, () => { completed = true; });
const ship2 = { id: 'sys2', mode: 'thrust', thrust: { ax: 0.5, ay: 0 }, maneuverNodes: [] };
maneuverSystem.createNode(ship2, { time: -10, relX: 0, relY: 0, anchorBody: null });
maneuverSystem.updateNodeDeltaV(ship2, 'pro', 5, axes);
for (let i = 0; i < 400; i++) maneuverSystem.update(ship2, 0.05);
check('S6 完成事件已广播', completed === true);

// S7: 删除节点
const del = maneuverSystem.deleteNode(ship);
check('S7 删除成功且数组清空', del === true && ship.maneuverNodes.length === 0);

// S8: 方案B —— 节点拖到新位置后，"顺向 100 m/s"应变为【新位置的顺向】
{
    const { computeNodeAxes } = await import('./src/physics/maneuverPrediction.js');
    const ship3 = { id: 's8', mode: 'on_rails', thrust: { ax: 0, ay: 0 }, maneuverNodes: [] };
    maneuverSystem.createNode(ship3, {
        time: 100, relX: 1e6, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: 2000 }
    });
    const n3 = ship3.maneuverNodes[0];
    const axesA = computeNodeAxes({ x: 1e6, y: 0 }, { x: 0, y: 2000 });
    maneuverSystem.updateNodeDeltaV(ship3, 'pro', 100, axesA);
    check('S8 A 点顺向+100（世界矢量 = +Y）',
        Math.abs(n3.deltaV.x) < 1e-6 && Math.abs(n3.deltaV.y - 100) < 1e-6);
    check('S8 分量为真值 dvPro=100', Math.abs(n3.dvPro - 100) < 1e-9 && Math.abs(n3.dvRadial) < 1e-9);

    // 拖到 B 点：位置 +Y、速度 −X（轨道系顺向相对 A 旋转 90°）
    maneuverSystem.updateNodeTime(ship3, {
        time: 200, relX: 0, relY: 1e6, anchorBody: 'Kerbin', velRel: { x: -2000, y: 0 }
    });
    const dotProB = n3.deltaV.x * (-1) + n3.deltaV.y * 0;   // B 点顺向单位向量 = (−1, 0)
    check('S8 拖到 B 点后 Δv = B 点顺向 100', Math.abs(dotProB - 100) < 1e-6);
    check('S8 拖拽后 |Δv| 保持 100', Math.abs(Math.hypot(n3.deltaV.x, n3.deltaV.y) - 100) < 1e-6);
    check('S8 拖拽后分量不变（仍为输入的 100 顺向）', Math.abs(n3.dvPro - 100) < 1e-9);
}

// S9: 完成后节点仍可编辑（0.3.0 打磨：参照轨迹常驻，可规划"拐回来"）
{
    const { computeNodeAxes } = await import('./src/physics/maneuverPrediction.js');
    // 节点 Δv = 顺向（速度 (0,2000) → 顺向单位向量 (0,1)）→ 推力须同向才能烧足
    const ship4 = { id: 's9', mode: 'thrust', thrust: { ax: 0, ay: 1 }, maneuverNodes: [] };
    maneuverSystem.createNode(ship4, {
        time: -5, relX: 1e6, relY: 0, anchorBody: 'Kerbin', velRel: { x: 0, y: 2000 }
    });
    const n4 = ship4.maneuverNodes[0];
    const axes4 = computeNodeAxes({ x: 1e6, y: 0 }, { x: 0, y: 2000 });
    maneuverSystem.updateNodeDeltaV(ship4, 'pro', 5, axes4);
    for (let i = 0; i < 400; i++) maneuverSystem.update(ship4, 0.05);   // 手动烧足
    check('S9 烧足后 executed=true', n4.executed === true);
    check('S9 完成后 getNode 仍返回该节点（轨迹/面板常驻）', maneuverSystem.getNode(ship4) === n4);

    let arrivedAfterEdit = 0;
    const h = () => { arrivedAfterEdit++; };
    eventBus.on(Events.MANEUVER_ARRIVED, h);
    maneuverSystem.updateNodeDeltaV(ship4, 'pro', 10, axes4);           // 完成后继续编辑
    check('S9 编辑后 executed 复位（重新进入计划态）', n4.executed === false);
    check('S9 编辑后分量继续累加（5 → 15）', Math.abs(n4.dvPro - 15) < 1e-9);
    maneuverSystem.update(ship4, 0.05);
    check('S9 编辑后不重复弹到达提醒', arrivedAfterEdit === 0);
    eventBus.off(Events.MANEUVER_ARRIVED, h);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
