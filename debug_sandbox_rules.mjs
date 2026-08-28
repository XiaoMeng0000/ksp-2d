// TEMP: 沙盒/生涯资源规则冒烟测试（0.2.0 阶段7）
// 运行：node debug_sandbox_rules.mjs
globalThis.window = {};
import { gameState } from './src/gameState.js';
import { consumeStorage, consumeCargo } from './src/resources/cargoSystem.js';
import { consumePlayerResource } from './src/resources/resourceSystem.js';

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
    const ok = actual === expected;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 实际=${actual} 期望=${expected}`);
}

function setMode(mode) {
    const st = gameState.getState();
    gameState.setState({ player: { ...st.player, gameMode: mode } });
}

// ===== 设施存储消耗 =====
function makeFacility(amount) {
    return { storage: { materialKits: { amount, capacity: 1000 } } };
}

// 1. sandbox 余额不足 → 扣到 0 返回 true
setMode('sandbox');
let fac = makeFacility(30);
check('sandbox consumeStorage 不足→成功', consumeStorage(fac, 'materialKits', 100), true);
check('sandbox consumeStorage 扣到 0', fac.storage.materialKits.amount, 0);

// 2. career 余额不足 → 拒绝且不扣
setMode('career');
fac = makeFacility(30);
check('career consumeStorage 不足→拒绝', consumeStorage(fac, 'materialKits', 100), false);
check('career consumeStorage 不扣款', fac.storage.materialKits.amount, 30);

// 3. career 余额充足 → 正常扣
check('career consumeStorage 充足→成功', consumeStorage(fac, 'materialKits', 10), true);
check('career consumeStorage 正常扣款', fac.storage.materialKits.amount, 20);

// ===== 飞船货仓消耗 =====
function makeShip(amount) {
    return { cargo: { materialKits: { amount } } };
}

// 4. sandbox 货仓不足 → 扣到 0（槽删除）返回 true
setMode('sandbox');
let ship = makeShip(5);
check('sandbox consumeCargo 不足→成功', consumeCargo(ship, 'materialKits', 50), true);
check('sandbox consumeCargo 槽已清理', ship.cargo.materialKits === undefined, true);

// 5. career 货仓不足 → 拒绝
setMode('career');
ship = makeShip(5);
check('career consumeCargo 不足→拒绝', consumeCargo(ship, 'materialKits', 50), false);
check('career consumeCargo 不扣款', ship.cargo.materialKits.amount, 5);

// ===== 科技点消耗 =====
// 6. sandbox science 免扣（初始 50）
setMode('sandbox');
check('sandbox science 免扣→成功', consumePlayerResource('science', 999), true);
check('sandbox science 数字不动', gameState.getState().player.resources.science.amount, 50);

// 7. career science 余额不足 → 拒绝
setMode('career');
check('career science 不足→拒绝', consumePlayerResource('science', 999), false);
check('career science 不扣款', gameState.getState().player.resources.science.amount, 50);

// 8. career science 充足 → 正常扣
check('career science 充足→成功', consumePlayerResource('science', 20), true);
check('career science 正常扣款', gameState.getState().player.resources.science.amount, 30);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
