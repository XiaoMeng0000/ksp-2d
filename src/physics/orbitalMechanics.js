function stateToKepler(pos, vel, gm) {
    // 深空（无有效引力场）：无法定义轨道根数，返回 null（物理层走 RK4 匀速直线）
    if (!(gm > 0) || !isFinite(gm)) return null;

    const h = pos.x * vel.y - pos.y * vel.x;
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const v = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

    const a = 1 / (2 / r - (v * v) / gm);
    // 近逃逸钳制：|a| 超过阈值视为逃逸（返回 null）。
    // e→1 时 a 对速度误差极度敏感，同一状态会在"巨大椭圆/双曲线"与"逃逸"之间反复横跳，
    // 导致 HUD 数值鬼畜、轨道预测误判。阈值 1e12 远大于星系内正常轨道
    // （Kerbin 绕 Kerbol 约 1.36e10），不影响正常轨道判定。
    const MAX_A = 1e12;
    if (!isFinite(a) || Math.abs(a) > MAX_A) return null;

    const vr = (pos.x * vel.x + pos.y * vel.y) / r;
    const eVecX = ((v * v) / gm - 1 / r) * pos.x - (r * vr / gm) * vel.x;
    const eVecY = ((v * v) / gm - 1 / r) * pos.y - (r * vr / gm) * vel.y;

    const e = Math.sqrt(eVecX * eVecX + eVecY * eVecY);

    let theta;
    let omega;
    if (e < 1e-10) {
        theta = Math.atan2(pos.y, pos.x);
        omega = 0;
    } else {
        const cosTheta = (eVecX * pos.x + eVecY * pos.y) / (e * r);
        const sinTheta = (eVecX * pos.y - eVecY * pos.x) / (e * r);
        theta = Math.atan2(sinTheta, cosTheta);
        omega = Math.atan2(eVecY, eVecX);
    }

    // e < 1：椭圆（a > 0）；e >= 1：双曲线（a < 0）— 均返回根数供解析推进
    // 抛物线（e≈1，a 发散）在上方 |a| 钳制处返回 null，物理层走 RK4 兜底
    return { a, e, theta, omega };
}

