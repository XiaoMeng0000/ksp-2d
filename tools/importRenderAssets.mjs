"use strict";

// 卡B · **渲染资产导入器**（游戏侧消费者入口）。
//
// 用途：把实验室导出的**资产包**（`<lab>/data/out/asset-bundle/<bodyId>/manifest.json`
// + 各 family 的文件）按 **family 泛化**导入游戏，并**重新生成**配置。
//
// 用法：
//   node tools/importRenderAssets.mjs --lab-repo D:\ksp-renderlab --body kerbin
//   node tools/importRenderAssets.mjs --lab-repo D:\ksp-renderlab --body all
//   node tools/importRenderAssets.mjs --lab-repo D:\ksp-renderlab --body all --dry-run
//   node tools/importRenderAssets.mjs --verify          # 只读：按配置检查资产是否齐备（数据驱动）
//
// ★ 前置依赖（**显式**）★
//   资产包里的图片（`albedo.png` 等）**不入库**（实验室 .gitignore 按设计排除）。
//   若找不到资产包 ⇒ 本工具**直接报错并提示**：
//       "先在实验室跑 `node tools/assetBundle.mjs export`"
//   **绝不静默跳过**。
//
// ★ 为什么不动 `textureConfig.js` ★
//   该文件自己的分层约定写明：「天体表面贴图 → `src/config/systems/*.js` 的 `texture`，
//   **本文件不再登记**」。所以渲染资产的**单一真源**是本工具生成的
//   `src/config/assets/renderAssets.js`；`textureConfig.js` 保持不动（**这条路 = 不走它**）。
//
// ★ 外接球语义 ★
//   `screenRadiusPx` **一律按外接球半径**解释。球体 `circumscribedRatio = 1`；
//   不规则体取 `src/config/world/bodyRenderShape.js` 里的 `circumscribedRatio`，
//   换算：`physScreenR = screenRadiusPx × ratio`（见本文件生成的配置里的 `radiusSemantics`）。
//
// 幂等：`--no-timestamp` ⇒ 生成文件**完全**字节一致；默认带 `generatedAt`（除它之外无 diff）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(HERE, '..');
const OUT_CONFIG = path.join(GAME_ROOT, 'src', 'config', 'assets', 'renderAssets.js');
const SHAPE_FILE = path.join(GAME_ROOT, 'src', 'config', 'world', 'bodyRenderShape.js');
const ASSET_ROOT = path.join(GAME_ROOT, 'assets', 'images', 'celestial');

/** 天体 → 所属恒星系（资产目录按星系分层：assets/images/celestial/<systemId>/…） */
const BODY_SYSTEM = {
    kerbin: 'kerbolar',
    mun: 'kerbolar',
    jool: 'kerbolar',
};

function sha256File(file) {
    return 'sha256:' + createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 读 PNG 头（零依赖）——**校验用实测宽高，不信 manifest** */
function readPngSize(file) {
    const b = fs.readFileSync(file);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (b[i] !== sig[i]) {
            throw new Error('不是 PNG（签名不符）：' + file);
        }
    }
    if (b.toString('ascii', 12, 16) !== 'IHDR') {
        throw new Error('PNG 首个 chunk 不是 IHDR：' + file);
    }
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

function parseArgs(argv) {
    const out = { bodies: [], dryRun: false, noTimestamp: false, verify: false, labRepo: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--lab-repo') {
            out.labRepo = argv[i + 1];
            i += 1;
        } else if (a === '--body') {
            out.bodies.push(argv[i + 1]);
            i += 1;
        } else if (a === '--dry-run') {
            out.dryRun = true;
        } else if (a === '--no-timestamp') {
            out.noTimestamp = true;
        } else if (a === '--verify') {
            out.verify = true;
        }
    }
    return out;
}

/* ============================ 读取资产包 ============================ */

