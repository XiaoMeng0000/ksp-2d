"use strict";

// 环境危害检测模块 — 大气引爆 + 表面危险边界
//
// 两类危险边界（圆形，数据驱动）：
//   1. 大气边界 = radius + atmosphereHeight（有大气天体）：
//      进入后启动 10 秒倒计时警告，归零仍在内 → 销毁；拉出边界 → 警告取消
//   2. 表面边界 = radius（无大气天体）：
//      进入即立即销毁（无缓冲，硬碰硬）
//
// 与物理更新的关系：在 updateShipPhysics 物理推进后调用本模块检测，
// 飞船位置与天体位置同帧，检测结果可靠。设施（含 typeId）不参与检测。

import { eventBus, Events } from '../eventBus.js';
import { getAbsolutePosition, celestialBodies } from './physics.js';
import { shipSystem } from '../ship/shipSystem.js';

// 大气进入倒计时（秒）
const ATMO_WARNING_TIME = 10;

// 大气倒计时警告状态字段（挂在 ship 上，随飞船序列化/生命周期）
const DANGER_FLAG = '_atmoDanger';  // { bodyName, remaining, boundaryType }

/**
 * 执行环境危害检测（大气倒计时 / 表面硬边界）
 * @param {Object} ship - 飞船实例（直接引用）
 * @param {number} dt - 时间步长（秒）
 */
export function checkAtmosphereDanger(ship, dt) {
    if (!ship) return;
    // 设施不参与引爆检测（部署时已校验危险边界，轨道上不会漂进大气）
    if (ship.typeId) return;

    const absPos = getAbsolutePosition(ship);

    for (const body of celestialBodies) {
        const dx = body.position.x - absPos.x;
        const dy = body.position.y - absPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (body.hasAtmosphere && body.atmosphereHeight > 0) {
            // === 大气边界（倒计时警告） ===
            const boundary = body.radius + body.atmosphereHeight;
            if (dist < boundary) {
                const danger = ship[DANGER_FLAG];
                if (!danger || danger.bodyName !== body.name) {
                    // 首次进入该天体大气：初始化倒计时
                    ship[DANGER_FLAG] = {
                        bodyName: body.name,
                        remaining: ATMO_WARNING_TIME,
                        boundaryType: 'atmosphere'
                    };
                    if (window.showNotification) {
                        window.showNotification(`⚠ 警告：正在进入 ${body.name} 大气层！`, 'warning');
                    }
                } else {
                    // 持续在大气内：倒计时递减
                    danger.remaining -= dt;
                    if (danger.remaining <= 0) {
                        ship[DANGER_FLAG] = null;
                        _destroyShip(ship, 'atmosphere');
                        return;
                    }
                }
            } else if (ship[DANGER_FLAG] && ship[DANGER_FLAG].bodyName === body.name) {
                // 拉出大气边界：取消警告
                ship[DANGER_FLAG] = null;
            }
        } else {
            // === 表面危险边界（无大气天体，立即销毁） ===
            if (dist < body.radius) {
                _destroyShip(ship, 'surface');
                return;
            }
        }
    }
}

/**
 * 销毁飞船并广播事件（附损毁报告数据：飞船名/宿主天体/高度/速度）
 * @param {Object} ship
 * @param {string} reason - 'atmosphere' | 'surface'
 */
function _destroyShip(ship, reason) {
    const shipId = ship.id;
    const displayName = ship.displayName || shipId;

    // 损毁报告数据（ship.pos/vel 为相对宿主坐标）
    const bodyName = ship.currentSOI || '深空';
    const host = ship.currentSOI ? celestialBodies.find(b => b.name === ship.currentSOI) : null;
    const distToCenter = Math.hypot(ship.pos.x, ship.pos.y);
    const altitude = host ? Math.max(0, distToCenter - host.radius) : 0;
    const speed = Math.hypot(ship.vel.x, ship.vel.y);

    shipSystem.deleteShip(shipId);
    eventBus.emit(Events.SHIP_DESTROYED, {
        shipId,
        reason,
        shipName: displayName,
        bodyName,
        altitude,
        speed
    });
    if (window.showNotification) {
        const msg = reason === 'atmosphere'
            ? `💥 ${displayName} 在大气层中坠毁`
            : `💥 ${displayName} 撞击天体表面`;
        window.showNotification(msg, 'error');
    }
    console.log(`[Atmosphere] 飞船 ${displayName} 已销毁，原因: ${reason}`);
}
