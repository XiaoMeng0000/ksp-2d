````markdown
# KSP 2D 资源系统重构方案

| 项 | 内容 |
|---|---|
| 版本 | v1.7 |
| 日期 | 2026-08-15 |
| 状态 | 阶段 1-6 已实施；后置事项见 §13（v1.7 同步文档与实现，含 modeRules/资源归属修正） |
| 分支 | `feature`（当前工作分支） |

---

## 1. 背景与目标

### 1.1 现状问题

当前游戏的资源系统处于"接口预留"状态：

- `player.points` / `player.unlockedBlueprints` 存在但无任何驱动逻辑
- 燃料只有单一 `fuel` 标量（kg），无资源类型体系
- 建造 / 补给 / 安装模块全部免费（3 处 `TODO: 点数系统启用后扣除点数`）
- 存在 2 个 P1 Bug：
  - **B1**：燃料耗尽后 `maxThrust` 被永久置 0（[flightScene.js](src/scenes/flightScene.js)），补给燃料不恢复，飞船永久报废
  - **B2**：UI 读 `ship.maxFuel`，飞船实例字段是 `fuelCapacity`，燃料显示恒为 `xxx / -`、进度条恒 0

### 1.2 目标

1. 建立统一资源数据模型：多燃料类型 + 建造耗材 + 科技点 + 星球原料
2. 打通"获取 → 库存 → 消耗"最小经济闭环
3. 引入引擎类型体系（KSP 风格燃料配方）
4. 引入飞船模板升级体系（家族分代 / 科技递进）
5. 引入星球资源与扫描机制（轨道挖地表矿）
6. 预留自由模式 / 生涯模式双模式
7. 修复 2 个 P1 Bug 与字段错位问题
8. 为后续扩展（采矿、精炼、任务、科技树、新天体）预留接口

---

## 2. 设计总览

```
星球资源(原料) → [扫描模块] → 丰度可见 → [采矿模块(后置)] → 原料库存
                                                          ↓ [精炼(后置)]
玩家资源(科技点/材料套装) → [解锁/建造] → 飞船模板(家族分代)
                                              ↓
                        飞船实例.resources(推进剂) → [引擎] → 飞行/消耗
                                              ↓
                             燃料耗尽 engineOut → 设施补给（消耗耗材，后置）
```

三条主线：
- **推进链**：燃料(资源) → 引擎(配方) → 飞行消耗
- **成长链**：科技点 → 模板族 tier → 更先进引擎/燃料
- **经济链**：星球采矿 → 精炼 → 补给（本期只建数据）

---

## 3. 资源体系

### 3.1 命名规范

- **代码 id**：全小写驼峰，稳定不可变（进入存档，改名成本高）
- **中文显示名**：玩家可见，2~4 字为宜
- **分类**：`propellant`（推进剂）/ `raw`（原料）/ `construction`（建造）/ `research`（科研）
- **单位**：推进剂与原料 kg；耗材"套"；科技点"点"
- **探测等级（tier）**：仅 `raw` 与可作为星球资源的推进剂需要（1 常见 / 2 稀有 / 3 隐藏）

### 3.2 资源注册表（定稿 18 类）

