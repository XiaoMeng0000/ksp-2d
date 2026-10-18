'use strict';

// 地表材质的光学层：逐群系的 BRDF 参数（f0 / 粗糙度）。
//
// ★ 这一层解决什么 ★
//   在此之前地表光照是**纯 Lambert**：`albedo × (ambient + diffuse × N·L × sunTint)`。
//   在这条式子下 **冰、岩石、水、土壤的反光方式完全一样** —— 材质贴图画得再细，
//   水也不会反光、冰也不会亮。而"水／冰／岩／土"恰恰是靠**光学差异**区分的，
//   不是靠颜色。这个模块提供那份差异。
//
// ★ 设计口径（2026-09-27 与总监定下）★
//   · BRDF 用 **GGX 微表面 + Schlick Fresnel + Smith 几何项**，不是 Blinn-Phong。
//     理由：Fresnel 反正要做（水面 Plan A 就要求它），有了 Fresnel 改成 GGX
//     只多两行数学；而且与"大气那次物理基本正确"的取向一致。
//   · 水面是**第一个实例**，不是特例分支 —— 水/冰/岩/土共用同一套管线。
//   · ⚠️ **默认值必须做到"未声明材质 = 逐像素零行为变化"**：
//     f0 = 0 ⇒ 镜面项恒为 0；rough 默认 1。
//     这是它能安全落地的前提（大气层当年靠 uAtmoEnabled=0 逐像素一致才敢上）。
//
// ★ 刻意**不做**的项（第一版做了，被否掉）★
//   · **次表面透光（sss）**：第一版按 `(1 − N·L)` 加权，结果权重在**边缘**最大
//     ⇒ 每个声明材质的群系都长出一圈亮边，看着像描了边。
//     真想做得对，需要**背光侧的透射方向**（光穿过介质后从哪出来），
//     那要厚度信息，不是 N·L 能凑出来的。宁可不做，也不做错。
//   · **波浪法线扰动**（2026-09-27 已做，见下面的 waveDeg）。
//
// ★ 一个对实现有利的巧合 ★
//   相机是**正交投影** ⇒ 视线方向 V 是**常量** (0,0,-1)，不随像素变。
//   高光因此比常规透视便宜（H = normalize(L + V) 一次即可），
//   而且 Fresnel 只随法线变 —— 水面在掠射角反射率升高会**自然出现**。
//   ⚠️ V 的符号：实测「朝相机」是 z 的**负**方向（见 meshRenderer 的 sunDir 约定）。
//
// ★ 参数放哪 ★
//   逐群系写在 `data/planet-src/<body>/biome-styles.json` 的 `biomes.<id>.material` 里，
//   与 detailStrength / detailScale 同一处 —— 那里是手工维护的外观真源。
//   （`palette-map.json` 由 quantizeBiome **生成**，手改会被下次量化覆盖，不能放。）

/**
 * 材质参数的默认值。
 *
 * ⚠️ **这两个默认值共同保证"未声明材质 = 逐像素零行为变化"** —— 改动它们
 *    会静默改变所有既有天体的外观，动之前必须跑 checkComparison / checkM5。
 */
export const DEFAULT_MATERIAL = {
    /** 垂直入射反射率（F0）。0 = 无镜面 ⇒ 退回纯 Lambert */
    f0: 0.0,
    /** 微表面粗糙度。1 = 完全粗糙 ⇒ 高光铺满、看不出形状 */
    rough: 1.0,
    /**
     * 波浪：法线扰动的 **RMS 角度（度）**。0 = 无波浪。
     *
     * ⚠️ 单位是"角度"而不是"振幅/强度"，刻意的：
     *    同一个数字既是几何扰动的幅度，**又是要并进 α_eff 的方差** ——
     *    两处直接用同一个量，不存在"改了参数但方差没跟着改"的脱节。
     */
    waveDeg: 0.0,
    /** 波浪：横跨整颗星球的周期数（u 方向） */
    waveScale: 24.0,
};

