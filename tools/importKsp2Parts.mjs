// KSP2 官方部件资产导入工具
// 用法:
//   node tools/importKsp2Parts.mjs --list                      列出可导入部件
//   node tools/importKsp2Parts.mjs --part engine_1v_methalox_terrier
//   node tools/importKsp2Parts.mjs --preset core               导入推荐核心部件组
//   node tools/importKsp2Parts.mjs --all --limit 24            批量导入（慎用，体积大）
//
// 只复制 OBJ / MTL / meta.json 与被 MTL 引用的贴图，贴图统一落在
// assets/models/ksp2/_textures/ 共享目录，避免同图重复。
//
// 贴图引用来源有两处（都要扫）：
//   1. 标准 MTL 指令  map_Kd / map_Bump / map_Ke
//   2. KSP2 导出器写的注释  # map _MetallicGlossMap -> xxx_M (Texture2D)

import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const SRC_ROOT = process.env.KSP2_PARTS_SRC || 'C:/Users/魏新润/Desktop/KSP2-rocket-parts-OBJ';
const DST_ROOT = join(repoRoot, 'assets/models/ksp2');
const DST_TEX = join(DST_ROOT, '_textures');

const PRESETS = {
    core: [
        'pod_1v_conical_crew',
        'fueltank_1v_inline_methalox_1x2',
        'engine_1v_methalox_terrier',
        'engine_1v_methalox_reliant',
        'decoupler_1v_inline',
        'stabilizer_1v_reactionwheel'
    ],
    tanks: [
        'fueltank_1v_inline_methalox_1x1',
        'fueltank_1v_inline_methalox_1x2',
        'fueltank_1v_inline_methalox_1x4',
        'fueltank_2v_inline_methalox_1x2'
    ]
};

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) { out[key] = next; i++; }
            else out[key] = true;
        } else out._.push(a);
    }
    return out;
}

function listParts() {
    return readdirSync(SRC_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name)
        .sort();
}

/**
 * 从 MTL 文本提取全部贴图引用（含注释里的 Unity 额外贴图槽）。
 * @returns {string[]} 形如 '../_textures/xxx.png' 的相对路径
 */
function collectTextureRefs(mtlText) {
    const refs = new Set();

    for (const raw of mtlText.split(/\r?\n/)) {
        const line = raw.trim();

        // 1) 标准指令：map_Kd / map_Bump / map_Ke / bump
        const std = line.match(/^(map_\w+|bump)\s+(.+)$/i);
        if (std && !line.startsWith('#')) {
            refs.add(std[2].trim());
            continue;
        }

        // 2) 注释槽位：# map _MetallicGlossMap -> name (Texture2D)
        const cmt = line.match(/^#\s*map\s+_(\w+)\s*->\s*(.+?)\s*\(/);
        if (cmt) {
            refs.add('../_textures/' + cmt[2].trim() + '.png');
        }
    }
    return [...refs];
}

/** 在指定目录里做大小写不敏感的文件查找（KSP2 导出的大小写并不统一） */
function findFileCI(dir, wanted) {
    const exact = join(dir, wanted);
    if (existsSync(exact)) return exact;
    const lower = wanted.toLowerCase();
    for (const name of readdirSync(dir)) {
        if (name.toLowerCase() === lower) return join(dir, name);
    }
    return null;
}

const copiedTex = new Set();
let totalBytes = 0;

function importPart(partName) {
    const src = join(SRC_ROOT, partName);
    if (!existsSync(src)) {
        console.warn(`  ✗ 源目录不存在: ${partName}`);
        return { ok: false };
    }

    const objSrc = findFileCI(src, partName + '.obj');
    const mtlSrc = findFileCI(src, partName + '.mtl');
    if (!objSrc || !mtlSrc) {
        console.warn(`  ✗ 缺少 obj/mtl: ${partName}`);
        return { ok: false };
    }

    const dst = join(DST_ROOT, partName);
    mkdirSync(dst, { recursive: true });

    const objBytes = statSync(objSrc).size;
    copyFileSync(objSrc, join(dst, partName + '.obj'));
    copyFileSync(mtlSrc, join(dst, partName + '.mtl'));
    totalBytes += objBytes;

    const metaSrc = findFileCI(src, 'meta.json');
    if (metaSrc) copyFileSync(metaSrc, join(dst, 'meta.json'));

    const refs = collectTextureRefs(readFileSync(mtlSrc, 'utf8'));
    let texCount = 0;
    let missing = [];

    for (const ref of refs) {
        const wanted = basename(ref.replace(/\\/g, '/'));
        if (copiedTex.has(wanted.toLowerCase())) continue;

        // 引用路径形如 ../_textures/xxx.png，源侧在 SRC_ROOT/_textures
        const srcTexDir = join(SRC_ROOT, '_textures');
        const found = findFileCI(srcTexDir, wanted);
        if (!found) { missing.push(wanted); continue; }

        mkdirSync(DST_TEX, { recursive: true });
        copyFileSync(found, join(DST_TEX, basename(found)));
        copiedTex.add(basename(found).toLowerCase());
        totalBytes += statSync(found).size;
        texCount++;
    }

    if (missing.length) {
        console.warn(`  ⚠ ${partName}: ${missing.length} 张贴图缺失 → ${missing.join(', ')}`);
    }
    console.log(`  ✓ ${partName}  obj ${(objBytes / 1024).toFixed(0)}KB, 新增贴图 ${texCount} 张`);
    return { ok: true, partName };
}

function writeIndex(imported) {
    const indexPath = join(DST_ROOT, 'index.json');
    let index = {};
    if (existsSync(indexPath)) {
        try { index = JSON.parse(readFileSync(indexPath, 'utf8')); } catch { index = {}; }
    }
    for (const p of imported) {
        index[p] = { importedAt: new Date().toISOString() };
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
    console.log(`\n已更新 ${indexPath}（${Object.keys(index).length} 个部件）`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.list) {
        const parts = listParts();
        console.log(`可用部件 ${parts.length} 个：`);
        parts.forEach((p) => console.log('  ' + p));
        return;
    }

    if (!existsSync(SRC_ROOT)) {
        console.error(`源目录不存在: ${SRC_ROOT}`);
        console.error('可用环境变量 KSP2_PARTS_SRC 覆盖源目录。');
        process.exit(1);
    }

    let targets = [];
    if (args.preset) {
        if (!PRESETS[args.preset]) {
            console.error(`未知预设: ${args.preset}（可选: ${Object.keys(PRESETS).join(', ')}）`);
            process.exit(1);
        }
        targets = PRESETS[args.preset];
    } else if (args.part) {
        targets = String(args.part).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (args.all) {
        targets = listParts();
        if (args.limit) targets = targets.slice(0, Number(args.limit));
    } else {
        console.log('用法: node tools/importKsp2Parts.mjs --preset core | --part <id> | --all --limit N | --list');
        return;
    }

    console.log(`导入 ${targets.length} 个部件 → ${DST_ROOT}\n`);
    const imported = [];
    for (const t of targets) {
        const r = importPart(t);
        if (r.ok) imported.push(r.partName);
    }

    writeIndex(imported);
    console.log(`\n合计 ${imported.length} 个部件，体积 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

main();
