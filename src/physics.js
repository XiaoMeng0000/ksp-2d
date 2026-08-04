"use strict";

// TEMP: 天体驱动器 6.5步
import { solarSystemData } from './config/solarSystem.js';
import { keplerPositionAtTime } from './orbitalMechanics.js';

export const celestialBodies = structuredClone(solarSystemData);

// 获取飞船相对于宿主天体的位置（世界坐标 → 宿主参考系）
export function getRelativePosition(pos, host) {
    if (!host) return { x: pos.x, y: pos.y };
    return {
        x: pos.x - host.position.x,
        y: pos.y - host.position.y
    };
}

// SOI 归属判定：判断 pos 属于哪个天体的 SOI
export function getSOIHost(pos) {
    let starHost = null;
    let closestNonStar = null;
    let closestDist = Infinity;

    for (const body of celestialBodies) {
        const dx = body.position.x - pos.x;
        const dy = body.position.y - pos.y;
        const r = Math.sqrt(dx * dx + dy * dy);

        if (r < body.soiRadius) {
            if (body.type === 'star') {
                starHost = body;
            } else {
                if (r < closestDist) {
                    closestDist = r;
                    closestNonStar = body;
                }
            }
        }
    }
    return closestNonStar || starHost;
}

// 将速度向量从一个天体参考系转换到另一个天体参考系，直接修改 vel 对象
export function convertVelocityFrame(vel, fromHostName, toHostName) {
    const oldHost = fromHostName
        ? celestialBodies.find(b => b.name === fromHostName)
        : null;
    const newHost = toHostName
        ? celestialBodies.find(b => b.name === toHostName)
        : null;

    const oldVel = oldHost ? oldHost.velocity : { x: 0, y: 0 };
    const newVel = newHost ? newHost.velocity : { x: 0, y: 0 };

    vel.x = vel.x + oldVel.x - newVel.x;
    vel.y = vel.y + oldVel.y - newVel.y;
}

/**
 * RK4 数值积分器，用于更新航天器的位置和速度
 * @param {Object} pos - 当前位置 {x, y}（世界坐标）
 * @param {Object} vel - 当前速度 {x, y}
 * @param {number} dt - 时间步长（秒），建议不超过 0.05 秒
 * @param {number} gm - 当前 SOI 天体的引力常数
 * @param {Object} thrustAccel - 推力加速度向量 {ax, ay}，为 {ax: 0, ay: 0} 时即为纯引力积分
 * @returns {Object} 更新后的状态 { pos: {x, y}, vel: {x, y} }
 */
function rk4Integrate(pos, vel, dt, gm, thrustAccel) {
    const clampedDt = Math.min(dt, 0.05);

    function f(state) {
        const { x, y, vx, vy } = state;
        const r = Math.sqrt(x * x + y * y);
        let ax = 0, ay = 0;
        if (r > 0.001) {
            const a = gm / (r * r);
            ax = -a * (x / r);
            ay = -a * (y / r);
        }
        ax += thrustAccel.ax;
        ay += thrustAccel.ay;
        return { vx, vy, ax, ay };
    }

    const k1 = f({ x: pos.x, y: pos.y, vx: vel.x, vy: vel.y });

    const k2 = f({
        x: pos.x + k1.vx * clampedDt * 0.5,
        y: pos.y + k1.vy * clampedDt * 0.5,
        vx: vel.x + k1.ax * clampedDt * 0.5,
        vy: vel.y + k1.ay * clampedDt * 0.5
    });

    const k3 = f({
        x: pos.x + k2.vx * clampedDt * 0.5,
        y: pos.y + k2.vy * clampedDt * 0.5,
        vx: vel.x + k2.ax * clampedDt * 0.5,
        vy: vel.y + k2.ay * clampedDt * 0.5
    });

    const k4 = f({
        x: pos.x + k3.vx * clampedDt,
        y: pos.y + k3.vy * clampedDt,
        vx: vel.x + k3.ax * clampedDt,
        vy: vel.y + k3.ay * clampedDt
    });

    return {
        pos: {
            x: pos.x + (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx) * clampedDt / 6,
            y: pos.y + (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy) * clampedDt / 6
        },
        vel: {
            x: vel.x + (k1.ax + 2 * k2.ax + 2 * k3.ax + k4.ax) * clampedDt / 6,
            y: vel.y + (k1.ay + 2 * k2.ay + 2 * k3.ay + k4.ay) * clampedDt / 6
        }
    };
}

// TEMP: 天体驱动器 6.6步
export function updateCelestialBodies(time) {
    // TEMP: 天体速度修复 — 先更新所有位置，再计算绝对速度
    // 第一遍：更新位置 + 存储相对速度
    const relVelocities = {};

    for (const body of celestialBodies) {
        if (!body.orbitParent) {
            body.velocity = { x: 0, y: 0 };
            continue;
        }

        const parent = celestialBodies.find(b => b.name === body.orbitParent);
        if (!parent) continue;

        const kepler = {
            a: body.orbitA,
            e: body.orbitE,
            theta: body.orbitTheta0,
            omega: body.orbitOmega
        };

        const relPos = keplerPositionAtTime(kepler, parent.gm, time, body.orbitOmega);

        body.position.x = parent.position.x + relPos.x;
        body.position.y = parent.position.y + relPos.y;

        // 数值微分计算相对速度
        const dt2 = 0.001;
        const relPosNext = keplerPositionAtTime(kepler, parent.gm, time + dt2, body.orbitOmega);
        relVelocities[body.name] = {
            x: (relPosNext.x - relPos.x) / dt2,
            y: (relPosNext.y - relPos.y) / dt2
        };
    }

    // 第二遍：累加父天体速度，得到绝对速度
    // 依赖：celestialBodies 数组中父天体排在子天体之前（Kerbol → Kerbin → Mun）
    for (const body of celestialBodies) {
        if (!body.orbitParent) continue;
        if (!relVelocities[body.name]) continue;

        const parent = celestialBodies.find(b => b.name === body.orbitParent);
        if (!parent) continue;

        body.velocity = {
            x: parent.velocity.x + relVelocities[body.name].x,
            y: parent.velocity.y + relVelocities[body.name].y
        };
    }
}

export { rk4Integrate };
