# UI 开发规范

> 适用版本:四阶段 UI 架构改造完成后(v0.2.4-alpha,2026-08-13)
> 本文档替代一切旧的 UI 编写习惯,新增/删除/修改 UI 一律按本规范执行

---

## 第一部分:最新 UI 形式完整解读

### 1. 总体架构:Canvas 画面 + DOM 界面

```
┌──────────────────────────────────────────────┐
│  Canvas 画布(唯一 #canvas)                    │
│   · 游戏世界(飞船/天体/轨道/星云/背景)         │
│   · 主菜单背景(星空/背景图,由 menuScene.render) │
├──────────────────────────────────────────────┤
│  DOM 覆盖层(position:fixed, z-index 分层)     │
│   · 游戏 HUD:左侧工具栏/时间加速/SAS/可见性     │
│   · 弹层面板:ESC 菜单/存档管理/建造/部署/对话框  │
│   · 场景页:主菜单/设置/百科/星系图鉴/信息页      │
└──────────────────────────────────────────────┘
```

- **分工铁律**:Canvas 只画"世界"与背景,**一切 UI(按钮/面板/文字/弹窗)都是 DOM**。禁止把交互控件画回 Canvas。
- 主菜单是特例:背景仍由 Canvas 绘制,但按钮/Logo/版本号已是 DOM(`#mainMenuContainer`)。

### 2. 目录结构

```
src/
├── ui/                     # UI 模块,按功能一文件
│   ├── uiManager.js        # 面板注册/显隐管理器
│   ├── uiComponents.js     # 通用组件:对话框/通知/确认框/图标渲染
│   ├── menuUI.js           # ESC 菜单 + 存档管理 + 全局通知桥
│   ├── flightUI.js         # 左侧工具栏 + 设施舱室面板 + 对接提示
│   ├── timeWarpUI.js       # 时间加速面板(常驻 HUD)
│   ├── sasUI.js            # 导航球/SAS 圆盘/可见性筛选(Canvas+DOM 混合)
│   ├── shipBuilderUI.js    # 飞船建造面板
│   ├── facilityDeployUI.js # 设施部署面板
│   ├── trackingUI.js       # 追踪站信息窗口 + 导航栏
│   ├── debugUI.js          # 调试面板(F1)
│   ├── shipDestroyedUI.js  # 飞船损毁结算面板(待 CSS 化)
│   └── styles/             # 全部样式(见 §4)
├── config/
│   ├── strings.js          # 全部用户可见文本 + t() 查询
│   └── menuConfig.js       # 主菜单/子菜单按钮数据(MENUS)
└── scenes/                 # 场景(注册进 sceneManager)
```

- **禁止**重新创建 `src/ui/ui.js`(阶段 0 已删除,历史遗留)。

### 3. 状态与通信

| 机制 | 用途 | 关键约定 |
|------|------|----------|
| `GameState` 单例 | 全局游戏状态 | 所有模块读写统一入口 |
| `eventBus` + `Events` | 模块间解耦通信 | UI 只订阅事件刷新,不直接轮询业务模块 |
| `uiManager` | DOM 面板注册/显隐 | `registerPanel(id, { element, show, hide, render })` |
| `sceneManager` | 场景切换 | DOM 场景页 enter 建 / exit 移除 |
| `t(key, params)` | 文本查询 | 缺失返回 key 本身,开启 `window.__DEBUG_STRINGS` 会 console.warn |

### 4. CSS 体系(阶段 2 成果)

**4.1 变量基石 `root.css`** — 约 40 个 CSS 变量,是所有颜色的唯一来源:

```
--panel-bg / --panel-bg-deep / --panel-bg-soft   面板底色
--card-bg / --card-bg-dark / --card-bg-light      卡片/槽位底
--border / --border-dark / --border-light         边框
--accent / --accent-bg / --accent-border          HUD 主蓝(高亮)
--danger / --danger-bg / --danger-border          危险红
--warn / --success / --refuel                     警告橙/成功绿/补给黄
--text-bright / --text-main / --text-mid / --text-dim / --text-faint
--ut-gold / --ut-gold-border                      时间标签金
--font-mono                                       等宽字体
```

