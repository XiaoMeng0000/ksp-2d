'use strict';

import { sceneManager } from '../sceneManager.js';
import { eventBus, Events } from '../eventBus.js';
import { audioCore } from '../audio/audioCore.js';

let _container = null;
let _onKeyDown = null;
let _currentCategory = 'display';
let _previousScene = 'menu';

// 分类定义
const CATEGORIES = [
    { id: 'display',   label: '显示',  enabled: true },
    { id: 'audio',     label: '音频',  enabled: true },
    { id: 'control',   label: '控制',  enabled: false },
    { id: 'game',      label: '游戏',  enabled: false },
];

// 每个分类的说明文字
const CATEGORY_DESCRIPTIONS = {
    display: '选择菜单背景显示模式。星空模式会透出游戏星空背景，图片模式会加载自定义背景图。',
    audio:   '选择菜单背景音乐。KSP1 / KSP2 对应两首不同的菜单音乐。',
    control: '配置键盘映射、鼠标灵敏度等控制选项。（即将推出）',
    game:    '调整游戏难度、时间加速倍率等玩法参数。（即将推出）',
};

// 分段按钮组 — 生成 HTML
function _renderButtonGroup(name, options, currentValue, storageKey) {
    let html = `<div style="display:flex; gap:4px;">`;
    for (const opt of options) {
        const isSelected = opt.value === currentValue;
        const bg = isSelected ? 'rgba(136,204,255,0.2)' : 'rgba(0,0,0,0.85)';
        const color = isSelected ? '#88ccff' : '#ccc';
        const border = '1px solid #555';
        html += `<button data-group="${name}" data-value="${opt.value}" style="
            flex:1; padding:6px 16px; cursor:pointer;
            background:${bg}; color:${color}; border:${border};
            border-radius:5px; font-family:monospace; font-size:12px;
            transition:background 0.15s ease;
        ">${opt.label}</button>`;
    }
    html += `</div>`;
    return html;
}

// 设置行 — 左侧标签 + 右侧控件
function _renderSettingRow(label, controlHtml) {
    return `<div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.1);
    ">
        <div style="color:#ddd; font-size:13px;">${label}</div>
        <div style="flex:0 0 55%; max-width:320px;">${controlHtml}</div>
    </div>`;
}

// 分组标题条
function _renderGroupHeader(title) {
    return `<div style="
        background:rgba(0,0,0,0.5); color:#88ccff;
        padding:6px 12px; font-size:13px; margin-top:16px;
        border-radius:5px; border:1px solid #444;
    ">${title}</div>`;
}

function _renderNav(navEl) {
    let html = '<div style="color:#88ccff;margin-bottom:12px;font-size:14px;border-bottom:1px solid #444;padding-bottom:8px;">设置</div>';
    for (const cat of CATEGORIES) {
        const isActive = cat.id === _currentCategory;
        const color = cat.enabled
            ? (isActive ? '#88ccff' : '#ccc')
            : '#555';
        const cursor = cat.enabled ? 'pointer' : 'default';
        const bg = isActive ? 'rgba(80,80,160,0.4)' : 'transparent';
        html += `<div data-cat="${cat.id}" style="
            padding:8px 12px; margin-bottom:2px; cursor:${cursor};
            color:${color}; background:${bg}; border-radius:3px;
            font-size:13px;
        ">${cat.label}</div>`;
    }
    // 底部返回按钮
    html += `<div style="margin-top:auto; padding-top:12px; border-top:1px solid #444;">
        <div id="settingsBackBtn" style="
            padding:8px 12px; cursor:pointer; color:#88ccff;
            border:1px solid #555; border-radius:3px; text-align:center;
            font-size:13px;
        ">返回</div>
    </div>`;
    navEl.innerHTML = html;

    // 绑定分类点击
    navEl.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => {
            const catId = el.getAttribute('data-cat');
            const cat = CATEGORIES.find(c => c.id === catId);
            if (cat && cat.enabled) {
                _currentCategory = catId;
                _renderNav(navEl);
                _renderContent(contentEl);
            }
        });
    });

    // 绑定返回按钮
    const backBtn = navEl.querySelector('#settingsBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            sceneManager.switchTo(_previousScene);
        });
    }
}

let contentEl = null;

function _getMenuBgSetting() {
    return localStorage.getItem('ksp2d.menuBg') || 'stars';
}

function _setMenuBgSetting(value) {
    localStorage.setItem('ksp2d.menuBg', value);
}

