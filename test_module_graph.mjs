// 浏览器模块图冒烟导入（node 环境，临时脚本）：DOM/canvas/audio 桩 + 全模块图导入，
// 抓导入期错误（循环依赖 / 导出名拼写 / 顶层 window/document 引用）。
// 用法: node test_module_graph.mjs
globalThis.window = globalThis.window || {};

// —— 最小浏览器桩 ——
const noop = () => {};
const ctxStub = new Proxy({}, {
    get(target, prop) {
        if (prop === 'canvas') return canvasStub;
        return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; }
});
const canvasStub = { width: 1280, height: 720, getContext: () => ctxStub, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
const elStub = () => new Proxy({}, {
    get(target, prop) {
        if (prop === 'style') return {};
        if (prop === 'classList') return { add: noop, remove: noop };
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
globalThis.window.innerWidth = 1280;
globalThis.window.innerHeight = 720;
globalThis.document = {
    documentElement: { style: { setProperty: noop } },
    createElement: () => elStub(),
    body: { appendChild: noop },
    addEventListener: noop,
    removeEventListener: noop,
    querySelectorAll: () => []
};
globalThis.localStorage = { getItem: () => null, setItem: noop };
globalThis.requestAnimationFrame = noop;
globalThis.AudioContext = undefined;
globalThis.showNotification = noop;

const mods = [
    './src/eventBus.js',
    './src/config/strings.js',
    './src/utils/format.js',
    './src/config/maneuverConfig.js',
    './src/config/orbitPointTypes.js',
    './src/physics/physics.js',
    './src/physics/orbitalMechanics.js',
    './src/physics/orbitalPrediction.js',
    './src/physics/maneuverPrediction.js',
    './src/ship/maneuverSystem.js',
    './src/ui/orbitLabels.js',
    './src/renderer.js',
    './src/ui/orbitContextMenu.js',
    './src/ui/maneuverUI.js',
    './src/scenes/flightScene.js',
    './src/audio/audioConfig.js',
    './src/audio/audioCore.js',
    './src/audio/audioDirector.js'
];

let failCount = 0;
for (const m of mods) {
    try {
        await import(m);
        console.log('OK   ' + m);
    } catch (e) {
        failCount++;
        console.log('FAIL ' + m + ' → ' + e.message);
        if (e.stack) console.log(e.stack.split('\n').slice(0, 3).join('\n'));
    }
}
console.log(failCount === 0 ? '\n全部模块导入成功' : `\n${failCount} 个模块导入失败`);
process.exit(failCount > 0 ? 1 : 0);
