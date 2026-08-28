# UI 面板视觉风格规范(KSP2 Design Language)

> 适用版本:0.2.7 视觉风格体系固化后
> 本文档是**视觉层规范**,与 `UI开发规范.md`(结构与流程规范)配套使用:
> 结构/事件/文本走 UI 开发规范;颜色/组件/层级/绘制走本规范。

---

## 一、总设计原则

1. **一套视觉语言,全局复用**:所有面板/HUD 使用同一组 CSS 变量与组件类,禁止局部另起炉灶。
2. **层级靠"明度分层 + 紫头条"表达**:面板壳最浅(`--theme-bg`),内容卡最深(`--theme-panel-deep`),分区/卡片头用紫头条(`--theme-btn-selected`)。
3. **内部卡默认无边框**:卡与卡之间靠底色差 + 圆角区分;只有"面板壳/外框"才用描边。
4. **Canvas 与 DOM 同色系**:Canvas 无法读 CSS 变量,绘制常量必须在注释中标注对应的变量值(如 `PANEL_BORDER_COLOR = '#6153D0' // --toolbar-border`)。
5. **颜色唯一来源**:新增色值一律进 `root.css` / `theme.css` 变量,业务代码与 CSS 均引用变量。

---

## 二、色彩变量体系

### 2.1 面板底色(`theme.css`)

| 变量 | 值 | 用途 |
|------|----|------|
| `--theme-bg` | `#2E3540` | 面板壳 / 最外层容器底(最浅) |
| `--theme-panel` | `#1C212A` | 面板/内容区底(列表、面板内分区) |
| `--theme-panel-deep` | `#14191F` | 更深底:分类项、卡片、二级背景(最深) |
| `--theme-hover` | `#080B0F` | 行/卡片 hover 底 |
| `--theme-btn-bg` | `#0F1318` | 按钮底 |
| `--theme-btn-selected` | `#4852AF` | 选中按钮底 / **紫头条** |
| `--theme-active-bg` | `rgba(80,80,160,0.4)` | 选中项高亮底 |

### 2.2 边框(`theme.css`)

| 变量 | 值 | 用途 |
|------|----|------|
| `--theme-border` | `#676767` | 通用边框(灰) |
| `--theme-border-hover` | `#4B758A` | 边框悬停(蓝) |
| `--theme-border-row` | `#060709` | 行分隔线 / 深色细线 |
| `--theme-card-border` | `#2E3555` | 工具卡描线(深蓝紫) |
| `--theme-menu-border` | `#5A5FCF` | **面板壳外框紫**(工具面板/建造/部署/百科/设置系) |
| `--toolbar-border` | `#6153D0` | **工具栏/SAS 紫框**(`--theme-menu-border` 明度 -10%) |

### 2.3 文本与语义色(`root.css`)

| 变量 | 值 | 用途 |
|------|----|------|
| `--text-bright` | `#fff` | 亮白(标题/数值/重点) |
| `--text-main` | `#ddd` | 正文 |
| `--text-mid` | `#aaa` | 次要信息 |
| `--text-dim` | `#666` | 弱化信息 |
| `--text-faint` | `#555` | 占位/注释 |
| `--text-danger` | `#ff5566` | 危险文本 |
| `--accent` | `#88ccff` | HUD 主蓝(高亮/选中/分区标题) |
| `--danger` / `--warn` / `--success` | `#ff6666` / `#ffaa44` / `#6775FB` | 危险红 / 警告橙 / 成功 |
| `--ut-gold` | `#d4c86a` | 时间金 / 价格金 |
| `--progress-green` | `#3dff3d` | **进度条绿 / 选中态绿条**(全项目统一) |
| `--hud-bg` | `#0d0d0d` | 玩家 HUD 背景(深黑实色) |

### 2.4 字体(`root.css`)

| 变量 | 字体 |
|------|------|
| `--font-mono` | JetBrainsMono-Regular |
| `--font-mono-bold` | JetBrainsMono-Bold |
| `--font-pixel` | PixeledFont(像素风标题可选) |

> 所有 `@font-face` 带 `font-display: swap`(防 FOIT 文本不可见)。
> 加载页等"字体本身是加载资源"的场景使用回退字体 `monospace`(防加载后尺寸跳动)。

---

## 三、组件规范

### 3.1 面板壳(三大面板 + 设置/百科系)

```css
background: var(--theme-bg);
border: 1px solid var(--theme-menu-border);   /* 面板壳紫描边 */
border-radius: 5px;
```

- 代表:`#toolbarPanel`(飞行工具面板)、`#shipBuilderPanel`、`#facilityDeployPanel`、`#encyclopediaPanel`。
- **紫框外另加 2px 黑框**(仅飞行 HUD 组件)时用:
  ```css
  box-shadow: 0 0 0 2px #000;   /* 跟随圆角,不占布局 */
  ```

### 3.2 紫头条(分区/卡片头)

```css
background: var(--theme-btn-selected);
color: var(--text-bright);
font-family: var(--font-mono-bold);
font-weight: normal;
letter-spacing: 1px;
```

- 用于:资源分组卡头、百科条目卡头、加载面板头、面板页头等。
- **分区标题(非头)**:`// 前缀 + --accent`(如 `.tkp-section` / `.enc-content-title`)。

### 3.3 内部卡(无边框原则)

| 类 | 底 | 圆角 | 用途 |
|----|----|------|------|
| `.tkp-card` | `--theme-panel-deep` | 5px | 大卡(目标/信息) |
| `.tkp-card-sm` | `--theme-panel-deep` | 5px | 次级卡(行列表) |
| `.tkp-slot` | `--theme-panel-deep` | 5px | 槽位/飞船卡 |
| `.tkp-info` | `--theme-panel-deep` | 5px | label+value 小卡 |
| `.tkp-res-group-card` | `--theme-panel-deep` | 5px | 资源分组卡(紫头+卡体) |

