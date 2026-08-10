// TEMP: 检查点18 复现脚本 — 用存档真实数据跑轨道预测
// 运行：node debug_checkpoint18.mjs
globalThis.window = { _soiDiag: true };
import { eventBus, Events } from './src/eventBus.js';
import { updateCelestialBodies, celestialBodies } from './src/physics/physics.js';
import { predictTrajectoryPatched, getSOIHostAtTime, bodyFuturePos } from './src/physics/orbitalPrediction.js';
import { stateToKepler } from './src/physics/orbitalMechanics.js';

// 存档数据（检查点18，世界123）
const gameTime = 1189879.348697089;
const shipData = {
    id: 'ship_1786177957595_d4v9l',
    pos: { x: 1348546.06798541, y: 1986218.9847707937 },
    vel: { x: -147.66418002818114, y: -180.7743834376415 },
    currentSOI: 'Mun',
    currentGM: 65138398000,
    mode: 'on_rails',
    orbitTime: 0,
    kepler: null,
    thrust: { ax: 0, ay: 0 }
};

// 同步游戏时间（天体位置与预测时钟）
eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: gameTime });
updateCelestialBodies(gameTime);

const mun = celestialBodies.find(b => b.name === 'Mun');
const r = Math.hypot(shipData.pos.x, shipData.pos.y);
const v = Math.hypot(shipData.vel.x, shipData.vel.y);
const vEsc = Math.sqrt(2 * shipData.currentGM / r);
const energy = v * v / 2 - shipData.currentGM / r;

console.log(`==== 状态分析 ====`);
console.log(`距Mun=${r.toFixed(1)} m  MunSOI=${mun.soiRadius} m  边界余量=${(mun.soiRadius - r).toFixed(1)} m`);
console.log(`速度=${v.toFixed(2)} m/s  逃逸速度@r=${vEsc.toFixed(2)} m/s  v/vEsc=${(v / vEsc).toFixed(4)}`);
console.log(`比能量=${energy.toFixed(0)} J/kg  (负=束缚 正=逃逸)`);
console.log(`角动量h=${(shipData.pos.x * shipData.vel.y - shipData.pos.y * shipData.vel.x).toFixed(1)}`);

const k = stateToKepler(shipData.pos, shipData.vel, shipData.currentGM);
console.log(`stateToKepler =`, k ? `{a=${k.a.toExponential(3)} e=${k.e.toFixed(6)} dir=${k.dir} e-1=${(k.e - 1).toExponential(3)}}` : 'null (病态/近抛物线)');

// 当前位置 SOI 归属
const absPos = { x: mun.position.x + shipData.pos.x, y: mun.position.y + shipData.pos.y };
const hostNow = getSOIHostAtTime(absPos, gameTime);
console.log(`当前位置归属: ${hostNow ? hostNow.name : 'null'}  (currentSOI=${shipData.currentSOI})`);

// 预测
console.log(`==== 预测输出 ====`);
const segs = predictTrajectoryPatched(shipData, 5);
console.log(`段数=${segs.length}`);
segs.forEach((s, i) => {
    const pts = s.relPoints || [];
    let info = `[${i}] host=${s.anchorBody}  pts=${pts.length}  cur=${s.isCurrentSoi}  anchorT=${s.anchorTime}`;
    if (pts.length >= 2) {
        const p0 = pts[0], pN = pts[pts.length - 1];
        info += `  r0=${Math.hypot(p0.x, p0.y).toFixed(0)}  rN=${Math.hypot(pN.x, pN.y).toFixed(0)}`;
    }
    console.log(info);
});
// 逐段首尾点（绝对化后）相对宿主距离，看段是否延伸到 SOI 边界
segs.forEach((s, i) => {
    const pts = s.relPoints || [];
    if (pts.length < 2) return;
    const pN = pts[pts.length - 1];
    console.log(`  段${i} 末端相对宿主半径 = ${Math.hypot(pN.x, pN.y).toFixed(0)} m  (宿主SOI=${(celestialBodies.find(b => b.name === s.anchorBody)?.soiRadius ?? 0).toFixed(0)})`);
});
