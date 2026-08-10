function stateToKepler(pos, vel, gm) {
    // 深空（无有效引力场）：无法定义轨道根数，返回 null（物理层走 RK4 匀速直线）
    if (!(gm > 0) || !isFinite(gm)) return null;

    const h = pos.x * vel.y - pos.y * vel.x;
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    // 位置退化防御：r≈0（与宿主重合，如预测起始点异常/切换点定位错误）时
    // 真近点角与角动量定义病态，直接返回 null 走 RK4 兜底，避免 NaN 根数污染后续计算
    if (!(r > 1)) return null;
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

    // 数值病态回退：解析解在以下区间数值失稳（F 求解爆炸/NaN/方向失真），
    // 返回 null 由物理层 RK4 子步兜底（physicsUpdate.js 无 kepler 分支）：
    // 1) 径向/直线弹道（|h| 过小）：真近点角定义病态，e 失真（近抛物线时 e-1 精度丢失）
    // 2) 极近抛物线双曲线（a<0 且 e-1 < 3e-5）：双曲开普勒方程 M=e·sinhF−F 数值失稳。
    //    阈值经实测校准（2026-08-08，检查点15 案例）：e-1=7e-5 时解析推进 vs RK4 误差 <1m，
    //    e-1=1.8e-5 时误差 0.18%，e-1=3.5e-7（超逃逸 0.0001m/s）才真正爆炸。
    //    原取 1e-4 保守拦截；但 RK4 兜底对近抛物线逃逸步数需求爆炸（出 SOI 需数千秒、
    //    近点附近数值失真），故放宽到 3e-5：覆盖 e-1≥7e-5 的校准安全区，1.8e-5 以下仍回退。
    const aMag = Math.abs(a);
    const hMin = 1e-4 * Math.sqrt(gm * aMag);
    if (Math.abs(h) < hMin || (a < 0 && e - 1 < 3e-5)) {
        return null;
    }

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
    // dir：运动方向（h<0 为顺时针 -1，否则 +1）。解析推进在镜像坐标求解，
    // 保证逆行轨道（h<0）方向正确；旧存档/手建 kepler 无该字段时默认顺行 +1
    return { a, e, theta, omega, dir: h < 0 ? -1 : 1 };
}

