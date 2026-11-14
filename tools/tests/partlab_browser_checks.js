"use strict";

// 浏览器内运行：进入实验室后 import('/tools/tests/partlab_browser_checks.js').then(m => m.runPartLabChecks())。
// 用真实场景监听器与 DOM 事件验证接线；合成事件不替代人工手感和截图验收。
import { gameState } from '../../src/gameState.js';
import { sceneManager } from '../../src/sceneManager.js';
import { applyEdit } from '../../src/partlab/editorTransactions.js';
import { projectToScreen } from '../../src/ship/shipMath3D.js';

export function runPartLabChecks() {
    if (sceneManager.getCurrentScene() !== 'partlab') throw new Error('请先进入实验室');
    // 启动时的「最新消息 / 公告」可能覆盖视口，先确定性地关掉再测点击。
    const dismiss = (selector) => {
        const panel = document.querySelector(selector);
        if (panel) panel.parentElement?.removeChild(panel);
    };
    const hideUi = (id) => {
        try { window.__uiManager?.hidePanel?.(id); } catch (e) { /* 未注册时忽略 */ }
    };
    hideUi('latestNews');
    hideUi('announcement');
    dismiss('#latestNewsPanel');
    dismiss('#announcementPanel');
    const results = [];
    const pl = window.__partLab;
    const canvas = document.getElementById('canvas');
    const session = () => gameState.getPartLabSession();
    const snapshot = () => JSON.stringify(session().design);
    const check = (condition, message) => {
        if (!condition) throw new Error(message);
    };
    const test = (name, run) => { run(); results.push(name); };
    const send = (target, type, point, extras = {}) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0,
        clientX: point.x, clientY: point.y, ...extras
    }));
    const project = position => {
        const rect = canvas.getBoundingClientRect();
        const p = projectToScreen(pl.camera.getViewProjMatrix(canvas.width, canvas.height), position, canvas.width, canvas.height);
        return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + p.y * rect.height / canvas.height };
    };
    const clickCanvas = (point, extras = {}) => {
        if (document.elementFromPoint(point.x, point.y) !== canvas) {
            // 启动期的「最新消息」可能在异步后弹回，拦住一次再判。
            dismiss('#latestNewsPanel');
            dismiss('#announcementPanel');
        }
        check(document.elementFromPoint(point.x, point.y) === canvas, '测试目标被面板遮挡，请扩大浏览器视口');
        send(canvas, 'pointerdown', point, extras);
        send(canvas, 'pointerup', point, extras);
    };
    const key = (key, code = key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    const button = action => document.querySelector(`[data-action="${action}"]`).click();
    const pick = id => {
        const tile = document.querySelector(`.vab-part-tile[data-part-type="${id}"]`);
        const rect = tile.getBoundingClientRect();
        const p = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        send(tile, 'pointerdown', p);
        send(tile, 'pointerup', p);
        check(tile.isConnected, '拿起时不能重建零件格DOM');
    };

    test('属性滑块预览隔离、一次历史、撤销重做', () => {
        pl.loadPreset('preset_k2_standard');
        const before = snapshot();
        clickCanvas(project(session().design.parts[1].position), { button: 2 });
        const slider = document.querySelector('[data-paw-prop="res:hydrogen"]');
        check(slider, '右键没有打开储罐属性');
        send(slider, 'pointerdown', { x: 0, y: 0 });
        for (const amount of [160, 130, 100]) {
            slider.value = amount;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        check(snapshot() === before && session().undo.length === 0, '拖动污染正式设计或产生多条历史');
        check(slider === document.querySelector('[data-paw-prop="res:hydrogen"]'), '滑块在拖动中被重建');
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        const after = snapshot();
        check(session().undo.length === 1 && after !== before, '属性没有一次性提交');
        button('undo');
        check(snapshot() === before, '属性撤销错误');
        button('redo');
        check(snapshot() === after, '属性重做错误');
    });

    test('完整两件组件预览、相机拖动不取消、Esc原样恢复', () => {
        const before = snapshot();
        const history = session().undo.length;
        button('paw-pickup');
        const point = { x: innerWidth * 0.65, y: innerHeight * 0.5 };
        send(canvas, 'pointermove', point);
        check(session().held.parts.length === 2 && pl.preview.ghostParts.length === 2, '手持后代丢失');
        check(session().held.parts[0].resourceAmounts.hydrogen === 100, '移动把半箱油恢复为满箱');
        check(snapshot() === before, '预览修改了主船');
        send(canvas, 'pointerdown', point, { button: 2 });
        const end = { x: point.x + 30, y: point.y + 15 };
        send(canvas, 'pointermove', end, { buttons: 2 });
        send(canvas, 'pointerup', end, { button: 2 });
        check(session().held && snapshot() === before, '相机拖动误安装或取消');
        key('Escape');
        check(!session().held && snapshot() === before && session().undo.length === history, '取消未精确恢复');
    });

    test('目录点击拿起、工具栏不丢手持、原位节点安装', () => {
        pl.loadPreset('preset_k2_standard');
        pick('tank_fl_t200');
        const control = document.getElementById('vabSymDisc');
        const rect = control.getBoundingClientRect();
        const p = { x: rect.left + 5, y: rect.top + 5 };
        send(control, 'pointerdown', p);
        send(control, 'pointerup', p);
        control.click();
        check(session().held, '工具栏点击丢失手持');
        const target = project([0, -3.9, 0]);
        send(canvas, 'pointermove', target);
        check(pl.preview.valid, '有效轴向节点未吸附');
        clickCanvas(target);
        check(session().design.parts.length === 4 && session().undo.length === 1 && !session().held, '目录件未一次提交');
    });

    test('对称四件整枝移动保留IDs和子件属性，一次undo/redo', () => {
        pl.loadPreset('preset_deep_explorer');
        applyEdit(session(), draft => {
            for (const id of ['p4', 'p5']) {
                const p = draft.parts.find(part => part.id === id);
                p.resourceAmounts = { hydrogen: 25, oxygen: 200 };
                draft.parts.push({
                    id: 'child_' + id, typeId: 'engine_lv909', parentId: id,
                    attachMode: 'node', parentNodeId: 'bottom', selfNodeId: 'top',
                    position: [p.position[0], p.position[1] - 1.2, p.position[2]], rotationY: p.rotationY,
                    thrustLimit: 0.42, stage: 3, symmetryCount: 1, symmetryGroupId: null
                });
            }
        });
        // 场景正常事件刷新（不写调试钩子的 design）。
        button('cycle-symmetry');
        const before = snapshot(), history = session().undo.length;
        // 左键按下即拎起（KSP 习惯），再移到目标点松手放置。
        const p4Point = project(session().design.parts.find(p => p.id === 'p4').position);
        send(canvas, 'pointerdown', p4Point);
        check(session().held && session().held.parts.length === 4, '左键按下没有拎起对称整枝');
        const target = project([0, -1, 0.6]);
        send(canvas, 'pointermove', target, { buttons: 1 });
        check(pl.preview.ghostParts.length === 4 && pl.preview.valid, '对称整枝预览错误');
        clickCanvas(target);
        const after = snapshot();
        check(before !== after && session().undo.length === history + 1, '整枝没有一次提交');
        check(session().design.parts.find(p => p.id === 'child_p4').thrustLimit === 0.42, '子件状态丢失');
        button('undo');
        check(snapshot() === before, '整枝撤销不精确');
        button('redo');
        check(snapshot() === after, '整枝重做不精确');
    });

    test('目录拖出松手安装、删除已有手持组件可撤销', () => {
        pl.loadPreset('preset_k2_standard');
        const tile = document.querySelector('.vab-part-tile[data-part-type="tank_fl_t200"]');
        const rect = tile.getBoundingClientRect();
        const start = { x: rect.left + 10, y: rect.top + 10 };
        send(tile, 'pointerdown', start);
        const target = project([0, -3.9, 0]);
        send(canvas, 'pointermove', target, { buttons: 1 });
        send(canvas, 'pointerup', target);
        check(session().design.parts.length === 4 && !session().held, '目录拖出松手没有提交');
        button('undo');
        const before = snapshot();
        // 左键按下即拎起整枝，再点删除按钮移除该组件。
        send(canvas, 'pointerdown', project(session().design.parts[1].position));
        check(session().held && session().held.parts.length === 2, '按下未拎起整枝');
        button('delete-selected');
        check(session().design.parts.length === 1 && !session().held, '删除未移除整枝');
        button('undo');
        check(snapshot() === before, '删除整枝不能完整撤销');
    });

    test('pointercancel取消属性草稿、不记录历史', () => {
        pl.loadPreset('preset_k2_standard');
        clickCanvas(project(session().design.parts[1].position), { button: 2 });
        const before = snapshot();
        const slider = document.querySelector('[data-paw-prop="res:hydrogen"]');
        send(slider, 'pointerdown', { x: 0, y: 0 });
        slider.value = 50;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        send(slider, 'pointercancel', { x: 0, y: 0 });
        check(!session().edit && snapshot() === before && session().undo.length === 0, 'pointercancel提交了草稿');
    });

    test('左键点一下就拎起、松手仍在手上、放件后不残留选中', () => {
        pl.loadPreset('preset_k2_standard');
        const partPoint = project(session().design.parts[1].position);

        // 单击（按下+松开，不移动）→ 立刻拎起整枝，并且松手后仍在手上
        send(canvas, 'pointerdown', partPoint);
        check(session().held && session().held.parts.length === 2, '左键按下没有立即拎起');
        send(canvas, 'pointerup', partPoint);
        check(session().held && session().held.parts.length === 2, '松手后不应自动放下');
        check(session().design.parts.length === 3, '拿起阶段不应改动设计');
        check(session().undo.length === 0, '拿起不应产生历史');

        // 移到原节点单击 → 安装
        const target = project([0, -0.9, 0]);
        send(canvas, 'pointermove', target, { buttons: 0 });
        check(pl.preview.valid, '回到原节点未吸附');
        clickCanvas(target);
        check(!session().held && session().design.parts.length === 3, '再次单击未完成安装');

        // 放件后不应残留选中/属性窗（不必再点一下空白处）
        check(!document.getElementById('vabPartInspector').classList.contains('open'), '放件后仍打开属性窗');
        const before = snapshot();
        const empty = { x: innerWidth * 0.78, y: innerHeight * 0.2 };
        if (document.elementFromPoint(empty.x, empty.y) === canvas) {
            clickCanvas(empty);
            check(snapshot() === before && !session().held, '点空白处不应改动设计');
        }
    });

    test('退出实验室清理手持会话，不修改战役', () => {
        button('close-paw');
        const campaign = JSON.stringify(gameState.getAllShipsRef());
        pick('tank_fl_t200');
        sceneManager.switchTo('menu');
        check(gameState.getPartLabSession() === null, '退出后会话仍残留');
        check(!document.getElementById('partLabContainer'), '退出后DOM残留');
        check(JSON.stringify(gameState.getAllShipsRef()) === campaign, '实验室修改战役飞船');
        sceneManager.switchTo('partlab');
        check(session().undo.length === 0 && !session().held, '重进场景残留历史或手持');
    });
    return { passed: results.length, results };
}
