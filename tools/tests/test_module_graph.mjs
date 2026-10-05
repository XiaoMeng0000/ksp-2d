// 浏览器模块图冒烟导入（node 环境）：DOM/canvas/audio 桩 + 自动遍历 src/ 下全部 ES 模块，
// 抓导入期错误（循环依赖 / 导出名拼写 / 顶层 window/document 引用）。
// 模块清单自动发现，新增配置文件无需改本脚本。
// 用法: node tools/tests/test_module_graph.mjs
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.window = globalThis.window || {};

// —— 最小浏览器桩 ——
const noop = () => {};
const ctxStub = new Proxy({}, {
    get(target, prop) {
        if (prop === 'canvas') return canvasStub;
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: noop });
        return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; }
});
const canvasStub = {
    width: 1280, height: 720, style: {},
    getContext: () => ctxStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};
const elStub = () => new Proxy({}, {
    get(target, prop) {
        if (prop === 'style') return {};
        if (prop === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
        if (prop === 'dataset') return {};
        if (prop === 'addEventListener') return noop;
        if (prop === 'appendChild' || prop === 'removeChild') return noop;
        if (prop === 'querySelector' || prop === 'querySelectorAll') return () => elStub();
        if (prop === 'setPointerCapture' || prop === 'releasePointerCapture') return noop;
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
globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
globalThis.document = {
    documentElement: { style: { setProperty: noop } },
    createElement: (tag) => (tag === 'canvas' ? canvasStub : elStub()),
    createElementNS: () => elStub(),
    body: { appendChild: noop },
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => elStub(),
    querySelector: () => elStub(),
    querySelectorAll: () => [],
    fonts: { add: noop, ready: Promise.resolve() }
};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.requestAnimationFrame = noop;
globalThis.cancelAnimationFrame = noop;
globalThis.AudioContext = undefined;
globalThis.showNotification = noop;
globalThis.Image = class { constructor() { this.style = {}; } addEventListener() {} };
globalThis.Path2D = class { constructor() {} };
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctxStub; } };

// —— 自动收集 src/ 下全部模块（相对本文件解析，从任意工作目录运行结果一致）——
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const srcRoot = join(repoRoot, 'src');

function collectModules(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...collectModules(full));
        else if (entry.name.endsWith('.js')) found.push(full);
    }
    return found;
}

const mods = collectModules(srcRoot).sort();

let failCount = 0;
for (const abs of mods) {
    const rel = abs.slice(repoRoot.length).split(sep).join('/');
    try {
        await import(pathToFileURL(abs).href);
        console.log('OK   ' + rel);
    } catch (e) {
        failCount++;
        console.log('FAIL ' + rel + ' → ' + e.message);
        if (e.stack) console.log(e.stack.split('\n').slice(0, 3).join('\n'));
    }
}
console.log(failCount === 0
    ? `\n全部 ${mods.length} 个模块导入成功`
    : `\n共 ${mods.length} 个模块，${failCount} 个导入失败`);
process.exit(failCount > 0 ? 1 : 0);
