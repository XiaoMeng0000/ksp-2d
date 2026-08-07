"use strict";

import { eventBus, Events } from '../eventBus.js';
import { getSOIHost, getAbsolutePosition, getRelativePosition, convertVelocityFrame, celestialBodies } from './physics.js';
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

    // === 1. SOI 边界检测 ===
    // ship.pos 现在是相对宿主位置，需要转绝对坐标用于 SOI 判定
    const absPos = getAbsolutePosition(ship);
    const host = getSOIHost(absPos);

    // SOI边界诊断 — 输出所有接近天体的距离信息
    if (soiDiagEnabled() && isActive) {
        for (const body of celestialBodies) {
            const dx = body.position.x - absPos.x;
            const dy = body.position.y - absPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < body.soiRadius * 1.5) {
                const soiStr = dist < body.soiRadius ? '内' : '外';
                console.log(`[DIAG] SOI检测 ship=${ship.id.slice(-6)} body=${body.name} dist=${dist.toFixed(2)} SOI=${body.soiRadius} (${soiStr}) absPos=(${absPos.x.toFixed(2)},${absPos.y.toFixed(2)}) bodyPos=(${body.position.x.toFixed(2)},${body.position.y.toFixed(2)}) hostResult=${host ? host.name : 'null'} currentSOI=${ship.currentSOI}`);
            }
        }
    }

    if (host) {
        if (host.name !== ship.currentSOI) {
            // SOI 切换：ship.pos 从旧宿主相对坐标 rebase 到新宿主相对坐标
            const oldSOI = ship.currentSOI;
            const oldHost = oldSOI
                ? celestialBodies.find(b => b.name === oldSOI)
                : null;
            const oldHostPos = oldHost ? oldHost.position : { x: 0, y: 0 };
            ship.pos.x = (oldHostPos.x + ship.pos.x) - host.position.x;
            ship.pos.y = (oldHostPos.y + ship.pos.y) - host.position.y;

            convertVelocityFrame(ship.vel, oldSOI, host.name);

            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            eventBus.emit(Events.SOI_CHANGED, { from: oldSOI, to: host.name });

            const newKepler = stateToKepler(ship.pos, ship.vel, host.gm);
            if (newKepler) {
                ship.kepler = newKepler;
                ship.orbitTime = 0;
            } else {
                ship.kepler = null;
                ship.orbitTime = 0;
            }
        }
        // same SOI: ship.pos 已经是相对坐标，不需要额外处理
    } else {
        if (ship.currentSOI !== null) {
            // 离开 SOI 进入深空：相对坐标转为绝对世界坐标
            const oldHost = celestialBodies.find(b => b.name === ship.currentSOI);
            if (oldHost) {
                ship.pos.x = oldHost.position.x + ship.pos.x;
                ship.pos.y = oldHost.position.y + ship.pos.y;
            }

            eventBus.emit(Events.SOI_CHANGED, { from: ship.currentSOI, to: null });
            convertVelocityFrame(ship.vel, ship.currentSOI, null);
            ship.currentSOI = null;
            ship.currentGM = 0;
            ship.kepler = null;
        }
    }

    // === 2. 物理更新 ===
    // ship.pos 已经是相对坐标，直接传给积分器，积分结果也直接写回
    if (!isActive || ship.mode === 'on_rails') {
        if (!ship.kepler) {
            // 无 kepler（双曲线/逃逸轨道）：RK4 纯引力积分推进，防止卡死
            const state = rk4Integrate(ship.pos, ship.vel, dt, ship.currentGM, { ax: 0, ay: 0 });
            ship.pos.x = state.pos.x;
            ship.pos.y = state.pos.y;
            ship.vel.x = state.vel.x;
            ship.vel.y = state.vel.y;
        } else {
            // 正常开普勒轨道
            ship.orbitTime += dt;
            const state = keplerToState(ship.kepler, ship.currentGM, ship.orbitTime);
            ship.pos.x = state.pos.x;
            ship.pos.y = state.pos.y;
            ship.vel.x = state.vel.x;
            ship.vel.y = state.vel.y;
        }
    } else if (ship.mode === 'thrust' && isActive) {
        const thrustAccel = ship.thrust ? ship.thrust : { ax: 0, ay: 0 };
        // 子步循环 — 每步 RK4 不超过 0.05s，保证物理加速（2x~4x）下推力轨道精度
        // 逃逸轨道（无 kepler）分支暂不子步化：高倍率下步数过多，记为已知限制
        const MAX_RK4_STEP = 0.05;
        let remaining = dt;
        let p = ship.pos;
        let v = ship.vel;
        while (remaining > 1e-9) {
            const step = Math.min(remaining, MAX_RK4_STEP);
            const state = rk4Integrate(p, v, step, ship.currentGM, thrustAccel);
            p = state.pos;
            v = state.vel;
            remaining -= step;
        }
        ship.pos.x = p.x;
        ship.pos.y = p.y;
        ship.vel.x = v.x;
        ship.vel.y = v.y;
    }
}