function loadBundle(labRepo, bodyId) {
    const dir = path.join(labRepo, 'data', 'out', 'asset-bundle', bodyId);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        // ★ 显式缺失（卡B 要点 2）：不静默跳过
        throw new Error('找不到资产包：' + manifestPath + '\n'
            + '  ⇒ 资产不入库（按设计被实验室 .gitignore 排除）。\n'
            + '  ⇒ **请先在实验室跑** `node tools/assetBundle.mjs export` 生成资产包，再重跑本工具。');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 1) {
        throw new Error('manifest schemaVersion=' + manifest.schemaVersion + '（本工具只认 1）');
    }
    return { dir, manifest };
}

/** 校验并（可选）复制一个 image family */
function importImageFamily(labDir, bodyId, famName, fam, opts) {
    const srcPath = path.join(labDir, fam.file);
    if (!fs.existsSync(srcPath)) {
        throw new Error(bodyId + '.' + famName + '：资产包缺文件 ' + fam.file
            + '（manifest 说有、实际没有）⇒ 拒绝导入');
    }
    const size = readPngSize(srcPath);
    // ① 2:1（实测，不信 manifest）
    if (size.w !== size.h * 2) {
        throw new Error(bodyId + '.' + famName + '：实测 ' + size.w + '×' + size.h
            + ' 不是 2:1 ⇒ **拒收**（等距圆柱投影要求 2:1）');
    }
    // ② sha256 与源字节一致
    const actualSha = sha256File(srcPath);
    if (actualSha !== fam.sha256) {
        throw new Error(bodyId + '.' + famName + '：sha256 不符（manifest ' + fam.sha256
            + ' vs 实测 ' + actualSha + '）⇒ 源已变，请重新导出资产包');
    }
    // ③ tier 合法（当前口径 = 实际像素尺寸串）
    const actualTier = size.w + '×' + size.h;
    if (fam.tier !== actualTier) {
        throw new Error(bodyId + '.' + famName + '：tier 不符（' + fam.tier + ' vs 实测 ' + actualTier + '）');
    }
    const systemId = BODY_SYSTEM[bodyId];
    if (!systemId) {
        throw new Error('未知天体 ' + bodyId + ' 的所属星系（请在 BODY_SYSTEM 里登记）');
    }
    const relPath = 'assets/images/celestial/' + systemId + '/render/' + bodyId + '.' + famName + '.png';
    const destPath = path.join(GAME_ROOT, relPath.replace(/\//g, path.sep));
    if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);           // ★ 字节级原样复制，不重编码
        const copiedSha = sha256File(destPath);
        if (copiedSha !== actualSha) {
            throw new Error(bodyId + '.' + famName + '：复制后字节不一致 ⇒ 中止');
        }
    }
    return {
        entry: {
            path: relPath,
            w: size.w,
            h: size.h,
            sha256: actualSha,
            tier: actualTier,
        },
        destPath, relPath,
    };
}

/* ============================ 生成配置 ============================ */

