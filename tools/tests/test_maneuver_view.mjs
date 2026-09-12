// 机动视图（V 切换）纯逻辑单测：聚焦目标（当前星系全部天体）/ fit 口径 / 可用性 / 缩放夹取
// 用法: node tools/tests/test_maneuver_view.mjs
globalThis.window = globalThis.window || {};

const { celestialBodies, updateCelestialBodies, getAbsolutePosition } = await import('../../src/physics/physics.js');
const {
    getFocusTargets, computeBodyFitRadius, computeFitZoom, isManeuverAvailable,
    apoapsisOf, findStarAncestor, branchChildOfStar, resolveCurrentStar
} = await import('../../src/flightView.js');
const { setZoomLimits, setZoom, getZoomLimits } = await import('../../src/camera.js');

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

// V7: 相机平滑过渡动画（0.2.5）
{
    const { camera, animateCameraTo, updateCameraAnimation, isCameraAnimating, cancelCameraAnimation, setZoomLimits } =
        await import('../../src/camera.js');
    setZoomLimits(1e-12, 10);

    // 动态目标（模拟公转天体：位置随时间移动）
    camera.x = 0; camera.y = 0; camera.zoom = 1e-4;
    let targetX = 1000;
    animateCameraTo(() => ({ x: targetX, y: 2000, zoom: 1e-8 }), 700);
    check('V7 动画已启动', isCameraAnimating() === true);

    const t0 = performance.now();
    // 推进到 50%：位置应在起终点之间（缓动中点 = 几何中点）
    updateCameraAnimation(t0 + 350);
    check('V7 50% 位置居中（缓动对称）', Math.abs(camera.x - 500) < 60 && Math.abs(camera.y - 1000) < 60);
    // 缩放按 log 空间插值：50% 时应为几何平均 √(1e-4×1e-8) = 1e-6
    check('V7 50% 缩放 = 几何平均 1e-6', Math.abs(camera.zoom - 1e-6) / 1e-6 < 0.05);

    // 目标移动后再推进到 100%：应落到**最新**目标位置（跟随运动天体）
    targetX = 1500;
    updateCameraAnimation(t0 + 700);
    check('V7 结束落在最新目标位置', Math.abs(camera.x - 1500) < 1e-6 && Math.abs(camera.y - 2000) < 1e-6);
    check('V7 结束后缩放到位', Math.abs(camera.zoom - 1e-8) / 1e-8 < 1e-6);
    check('V7 动画自动结束', isCameraAnimating() === false);

    // 取消动画
    animateCameraTo(() => ({ x: 9, y: 9, zoom: 1e-6 }), 500);
    cancelCameraAnimation();
    check('V7 可取消（滚轮接管）', isCameraAnimating() === false);

    // 动画期间 setZoomLimits 不夹取当前值（避免切换瞬间硬跳）
    camera.zoom = 1e-4;
    animateCameraTo(() => ({ x: 0, y: 0, zoom: 1e-8 }), 700);
    setZoomLimits(1e-12, 1e-9);
    check('V7 动画期间不夹取当前缩放（防硬跳）', camera.zoom === 1e-4);
    updateCameraAnimation(performance.now() + 900);
    check('V7 动画结束后按新上限夹取', camera.zoom <= 1e-9 + 1e-15);
}

// V8: 平滑过渡不硬跳（0.2.5 修复"先突然缩小再动画"）
{
    const { camera, isCameraAnimating, updateCameraAnimation, setZoomLimits: szl } = await import('../../src/camera.js');
    const { flightView } = await import('../../src/flightView.js');
    const { VIEW_CONFIG } = await import('../../src/config/viewConfig.js');
    szl(1e-12, 10);
    camera.zoom = 2e-4;                       // 近景档
    camera.x = 12345; camera.y = -6789;
    const before = { zoom: camera.zoom, x: camera.x, y: camera.y };
    const ok = flightView.enterManeuver(ship, canvas);
    check('V8 进入机动视图成功', ok === true);
    check('V8 动画已启动', isCameraAnimating() === true);
    // 关键：进入瞬间缩放/位置**不得**被硬跳到目标档（修复前 setZoomLimits 会立刻夹取）
    check('V8 进入瞬间缩放未硬跳', Math.abs(camera.zoom - before.zoom) < 1e-12);
    check('V8 进入瞬间位置未硬跳', Math.abs(camera.x - before.x) < 1e-6);
    // 推进到结束：应落到当前聚焦天体（恒星）位置与其上限
    updateCameraAnimation(performance.now() + VIEW_CONFIG.transitionMs + 50);
    const star = celestialBodies.find(b => b.type === 'star');
    check('V8 结束落到聚焦天体位置',
        Math.abs(camera.x - star.position.x) < 1 && Math.abs(camera.y - star.position.y) < 1);
    const capStar = computeFitZoom(targets[0].fitRadius, canvas);
    check('V8 结束缩放 = 该天体上限', Math.abs(camera.zoom - capStar) / capStar < 1e-6);
    // 退出：同样不得硬跳
    camera.zoom = 1e-7;
    const zBeforeExit = camera.zoom;
    flightView.exitManeuver(ship, canvas);
    check('V8 退出瞬间缩放未硬跳', Math.abs(camera.zoom - zBeforeExit) < 1e-18);
    check('V8 退出动画已启动', isCameraAnimating() === true);
    updateCameraAnimation(performance.now() + VIEW_CONFIG.transitionMs + 50);
    check('V8 过渡时长已加长（≥1000ms）', VIEW_CONFIG.transitionMs >= 1000);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