function keplerPositionAtTime(kepler, gm, t, omega) {
    const { a, e, theta: theta0 } = kepler;

    // 双曲线轨道（a<0）：双曲近点角 F 满足 M = e·sinhF − F
    if (a < 0) {
        const aMag = -a;
        const n = Math.sqrt(gm / (aMag * aMag * aMag));

        // t=0 精确锚定：直接用真近点角 θ0 计算位置（不经过 F）。
        // 保证 stateToKepler→keplerToState 在拟合时刻精确复现状态，
        // 从而 SOI 切换帧（orbitTime 归零后首次调用）位置严格连续，不会瞬移。
        if (t === 0) {
            const p = aMag * (e * e - 1);
            const r0 = p / (1 + e * Math.cos(theta0));
            const ox = r0 * Math.cos(theta0);
            const oy = r0 * Math.sin(theta0);
            return {
                x: ox * Math.cos(omega) - oy * Math.sin(omega),
                y: ox * Math.sin(omega) + oy * Math.cos(omega)
            };
        }

        // 从当前真近点角反推 F0：tanh(F/2) = sqrt((e−1)/(e+1))·tan(θ/2)
        // clamp 仅防 θ 极端接近渐近线时 atanh(±1)=±∞（t=0 锚定已不依赖 F0，阈值放宽到 1−1e-12）
        const tanHalf = Math.sqrt((e - 1) / (e + 1)) * Math.tan(theta0 / 2);
        const F0 = 2 * Math.atanh(Math.max(-(1 - 1e-12), Math.min(1 - 1e-12, tanHalf)));
        const M0 = e * Math.sinh(F0) - F0;
        const M = M0 + n * t;

        // 求解 M = e·sinhF − F 的逆：asinh 解析近似作初值，牛顿迭代精化
        //（对任意大小的 M 统一处理；不再区分 |M|>20 直接返回近似值）
        let F = Math.sign(M) * Math.asinh(Math.abs(M) / e);
        for (let i = 0; i < 40; i++) {
            const coshF = Math.cosh(F);
            const denom = e * coshF - 1;
            if (!isFinite(denom)) break; // 溢出防护：退化为 asinh 初值
            const delta = e * Math.sinh(F) - F - M;
            if (Math.abs(delta) < 1e-9) break;
            F -= delta / denom;
        }

        // 极坐标形式（与椭圆分支同构）：位置由真近点角 θ 计算，r 由 F 计算
        const theta = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2));
        const r = aMag * (e * Math.cosh(F) - 1);
        const ox = r * Math.cos(theta);
        const oy = r * Math.sin(theta);

        return {
            x: ox * Math.cos(omega) - oy * Math.sin(omega),
            y: ox * Math.sin(omega) + oy * Math.cos(omega)
        };
    }

    // === 椭圆轨道（a>0）原逻辑 ===
    const T = 2 * Math.PI * Math.sqrt(a * a * a / gm);
    const n = 2 * Math.PI / T;

    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta0 / 2));
    const M0 = E0 - e * Math.sin(E0);
    const M = M0 + n * t;

    let E = M;
    let converged = false;
    for (let i = 0; i < 20; i++) {
        const delta = E - e * Math.sin(E) - M;
        if (Math.abs(delta) < 1e-8) { converged = true; break; }
        E = E - delta / (1 - e * Math.cos(E));
    }
    if (!converged) {
        // 牛顿法未收敛：降级为二分法（高离心率轨道 e>0.95 时可能出现）
        let lo = M - Math.PI, hi = M + Math.PI;
        for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            if (mid - e * Math.sin(mid) < M) lo = mid; else hi = mid;
        }
        E = (lo + hi) / 2;
    }

    const theta = 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2));
    const r = a * (1 - e * Math.cos(E));

    const ox = r * Math.cos(theta);
    const oy = r * Math.sin(theta);

    return {
        x: ox * Math.cos(omega) - oy * Math.sin(omega),
        y: ox * Math.sin(omega) + oy * Math.cos(omega)
    };
}

function keplerToState(kepler, gm, t) {
    const pos = keplerPositionAtTime(kepler, gm, t, kepler.omega);
    const dt = 0.0001;
    const pos2 = keplerPositionAtTime(kepler, gm, t + dt, kepler.omega);

    const vel = {
        x: (pos2.x - pos.x) / dt,
        y: (pos2.y - pos.y) / dt
    };

    return { pos, vel };
}

// 根据 true anomaly 直接计算轨道相对位置（不经过时间参数）
function keplerPositionAtTheta(kepler, gm, theta) {
    const { a, e, omega } = kepler;
    const r = a * (1 - e * e) / (1 + e * Math.cos(theta));
    const ox = r * Math.cos(theta);
    const oy = r * Math.sin(theta);
    return {
        x: ox * Math.cos(omega) - oy * Math.sin(omega),
        y: ox * Math.sin(omega) + oy * Math.cos(omega)
    };
}

