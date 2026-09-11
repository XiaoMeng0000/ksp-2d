// 机动节点面板三行状态纯函数单测（node 环境，最小 DOM 桩）
// 用法: node test_maneuver_panel_state.mjs
globalThis.window = globalThis.window || {};

const noop = () => {};
const elStub = () => new Proxy({}, {
    get(target, prop) {
        if (prop === 'style') return {};
        if (prop === 'classList') return { add: noop, remove: noop, toggle: noop };
        if (prop === 'addEventListener') return noop;
        if (prop === 'appendChild') return noop;
        if (prop === 'querySelector' || prop === 'querySelectorAll') return () => elStub();
        if (prop === 'setPointerCapture') return noop;
        if (prop === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 0, height: 0 });
        return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; }
});
globalThis.window.addEventListener = noop;
globalThis.window.removeEventListener = noop;
globalThis.window.devicePixelRatio = 1;
globalThis.document = {
    documentElement: { style: { setProperty: noop } },
    createElement: () => elStub(),
    body: { appendChild: noop },
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => null,
    querySelectorAll: () => []
};
globalThis.localStorage = { getItem: () => null, setItem: noop };
globalThis.requestAnimationFrame = noop;

const { computeManeuverRowStates } = await import('./src/ui/maneuverUI.js');

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// 基线：节点时刻未到、计划 Δv 在飞船能力内
const s1 = computeManeuverRowStates({ planned: 948, shipDv: 1500, now: 0, nodeTime: 100 });
check('行1 够 → ✓白', s1[0].check === '✓' && s1[0].active === true);
check('行2 节点前 → ✓白', s1[1].check === '✓' && s1[1].active === true);
check('行3 节点前 → ✗灰', s1[2].check === '✗' && s1[2].active === false);

// 计划 Δv 超出飞船当前能力
const s2 = computeManeuverRowStates({ planned: 1600, shipDv: 1500, now: 0, nodeTime: 100 });
check('行1 不够 → ✗灰', s2[0].check === '✗' && s2[0].active === false);

// 0/0（未设 Δv）→ 视为够
const s3 = computeManeuverRowStates({ planned: 0, shipDv: 1500, now: 0, nodeTime: 100 });
check('行1 0/0 → ✓白', s3[0].check === '✓' && s3[0].active === true);

// 节点时刻已到（燃烧窗口内）
const s4 = computeManeuverRowStates({ planned: 948, shipDv: 1500, now: 100, nodeTime: 100 });
check('行2 到达后 → ✓灰（对号常驻）', s4[1].check === '✓' && s4[1].active === false);
check('行3 到达后 → ✓白', s4[2].check === '✓' && s4[2].active === true);

// 燃烧结束之后（第三项保持 ✓白，不回灰）
const s5 = computeManeuverRowStates({ planned: 948, shipDv: 1500, now: 5000, nodeTime: 100 });
check('行3 燃烧结束后仍 ✓白（保持）', s5[2].check === '✓' && s5[2].active === true);
check('行2 燃烧结束后仍 ✓灰', s5[1].check === '✓' && s5[1].active === false);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
