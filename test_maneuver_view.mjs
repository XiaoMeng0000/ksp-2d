// 机动视图（V 切换）纯逻辑单测：聚焦候选 / fit 上限 / 可用性 / 相机接管（node 环境）
// 用法: node test_maneuver_view.mjs
globalThis.window = globalThis.window || {};

const { celestialBodies, updateCelestialBodies } = await import('./src/physics/physics.js');
const { getFocusCandidates, computeFitZoom, isManeuverAvailable, apoapsisOf, findStarAncestor, branchChildOfStar } = await import('./src/flightView.js');
const { camera, setZoomLimits, setZoom, getZoomLimits } = await import('./src/camera.js');

updateCelestialBodies(0);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const byName = (n) => celestialBodies.find(b => b.name === n);

const kerbin = byName('Kerbin');
const mun = byName('Mun');
const minmus = byName('Minmus');
const kerbol = byName('Kerbol');

// V1: 恒星解析与分支子天体（数据驱动）
check('V1 findStarAncestor(Kerbin) = Kerbol', findStarAncestor(kerbin) === kerbol);
check('V1 findStarAncestor(Mun) = Kerbol', findStarAncestor(mun) === kerbol);
check('V1 分支子天体: Kerbin→Kerbin', branchChildOfStar(kerbin) === kerbin);
check('V1 分支子天体: Mun→Kerbin', branchChildOfStar(mun) === kerbin);

// V2: 候选规则
const cKerbin = getFocusCandidates(kerbin);
check('V2 Kerbin 候选数 = 2（宿主 + 恒星）', cKerbin.length === 2);
check('V2 候选1 = 宿主自身，fit = 最远卫星（Minmus）轨道远心距',
    cKerbin[0].kind === 'host' && cKerbin[0].body === kerbin
    && Math.abs(cKerbin[0].fitRadius - apoapsisOf(minmus)) < 1);
check('V2 候选2 = 恒星，fit = Kerbin 绕 Kerbol 轨道远心距',
    cKerbin[1].kind === 'star' && cKerbin[1].body === kerbol
    && Math.abs(cKerbin[1].fitRadius - apoapsisOf(kerbin)) < 1);

const cMun = getFocusCandidates(mun);
check('V2 Mun（无卫星）候选只有恒星', cMun.length === 1 && cMun[0].kind === 'star');
check('V2 Mun 的恒星 fit = Kerbin 轨道', Math.abs(cMun[0].fitRadius - apoapsisOf(kerbin)) < 1);

// V3: 可用性
check('V3 Kerbin SOI 可用', isManeuverAvailable(kerbin) === true);
check('V3 Mun SOI 可用', isManeuverAvailable(mun) === true);
check('V3 恒星宿主不可用（无父轨道）', isManeuverAvailable(kerbol) === false);
check('V3 深空（无宿主）不可用', isManeuverAvailable(null) === false);

// V4: fit 上限关系（canvas 1920×1080）
const canvas = { width: 1920, height: 1080 };
const zoomHost = computeFitZoom(cKerbin[0].fitRadius, canvas);   // 聚焦 Kerbin（最远卫星）
const zoomStar = computeFitZoom(cKerbin[1].fitRadius, canvas);   // 聚焦恒星（Kerbin 轨道）
check('V4 聚焦宿主允许更深放大（上限更大）', zoomHost > zoomStar);
check('V4 fit 与半径反比', Math.abs(zoomStar * cKerbin[1].fitRadius - 0.9 * 540) < 1e-6);
check('V4 恒星档上限量级合理（1e-8 级）', zoomStar > 1e-9 && zoomStar < 1e-7);

// V5: 相机缩放上下限（视图档位）
setZoomLimits(1e-12, zoomStar);       // 模拟进入机动视图（恒星档）
check('V5 上限生效（俯冲放大被夹）', Math.abs(setZoom(1e-3) - zoomStar) < 1e-15);
check('V5 下限保留可继续缩小', setZoom(1e-12) === 1e-12);
setZoomLimits(1e-12, 10);             // 模拟退出机动视图
check('V5 退出后放大上限恢复', Math.abs(setZoom(5) - 5) < 1e-12);
check('V5 取回上下限接口', getZoomLimits().max === 10);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