/** 生成 `src/config/assets/renderAssets.js` 的文本（按 family 泛化） */
function renderConfig(state, noTimestamp) {
    const L = [];
    L.push('\'use strict\';');
    L.push('');
    L.push('// ★★★ 本文件由 tools/importRenderAssets.mjs 生成 —— 禁止手改 ★★★');
    L.push('//');
    L.push('// 渲染资产配置（游戏侧消费端）。**按 family 泛化**：');
    L.push('//   · `families` 描述**每一类渲染资产**（kind / projection / ratio / suffix / tier）；');
    L.push('//   · `bodies[bodyId].families[famName]` 挂该类资产的**实际条目** —— 不写死 albedo，');
    L.push('//     将来加 biome / height / detail 只是多一条 family，**结构不用改**。');
    L.push('//');
    L.push('// ★ 半径语义：`screenRadiusPx` **一律按「外接球半径」解释** ★');
    L.push('//   球体 `circumscribedRatio = 1`；不规则体取 `src/config/world/bodyRenderShape.js`');
    L.push('//   里的 `circumscribedRatio`。换算：`physScreenR = screenRadiusPx × ratio`。');
    L.push('//   （不规则体没有单一屏幕半径 ⇒ 取外接球的上界才好做池准入与三段式归属。）');
    L.push('//');
    L.push('// ★ 形状参数**不在这里**：形状与资产分离，见 `src/config/world/bodyRenderShape.js`。');
    L.push('//   本文件**不得**出现 harmonics / segments / rings 等几何参数。');
    L.push('');
    L.push('/**');
    L.push(' * family 声明表（每类资产的**元信息**，与具体天体无关）。');
    L.push(' * 加一类资产 ⇒ 这里多一条 + `bodies` 里多一条，**不改任何既有结构**。');
    L.push(' */');
    L.push('export const ASSET_FAMILIES = ' + JSON.stringify(state.families, null, 4) + ';');
    L.push('');
    L.push('/**');
    L.push(' * 按天体挂资产条目。');
    L.push(' * image family 条目：`{ path, w, h, sha256, tier }`');
    L.push(' * data  family 条目：`{ params, provenance }`');
    L.push(' */');
    L.push('export const RENDER_ASSETS = ' + JSON.stringify(state.bodies, null, 4) + ';');
    L.push('');
    L.push('/**');
    L.push(' * **缺资产**清单（显式）：每条含 bodyId + family + reason。');
    L.push(' * 消费方必须据此把该天体**排除出 WebGL 渲染**（不得静默、不得拿 null 冒充"有"）。');
    L.push(' */');
    L.push('export const RENDER_ASSETS_MISSING = ' + JSON.stringify(state.missing, null, 4) + ';');
    L.push('');
    L.push('/** 已见但**不进本文件**的 family（data family 归形状表，资产/形状分离） */');
    L.push('export const RENDER_ASSETS_SKIPPED = ' + JSON.stringify(state.skippedFamilies, null, 4) + ';');
    L.push('');
    L.push('/** 外接球半径语义（供消费方读取，避免只写在注释里） */');
    L.push('export const RADIUS_SEMANTICS = ' + JSON.stringify(state.radiusSemantics, null, 4) + ';');
    L.push('');
    if (!noTimestamp) {
        L.push('/** 生成时间（`--no-timestamp` 时不含本字段，便于下游 diff） */');
        L.push('export const GENERATED_AT = ' + JSON.stringify(state.generatedAt) + ';');
        L.push('');
    }
    return L.join('\n');
}

/* ============================ 主流程 ============================ */