/** 参与逐群系 uniform 数组的字段（顺序无关，但改这里要同步 shader 的 uniform 列表） */
export const MATERIAL_KEYS = ['f0', 'rough', 'waveDeg', 'waveScale'];

/**
 * 各字段的合法区间。超范围**钳制**而不是抛错 —— 这是外观参数，
 * 钳制能让"手误填了 5"立刻表现为"封顶"而不是渲染异常。
 *
 * waveDeg 上限 45°：再大就不是"波浪"而是"碎浪/泡沫"了，
 * 而且会把 α_eff 撑到 0.8 以上，高光彻底消失（那应该改用 albedo 表达）。
 */
const RANGE = {
    f0: [0.0, 1.0],
    rough: [0.01, 1.0],
    waveDeg: [0.0, 45.0],
    waveScale: [1.0, 400.0],
};
/**
 * 单条材质定义的求解（缺字段用默认值，超范围钳制）。
 *
 * @param {object|null|undefined} raw biome-styles.json 里的 material 字段
 * @returns {{f0:number, rough:number}}
 */
export function solveMaterial(raw) {
    const out = {};
    MATERIAL_KEYS.forEach((k) => {
        const v = raw && raw[k] !== undefined ? Number(raw[k]) : DEFAULT_MATERIAL[k];
        const r = RANGE[k];
        out[k] = Number.isFinite(v) ? Math.min(r[1], Math.max(r[0], v)) : DEFAULT_MATERIAL[k];
    });
    return out;
}

/**
 * 求解面板/配置给的值 → 逐群系材质表。
 *
 * @param {Array<object|null>} styles 逐群系 [{ material }]，顺序 = 群系下标
 * @param {number} maxBiomes 着色器的 MAX_BIOMES（改这里必须同步 shader）
 * @returns {{f0:Float32Array, rough:Float32Array, waveDeg:Float32Array,
 *            waveScale:Float32Array, declared:number}}
 *          declared = 真正声明了材质的群系数（用于诊断输出）
 */
export function solveBiomeMaterials(styles, maxBiomes) {
    const out = {
        f0: new Float32Array(maxBiomes),
        rough: new Float32Array(maxBiomes),
        waveDeg: new Float32Array(maxBiomes),
        waveScale: new Float32Array(maxBiomes),
        declared: 0,
    };
    for (let i = 0; i < maxBiomes; i++) {
        const raw = styles && styles[i] ? styles[i].material : null;
        if (raw) {
            out.declared += 1;
        }
        const m = solveMaterial(raw);
        out.f0[i] = m.f0;
        out.rough[i] = m.rough;
        // 着色器收**弧度**；面板/配置写**度**。转换只此一处。
        out.waveDeg[i] = m.waveDeg * Math.PI / 180;
        out.waveScale[i] = m.waveScale;
    }
    return out;
}

/**
 * ★★ 实验室专用的"材质调参"覆盖（迁移到主游戏时不带这个）★★
 *
 * 逐群系的真实值在 `biome-styles.json` 的 `material` 里，是**配置真源**。
 * 但水面那几个参数是**观感参数**，靠"改 JSON → 重载页面 → 看一眼"来调太慢 ——
 * 总监在实验室里要能实时拖。所以这里开一个覆盖口：面板上的滑块直接替换掉
 * **已声明材质**的群系的这些字段。调定之后把值折回配置文件。
 *
 * ⚠️⚠️ **"已声明材质"的判据只看 `solved.f0[i]`（原值），不看覆盖值** ★★
 *    这是「未声明材质 = 逐像素零行为变化」这条保证的守门条件（§13.32 / §13.34）。
 *    覆盖里**有 f0** —— 若拿覆盖后的 f0 去判，面板上把 f0 拖到 >0 就会
 *    **把整颗星球的每个群系都点亮镜面**（岩石、冰、沙漠全反光），
 *    而画面只是"变亮了"，不报错、不变色。所以判据必须用**原值**。
 *
 * ⚠️ 目前**唯一**声明材质的群系就是水域/滨海，所以"套到所有已声明材质的群系上"
 *    等价于"套到水体上"。将来若岩石/冰也声明材质，这里要改成按群系选择。
 *
 * ⚠️ 返回的是**新数组**（不就地改 solved）—— 就地改会让"配置值"永久丢失，
 *    面板一关就回不去了。
 *
 * @param {object} solved solveBiomeMaterials 的返回
 * @param {object|null|undefined} override { f0, rough, waveDeg, waveScale }；waveDeg 单位是**度**
 * @returns {object} { f0, rough, waveDeg, waveScale }（可直接当 uniform 数组用）
 */