**4.2 通用组件类**(定义于 root.css,全项目复用):

```
.ui-panel / .ui-panel-header / .ui-panel-title   面板骨架
.ui-btn / .ui-btn-sm / .ui-btn-danger / .ui-btn-primary   按钮四型
.ui-card / .ui-hint / .ui-divider / .ui-label / .ui-value  数据展示
```

**4.3 按场景拆分的 CSS 文件**(新增 UI 时按归属落位):

| CSS 文件 | 覆盖 | 主要 id/class 前缀 |
|----------|------|--------------------|
| `main_menu.css` | 主菜单 | `#mainMenuContainer` / `.mm-*` |
| `dialogs.css` | 通知 / 存档管理面板（0.2.6 对话框组件迁入 ksp2_panels.css） | `.ui-notification*` / `#archiveManagerPanel` |
| `ksp2_panels.css` | KSP2 覆盖式面板：设置页 / 开始游戏面板 / 通用对话框组件（0.2.6 由 settings.css + start_game.css 合并，并迁入 uiComponents 对话框样式） | `#settings*` / `.settings-*` / `#startGamePanel` / `.sgp-*` / `#newCampaignDialog` / `.nc-*` / `.ui-dialog*` / `.ui-list*` / `.ui-input` |
| `tracking.css` | 追踪站 | `#tracking*` / `.tracking-*` |
| `flight.css` | 飞行 HUD | `#leftToolbar` / `#toolbarPanel` / `#timeWarp*` / `#sasBottomButtons` / `#visibilityPanel` |
| `ship_builder.css` | 飞船建造 | `#shipBuilderPanel` / `.builder-*` |
| `facility.css` | 设施部署 | `#facilityDeployPanel` / `.deploy-*` |
| `scenes.css` | info/星系图鉴 | `.scene-fullscreen` / `.info-*` / `.galaxies-*` |
| `index.html` 内联 | 启动加载画面 | `#loadingScreen`(遗留,待外置) |

**4.4 布局与视觉分离原则**:
- **视觉样式**(底色/边框/圆角/字体/字号/字色/内边距)→ 一律写 CSS,引用变量。
- **布局定位**(`display` 切换 / `left` / `top` / `transform` / 依赖运行时计算的宽高)→ 允许 JS 内联。
- **静态固定定位**的容器 → 也进 CSS(id 选择器),与 JS 内联等价。
- **动态状态样式**(每帧/每次变化写入的 style,如选中色、灰显、边框状态色)→ 保留 JS 内联,但优先用 class 切换(`classList.toggle`)。
- **禁止在 JS 中硬编码色值/字体**;仅当该颜色是纯动态状态色且无对应变量时可例外(如 `#ff5050` 暂停红)。

### 5. 文本外置(阶段 1.5 成果)

- 所有用户可见文本 → `src/config/strings.js`,用 `t(key, params)` 引用。
- key 按功能前缀分组:`common.` `esc.` `archive.` `tracking.` `facility.` `dock.` `build.` `sas.` `timewarp.` `settings.` `info.` `deploy.` `galaxies.` `newgame.` `load.` `feedback.` `save.` `atmo.` 等。
- 动态命名文本进 `t('key', { name: xxx })` 插值;日期等复杂格式在插值函数内处理。
- **数据配置文本**(solarSystem/moduleTypes/facilityTypes/shipTemplates/encyclopediaConfig/menuConfig 的 label)属数据层,**不迁移**。

### 6. 事件绑定(阶段 4 成果)