function cmdImport(args) {
    if (!args.labRepo) {
        throw new Error('必须给 `--lab-repo <实验室仓库路径>`');
    }
    if (!args.bodies.length) {
        throw new Error('必须给 `--body <bodyId|all>`');
    }
    const bodies = args.bodies[0] === 'all' ? Object.keys(BODY_SYSTEM) : args.bodies;
    const state = {
        families: {},
        bodies: {},
        missing: [],
        skippedFamilies: [],
        radiusSemantics: {
            note: '`screenRadiusPx` 一律按**外接球半径**解释',
            sphere: 'circumscribedRatio = 1（见 bodyRenderShape.js）',
            irregular: '取 bodyRenderShape.js 的 circumscribedRatio（= 1 + Σ|harmonics[].amp|）',
            conversion: 'physScreenR = screenRadiusPx × circumscribedRatio',
        },
        generatedAt: new Date().toISOString(),
    };
    const plans = [];
    bodies.forEach((bodyId) => {
        const { dir, manifest } = loadBundle(args.labRepo, bodyId);
        state.bodies[bodyId] = { families: {} };
        Object.keys(manifest.families).forEach((famName) => {
            const fam = manifest.families[famName];
            if (fam.kind === 'image') {
                if (!state.families[famName]) {
                    state.families[famName] = {
                        kind: 'image',
                        projection: fam.projection,
                        ratio: fam.ratio,
                        suffix: '.' + famName + '.png',
                        tier: 'w×h（实际像素，见条目）',
                    };
                }
                const r = importImageFamily(dir, bodyId, famName, fam, args);
                state.bodies[bodyId].families[famName] = r.entry;
                plans.push(r.relPath + (args.dryRun ? '（dry-run 未写）' : ''));
            } else {
                // ★ 资产/形状分离：data family（shape 等**几何参数**）**不导入本配置** ——
                //    形状的唯一真源是手写的 src/config/world/bodyRenderShape.js。
                //    这里只**记录**"已见但由形状表接管"，绝不把 harmonics 写进本文件。
                state.skippedFamilies.push({
                    bodyId,
                    family: famName,
                    reason: 'data family 由 src/config/world/bodyRenderShape.js 接管（资产/形状分离）',
                });
            }
        });
        (manifest.missing || []).forEach((m) => {
            state.missing.push({ bodyId, family: m.family, reason: m.reason });
        });
    });

    const text = renderConfig(state, args.noTimestamp);
    if (args.dryRun) {
        console.log('[dry-run] 将写入：');
        plans.forEach((p) => console.log('  资产 ' + p));
        console.log('  配置 ' + path.relative(GAME_ROOT, OUT_CONFIG).replace(/\\/g, '/')
            + '（' + Buffer.byteLength(text, 'utf8') + ' 字节）');
        console.log('[dry-run] 未写任何文件');
        return 0;
    }
    fs.mkdirSync(path.dirname(OUT_CONFIG), { recursive: true });
    fs.writeFileSync(OUT_CONFIG, text, 'utf8');
    console.log('[import] 资产：');
    plans.forEach((p) => console.log('  ' + p));
    console.log('[import] 配置 ' + path.relative(GAME_ROOT, OUT_CONFIG).replace(/\\/g, '/')
        + '（' + Buffer.byteLength(text, 'utf8') + ' 字节）');
    if (state.missing.length) {
        console.log('[import] **缺资产（显式）**：');
        state.missing.forEach((m) => console.log('  ' + m.bodyId + '.' + m.family + ' — ' + m.reason));
    }
    return 0;
}

/* ============================ 只读校验（数据驱动负对照用） ============================ */

/**
 * 按**配置**（renderAssets.js + bodyRenderShape.js）检查资产齐备性。
 * ★ 这就是"只改配置不改代码"的那个消费方：往配置里加一条假 body ⇒ 这里必然报"资产缺失"；
 *   删一条真条目 ⇒ 同样走显式缺失分支。**不渲染、不改任何文件**。
 */