export function applyMaterialOverride(solved, override) {
    if (!override) {
        return {
            f0: solved.f0,
            rough: solved.rough,
            waveDeg: solved.waveDeg,
            waveScale: solved.waveScale,
        };
    }
    const oF0 = Number(override.f0);
    const oRough = Number(override.rough);
    const oWave = Number(override.waveDeg);
    const oScale = Number(override.waveScale);
    // f0 必须克隆：它是零行为变化判据的载体，绝不能就地改
    const f0 = Float32Array.from(solved.f0);
    const rough = Float32Array.from(solved.rough);
    const waveDeg = Float32Array.from(solved.waveDeg);
    const waveScale = Float32Array.from(solved.waveScale);
    const clamp = (range, v) => Math.min(range[1], Math.max(range[0], v));
    for (let i = 0; i < solved.f0.length; i++) {
        if (solved.f0[i] <= 0) {
            continue;   // 未声明材质 ⇒ 一个字段都不动（见上面的 ⚠️⚠️）
        }
        if (Number.isFinite(oF0)) {
            f0[i] = clamp(RANGE.f0, oF0);
        }
        if (Number.isFinite(oRough)) {
            rough[i] = clamp(RANGE.rough, oRough);
        }
        if (Number.isFinite(oWave)) {
            // 面板给度、着色器收弧度
            waveDeg[i] = clamp(RANGE.waveDeg, oWave) * Math.PI / 180;
        }
        if (Number.isFinite(oScale)) {
            waveScale[i] = clamp(RANGE.waveScale, oScale);
        }
    }
    return { f0, rough, waveDeg, waveScale };
}

/**
 * 从逐群系样式表里取"水体初值"，用来初始化实验室面板。
 *
 * 取**第一个声明了 material 的群系**（当前 = 水域，palette 顺序第 0 个）。
 * 这样面板初值永远跟着配置走，不会出现"面板显示 0.02、渲染用 0.25"的脱节。
 *
 * @param {Array<object|null>} styles 逐群系 [{ material }]
 * @returns {{f0:number, rough:number, waveDeg:number, waveScale:number}|null}
 */
export function firstDeclaredMaterial(styles) {
    if (!styles) {
        return null;
    }
    for (let i = 0; i < styles.length; i++) {
        const raw = styles[i] ? styles[i].material : null;
        if (raw) {
            const m = solveMaterial(raw);
            return { f0: m.f0, rough: m.rough, waveDeg: m.waveDeg, waveScale: m.waveScale };
        }
    }
    return null;
}

/**
 * 诊断用：把求解结果转成可读文本（面板/状态栏/自动化读取）。
 * @param {object} solved solveBiomeMaterials 的返回
 * @param {Array<string>} [names] 群系 id，用于标注
 * @returns {string}
 */
export function describeMaterials(solved, names) {
    const parts = [];
    for (let i = 0; i < solved.f0.length; i++) {
        if (solved.f0[i] <= 0) {
            continue;   // 未声明（纯 Lambert）的不列，保持输出简短
        }
        parts.push((names && names[i] ? names[i] : '#' + i)
            + '(f0=' + solved.f0[i].toFixed(3)
            + ' rough=' + solved.rough[i].toFixed(2)
            + (solved.waveDeg[i] > 0
                ? ' wave=' + (solved.waveDeg[i] * 180 / Math.PI).toFixed(1) + '°×' + solved.waveScale[i].toFixed(0)
                : '')
            + ')');
    }
    return parts.length ? parts.join(' ') : '（全部未声明材质 ⇒ 纯 Lambert）';
}