- **禁止** `onclick=` / `onchange=` 字符串注入(全项目已清零,勿回归)。
- 静态元素 → `addEventListener('click', handler)` 直接绑定。
- 动态列表/重复渲染的元素 → **容器事件委托**:
  - 模板中写 `data-action="xxx"` + `data-*` 参数属性;
  - 模块级容器注册一次 `click`(或 `change`)监听,`e.target.closest('[data-action]')` 取目标,按 `data-action` 分发;
  - 委托只在 `data-action` 存在时生效,不影响容器内其他元素。
- 禁止在模板字符串里拼 JS 函数名。

### 7. window 全局清单(阶段 4 收敛后的白名单)

以下桥接是**合法**跨模块接口,可继续使用;除此之外**新增任何 window 全局前必须评估**——优先模块 `import`/命名导出。

| 全局 | 用途 |
|------|------|
| `window.showNotification(msg, type, duration)` | 全局通知(跨逻辑模块 79+ 处) |
| `window.__createDialog / __createInputDialog / __createConfirmDialog` | 对话框桥(main.js / shipBuilderUI 等) |
| `window.openSettings / startNewGame / continueGame / openLoadMenu / openArchiveManager / openFeedback` | main.js 入口 |
| `window.openShipBuilder / openFacilityDeployPanel` | 面板入口(flightUI 调用) |
| `window.renderToolbarIcons / showDockPrompt / hideDockPrompt` | flightScene ↔ flightUI |
| `window.__visibilityState / __toggleVisibility` | flightScene ↔ sasUI |
| `window.__pendingFacilityId` | trackingUI → flightScene |
| `window.updateTrackingInfo / hideTrackingInfo` | trackingScene ↔ trackingUI |
| `window.__shipSystem / __saveManager / __eventBus` 等单例 | console 调试访问 + 惰性跨模块访问 |
| `window._soiDiag / __DEBUG_STRINGS / __timeWarpKeyDebug` | 调试开关 |

**已被收敛、勿再使用**:`window.__renderWorldList` 等存档管理函数(已改 menuUI 命名导出)、`window.__toggleShipCategory` 等建造/部署内部函数、`window.formatSpeed` 等格式化函数、`window.switchToThrustMode` 等调试函数。

### 8. 数据驱动

- 菜单按钮 → `menuConfig.js` 的 `MENUS`(`main` / `game` / `extra`),action 协议:`back` / `submenu:X` / `scene:X` / `callback:X`。
- 飞船模板/模块/设施/天体 → `config/` 下对应数据文件,UI 只读渲染。
- 新 UI 若有"按钮列表/选项卡"等结构化数据,优先数据驱动而非硬编码循环。

---

## 第二部分:UI 添加原则

**新增一个面板/组件的标准流程**:

1. **立项定位**:先判断归属——是常驻 HUD(建一次)还是场景页(enter/exit);确定放哪个 CSS 文件。
2. **新建模块**:`src/ui/xxxUI.js`。文件头 `'use strict'`,4 空格缩进,单引号,命名导出。构建 DOM 用 `document.createElement` 或 `innerHTML`(不含 onclick 字符串),元素加 id/class。
3. **样式**:静态视觉样式写入对应 CSS 文件(引用 `var(--xxx)`);新建大组件才允许新增 CSS 文件(并加入 `index.html` link)。
4. **文本**:新增文案进 `strings.js`,代码里用 `t('新前缀.key')`。
5. **事件**:静态元素 `addEventListener`;重复列表用 `data-action` 委托。
6. **显隐**:注册进 `uiManager.registerPanel(id, { element, show, hide, render })`;若跨场景,订阅 `Events.SCENE_CHANGED`。
7. **数据**:结构化数据放 `src/config/`,UI 只读。
8. **接线**:若需跨模块调用,先查 §7 白名单桥接;必要时在 main.js import(副作用加载优先)。
9. **验证**:浏览器回归该组件 + 周边场景,确认无 JS 错误。