function cmdVerify() {
    // ⚠️ 不用动态 import：仓库没有 package.json，`.js` 会被当 CommonJS ⇒ 直接求值文本更稳。
    const assetsSrc = fs.readFileSync(OUT_CONFIG, 'utf8');
    const shapeSrc = fs.readFileSync(SHAPE_FILE, 'utf8');
    const assetsMod = evalModule(assetsSrc);
    const shapeMod = evalModule(shapeSrc);
    const rows = [];
    Object.keys(assetsMod.RENDER_ASSETS).forEach((bodyId) => {
        const fams = assetsMod.RENDER_ASSETS[bodyId].families || {};
        const table = shapeMod.BODY_RENDER_SHAPE || {};
        const shape = table[bodyId] || shapeMod.DEFAULT_RENDER_SHAPE
            || { kind: 'sphere', circumscribedRatio: 1 };
        const famNames = Object.keys(fams);
        if (!famNames.length) {
            rows.push({
                bodyId, status: 'missing-all-families', webglEligible: false,
                missing: [{ family: '* ', reason: '配置里该天体没有任何 family' }],
            });
            return;
        }
        const missingFams = [];
        famNames.forEach((f) => {
            const e = fams[f];
            if (!e || !e.path) {
                missingFams.push({ family: f, reason: '条目无 path' });
                return;
            }
            const abs = path.join(GAME_ROOT, e.path.replace(/\//g, path.sep));
            if (!fs.existsSync(abs)) {
                missingFams.push({ family: f, reason: '文件不存在：' + e.path });
                return;
            }
            const actual = sha256File(abs);
            if (e.sha256 && actual !== e.sha256) {
                missingFams.push({ family: f, reason: 'sha256 不符（文件被改过）' });
            }
        });
        rows.push({
            bodyId,
            families: famNames,
            shapeKind: shape.kind,
            circumscribedRatio: shape.circumscribedRatio === undefined ? 1 : shape.circumscribedRatio,
            status: missingFams.length ? 'missing-asset' : 'ok',
            missing: missingFams,
            webglEligible: missingFams.length === 0,
            screenRadiusNote: 'physScreenR = screenRadiusPx × '
                + (shape.circumscribedRatio === undefined ? 1 : shape.circumscribedRatio),
        });
    });
    rows.forEach((r) => {
        if (r.status === 'ok') {
            console.log('[verify] ✔ ' + r.bodyId.padEnd(8) + ' families=[' + r.families.join(',') + ']'
                + ' shape=' + r.shapeKind + ' ratio=' + r.circumscribedRatio + ' → ' + r.screenRadiusNote);
        } else {
            console.log('[verify] ★ ' + r.bodyId.padEnd(8) + ' status=' + r.status
                + ' **不进 WebGL** —— '
                + (r.missing || []).map((m) => m.family + ':' + m.reason).join(' | '));
        }
    });
    const bad = rows.filter((r) => r.status !== 'ok');
    console.log('[verify] 合计 ' + rows.length + ' 天体：ok=' + (rows.length - bad.length) + '，缺资产=' + bad.length);
    return 0;
}

/** 极简 ESM 求值：只支持本项目的 `export const` 形式（够用即可） */
function evalModule(src) {
    const body = src.replace(/^['"]use strict['"];?\s*/m, '');
    // ⚠️ 生成的配置与形状表都用 `export const` / `export function` ⇒ 两种前缀都要剥
    const src2 = body.replace(/export const /g, 'const ').replace(/export function /g, 'function ');
    const names = [].concat(
        // ★ 只收集**行首**（顶层）声明：函数体内的 `const ratio` 不能被当成模块级名字，
        //   否则 `return { ratio }` 会在模块作用域抛 "ratio is not defined"（本卡踩过）。
        (src2.match(/^const (\w+) =/gm) || []).map((m) => m.replace('const ', '').replace(' =', '')),
        (src2.match(/^function (\w+)\(/gm) || []).map((m) => m.replace('function ', '').replace('(', '')));
    const fn = new Function(src2 + '\nreturn { ' + Array.from(new Set(names)).join(', ') + ' };');
    return fn();
}

/* ============================ 入口 ============================ */

const args = parseArgs(process.argv.slice(2));
const main = async () => {
    if (args.verify) {
        return cmdVerify();
    }
    if (!args.labRepo && !args.bodies.length) {
        console.log('用法：');
        console.log('  node tools/importRenderAssets.mjs --lab-repo <实验室仓库> --body <kerbin|all> [--dry-run] [--no-timestamp]');
        console.log('  node tools/importRenderAssets.mjs --verify   # 只读：按配置检查资产齐备性');
        console.log('');
        console.log('⚠️ 前置：资产包里的图片**不入库** ⇒ 请先在实验室跑 `node tools/assetBundle.mjs export`。');
        return 2;
    }
    return cmdImport(args);
};

main().then((c) => {
    process.exitCode = c;
}).catch((err) => {
    console.error('[importRenderAssets] 失败：' + ((err && err.message) || err));
    process.exitCode = 1;
});