> 均为 `border: none`;导航球一级背景色为 `#0d1015`(`NAVBALL_PLATE_BG`,与 `--hud-bg` 同族深黑)。

### 3.4 按钮

```css
height: 26~28px; padding: 0 12px; border-radius: 5px;
background: var(--theme-btn-bg); color: var(--text-bright);
border: 1px solid var(--border-light);
:hover { border-color: var(--theme-border-hover); }
```

- 主按钮(`.tkp-btn-primary`):`background: var(--theme-btn-selected)`,hover 提亮。
- 行内小按钮:`flex: none`,高度 18~20px,字号 10px(容器内由布局控制)。

### 3.5 进度条 / 资源条

- 桶底:8~10px 高,`--theme-panel(-deep)`,圆角 4px;填充统一 `--progress-green`(语义例外:`--accent` 蓝/`--ut-gold` 金仅限资源/字体加载条)。
- **资源条行**:名称(条外左侧)、绿条(条内无文字)、数量(条外右侧);0 量**空槽常显**(条不消失)。
- 燃料条:`标签 + 条 + 数量(带单位)`。

### 3.6 折叠交互

- 组头(紫条)可点击折叠,**折叠后仅剩紫头条**;
- 交互:`data-action` 容器委托 + `classList.toggle('collapsed')`,CSS 隐藏卡体/旋转箭头(纯 DOM 切换,不重渲染)。

### 3.7 左侧工具栏(飞行 HUD)

```css
background: #000; border: 1px solid var(--toolbar-border);
box-shadow: 0 0 0 2px #000;   /* 紫框外 2px 黑框 */
```

- 裸图标行(无方框底)+ 右侧状态竖条:未选中 `--border-dark` 暗条 / 选中(已打开入口)`--progress-green` 绿条;
- 打开面板/建造/部署面板时 `active`,面板关闭(UI_PANEL_CLOSED)或切场景时清除。

### 3.8 SAS 模块

- 导航球:**一级背景圆盘** `#0d1015` 实色 + **黑-紫双层描边**(黑衬 2px 在外,紫 1.5px 在内,几何无缝);球内容整体缩小(`NAVBALL_CONTENT_SCALE`),二级背景(黑球)距外框 15px。
- 节流阀弧(自下而上):黑色环带底(二级背景)→ 未填充弧(暗紫 `#06060d`)→ 激活填充弧(项目绿 `#3dff3d`),内容距边框 5px(露出黑底);双层描边同导航球。
- SAS 按钮框:黑底 + `--toolbar-border` 紫框 + 2px 黑外框。

### 3.9 模块选择弹窗(`.module-selector-popup`)

- 外壳:`--theme-bg` + 1px `--theme-menu-border` 紫描边,圆角 5px;
- 分类 = 紫头卡(可折叠),行 hover `--accent-bg`,价格金字 `--ut-gold`;
- 已安装提示 / 卸载危险行(`.msp-installed` / `.msp-uninstall`)。

### 3.10 滚动条(全局)

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-dark); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--theme-border-hover); }
/* Firefox */
* { scrollbar-width: thin; scrollbar-color: var(--border-dark) transparent; }
```

- **排除**:设置页 `#settingsContainer` 还原浏览器默认外观(见 ksp2_panels.css 末尾)。

### 3.11 加载页(启动画面)

- 面板壳(蓝灰 + 紫描边)→ 紫头(`// 启动加载`)→ 提示分区(`--theme-panel-deep`)→ 内容卡(`--theme-panel-deep`)+ 三条进度槽(同类底色;填充 `--accent`/`--progress-green`/`--ut-gold`);
- 字体统一回退 `monospace`(防加载后尺寸跳动);文本 id 全部保留供 main.js 更新。

### 3.12 文档页(版权声明 / 制作人员)

- 半透明黑遮罩 `rgba(0,0,0,0.6)` + `backdrop-filter: blur(10px)`;
- 顶部 `// 标题`(`--accent` 蓝)+ 装饰线;正文左对齐流(license)或双列格网(credits 角色右对齐/名字左对齐,节标题 `--warn` 橙);
- 左下角标准返回按钮(Esc 可关)。

---

## 四、层级速查

| 层级 | 用什么 |
|------|--------|
| 最外层壳 / 面板 | `--theme-bg` + 紫描边(`--theme-menu-border`) |
| 分区标题 | `// ` 前缀 + `--accent` |
| 卡/分组头 | 紫头条 `--theme-btn-selected` + `--font-mono-bold` |
| 二级背景 / 内容卡 | `--theme-panel-deep`(无边框,圆角 4~5px) |
| 行 hover | `--theme-hover` / `--accent-bg` |
| 文本 | 标题/重点 `--text-bright` → 正文 `--text-main` → 弱化 `--text-dim` |

## 五、新增 UI 时的检查清单

1. 颜色是否引用了本规范的变量?(禁止新硬编码色值)
2. 有无可复用的 `.tkp-*` / `.doc-*` / `.msp-*` / `.enc-*` 类?
3. 结构是否遵循"外壳→分区/紫头→内部无边框卡"?
4. Canvas 绘制色值是否在注释中标明对应变量?
5. 滚动区域是否有统一滚动条?若为设置页请保持排除。
6. 文本是否全部走 `strings.js`?

---

> 本规范随视觉演进更新;历史版本以"0.2.7"为基线,后续变更需同步更新本文档对应条目。