// 计算轨道与 SOI 边界的交点（解析解求 θ，再用几何公式算位置/速度）
function findSOIIntersection(kepler, gm, soiRadius) {
    const { a, e, theta: theta0, omega } = kepler;

    // 双曲线轨道（a<0）：无拱点限制，r = p/(1+e·cosθ)，p=|a|(e²−1)，θ∈(−θmax,θmax)
    if (a < 0) {
        const aMag = -a;
        const p = aMag * (e * e - 1);
        const rCurr = p / (1 + e * Math.cos(theta0));
        // 当前已在 SOI 边界外（或正远离）：无内部交点
        if (soiRadius <= rCurr) return null;

        const cosVal = (p / soiRadius - 1) / e;
        const clamped = Math.max(-1, Math.min(1, cosVal));
        const thetaA = Math.acos(clamped);
        const thetaB = -thetaA;
        // 取前进方向（θ>θ0）最近交点；双曲线 θ 沿运动方向单调增
        // θ0<0（来向，r 仍减小）时 thetaA>0>θ0 必命中；θ0>0（离开段）时 r 单调增，交点唯一
        let thetaIntersect;
        if (thetaA > theta0) {
            thetaIntersect = thetaA;
        } else if (thetaB > theta0) {
            thetaIntersect = thetaB;
        } else {
            return null;
        }

        const r = soiRadius;
        const ox = r * Math.cos(thetaIntersect);
        const oy = r * Math.sin(thetaIntersect);
        const pos = {
            x: ox * Math.cos(omega) - oy * Math.sin(omega),
            y: ox * Math.sin(omega) + oy * Math.cos(omega)
        };

        // 速度（径向/切向分解，双曲线同样适用）
        const sqrtGMp = Math.sqrt(gm / p);
        const vr = sqrtGMp * e * Math.sin(thetaIntersect);
        const vtheta = sqrtGMp * (1 + e * Math.cos(thetaIntersect));

        const radDir = { x: Math.cos(thetaIntersect), y: Math.sin(thetaIntersect) };
        const tanDir = { x: -Math.sin(thetaIntersect), y: Math.cos(thetaIntersect) };

        const velLocal = {
            x: vr * radDir.x + vtheta * tanDir.x,
            y: vr * radDir.y + vtheta * tanDir.y
        };
        const vel = {
            x: velLocal.x * Math.cos(omega) - velLocal.y * Math.sin(omega),
            y: velLocal.x * Math.sin(omega) + velLocal.y * Math.cos(omega)
        };

        return { theta: thetaIntersect, pos, vel };
    }

    const rApo = a * (1 + e);
    if (rApo <= soiRadius) return null;

    // 圆形轨道（e≈0）：半径恒定，不可能穿越 SOI 边界，直接返回 null 避免除零
    if (e < 1e-10) return null;

    const cosTheta = (a * (1 - e * e) / soiRadius - 1) / e;
    const clamped = Math.max(-1, Math.min(1, cosTheta));
    const thetaBase = Math.acos(clamped);

    let cand1 = thetaBase;
    let cand2 = 2 * Math.PI - thetaBase;
    while (cand1 <= theta0) cand1 += 2 * Math.PI;
    while (cand2 <= theta0) cand2 += 2 * Math.PI;
    const thetaIntersect = Math.min(cand1, cand2);

    const r = soiRadius;
    const ox = r * Math.cos(thetaIntersect);
    const oy = r * Math.sin(thetaIntersect);
    const pos = {
        x: ox * Math.cos(omega) - oy * Math.sin(omega),
        y: ox * Math.sin(omega) + oy * Math.cos(omega)
    };

    const p = a * (1 - e * e);
    const sqrtGMp = Math.sqrt(gm / p);
    const vr = sqrtGMp * e * Math.sin(thetaIntersect);
    const vtheta = sqrtGMp * (1 + e * Math.cos(thetaIntersect));

    const radDir = { x: Math.cos(thetaIntersect), y: Math.sin(thetaIntersect) };
    const tanDir = { x: -Math.sin(thetaIntersect), y: Math.cos(thetaIntersect) };

    const velLocal = {
        x: vr * radDir.x + vtheta * tanDir.x,
        y: vr * radDir.y + vtheta * tanDir.y
    };
    const vel = {
        x: velLocal.x * Math.cos(omega) - velLocal.y * Math.sin(omega),
        y: velLocal.x * Math.sin(omega) + velLocal.y * Math.cos(omega)
    };

    return { theta: thetaIntersect, pos, vel };
}

