"use strict";

function stateToKepler(pos, vel, gm) {
    const h = pos.x * vel.y - pos.y * vel.x;
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const v = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

    const a = 1 / (2 / r - (v * v) / gm);
    if (!isFinite(a) || a <= 0) return null;

    const vr = (pos.x * vel.x + pos.y * vel.y) / r;
    const eVecX = ((v * v) / gm - 1 / r) * pos.x - (r * vr / gm) * vel.x;
    const eVecY = ((v * v) / gm - 1 / r) * pos.y - (r * vr / gm) * vel.y;

    const e = Math.sqrt(eVecX * eVecX + eVecY * eVecY);
    if (e >= 1) return null;

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

    return { a, e, theta, omega };
}

function keplerPositionAtTime(kepler, gm, t, omega) {
    const { a, e, theta: theta0 } = kepler;

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

export { stateToKepler, keplerPositionAtTime, keplerToState, keplerPositionAtTheta, findSOIIntersection, getOrbitalDirectionAngles };