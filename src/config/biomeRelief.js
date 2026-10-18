'use strict';

// 逐群系「地表起伏（法线图）强度」表 —— **数据驱动**，业务模块不得硬编码。
//
// 用途：渲染器里实际生效的起伏强度 = params.normalStrength × 本表[群系下标]。
//   两者是**相乘**关系：normalStrength 是全局画质旋钮（0 = 关闭，默认值，
//   关闭时渲染结果与未接法线图逐像素一致），本表是逐群系的相对比例。
//
// ★ 本表的数是怎么来的（不要手改，改了就与统计工具脱节）★
//   现值来自 `tools/biomeReliefStats.mjs`（task-25 度量换轨）的**低频幅度法**：
//
//       1) height 图块平均降采样到 ~128×64（16×16 块，滤掉 fbm 高频噪声）；
//       2) 每群系在它的块上算 |H − 该群系均值| 的 p90（低频幅度）；
//       3) strength = 该值 / max(同天体非水群系的该值)，算完再人工取整。
//
//   为什么换度量：旧度量「p95 坡度」被 fbm 高频噪声抬高，平原被高估到山地的
//   79%（plains 0.707 vs mountain 0.900），总监人眼复看平原/沙漠起伏偏大。
//
//   ⚠️ 已知局限（kerbin 手调的原因）：16×16 块平均会把**窄山脊**的高频幅度
//   一并抹掉，低频幅度度量系统性低估窄脊群系 —— kerbin mountain 计算值
//   0.617 反而低于 plains 0.849。因此 kerbin 最终值按组长观感手调（见各
//   note 的「计算值 → 最终值」），不直接采用计算值。
//
//   旧度量（p95 坡度法，备查）：p95(该群系坡度)/max(p95(同天体非水群系坡度))，
//   初值来自 `data/out/normalmap/bake/biome-gradient.json`（卡1 产物）；
//   旧值逐条保留在各群系 note 里。
//
// ★ 水群系恒 0（水面不长山）★
//   `water: true` 的群系（Kerbin 的 ocean / coast）在 height 模型里**高度恒为 0**
//   （见 data/planet-src/kerbin/biome-styles.json 的「水域恒平」），水面观感由
//   既有材质层的程序化波浪（planetShaders.js 的 waveGrad）负责。
//   给水面叠地形法线 = 在海面上长出山，是明确的错误，因此这里写死 0，
//   **不**采用计算值 —— 新度量下 coast 的陆侧块仍有低频幅度（计算值 ≈0.21），
//   对水面仍是错误语义（旧 p95 公式值 0.96 同理）。
//
// ★ 群系下标从哪来 ★
//   下标 = `data/planet-src/<body>/palette-map.json` 的 `biomes` 数组下标，
//   而渲染器从群系索引图（`data/out/bake/<body>-biome.png`）的 R 通道读到的就是这个下标。
//   ⚠️ 这里**不复制** palette-map 的语义真源：`id` 字段只为可读性，
//      「下标 ↔ 语义」的对应关系由证据工具用像素占比逐一对账证明
//      （见 tools/normalMapRender.mjs 的 biomeIdentity；
//       tools/biomeReliefStats.mjs 的块占比与 biome-gradient.json 一致）。

/**
 * 每体归一化系数 K（卡1 烘焙报告 `data/out/normalmap/bake/bake-report.json` 的原值）。
 *
 * K = 1 / p95(|∇H|)，使该天体 p95 坡度映射到 45°。法线图存的是**单位强度**的
 * 法线（不含 K 的实际幅度），真实幅度由运行时 `normalStrength` 乘 —— 所以这里
 * 只是把 K **记下来**（将来要做"物理可比"的坡度时不必重烘），运行时不读它。
 */
export const RELIEF_NORMALIZATION = {
    kerbin: { k: 0.06823559636972593, slopeP95Deg: 45 },
    mun: { k: 0.2956296571600028, slopeP95Deg: 45 },
};

/**
 * 逐天体、逐群系的起伏强度（0~1）。
 * @type {Object<string, Object<number, {id:string, normalStrength:number, note:string}>>}
 */
export const BIOME_RELIEF = {
    kerbin: {
        0: { id: 'ocean', normalStrength: 0, note: '水域（water:true，高度恒 0）—— 水面用既有波浪，不长山；新旧度量一致恒 0' },
        1: { id: 'coast', normalStrength: 0, note: '滨海（water:true，浅海）—— 同上；低频幅度法计算值 ≈0.21 是陆侧海岸，对水面语义错误，恒 0（旧 p95 公式值 0.96）' },
        2: { id: 'plains', normalStrength: 0.30, note: '计算值 0.849 / 旧值 0.707（p95 坡度法，被 fbm 高频噪声抬高）→ 手调 0.30（组长观感：平原应明显平缓）' },
        3: { id: 'desert', normalStrength: 0.25, note: '计算值 0.857 / 旧值 0.588 → 手调 0.25（组长观感，同平原）' },
        4: { id: 'mountain', normalStrength: 0.900, note: '计算值 0.617（窄山脊被 16×16 块平均抹平，低频幅度低估）/ 旧值 0.900 → 维持 0.900（组长观感：山地仍最陡）' },
        5: { id: 'polar', normalStrength: 0.35, note: '计算值 1.000 / 旧值 0.35（旧公式值 1.000）→ 维持 0.35；配合着色器极点淡出，消除极区条纹；数值待总监观感定' },
    },
    mun: {
        0: { id: 'mare', normalStrength: 0.78, note: '低频幅度法计算值 0.780 → 0.78；旧值 0.500（p95 坡度法）' },
        1: { id: 'plains', normalStrength: 1.00, note: '低频幅度法计算值 1.000（本天体非水群系中最大）→ 1.00；旧值 0.662；⚠️ 计算值超过环形山，疑受窄脊抹平影响，待总监观感复核' },
        2: { id: 'crater', normalStrength: 0.84, note: '低频幅度法计算值 0.837 → 0.84；旧值 1.000（环形山边缘最陡 —— 窄脊被块平均抹平，计算值低估，待总监观感复核）' },
        3: { id: 'polar', normalStrength: 0.35, note: '低频幅度法计算值 0.633 → 维持 0.35（同 kerbin polar：配合着色器极点淡出，消除极区条纹；旧值 0.35）；数值待总监观感定' },
    },
};

/**
 * 未登记的天体 / 群系下标使用的缺省强度。
 * 取 1：法线图本身是单位强度，未登记时"按原样生效"是唯一不引入猜测的选择。
 * （注意它**不会**让默认路径有任何变化 —— `normalStrength` 默认 0，见渲染器。）
 */
export const DEFAULT_BIOME_RELIEF = { normalStrength: 1 };

/**
 * 求解某天体的逐群系强度定长数组（供 `setNormalMap(image, { relief })` 上传 uniform）。
 *
 * ⚠️ 返回 Float32Array：setUniforms 对定长数组走 uniform1fv 路径（与
 *    逐群系 detailStrength 的既有约定一致）。
 * @param {string} bodyId 天体 id（如 'kerbin'）
 * @param {number} count 长度（必须 = 着色器的 MAX_BIOMES）
 * @returns {Float32Array}
 */
export function resolveBiomeReliefArray(bodyId, count) {
    const out = new Float32Array(count);
    const table = BIOME_RELIEF[bodyId] || null;
    for (let i = 0; i < count; i++) {
        const entry = table ? table[i] : null;
        out[i] = entry ? entry.normalStrength : DEFAULT_BIOME_RELIEF.normalStrength;
    }
    return out;
}