```js
// src/resources/resourceTypes.js
export const RESOURCE_TYPES = [
  // ===== 推进剂（飞船侧） =====
  { id: 'hydrogen', name: '液氢', category: 'propellant', unit: 'kg' },         // 本期用
  { id: 'oxygen',   name: '液氧', category: 'propellant', unit: 'kg' },         // 本期用
  { id: 'methane',  name: '液态甲烷', category: 'propellant', unit: 'kg' },
  { id: 'monoprop', name: '单组元推进剂', category: 'propellant', unit: 'kg' },
  { id: 'metallicHydrogen', name: '金属氢', category: 'propellant', unit: 'kg' },
  { id: 'deuterium', name: '氘', category: 'propellant', unit: 'kg' },
  { id: 'tritium',   name: '氚', category: 'propellant', unit: 'kg' },
  { id: 'helium3',   name: '氦-3', category: 'propellant', unit: 'kg', tier: 3 },
  { id: 'nuclearSaltWater', name: '核盐水', category: 'propellant', unit: 'kg' },
  { id: 'fissionPellets',   name: '裂变弹丸', category: 'propellant', unit: 'kg' },
  { id: 'xenon', name: '氙', category: 'propellant', unit: 'kg' },
  { id: 'antimatter', name: '反物质', category: 'propellant', unit: 'kg' },

  // ===== 星球原料（可由采矿获取） =====
  { id: 'waterIce',        name: '水冰',       category: 'raw', unit: 'kg', tier: 1 },
  { id: 'metallicOre',     name: '金属矿石',   category: 'raw', unit: 'kg', tier: 1 },
  { id: 'rareMetals',      name: '稀土矿',     category: 'raw', unit: 'kg', tier: 2 },
  { id: 'fissileMaterials',name: '裂变材料',   category: 'raw', unit: 'kg', tier: 2 },

  // ===== 玩家全局 =====
  { id: 'materialKits', name: '材料套装', category: 'construction', unit: '套' },
  { id: 'science',     name: '科技点',   category: 'research',     unit: '点' },
];
```

### 3.3 资源归属

| 归属 | 资源 | 说明 |
|---|---|---|
| 飞船实例 `ship.resources` | 全部推进剂 | 每艘船独立库存，`amount` + `capacity`（储罐容量） |
| 玩家 `player.resources` | science（科技点） | v1.7 修正：0.2.0 阶段 5 起全局仅科技点；materialKits 等实体资源迁入设施存储 / 飞船货仓 |
| 天体配置 `BODY_RESOURCES` | 原料（静态丰度表） | 只读配置，不可增删 |

飞船资源结构：

```js
ship.resources = {
  hydrogen: { amount: 5000,  capacity: 5000  },
  oxygen:   { amount: 40000, capacity: 40000 },
  // 其余推进剂本期不填（amount/capacity 0），预留
}
```

废弃字段：`ship.fuel`、`ship.fuelCapacity`、`player.points`、`player.resources.rocketParts`（重命名为 materialKits）、`player.resources.materialKits`（阶段 5 迁入设施存储）。

### 3.4 统一工具函数（新建 `src/resources/resourceSystem.js`）

- `getResource(holder, id)` / `setResource` / `addResource` / `consumeResource(holder, id, amount)`
- `getTotalMass(ship)`：干质量 + Σ(所有推进剂 amount)
- 玩家全局：`getPlayerResource` / `addPlayerResource` / `consumePlayerResource`（0.2.0 阶段3，career 校验余额）
- 所有模块只经工具函数读写资源，杜绝裸字段操作

---

## 4. 引擎类型与燃料消耗

### 4.1 引擎类型表（新建 `src/resources/engineConfig.js`）

KSP 风格：**燃料配方定义在引擎配置上**（每个引擎自带 propellant 列表与比例），不在全局。

```js
export const ENGINE_TYPES = [
  { id: 'chemical',   props: [{ id: 'hydrogen', ratio: 1 }, { id: 'oxygen', ratio: 8 }], stage: 'now' },
  { id: 'metallicH',  props: [{ id: 'metallicHydrogen', ratio: 1 }],                      stage: 'later' },
  { id: 'fusion',     props: [{ id: 'deuterium', ratio: 1 }, { id: 'helium3', ratio: 1 }], stage: 'later' },
  { id: 'nswr',       props: [{ id: 'nuclearSaltWater', ratio: 1 }],                      stage: 'later' },
  { id: 'orion',      props: [{ id: 'fissionPellets', ratio: 1 }],                        stage: 'later' },
  { id: 'ion',        props: [{ id: 'xenon', ratio: 1 }],                                 stage: 'later' },
  { id: 'antimatter', props: [{ id: 'antimatter', ratio: 1 }],                            stage: 'later' },
];
```

- `stage: 'now'`：本期实现；`'later'`：占位，等对应玩法扩展
- `chemical` 混合比 `hydrogen:oxygen = 1:8`（近似化学计量质量比，与水冰电解产出闭环）

### 4.2 燃料消耗模型（阶段 2）

