// 机动视图（V 切换）纯逻辑单测：聚焦目标（当前星系全部天体）/ fit 口径 / 可用性 / 缩放夹取
// 用法: node test_maneuver_view.mjs
globalThis.window = globalThis.window || {};

const { celestialBodies, updateCelestialBodies, getAbsolutePosition } = await import('./src/physics/physics.js');
const {
    getFocusTargets, computeBodyFitRadius, computeFitZoom, isManeuverAvailable,
    apoapsisOf, findStarAncestor, branchChildOfStar, resolveCurrentStar
} = await import('./src/flightView.js');
const { setZoomLimits, setZoom, getZoomLimits } = await import('./src/camera.js');

updateCelestialBodies(0);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const byName = (n) => celestialBodies.find(b => b.name === n);

const kerbin = byName('Kerbin');
const mun = byName('Mun');
const minmus = byName('Minmus');
const kerbol = byName('Kerbol');

// 伪飞船（宿主 Kerbin）
const ship = {
    pos: { x: kerbin.radius + 100000, y: 0 },
    vel: { x: 0, y: 2200 },
    currentSOI: 'Kerbin'
};

// V1: 恒星解析与分支
check('V1 findStarAncestor(Kerbin) = Kerbol', findStarAncestor(kerbin) === kerbol);
check('V1 findStarAncestor(Mun) = Kerbol', findStarAncestor(mun) === kerbol);
check('V1 分支子天体: Kerbin→Kerbin', branchChildOfStar(kerbin) === kerbin);
check('V1 分支子天体: Mun→Kerbin', branchChildOfStar(mun) === kerbin);
check('V1 resolveCurrentStar(ship) = Kerbol', resolveCurrentStar(ship) === kerbol);

// V2: 聚焦目标 = 当前星系全部天体（层级有序）
const targets = getFocusTargets(kerbin);
const sysCount = celestialBodies.filter(b => findStarAncestor(b) === kerbol).length;
check('V2 目标数 = 当前星系全部天体', targets.length === sysCount && sysCount > 10);
check('V2 首项 = 恒星(depth 0)', targets[0].body === kerbol && targets[0].depth === 0 && targets[0].kind === 'star');
const munT = targets.find(t => t.body === mun);
const kerbinT = targets.find(t => t.body === kerbin);
check('V2 Kerbin depth=1 / Mun depth=2（层级缩进依据）', kerbinT.depth === 1 && munT.depth === 2);
check('V2 卫星排在所属行星之后（Mun 紧随 Kerbin）',
    targets.indexOf(munT) > targets.indexOf(kerbinT));

// V3: fit 口径（沿用现有规则并推广）
check('V3 Kerbin → 最远卫星（Minmus）轨道',
    Math.abs(kerbinT.fitRadius - apoapsisOf(minmus)) < 1);
check('V3 Mun → 自身绕 Kerbin 的轨道',
    Math.abs(munT.fitRadius - apoapsisOf(mun)) < 1);
check('V3 Kerbol → 玩家分支那一环（Kerbin 轨道）',
    Math.abs(targets[0].fitRadius - apoapsisOf(kerbin)) < 1);
check('V3 Minmus → 自身绕 Kerbin 的轨道',
    Math.abs(computeBodyFitRadius(minmus, kerbin) - apoapsisOf(minmus)) < 1);
// 宿主为 Mun 时，恒星的 fit 仍取玩家分支（Kerbin 轨道）
check('V3 宿主 Mun 时 Kerbol fit 仍 = Kerbin 轨道',
    Math.abs(computeBodyFitRadius(kerbol, mun) - apoapsisOf(kerbin)) < 1);

// V4: fit 与缩放上限关系（canvas 1920×1080）
const canvas = { width: 1920, height: 1080 };
const zoomKerbin = computeFitZoom(kerbinT.fitRadius, canvas);
const zoomStar = computeFitZoom(targets[0].fitRadius, canvas);
check('V4 聚焦小天体系统允许更深放大（上限更大）', zoomKerbin > zoomStar);
check('V4 fit 与半径反比', Math.abs(zoomStar * targets[0].fitRadius - 0.9 * 540) < 1e-6);

// V5: 可用性（始终可用，仅要求有活动飞船）
check('V5 有飞船 → 可用（即使宿主是恒星/深空）', isManeuverAvailable(ship) === true);
check('V5 无飞船 → 不可用', isManeuverAvailable(null) === false);

// V6: 相机缩放上下限（视图档位）
setZoomLimits(1e-12, zoomStar);
check('V6 上限生效（放大被夹）', Math.abs(setZoom(1e-3) - zoomStar) < 1e-15);
check('V6 下限保留可继续缩小', setZoom(1e-12) === 1e-12);
setZoomLimits(1e-12, 10);
check('V6 退出后放大上限恢复', Math.abs(setZoom(5) - 5) < 1e-12);
check('V6 取回上下限接口', getZoomLimits().max === 10);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