**新增原则速查(Do / Don't)**:

| 应该做 | 不应该做 |
|--------|----------|
| 颜色/字体走 CSS 变量 | JS 里写 `#333` / `monospace` |
| 文本走 `t()` | 中文/英文硬编码在 JS |
| `addEventListener` / `data-action` 委托 | `onclick="window.xxx()"` |
| 布局与视觉分离 | 一整坨 `style.cssText` 塞视觉+布局 |
| 优先 import 模块函数 | 随便新增 `window.__xxx` |
| 动态状态优先 `classList` 切换 | 每帧改 style 颜色 |

---

## 第三部分:UI 删除原则

**删除任何 UI 组件前,按序排查以下引用点(缺一不可)**:

1. **JS 引用**:`import` 该模块的文件(尤其 main.js 的副作用 import);`window.` 全局调用方。
2. **DOM 引用**:`getElementById` / `querySelector` / 事件委托 `data-action` 分支中的 id。
3. **CSS 引用**:该组件专属选择器是否被其他元素复用(如 `.ui-btn` 通用类不能删,`#escMenu` 专属可删)。
4. **文本引用**:`strings.js` 中对应 key 是否还有其他调用方。
5. **数据引用**:menuConfig / 配置文件中是否有该组件入口(action/scene)。

**标准删除步骤**:
1. 删除事件委托分支与 addEventListener 绑定;
2. 删除模块文件 + main.js import;
3. 删除专属 CSS 选择器(保留通用类);
4. 删除无引用的 strings key;
5. 删除 window 暴露(若有),并在 §7 清单中移除记录;
6. 全项目 grep 确认无残留引用;
7. 浏览器回归确认无 `undefined`/空白面板报错。

**注意**:删除面板类功能时,务必同步清理其在 `uiManager` 的注册、在 ESC 菜单/工具栏的入口,以及相关 strings 文案。

---

## 第四部分:UI 修改原则

1. **先改"数据与样式",不改逻辑**:文案 → strings.js;颜色/字号/间距 → CSS 变量或类;按钮列表 → menuConfig。只有当行为本身要变时才动 JS。
2. **保持架构边界**:不把 Canvas 内容改成 DOM,也不把 DOM UI 挪回 Canvas;场景页保持 enter 建/exit 移除的生命周期。
3. **改样式三问**:
   - 是视觉还是布局?(视觉→CSS,布局→JS/静态定位)
   - 是否能用已有变量/类?(避免引入同色新字面量)
   - 改 CSS 还是 JS 内联?(优先 CSS)
4. **改事件**遵循 §6(禁止 onclick;委托分支按 data-action)。
5. **改 window 桥接**:改签名前先 grep 所有调用方;删除桥接前确认无引用;新增桥接需列入 §7 清单。
6. **回归**:改动涉及的面板 + 其入口路径都要实测,尤其是动态内容(切换菜单/切换场景/多世界存档)路径。

---

## 第五部分:统一编码规范速查

```
- 文件首行:'use strict'
- 缩进:4 空格
- 引号:单引号
- 导出:命名导出(export function / export const)
- 临时代码:// TEMP: 标记
- 不确定处:// TODO: 注释说明
- 大文件避免并行编辑(历史教训:并行 Edit 同一文件有写入竞态)
- 修改接口前先查调用方依赖(import / window / data-action / strings key)
```

## 第六部分:验证流程(每次 UI 改动后)

1. `GetDiagnostics` 检查改动的 JS/CSS 无语法错误;
2. `grep` 确认无 `onclick=` / `onchange=` 回归、无残留 window 引用;
3. 浏览器回归:
   - 涉及面板打开/关闭/重开(生命周期);
   - 动态列表(多世界/多检查点/多分类)切换;
   - 场景切换进出(enter/exit 无残留 DOM);
   - 控制台无 JS error(红色)与 'xxx is not defined';
4. 通知与对话框(showNotification / createDialog / confirm)在新流程中仍正常。
