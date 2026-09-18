// 0.2.6 公告与版本号校验（对照 docs/公告编写规范.md；无需浏览器）
// 用法: node test_announcement_026.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

const { VERSION_TEXT } = await import('./src/config/version.js');
const { ANNOUNCEMENTS } = await import('./src/config/announcementConfig.js');

// —— 版本号
check('A1 VERSION_TEXT = v0.2.6', VERSION_TEXT === 'v0.2.6');

// —— 当前版本公告存在且置顶
check('A2 存在 v0.2.6 公告条目', ANNOUNCEMENTS.some(a => a.version === 'v0.2.6'));
check('A3 当前版本公告排在最前（自动排序）', ANNOUNCEMENTS[0].version === 'v0.2.6');
const cur = ANNOUNCEMENTS[0];
check('A4 大标题格式为「轨道工程师 0.2.6」', cur.title === '轨道工程师 0.2.6');

// —— 结构校验（规范第二/三章）
const titles = cur.sections.map(s => s.title);
check('A5 卡片数量合理（6–12 张）', cur.sections.length >= 6 && cur.sections.length <= 12);
check('A6 首尾卡片为「引言」「结语」', titles[0] === '引言' && titles[titles.length - 1] === '结语');

// 大纲编号：一、/ 1. / 1、/ (1) / 第 X 部分 —— 但**版本号前缀（如「0.2.5 回顾」）不算编号**（规范 2.3 示例即为版本号短语）
const outlineRe = /^(\s*)([一二三四五六七八九十]+、|(?!\d+\.\d)\d+[.、)]|\(\d+\)|（\d+）|第[一二三四五六七八九十\d]+[部分章节])/;
check('A7 卡片标题无大纲编号（禁「一、」「1.」「第 X 部分」）',
    titles.every(t => !outlineRe.test(t)));
check('A8 卡片标题末尾无句号', titles.every(t => !t.endsWith('。')));
check('A9 卡片标题无半角括号补注', titles.every(t => !/[()]/.test(t)));

const mdRe = /(\*\*|^#|^- |^\d\. |`)/;
const allParas = cur.sections.flatMap(s => s.paragraphs);
check('A10 正文为纯文本（无 Markdown 语法）', allParas.every(p => typeof p === 'string' && !mdRe.test(p)));
check('A11 正文无非空校验通过（全部为字符串且非空）', allParas.every(p => typeof p === 'string' && p.trim().length > 0));
check('A12 正文不含换行模拟（不用 \\n 造列表）', allParas.every(p => !p.includes('\n')));

// —— 内容口径（与实现一致的关键点）
const text = allParas.join('\n');
check('A13 说明"链上串行 / 每级一个"的核心规则', /机动后轨道/.test(text) && /每一级只允许一个节点/.test(text));
check('A14 说明"数量不设上限"', /数量不设上限/.test(text));
check('A15 说明"执行目标 = 下一个未完成节点"', /下一个未完成节点/.test(text));
check('A16 说明"删除只删选中 + 后续自动重接"', /删除只删除当前选中的节点/.test(text) && /重新接到前一个节点/.test(text));
check('A17 说明"前序编辑 → 后续自动跟随"', /会自动重新落到新的链上/.test(text));
check('A18 已知问题里不再宣称"单节点限制"',
    !/只支持一个未执行节点|单节点实现/.test(text) && /计划重算按帧分摊/.test(text));
check('A19 保留 0.2.5 回顾卡片', titles.includes('0.2.5 回顾'));
check('A20 体验重点卡片存在且条目 ≥ 5', (() => {
    const s = cur.sections.find(x => x.title === '体验重点');
    return !!s && s.paragraphs.length >= 5;
})());

// —— 其它版本公告不受影响
check('A21 历史版本公告仍在（v0.2.5 / v0.2.4）',
    ANNOUNCEMENTS.some(a => a.version === 'v0.2.5') && ANNOUNCEMENTS.some(a => a.version === 'v0.2.4'));
check('A22 常驻条目（无版本号）仍在列表末尾', (() => {
    const last = ANNOUNCEMENTS[ANNOUNCEMENTS.length - 1];
    return !/^v?\d/.test(String(last.version));
})());

// —— 源码注释里不应残留旧版本号描述为当前版本
const versionSrc = readFileSync('src/config/version.js', 'utf8');
check('A23 version.js 注释示例同步为 0.2.6', /v0\.2\.6/.test(versionSrc) && !/VERSION_TEXT = 'v0\.2\.5'/.test(versionSrc));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