- 质量流量：`ṁ = T / (isp × g₀)`，按引擎 `props` 比例拆分为各燃料消耗
- **停机判定**：任一配方燃料耗尽 → `engineOut = true` 熄火（**禁止修改 `maxThrust`**）
- 补给 / 恢复：`engineOut` 清除，`maxThrust` 保持不变

---

## 5. 飞船模板升级体系

### 5.1 形态选型：家族分代（Tier）

同系列分 Tier（如 坎星号 Mk1 → Mk2 → Mk3），每代换引擎类型 / 燃料 / 数值，靠科技点逐级解锁。
> 已实施注：tier1 现役舰已命名为「储备坎巴拉K2号」（id 仍为 `kanxing-1`，family `kanxing`），定位对标 KSP 原版 K2 火箭（Mun/Minmus 往返专用）。

```
坎星号 Mk1 (tier1, 化学) → Mk2 (tier2, 金属氢) → Mk3 (tier3, 氙电推)
```

### 5.2 模板字段扩展

```js
{
  id: 'kanxing-1', name: '储备坎巴拉K2号',
  family: 'kanxing',          // 系列名（升级线）
  tier: 1,                    // 分代序号，1 起
  category: 'probe',
  engineType: 'chemical',     // 关联 ENGINE_TYPES，决定燃料配方
  fuelTanks: { hydrogen: 280, oxygen: 2240 },  // 按引擎配方配储罐（总 2520 kg，ΔV≈2800）
  dryMass: 2000, isp: 350, maxThrust: 70000,
  cost: 50,                   // 建造耗材（材料套装）
  scienceCost: 0,             // 科技点（0 = 默认解锁；本期科技树不生效，保留字段）
  unlockCondition: 'always',  // 'always' | 'science' | '__debug__'
  ...
}
```

- `isp` / `maxThrust` 仍由模板给出（模板 = 船体 + 引擎组合体）
- 引擎表只定燃料配方与能力区间，互不冲突
- `family + tier` 唯一，作为升级线索引

### 5.3 升级解锁逻辑（本期不生效，接口预留）

- `tier 1`：默认解锁（scienceCost = 0）
- `tier n > 1`：消耗 `scienceCost` 且同族前置 tier 已解锁（KSP 科技树式强制前置）

### 5.4 模板族梯度目标（阶段 2 校准数值，此处为方向）

| 族 | tier | 引擎 | ΔV 目标 | scienceCost | cost |
|---|---|---|---|---|---|
| 储备坎巴拉K2号 | 1 | 化学氢氧 | 2,800 | 0 | 50 |
| 坎星号 Mk2 | 2 | 金属氢 | 12,000 | 80 | 400 |
| 坎星号 Mk3 | 3 | 氙电推 | 30,000 | 250 | 1,500 |
| 深空先锋 | 3 | 核盐水 | 40,000 | 400 | 2,500 |
| 代达罗斯级 | 4 | 聚变 | 80,000 | 800 | 5,000 |
| 创世纪方舟 | 5 | 反物质（旗舰） | 保留 | 2,000 | 9,999 |

> 已实施注：K2 号 ΔV 校准至 2,800 m/s（TWR≈1.58），足够 Mun/Minmus 往返、不足以直飞 Duna，符合 KSP 原版 K2 火箭定位。

测试巨兽保留 `__debug__` 特殊解锁。创世纪方舟按旗舰保留夸张数值，但 TWR 需 ≥ 1（阶段 2 校准）。

---

## 6. 星球资源与扫描机制

### 6.1 星球资源模型（新建 `src/config/bodyResources.js`）

每个天体挂资源分布表，**丰度系数 0~1**（未列出 = 无）。分两类：

- `surface`：地表矿（轨道飞船可挖），普通天体使用
- `orbitBands`：轨道资源带，**仅配给 Dres 星环 / Jool 周边**等特殊天体，本期其余天体一律空