function _getMenuMusicSetting() {
    return localStorage.getItem('ksp2d.menuMusic') || 'ksp2';
}

function _setMenuMusicSetting(value) {
    localStorage.setItem('ksp2d.menuMusic', value);
}

function _renderContent(content) {
    const cat = CATEGORIES.find(c => c.id === _currentCategory);
    if (!cat) return;

    // 内容区标题
    let html = `<div style="color:#88ccff;font-size:18px;margin-bottom:20px;border-bottom:1px solid #555;padding-bottom:10px;">${cat.label}</div>`;

    if (cat.enabled) {
        if (_currentCategory === 'display') {
            const currentBg = _getMenuBgSetting();

            // 菜单分组
            html += _renderGroupHeader('菜单');
            html += _renderSettingRow(
                '菜单背景',
                _renderButtonGroup('menuBg', [
                    { value: 'stars', label: '星空' },
                    { value: 'image', label: '图片' },
                ], currentBg, 'ksp2d.menuBg')
            );
        } else if (_currentCategory === 'audio') {
            const currentMusic = _getMenuMusicSetting();

            // 音乐分组
            html += _renderGroupHeader('音乐');
            html += _renderSettingRow(
                '菜单音乐',
                _renderButtonGroup('menuMusic', [
                    { value: 'ksp1', label: 'KSP1' },
                    { value: 'ksp2', label: 'KSP2' },
                ], currentMusic, 'ksp2d.menuMusic')
            );
        }
    } else {
        // 未启用的分类 — 灰色占位
        html += `<div style="color:#555;font-size:14px;margin-top:60px;text-align:center;">即将推出</div>`;
    }

    content.innerHTML = html;

    // 绑定分段按钮组事件
    content.querySelectorAll('button[data-group]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const group = btn.getAttribute('data-group');
            const value = btn.getAttribute('data-value');

            if (group === 'menuBg') {
                _setMenuBgSetting(value);
                // 重新渲染以更新按钮高亮
                _renderContent(contentEl);
            } else if (group === 'menuMusic') {
                _setMenuMusicSetting(value);
                _renderContent(contentEl);
                // 从菜单进入设置时立即试听新选择的菜单音乐
                if (_previousScene === 'menu') {
                    audioCore.playMusic('menu', value);
                }
            }
        });
    });
}

function registerSettingsScene() {
    sceneManager.registerScene('settings', {
        enter() {
            _currentCategory = 'display';

            // 记录当前场景作为返回目标（进入时 sceneManager 已切换到 settings
            // 但 SCENE_CHANGED 事件的 from 字段仍携带上一个场景 ID）
            const sceneChangeHandler = (data) => {
                if (data.to === 'settings' && data.from) {
                    _previousScene = data.from;
                }
                eventBus.off(Events.SCENE_CHANGED, sceneChangeHandler);
            };
            eventBus.on(Events.SCENE_CHANGED, sceneChangeHandler);

            _container = document.createElement('div');
            _container.style.cssText = `
                position:fixed; top:0; left:0; right:0; bottom:0;
                background:rgba(0,0,0,0.7); z-index:1000;
                display:flex; font-family:monospace; color:#fff;
                backdrop-filter:blur(4px);
            `;

            // 左侧导航栏（复用追踪站样式）
            const navEl = document.createElement('div');
            navEl.style.cssText = `
                width:280px; min-width:280px;
                background:rgba(0,0,0,0.85); border-right:1px solid #555;
                padding:15px; display:flex; flex-direction:column; gap:2px;
                font-size:12px; overflow-y:auto; box-sizing:border-box;
            `;

            // 右侧内容区（占满剩余空间）
            contentEl = document.createElement('div');
            contentEl.style.cssText = `
                flex:1; padding:20px 30px; overflow-y:auto;
            `;

            _container.appendChild(navEl);
            _container.appendChild(contentEl);
            document.body.appendChild(_container);

            _renderNav(navEl);
            _renderContent(contentEl);

            _onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    sceneManager.switchTo(_previousScene);
                }
            };
            document.addEventListener('keydown', _onKeyDown);
        },

        update() {
            // 无业务逻辑
        },

        render() {
            // 设置界面是 DOM，不走 Canvas
        },

        exit() {
            if (_onKeyDown) {
                document.removeEventListener('keydown', _onKeyDown);
                _onKeyDown = null;
            }
            if (_container) {
                document.body.removeChild(_container);
                _container = null;
            }
            contentEl = null;
        }
    });
}

export { registerSettingsScene };
