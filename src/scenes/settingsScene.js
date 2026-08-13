'use strict';

import { sceneManager } from '../sceneManager.js';
import { eventBus, Events } from '../eventBus.js';
import { audioCore } from '../audio/audioCore.js';
import { t } from '../config/strings.js';

let _container = null;
let _onKeyDown = null;
let _currentCategory = 'display';
let _previousScene = 'menu';

// 分类定义
const CATEGORIES = [
    { id: 'display',   label: t('settings.tabDisplay'),   enabled: true },
    { id: 'audio',     label: t('settings.tabAudio'),     enabled: true },
    { id: 'control',   label: t('settings.tabControl'),   enabled: false },
    { id: 'game',      label: t('settings.tabGame'),      enabled: false },
];

// 每个分类的说明文字
const CATEGORY_DESCRIPTIONS = {
    display: t('settings.descDisplay'),
    audio:   t('settings.descAudio'),
    control: t('settings.descControl'),
    game:    t('settings.descGame'),
};

// 分段按钮组 — 生成 HTML
function _renderButtonGroup(name, options, currentValue, storageKey) {
    let html = `<div class="settings-btn-group">`;
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
    return `<div class="settings-row">
        <div class="settings-row-label">${label}</div>
        <div class="settings-row-control">${controlHtml}</div>
    </div>`;
}

// 分组标题条
function _renderGroupHeader(title) {
    return `<div class="settings-group-header">${title}</div>`;
}

function _renderNav(navEl) {
    let html = '<div class="settings-nav-title">' + t('settings.title') + '</div>';
    for (const cat of CATEGORIES) {
        const isActive = cat.id === _currentCategory;
        const color = cat.enabled
            ? (isActive ? '#88ccff' : '#ccc')
            : '#555';
        const cursor = cat.enabled ? 'pointer' : 'default';
        const activeClass = isActive ? ' active' : '';
        html += `<div data-cat="${cat.id}" class="settings-cat${activeClass}" style="
            cursor:${cursor}; color:${color};
        ">${cat.label}</div>`;
    }
    // 底部返回按钮
    html += `<div style="margin-top:auto; padding-top:12px; border-top:1px solid #444;">
        <div id="settingsBackBtn" class="settings-back-btn">${t('common.back')}</div>
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
    let html = `<div class="settings-content-title">${cat.label}</div>`;

    if (cat.enabled) {
        if (_currentCategory === 'display') {
            const currentBg = _getMenuBgSetting();

            // 菜单分组
            html += _renderGroupHeader(t('settings.groupMenu'));
            html += _renderSettingRow(
                t('settings.menuBg'),
                _renderButtonGroup('menuBg', [
                    { value: 'stars', label: t('settings.bgStars') },
                    { value: 'image', label: t('settings.bgImage') },
                ], currentBg, 'ksp2d.menuBg')
            );
        } else if (_currentCategory === 'audio') {
            const currentMusic = _getMenuMusicSetting();

            // 音乐分组
            html += _renderGroupHeader(t('settings.groupMusic'));
            html += _renderSettingRow(
                t('settings.menuMusic'),
                _renderButtonGroup('menuMusic', [
                    { value: 'ksp1', label: 'KSP1' },
                    { value: 'ksp2', label: 'KSP2' },
                ], currentMusic, 'ksp2d.menuMusic')
            );
        }
    } else {
        // 未启用的分类 — 灰色占位
        html += `<div style="color:#555;font-size:14px;margin-top:60px;text-align:center;">${t('settings.comingSoon')}</div>`;
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
            _container.id = 'settingsContainer';

            // 左侧导航栏（复用追踪站样式）
            const navEl = document.createElement('div');
            navEl.id = 'settingsNav';

            // 右侧内容区（占满剩余空间）
            contentEl = document.createElement('div');
            contentEl.id = 'settingsContent';

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