```js
export const BODY_RESOURCES = {
  kerbin: { surface: { waterIce: { abundance: 0.8 }, metallicOre: { abundance: 0.6 }, rareMetals: { abundance: 0.3 } }, orbitBands: {} },
  mun:    { surface: { metallicOre: { abundance: 0.9 }, rareMetals: { abundance: 0.7 }, fissileMaterials: { abundance: 0.2 }, helium3: { abundance: 0.1 } }, orbitBands: {} },
  kerbol: { surface: {}, orbitBands: {} },
  // dres / jool 等天体加入时，在 orbitBands 配资源带
};
```

### 6.2 资源分级

| 资源 | 探测等级 tier |
|---|---|
| 水冰、金属矿石 | 1（常见） |
| 稀土矿、裂变材料 | 2（稀有） |
| 氦-3 | 3（极稀有 / 隐藏） |

### 6.3 扫描模块分级（moduleTypes 扩展）

资源丰度默认"未公开"，需扫描模块探测后才可见。

| 模块 id | 名称 | scanTier | price |
|---|---|---|---|
| `scanner_t1` | 资源扫描仪 Mk1 | 1 | 0 |
| `scanner_t2` | 资源扫描仪 Mk2 | 2 | 0 |
| `scanner_t3` | 资源扫描仪 Mk3 | 3 | 0 |

- 复用现有 `capability` 机制（capability = `scan_resources`），安装流程走 `addModuleToShip`
- **测试期 price 全 0、可直接选装**（科技树本期不生效）

### 6.4 扫描判定逻辑（阶段 6 ✅ 已实施：主动扫描模型）

- 扫描菜单（工具栏 🔭 图标）："开始扫描"启动任务 → 随游戏时间累积 → 完成写入 `tiersScanned`（取 max 不降级）
- 扫描时长 = 10 游戏天（21600s/天）× (radius/200km) × 等级系数（t1 ×1 / t2 ×0.5 / t3 ×0.25）
- 约束：飞船带扫描仪且在天体 SOI 内；全局单任务（单通道）；离开 SOI 任务中断（进度清零）
- 天体资源可见条件：`资源.tier ≤ tiersScanned`（`getVisibleBodyResources`）
- sandbox 模式：直接全部可见（`isScansEnabled()` 豁免）
- 附带：SOI 首访奖励（`awardFirstVisit`，发放科技点 +5，记录 `visitedBodies`）

```js
player.scannedBodies = {
  kerbin: { tiersScanned: 2 }   // 已扫到 tier2
}
```

---

## 7. 采矿与精炼（预留，后置）

### 7.1 采矿形态（已定）

- **普通天体**：轨道飞船/设施挖**地表矿**，单一丰度系数
- **轨道资源带**：仅 Dres / Jool 周边，本期仅数据结构预留
- v1.7 修正：原计划"本期只建接口 `mineResource(bodyId, module, dt)`"，实际**接口也未建立**，采矿整体后置

### 7.2 精炼转化链（只定义数据，本期不实现）

```js
// src/resources/craftRecipes.js（后置）
export const CRAFT_RECIPES = [
  { input: { waterIce: 9 },          output: { hydrogen: 1, oxygen: 8 }, time: 60 },   // 电解
  { input: { metallicOre: 10 },      output: { materialKits: 1 },        time: 60 },   // 冶炼
  { input: { fissileMaterials: 2 },  output: { nuclearSaltWater: 1 },   time: 120 },
];
```

闭环：星球原料 → 采矿 → 精炼 → 燃料/零件 → 补给飞船。

---

## 8. 游戏模式（sandbox / career）预留

### 8.1 数据层

- `player.gameMode: 'sandbox' | 'career'`（新建世界时写入 `world.metadata`）
- 旧存档默认归 `sandbox`（不破坏现有体验）

### 8.2 规则层（新建 `src/resources/modeRules.js`）

| 接口 | sandbox | career |
|---|---|---|
| `isResourceCheckEnabled()` | true（统一扣费） | true（扣费/校验余额） |
| `isTechLocked()` | false（全解锁） | true（需科技解锁） |
| `isScansEnabled()` | true（丰度直接可见） | false（需扫描） |

