// 放大图轨道点菜单的常规验证（无需浏览器）：
// ① 菜单**只有一项**且动作是"创建机动节点"（总监定稿）
// ② 建节点语义与主视图轨道菜单一致（冻结时刻速度快照 → maneuverSystem.createNode →
//    成功/已存在/失败三类通知）
// ③ HUD 风格样式与交互（点轨道打开 / 点外部或 Esc 关闭 / 已存在节点时置灰）
// 用法: node tools/tests/test_maneuver_inset_menu.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 项目根(锚定到脚本位置,任意 cwd 均可运行)
const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

const src = readFileSync(join(PROJECT_ROOT, 'src/ui/maneuverViewPanel.js'), 'utf8');
const css = readFileSync(join(PROJECT_ROOT, 'src/ui/styles/maneuverPanel.css'), 'utf8');
const strings = readFileSync(join(PROJECT_ROOT, 'src/config/strings.js'), 'utf8');

// —— ① 只有一项
check('M1 菜单项创建点仅一处（mvp-menu-item）',
    (src.match(/el\('div', 'mvp-menu-item'/g) || []).length === 1);
check('M2 该项动作为创建机动节点（文案键 mvp.createNode）',
    /t\('mvp\.createNode'\)/.test(src));
check('M3 菜单不含其他动作（无删除/目标/加速等项）',
    !/mvp-menu-item[\s\S]{0,200}(删除|目标|加速|warp|delete)/.test(src));

// —— ② 建节点语义与主视图一致
check('M4 使用 walkToTime 取冻结时刻状态',
    /walkToTime\(segs, near\.absTime\)/.test(src));
check('M5 createNode 传参齐全（time/relX/relY/anchorBody/velRel）',
    /maneuverSystem\.createNode\(ship, \{[\s\S]{0,200}time: data\.absTime[\s\S]{0,200}relX: data\.relX[\s\S]{0,120}relY: data\.relY[\s\S]{0,120}anchorBody: data\.anchorBody[\s\S]{0,80}velRel: data\.relVel/.test(src));
check('M6 三类结果通知与主视图同文案键',
    /maneuver\.created/.test(src) && /maneuver\.alreadyExists/.test(src) && /maneuver\.createFailed/.test(src));

// —— ③ 交互与样式
check('M7 点轨道打开：命中阈值 24px 且用宿主系段搜索',
    /nearestOrbitPointInInset\(segs, p, host, 24\)/.test(src));
check('M8 拖拽末尾的 click 被忽略（_dragMoved）',
    /_dragMoved = true/.test(src) && /if \(_drag \|\| _dragMoved\)/.test(src));
check('M9 点外部关闭菜单（capture 阶段 pointerdown）',
    /_nodeMenu && !inMenu\) closeNodeMenu\(\)/.test(src));
check('M10 Esc 关闭菜单', /e\.key === 'Escape'[\s\S]{0,80}closeNodeMenu\(\)/.test(src));
check('M11 已存在节点时该项置灰（disabled）',
    /mvp-menu-item' \+ \(exists \? ' disabled' : ''\)/.test(src));
check('M12 HUD 风格样式齐备（黑底/轨道绿/等宽小字）',
    /\.mvp-menu \{[\s\S]*?background: #000000;[\s\S]*?border: 1px solid var\(--progress-green\)/.test(css)
    && /\.mvp-menu-item\.disabled \{[\s\S]*?color: #6B737A/.test(css)
    && /\.mvp-menu \{[\s\S]*?font-family: var\(--font-mono\)/.test(css));

// —— ④ 文案存在
check('M13 文案 mvp.createNode = 创建机动节点',
    /'mvp\.createNode': '创建机动节点'/.test(strings));
check('M14 文案 mvp.menuTitleSuffix 存在', /'mvp\.menuTitleSuffix':/.test(strings));

// —— ⑤ 悬停反馈（0.3.0）：指针图标 + HUD 悬停标记
check('M15 悬停指针：手柄/节点 = grab，轨道 = pointer，其余 default',
    /cursor = 'grab'/.test(src) && /cursor = 'pointer'/.test(src) && /let cursor = 'default'/.test(src));
check('M16 拖拽中指针变 grabbing，离开画布复位 default',
    /_drag\) \{[\s\S]{0,120}style\.cursor !== 'grabbing'/.test(src)
    && /function onInsetLeave\(\)[\s\S]{0,160}style\.cursor !== 'default'/.test(src));
check('M17 仅变化时写 style.cursor（避免逐帧样式写入）',
    /if \(_insetCanvas\.style\.cursor !== cursor\) _insetCanvas\.style\.cursor = cursor;/.test(src));
check('M18 悬停标记：十字准星 + T- 读数（HUD 风格）',
    /if \(_hover && !_drag\)/.test(src)
    && /ctx\.fillText\('T-' \+ formatTCountdown\(remain\), hx \+ 10, hy - 10\)/.test(src));
check('M19 悬停命中用与点击一致的 24px / 手柄与节点命中半径',
    /nearestOrbitPointInInset\(segs, p, host, 24\)/.test(src)
    && /MANEUVER_CONFIG\.handleHitRadius/.test(src) && /MANEUVER_CONFIG\.nodeHitRadius/.test(src));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
