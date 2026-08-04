"use strict";

import { eventBus, Events } from '../eventBus.js';
import { getSOIHost, getRelativePosition, convertVelocityFrame, celestialBodies } from './physics.js';
import { rk4Integrate } from './integrator.js';
import { stateToKepler, keplerToState } from './orbitalMechanics.js';

// SOI 边界诊断开关 — 运行时从 window 读取，支持控制台热切换
function soiDiagEnabled() {
    return window._soiDiag === true;
}

/**
 * 共享飞船物理更新函数（使用飞船自带宿主状态，isActive 控制推力模式）
 * @param {Object} ship - 飞船实例（直接引用，会被原地修改）
 * @param {number} dt - 时间步长（秒）
 * @param {boolean} isActive - 是否为活动飞船（活动飞船允许走 thrust 模式）
 */
export function updateShipPhysics(ship, dt, isActive = true) {
    if (!ship) return;

    // 保存 currentHostPos 快照（上帧旧值），避免 SOI 块覆写后与 ship.pos 时间基准错位
    const hostPosSnapshot = ship.currentHostPos
        ? { x: ship.currentHostPos.x, y: ship.currentHostPos.y }
        : { x: 0, y: 0 };

    // === 1. SOI 边界检测 ===
    const host = getSOIHost(ship.pos);

    // SOI边界诊断 — 输出所有接近天体的距离信息
    if (soiDiagEnabled() && isActive) {
        for (const body of celestialBodies) {
            const dx = body.position.x - ship.pos.x;
            const dy = body.position.y - ship.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < body.soiRadius * 1.5) {
                const soiStr = dist < body.soiRadius ? '内' : '外';
                console.log(`[DIAG] SOI检测 ship=${ship.id.slice(-6)} body=${body.name} dist=${dist.toFixed(2)} SOI=${body.soiRadius} (${soiStr}) shipPos=(${ship.pos.x.toFixed(2)},${ship.pos.y.toFixed(2)}) bodyPos=(${body.position.x.toFixed(2)},${body.position.y.toFixed(2)}) hostResult=${host ? host.name : 'null'} currentSOI=${ship.currentSOI}`);
            }
        }
    }

    let soiChanged = false;

    if (host) {
        if (host.name !== ship.currentSOI) {
            soiChanged = true;
            const oldSOI = ship.currentSOI;
            convertVelocityFrame(ship.vel, ship.currentSOI, host.name);

            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.currentHostPos = { x: host.position.x, y: host.position.y };
            eventBus.emit(Events.SOI_CHANGED, { from: oldSOI, to: host.name });

            const relPos = getRelativePosition(ship.pos, host);
            const newKepler = stateToKepler(relPos, ship.vel, host.gm);
            if (newKepler) {
                ship.kepler = newKepler;
                ship.orbitTime = 0;
            } else {
                ship.kepler = null;
                ship.orbitTime = 0;
            }
        } else {
            ship.currentHostPos = { x: host.position.x, y: host.position.y };
        }
    } else {
        if (ship.currentSOI !== null) {
            eventBus.emit(Events.SOI_CHANGED, { from: ship.currentSOI, to: null });
            convertVelocityFrame(ship.vel, ship.currentSOI, null);
            ship.currentSOI = null;
            ship.currentGM = 0;
            ship.currentHostPos = { x: 0, y: 0 };
            ship.kepler = null;
        }
    }

    // === 2. 物理更新 ===
    // SOI 切换帧：速度已转换到新宿主参考系，用新宿主位置计算 relPos
    // 其余帧（same-SOI / 深空）：用快照旧值确保时间基准一致
    const hostPosForRel = (soiChanged && host)
        ? { x: ship.currentHostPos.x, y: ship.currentHostPos.y }
        : hostPosSnapshot;
    // 每帧刷新宿主最新位置，避免 SOI 切换后 currentHostPos 过期导致瞬移
    if (host && host.name === ship.currentSOI) {
        ship.currentHostPos = { x: host.position.x, y: host.position.y };
    }
    // 非活动飞船强制走 on_rails，活动飞船按 ship.mode 处理
    if (!isActive || ship.mode === 'on_rails') {
        if (!ship.kepler) {
            // 无 kepler（双曲线/逃逸轨道）：RK4 纯引力积分推进，防止卡死
            const relPos = {
                x: ship.pos.x - hostPosForRel.x,
                y: ship.pos.y - hostPosForRel.y
            };
            const relVel = { x: ship.vel.x, y: ship.vel.y };
            const state = rk4Integrate(relPos, relVel, dt, ship.currentGM, { ax: 0, ay: 0 });
            ship.pos.x = ship.currentHostPos.x + state.pos.x;
            ship.pos.y = ship.currentHostPos.y + state.pos.y;
            ship.vel.x = state.vel.x;
            ship.vel.y = state.vel.y;
        } else {
            // 正常开普勒轨道
            ship.orbitTime += dt;
            const state = keplerToState(ship.kepler, ship.currentGM, ship.orbitTime);
            ship.pos.x = ship.currentHostPos.x + state.pos.x;
            ship.pos.y = ship.currentHostPos.y + state.pos.y;
            ship.vel.x = state.vel.x;
            ship.vel.y = state.vel.y;
        }
    } else if (ship.mode === 'thrust' && isActive) {
        const thrustAccel = ship.thrust ? ship.thrust : { ax: 0, ay: 0 };
        const relPos = {
            x: ship.pos.x - hostPosForRel.x,
            y: ship.pos.y - hostPosForRel.y
        };
        const relVel = { x: ship.vel.x, y: ship.vel.y };
        const state = rk4Integrate(relPos, relVel, dt, ship.currentGM, thrustAccel);
        ship.pos.x = ship.currentHostPos.x + state.pos.x;
        ship.pos.y = ship.currentHostPos.y + state.pos.y;
        ship.vel.x = state.vel.x;
        ship.vel.y = state.vel.y;
    }
}
