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
        // 小 |M| 时 sinhF−F≈F³/6 → F≈(6M)^(1/3)，asinh 初值（≈M/e）会严重低估
        //（如 M=1e-10 时真解 F≈8.4e-4,初值仅 ~1e-10）；旧版残差绝对容差 1e-9 下
        // 该残差 |M|/e < 1e-9 即"零迭代退出"，t≈0 首帧位置误差米级、速度完全
        // 失真（实测 59%）。故 |M|<0.05 时改用立方根初值（与真解同阶）。
        const magM = Math.abs(M);
        let F;
        if (magM < 0.05) {
            F = Math.cbrt(6 * magM);
            if (M < 0) F = -F;
        } else {
            F = Math.sign(M) * Math.asinh(magM / e);
        }
        for (let i = 0; i < 40; i++) {
            const coshF = Math.cosh(F);
            const denom = e * coshF - 1;
            if (!isFinite(denom)) break; // 溢出防护：退化为 asinh 初值
            const delta = e * Math.sinh(F) - F - M;
            // 收敛判据：以"本轮 F 修正量"为准（与椭圆分支同口径）。
            // 旧版残差绝对容差在 |M| 极大时过松、|M| 极小时假收敛，
            // 均导致解精度不足；相对容差 1e-12·max(1,|F|) + 绝对地板兼顾两端。
            const step = delta / denom;
            if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(F))) break;
            F -= step;
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
    for (let i = 0; i < 40; i++) {
        const delta = E - e * Math.sin(E) - M;
        const denom = 1 - e * Math.cos(E);
        // 收敛判据：以"本轮 E 修正量"为准。旧版残差绝对容差 1e-8 有两个缺陷：
        // 1) |M| 极小（t≈0）时残差 ≈ −e·M < 1e-8 即被误判收敛，E 停在初值 M 而真解
        //    ≈ M/(1−e)，近地点附近位置误差可达米级（数值微分速度随之被污染）；
        // 2) 高离心率轨道中段（e>0.95）牛顿迭代可能跳变到错误分支，"假收敛"
        //    并不等于收敛 → 位置噪声 0.3~6 Mm，是 keplerToState 速度爆炸源头。
        // 修正量判据同时约束：E 大时按 1e-12·|E| 相对精度,小 E 时按 1e-12 绝对地板。
        const step = delta / denom;
        if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(E))) { converged = true; break; }
        E = E - step;
    }
    if (!converged) {
        // 牛顿法未收敛：降级为二分法（高离心率轨道 e>0.95 时可能出现）。
        // 40 次二分 → 区间宽度 2π/2^40 ≈ 5.7e-12 rad，位置误差亚毫米级
        let lo = M - Math.PI, hi = M + Math.PI;
        for (let i = 0; i < 40; i++) {
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

    // 解析速度（弃用数值微分）：由真近点角 θ 反推径向/切向分量，
    // 与 findSOIIntersection 的速度公式同口径，椭圆(a>0)/双曲线(a<0)同构：
    //   p = a·(1−e²)  （双曲线 a<0 时自动为正）
    //   vr = dir·√(gm/p)·e·sinθ    vθ = dir·√(gm/p)·(1+e·cosθ)
    // 旧版对 keplerPositionAtTime 做 dt=0.0001 前向差分：高离心率轨道中段
    // （开普勒方程牛顿假收敛/二分兜底,位置噪声数百米~数 Mm）会把噪声放大到
    // 百万 m/s 级,导致 HUD 重拟合与预测线逐帧乱跳（"鬼畜"）。
    // 解析公式零差分、零迭代依赖,双曲线 t≈0 死区一并根治。
    const { a, e } = kepler;
    const dir = kepler.dir === undefined ? 1 : kepler.dir;
    const cosOmega = Math.cos(kepler.omega);
    const sinOmega = Math.sin(kepler.omega);

    // 从世界坐标逆旋回轨道局部系,取真实真近点角（与位置严格一致）
    const ox = pos.x * cosOmega + pos.y * sinOmega;
    const oy = -pos.x * sinOmega + pos.y * cosOmega;
    const theta = Math.atan2(oy, ox);

    const p = a * (1 - e * e);
    const sqrtGMp = Math.sqrt(gm / p);
    const vr = dir * sqrtGMp * e * Math.sin(theta);
    const vtheta = dir * sqrtGMp * (1 + e * Math.cos(theta));

    // 局部系径向/切向 → 直角坐标 → 旋转回世界系
    const vlx = vr * Math.cos(theta) - vtheta * Math.sin(theta);
    const vly = vr * Math.sin(theta) + vtheta * Math.cos(theta);
    const vel = {
        x: vlx * cosOmega - vly * sinOmega,
        y: vlx * sinOmega + vly * cosOmega
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

// 计算轨道到达宿主 SOI 边界的飞行时间（游戏秒），口径与 orbitalPrediction.patchedStep
// 完全一致（运动坐标 ΔM/n）：有出界交点返回时间，无交点返回 null（调用方按"无切换"处理）。
// 供 SOI 切换时间保护与预测线共用同一数学，保证"预测线画到切换点、保护必同步生效"。
// 找到交点后仍需判断 theta0→交点沿运动方向是否前进由 findSOIIntersection 负责（已保证）。
function findSOIExitTime(kepler, gm, soiRadius) {
    if (!kepler || !isFinite(kepler.a) || !(gm > 0) || !isFinite(gm) || !(soiRadius > 0)) {
        return null;
    }
    const intersection = findSOIIntersection(kepler, gm, soiRadius);
    if (!intersection) {
        return null;
    }

    const dir = kepler.dir === undefined ? 1 : kepler.dir;
    const theta0m = dir * kepler.theta;
    const thetaEndm = dir * intersection.theta;

    // 双曲线轨道（a<0）：F 由 tanh(F/2)=√((e−1)/(e+1))·tan(θ/2) 反推；
    // 运动坐标 θm 单调增 → 双曲平近点角 M 单调增，无需 mod 2π
    if (kepler.a < 0) {
        const aMag = -kepler.a;
        const n = Math.sqrt(gm / (aMag * aMag * aMag));
        const clampTanh = (v) => Math.max(-(1 - 1e-12), Math.min(1 - 1e-12, v));
        const F0 = 2 * Math.atanh(clampTanh(
            Math.sqrt((kepler.e - 1) / (kepler.e + 1)) * Math.tan(theta0m / 2)
        ));
        const Fend = 2 * Math.atanh(clampTanh(
            Math.sqrt((kepler.e - 1) / (kepler.e + 1)) * Math.tan(thetaEndm / 2)
        ));
        const deltaM = (kepler.e * Math.sinh(Fend) - Fend) - (kepler.e * Math.sinh(F0) - F0);
        return Math.max(deltaM / n, 0.01);
    }

    // 椭圆轨道（a>0）：真近点角 → 偏近点角 → 平近点角差（正向单圈取模）
    const n = Math.sqrt(gm / (kepler.a * kepler.a * kepler.a));
    const E0 = 2 * Math.atan(Math.sqrt((1 - kepler.e) / (1 + kepler.e)) * Math.tan(theta0m / 2));
    const M0 = E0 - kepler.e * Math.sin(E0);
    const Eend = 2 * Math.atan(Math.sqrt((1 - kepler.e) / (1 + kepler.e)) * Math.tan(thetaEndm / 2));
    const Mend = Eend - kepler.e * Math.sin(Eend);
    let deltaM = Mend - M0;
    if (deltaM < 0) deltaM += 2 * Math.PI;
    return Math.max(deltaM / n, 0.01);
}

// 双曲线轨道到达近拱点（最近接近点，真实角 θ=0 → 运动坐标 θm=0 → F=0 → M=0）的时间
// 口径与 findSOIExitTime 的双曲线分支一致（M = e·sinhF − F，M 随运动坐标单调增）：
//   M0 < 0（未过近点）→ 返回正向时间 -M0/n；
//   M0 >= 0（已过近点）→ 返回 null（最近点已过去，无"下一次"）。
// 供标记层显示双曲线"入近点 Pe"（KSP 语义；getOrbitalInfo 对 a<=0 维持无数据，HUD 不受影响）
function timeToHyperPeriapsis(kepler, gm) {
    if (!kepler || !isFinite(kepler.a) || kepler.a >= 0 || !(gm > 0) || !isFinite(gm)) {
        return null;
    }
    const dir = kepler.dir === undefined ? 1 : kepler.dir;
    const theta0m = dir * kepler.theta;
    const aMag = -kepler.a;
    const n = Math.sqrt(gm / (aMag * aMag * aMag));
    // tanh 钳制仅防 θ 极端接近渐近线时 atanh(±1)=±∞（与 findSOIExitTime 同口径）
    const clampTanh = (v) => Math.max(-(1 - 1e-12), Math.min(1 - 1e-12, v));
    const F0 = 2 * Math.atanh(clampTanh(
        Math.sqrt((kepler.e - 1) / (kepler.e + 1)) * Math.tan(theta0m / 2)
    ));
    const M0 = kepler.e * Math.sinh(F0) - F0;
    if (M0 < 0) {
        return -M0 / n;
    }
    return null;
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
    } else if (a * (1 + e) > body.soiRadius) {
        // 伪椭圆（Ap 超出宿主 SOI）：轨道在到达 Ap 前即切换参考系，语义上按逃逸显示。
        // 0.3.0 修复：近逃逸 a 巨大/抖动时 HUD 不再误标"椭圆轨"（Ap/Pe 标记层同步隐藏 Ap）
        orbitType = 'escape';
    } else if (e < 0.01) {
        orbitType = 'circular';
    } else {
        orbitType = 'elliptical';
    }

    return { apAlt, peAlt, currentAlt, period, tToAp, tToPe, orbitType };
}

export { stateToKepler, keplerPositionAtTime, keplerToState, keplerPositionAtTheta, findSOIIntersection, findSOIExitTime, timeToHyperPeriapsis, getOrbitalDirectionAngles, getOrbitalInfo };