function normalizeAngle(a) {
    return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function getOrbitalDirectionAngles(relPos, velRel) {
    const prograde = normalizeAngle(Math.atan2(velRel.y, velRel.x));
    const retrograde = normalizeAngle(prograde + Math.PI);
    const radialOut = normalizeAngle(Math.atan2(relPos.y, relPos.x));
    const radialIn = normalizeAngle(radialOut + Math.PI);
    return { prograde, retrograde, radialIn, radialOut };
}

// 轨道信息汇总 — 供飞行 HUD 显示
// 输入：
//   kepler: ship.kepler（椭圆轨道元素 {a,e,theta,omega}；逃逸/双曲线轨道为 null）
//   gm:     ship.currentGM（当前 SOI 的引力常数）
//   body:   当前 SOI 天体对象（含 radius 字段），深空时为 null
//   relPos: 飞船相对宿主天体的位置 {x,y}（即 ship.pos），用于计算当前海拔，可省略
// 返回：
//   {
//     apAlt / peAlt / currentAlt / period / tToAp / tToPe: Number 或 null
//       （null 表示不可用，HUD 层显示 "--"）
//     orbitType: 'circular' | 'elliptical' | 'suborbital' | 'escape' | 'deep_space'
//   }
function getOrbitalInfo(kepler, gm, body, relPos) {
    // 深空：无宿主天体，所有轨道数据不可用
    if (!body) {
        return {
            apAlt: null, peAlt: null, currentAlt: null,
            period: null, tToAp: null, tToPe: null,
            orbitType: 'deep_space'
        };
    }

    const rBody = body.radius;

    // 当前海拔只依赖位置与天体半径，与轨道形态无关（逃逸轨道时依然有效）
    let currentAlt = null;
    if (relPos && isFinite(relPos.x) && isFinite(relPos.y)) {
        currentAlt = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y) - rBody;
    }

    // 逃逸/双曲线轨道（kepler 为 null 或 a<0）：无法给出拱点/周期数据
    if (!kepler || !isFinite(kepler.a) || kepler.a <= 0) {
        return {
            apAlt: null, peAlt: null, currentAlt,
            period: null, tToAp: null, tToPe: null,
            orbitType: 'escape'
        };
    }

    const { a, e, theta: theta0 } = kepler;

    const apAlt = a * (1 + e) - rBody;
    const peAlt = a * (1 - e) - rBody;

    let period = null;
    let tToAp = null;
    let tToPe = null;
    if (isFinite(gm) && gm > 0) {
        period = 2 * Math.PI * Math.sqrt(a * a * a / gm);
        const n = 2 * Math.PI / period;
        // 真近点角 → 偏近点角 E（atan2 半角形式保证与 theta 同象限）→ 平近点角 M
        const E0 = 2 * Math.atan2(
            Math.sqrt(1 - e) * Math.sin(theta0 / 2),
            Math.sqrt(1 + e) * Math.cos(theta0 / 2)
        );
        const M0 = E0 - e * Math.sin(E0);
        // 目标拱点：远拱点 theta=π → M=π；近拱点 theta=0 → M=0
        // 到达时间 = 归一化的平近点角差 ÷ 平均角速度（始终取正值，即下一次到达）
        tToAp = normalizeAngle(Math.PI - M0) / n;
        tToPe = normalizeAngle(0 - M0) / n;
    }

    // 轨道类型：亚轨道（Pe 低于天体表面）优先于圆轨判定
    let orbitType;
    if (peAlt < 0) {
        orbitType = 'suborbital';
    } else if (e < 0.01) {
        orbitType = 'circular';
    } else {
        orbitType = 'elliptical';
    }

    return { apAlt, peAlt, currentAlt, period, tToAp, tToPe, orbitType };
}

export { stateToKepler, keplerPositionAtTime, keplerToState, keplerPositionAtTheta, findSOIIntersection, getOrbitalDirectionAngles, getOrbitalInfo };