> v1.7 修正：`isResourceCheckEnabled()` 原设计 sandbox 免检，但 0.2.0 阶段 4 起改为**全模式统一扣费**（保证经济闭环可观测，修复资源数字静止 / 免费建造问题）。若将来需要"无限资源沙盒"，改回按 mode 区分（`modeRules.js` 已留 TODO）。

业务代码**只调这些接口**，不散落 `if (mode === 'career')`。将来加差异只改 modeRules 一处。

选模式 UI、生涯任务系统：后置。

---

## 9. 存档迁移方案（阶段 1）

在 `saveManager.loadCheckpoint` 迁移区追加：

| 旧字段 | 迁移逻辑 |
|---|---|
| `ship.fuel`（number） | 按 1:8 质量拆桶 → `resources.hydrogen.amount = fuel/9`、`resources.oxygen.amount = fuel*8/9` |
| `ship.fuelCapacity` | 按 1:8 拆 → `hydrogen.capacity` / `oxygen.capacity` |
| `player.points` | 废弃，映射为初始 materialKits / science 默认值 |
| `player.resources.rocketParts` | → 重命名为 `materialKits`（已存在则保留新值） |
| `player.resources.materialKits` | 阶段 5：转入第一个设施的存储槽（`addStorage`） |
| 缺失 `resources` 的新飞船 | 按模板 `fuelTanks` 重建 |
| 无 `facility.storage` | 按类型 `storageProfile` 补建空仓（`initFacilityStorage`） |
| 无 `gameMode` | 默认 `'sandbox'` |
| 无 `scannedBodies` | 默认 `{}` |
| 无 `visitedBodies` | 默认 `{}`（阶段3：SOI 首访奖励记录） |
| 无 `engineOut` | 默认 `false` |

版本号：`state.version` 提升至 `0.2.0`。

---

## 10. Bug 修复清单

| # | Bug | 修复方式 | 阶段 |
|---|---|---|---|
| B1 | 燃料耗尽 `maxThrust` 永久置 0 | 改 `engineOut` 标志 + 停机重算 kepler，补给恢复 | 2 ✅ |
| B2 | UI 用 `maxFuel`，数据是 `fuelCapacity` | 统一走 `getFuelAmount/getFuelCapacity` 工具函数 | 1 ✅ |
| B3 | ΔV 显示为轨道速度 / 手填值 | 新增 `computeDeltaV`（KSP 火箭方程），追踪站与建造面板统一 | 2 ✅ |

---

## 11. 分阶段实施计划

| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| **1** | 资源表 18 类 + bodyResources（surface/orbitBands）+ 引擎表 + 模板字段扩展 + 3 级扫描仪 + gameMode/scannedBodies + modeRules 骨架 + 存档迁移 + 修 B2 | 旧存档可加载且燃料换算正确；grep 无 `ship.fuel`/`maxFuel`/`points` 裸引用；debugUI 可打印新字段；新模块无导入报错 | ✅ 完成 |
| **2** | 化学引擎双燃料消耗 + engineOut 停机 + 修 B1 + 模板族数值重做 | lf/ox（hydrogen/oxygen）独立消耗；任一耗尽停机；补给后恢复点火；TWR ≥ 1 | ✅ 完成 |
| **3** | 扫描解锁逻辑 + career 经济闭环（耗材扣费 + SOI 首访奖励；科技解锁留接口不生效） | 扫描仪分级探测生效；sandbox 豁免；资源不足操作被拒且有提示 | ✅ 完成 |
| **4** | UI：燃料槽 / 扫描状态 / 星球资源信息 / 模式显示 | 所有界面燃料数字与进度条正确；无字段错位残留 | ✅ 完成 |
| **5** | 货运与存储：飞船货仓（货运模块）+ 设施存储（storageProfile 差异化）+ 全局资源只留科技点 + 设施间调拨菜单 + 自动物流接口预留 + 部署设施扣费修复 | 货仓/存储容量生效；建造/补给/装模块/部署均从正确位置扣费；调拨可用 | ✅ 完成 |
| **6** | 主动扫描：扫描菜单（工具栏图标）+ 扫描时长（游戏天，随星球规模/扫描仪等级）+ 进行中进度/取消 + 已知弹窗提示 | 菜单可用；扫描随游戏时间推进（时间加速同步）；离开 SOI 中断 | ✅ 完成 |
| 后置 | 采矿模块 + 精炼转化 + 生涯任务 + 选模式入口 + 科技树 + Dres/Jool 天体 + 自动物流执行 | — | ⬜ |

