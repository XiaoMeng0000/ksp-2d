/**
 * RK4 数值积分器，用于更新航天器的位置和速度
 * @param {Object} pos - 当前位置 {x, y}（相对宿主天体的坐标）
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

export { rk4Integrate };
