// 尝鲜版发布产物组装（零依赖，仅用 Node 内置模块）
//
// 为什么需要它：仓库里除游戏本体外还有文档、开发脚本、测试、截图等开发产物；
// GitHub Pages 直接整仓上传会把它们一起发出去（体积与暴露面都没必要）。
// 本脚本按白名单把「网页尝鲜版真正需要的东西」拷进 dist/，供 Pages 工作流上传。
//
// 用法：node tools/buildLiteDist.mjs
// 输出：dist/（每次运行前清空）
//
// 约定：
//   · 白名单之外的一切（docs/、tools/、.github/、Screenshots/、README 等）都不进产物；
//   · 不做任何编译 / 打包 / 压缩 —— 项目铁律「零构建」，这里只做文件搬运与体积报告；
//   · 新增运行时目录时，只需在 WHITELIST 里加一行。

import { rmSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const outDir = join(repoRoot, 'dist');

// 运行时白名单（相对仓库根）
const WHITELIST = [
    'index.html',
    'favicon.png',
    'main.js',
    'src',
    'assets'
];

// 产物内必须存在的入口文件（缺失即视为构建失败）
const REQUIRED = ['index.html', 'main.js', 'src/gameState.js', 'assets'];

// 单文件体积告警阈值（MB）
const LARGE_FILE_MB = 5;

function rmDist() {
    if (existsSync(outDir)) {
        rmSync(outDir, { recursive: true, force: true });
    }
    mkdirSync(outDir, { recursive: true });
}

function copyWhitelist() {
    const missing = [];
    for (const entry of WHITELIST) {
        const from = join(repoRoot, entry);
        if (!existsSync(from)) {
            missing.push(entry);
            continue;
        }
        cpSync(from, join(outDir, entry), { recursive: true });
    }
    return missing;
}

// 递归统计产物体积与文件数，并按顶层目录分组（便于一眼看出体积构成）
function measure(dir) {
    let bytes = 0;
    let count = 0;
    const byTop = new Map();
    const largeFiles = [];

    const walk = (current) => {
        for (const name of readdirSync(current)) {
            const full = join(current, name);
            const st = statSync(full);
            if (st.isDirectory()) {
                walk(full);
                continue;
            }
            bytes += st.size;
            count++;
            const rel = relative(outDir, full).split(sep).join('/');
            const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) + '/' : '(根)';
            const acc = byTop.get(top) || { bytes: 0, count: 0 };
            acc.bytes += st.size;
            acc.count += 1;
            byTop.set(top, acc);
            if (st.size / 1024 / 1024 >= LARGE_FILE_MB) {
                largeFiles.push({ rel, mb: st.size / 1024 / 1024 });
            }
        }
    };
    walk(dir);
    return { bytes, count, byTop, largeFiles };
}

function fmtMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// ---- 主流程 ----
console.log('[buildLiteDist] 仓库根: ' + repoRoot);
rmDist();
console.log('[buildLiteDist] 已清空 dist/');

const missing = copyWhitelist();
if (missing.length > 0) {
    console.error('[buildLiteDist] ✕ 白名单条目缺失: ' + missing.join(', '));
    process.exit(1);
}
console.log('[buildLiteDist] 已拷入白名单: ' + WHITELIST.join(', '));

const missingRequired = REQUIRED.filter((entry) => !existsSync(join(outDir, entry)));
if (missingRequired.length > 0) {
    console.error('[buildLiteDist] ✕ 产物缺少入口: ' + missingRequired.join(', '));
    process.exit(1);
}

const { bytes, count, byTop, largeFiles } = measure(outDir);

console.log('[buildLiteDist] 产物构成:');
for (const [top, acc] of [...byTop.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log('  ' + top.padEnd(12) + acc.count.toString().padStart(4) + ' 个文件   ' + fmtMB(acc.bytes));
}
console.log('[buildLiteDist] 合计: ' + count + ' 个文件, ' + fmtMB(bytes) + '（压缩后传输量约为其 1/3）');

if (largeFiles.length > 0) {
    console.warn('[buildLiteDist] ⚠ 单文件超过 ' + LARGE_FILE_MB + 'MB:');
    for (const f of largeFiles) {
        console.warn('    ' + f.rel + '  ' + f.mb.toFixed(2) + ' MB');
    }
}