function keplerPositionAtTime(kepler, gm, t, omega) {
    const { a, e, theta: theta0 } = kepler;

    // 双曲线轨道（a<0）：双曲近点角 F 满足 M = e·sinhF − F
    if (a < 0) {
        const aMag = -a;
        const n = Math.sqrt(gm / (aMag * aMag * aMag));
        // 运动方向（h<0 为 -1）：推进在"运动坐标" θm=dir·θ 中求解（θm 单调增），
        // 位置几何用真实 θ=dir·θm，保证顺行/逆行轨道方向均正确
        const dir = kepler.dir === undefined ? 1 : kepler.dir;
        const theta0m = dir * theta0;

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
        const tanHalf = Math.sqrt((e - 1) / (e + 1)) * Math.tan(theta0m / 2);
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

        // 极坐标形式（与椭圆分支同构）：运动坐标 θm 由 F 计算，真实 θ = dir·θm
        const thetaM = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2));
        const theta = dir * thetaM;
        const r = aMag * (e * Math.cosh(F) - 1);
        const ox = r * Math.cos(theta);
        const oy = r * Math.sin(theta);

        return {
            x: ox * Math.cos(omega) - oy * Math.sin(omega),
            y: ox * Math.sin(omega) + oy * Math.cos(omega)
        };
    }

    // === 椭圆轨道（a>0）：与双曲线分支同样的 dir 镜像处理 ===
    const T = 2 * Math.PI * Math.sqrt(a * a * a / gm);
    const n = 2 * Math.PI / T;
    const dir = kepler.dir === undefined ? 1 : kepler.dir;
    const theta0m = dir * theta0;

    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta0m / 2));
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

    const thetaM = 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2));
    const theta = dir * thetaM;
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
        // 在运动坐标（θm=dir·θ 沿运动方向单调增）中取前进方向最近交点，再映射回真实 θ
        const dir = kepler.dir === undefined ? 1 : kepler.dir;
        const theta0m = dir * theta0;
        const thetaAm = Math.acos(clamped);
        const thetaBm = -thetaAm;
        let thetaIntm;
        if (thetaAm > theta0m) {
            thetaIntm = thetaAm;
        } else if (thetaBm > theta0m) {
            thetaIntm = thetaBm;
        } else {
            return null;
        }
        const thetaIntersect = dir * thetaIntm;

        const r = soiRadius;
        const ox = r * Math.cos(thetaIntersect);
        const oy = r * Math.sin(thetaIntersect);
        const pos = {
            x: ox * Math.cos(omega) - oy * Math.sin(omega),
            y: ox * Math.sin(omega) + oy * Math.cos(omega)
        };

        // 速度（径向/切向分解，双曲线同样适用）
        // dir 修正：vr=(gm/h)·e·sinθ、vθ=h/r，h 带符号——逆行（h<0）时径向与切向均取反。
        // 否则预测线在逆行轨道 SOI 切换点后的续段方向完全错误
        const sqrtGMp = Math.sqrt(gm / p);
        const vr = dir * sqrtGMp * e * Math.sin(thetaIntersect);
        const vtheta = dir * sqrtGMp * (1 + e * Math.cos(thetaIntersect));

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

    // 在运动坐标（θm=dir·θ 沿运动方向单调增）中取前进方向最近交点，再映射回真实 θ
    const dir = kepler.dir === undefined ? 1 : kepler.dir;
    const theta0m = dir * theta0;
    let cand1 = thetaBase;
    let cand2 = 2 * Math.PI - thetaBase;
    while (cand1 <= theta0m) cand1 += 2 * Math.PI;
    while (cand2 <= theta0m) cand2 += 2 * Math.PI;
    const thetaIntm = Math.min(cand1, cand2);
    const thetaIntersect = dir * thetaIntm;

    const r = soiRadius;
    const ox = r * Math.cos(thetaIntersect);
    const oy = r * Math.sin(thetaIntersect);
    const pos = {
        x: ox * Math.cos(omega) - oy * Math.sin(omega),
        y: ox * Math.sin(omega) + oy * Math.cos(omega)
    };

    const p = a * (1 - e * e);
    // dir 修正（同双曲线分支）：顺行公式在逆行轨道上径向/切向均需取反
    const sqrtGMp = Math.sqrt(gm / p);
    const vr = dir * sqrtGMp * e * Math.sin(thetaIntersect);
    const vtheta = dir * sqrtGMp * (1 + e * Math.cos(thetaIntersect));

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

    const { a, e, theta: theta0, dir } = kepler;

    const apAlt = a * (1 + e) - rBody;
    const peAlt = a * (1 - e) - rBody;

    let period = null;
    let tToAp = null;
    let tToPe = null;
    if (isFinite(gm) && gm > 0) {
        period = 2 * Math.PI * Math.sqrt(a * a * a / gm);
        const n = 2 * Math.PI / period;
        // 真近点角 → 偏近点角 E（atan2 半角形式保证与 theta 同象限）→ 平近点角 M
        // 逆行轨道（dir=-1）：在运动坐标 θm=dir·θ 中计算（θm 沿运动方向单调增），
        // 保证 tToAp/tToPe 是"沿实际运动方向的到达时间"（顺行时 θm=θ，与旧逻辑一致）
        const dirD = dir === undefined ? 1 : dir;
        const theta0m = dirD * theta0;
        const E0 = 2 * Math.atan2(
            Math.sqrt(1 - e) * Math.sin(theta0m / 2),
            Math.sqrt(1 + e) * Math.cos(theta0m / 2)
        );
        const M0 = E0 - e * Math.sin(E0);
        // 目标拱点：运动坐标下远拱点 θm=π → M=π；近拱点 θm=0 → M=0
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