每阶段独立提交，经审查通过后进入下一阶段。

---

## 12. 文件影响面清单

| 文件 | 阶段 | 改动 | 状态 |
|---|---|---|---|
| `src/resources/resourceTypes.js` | 1 | **新建**：资源注册表（含材料套装） | ✅ |
| `src/resources/resourceSystem.js` | 1/2 | **新建**：资源工具函数 + `computeDeltaV` | ✅ |
| `src/resources/engineConfig.js` | 1 | **新建**：引擎类型表 | ✅ |
| `src/resources/modeRules.js` | 1 | **新建**：模式规则 | ✅ |
| `src/resources/scanSystem.js` | 3 | **新建**：扫描探测 / 资源可见性 / SOI 首访奖励 | ✅ |
| `src/resources/cargoSystem.js` | 5 | **新建**：飞船货仓 / 设施存储 / 双向调拨 / 自动物流接口预留 | ✅ |
| `src/config/bodyResources.js` | 1 | **新建**：星球资源 | ✅ |
| `src/gameState.js` | 1 | player 扩展 gameMode / scannedBodies / visitedBodies / resources | ✅ |
| `src/ship/shipTemplates.js` | 1/2 | 模板字段扩展 + 族数值重做 + K2 号改名/ΔV 校准 | ✅ |
| `src/ship/moduleTypes.js` | 1 | 扫描仪 3 级模块 | ✅ |
| `src/ship/shipSystem.js` | 1 | createShip 生成 resources，废弃 fuel | ✅ |
| `src/scenes/flightScene.js` | 2/3 | 双燃料消耗 + engineOut + 扫描更新 | ✅ |
| `src/facility/facilitySystem.js` | 2/3 | 补给恢复 engineOut + 建造/补给/装模块扣费 | ✅ |
| `src/saveManager.js` | 1 | 存档迁移 + 版本号 + rocketParts→materialKits + visitedBodies | ✅ |
| `src/ui/flightUI.js` 等 UI | 1/4 | 燃料字段统一工具函数 + 分槽显示；补给面板停机提示 + 扣费失败提示 | ✅ |
| `src/physics/physicsUpdate.js` 等 | 2 | 质量计算改用 getTotalMass | ✅ |
| `src/ui/trackingUI.js` | 2/4 | ΔV 改用 `computeDeltaV` + 燃料分槽 + 天体资源丰度/扫描状态显示 | ✅ |
| `src/ui/shipBuilderUI.js` | 2/3 | 建造面板 ΔV 实时计算 + 成本显示 + 建造扣费 | ✅ |
| `src/ui/resourceHUD.js` | 4 | **新建**：右上角常驻玩家资源 HUD（模式 + 科技点；阶段 5 后材料套装退场仅剩科技点） | ✅ |
| `src/config/bodyResources.js` | 1/4 | **新建**：星球资源 + key 归一化（Kerbin↔kerbin） | ✅ |

---

## 13. 后置事项与待决策

### 已确认后置

- 采矿模块 + 精炼转化（v1.7 修正：接口 `mineResource` 与 `craftRecipes.js` 均未建立，整体后置）
- 高级模板族（Mk2/Mk3、深空先锋、代达罗斯级、创世纪方舟——仅 §5.4 方向表，模板未建）
- 生涯任务系统
- 选模式 UI 入口
- 科技树（science 数据保留，解锁功能不生效）
- Dres / Jool 天体（本期仅 orbitBands 结构预留）
- 自动物流执行（`updateAutoLogistics()` 空实现，仅注册骨架）

### 待决策（后续）

- 采矿 / 精炼的产出率与能耗数值
- 生涯模式经济数值（成本、奖励、任务报酬）
- 资源带（Dres / Jool）具体丰度配置
- 反物质获取途径（任务 / 事件）
````

