// UI 管理器模块

import { eventBus, Events } from '../eventBus.js';

// UIManager 单例类
class UIManager {
    constructor() {
        if (UIManager._instance) {
            return UIManager._instance;
        }
        UIManager._instance = this;
        this._panels = {};
        this._data = {};
    }

    // 注册面板
    registerPanel(id, config) {
        if (this._panels[id]) {
            console.warn(`[UIManager] 面板 ${id} 已存在，将被覆盖`);
        }
        this._panels[id] = {
            element: config.element,
            render: config.render || (() => {}),
            show: config.show || (() => {}),
            hide: config.hide || (() => {}),
            isVisible: false
        };
        return this;
    }

    // 注销面板
    unregisterPanel(id) {
        delete this._panels[id];
        delete this._data[id];
        return this;
    }

    // 更新面板数据
    setData(id, data) {
        this._data[id] = data;
        const panel = this._panels[id];
        if (panel && panel.isVisible) {
            panel.render(data);
        }
        return this;
    }

    // 获取面板数据
    getData(id) {
        return this._data[id];
    }

    // 显示面板
    showPanel(id) {
        const panel = this._panels[id];
        if (!panel) {
            console.warn(`[UIManager] 面板 ${id} 未注册`);
            return this;
        }
        // 仅 false→true 跳变时发出打开事件，防止重复/showPanel 时重复发声
        const wasVisible = panel.isVisible;
        panel.show();
        panel.isVisible = true;
        if (!wasVisible) {
            eventBus.emit(Events.UI_PANEL_OPENED, { panelId: id });
        }
        const data = this._data[id];
        if (data) {
            panel.render(data);
        }
        return this;
    }

    // 隐藏面板
    hidePanel(id) {
        const panel = this._panels[id];
        if (!panel) {
            console.warn(`[UIManager] 面板 ${id} 未注册`);
            return this;
        }
        // 仅 true→false 跳变时发出关闭事件；已隐藏时 hidePanel 静默
        const wasVisible = panel.isVisible;
        panel.hide();
        panel.isVisible = false;
        if (wasVisible) {
            eventBus.emit(Events.UI_PANEL_CLOSED, { panelId: id });
        }
        return this;
    }

    // 强制刷新面板
    refreshPanel(id) {
        const panel = this._panels[id];
        if (!panel) {
            console.warn(`[UIManager] 面板 ${id} 未注册`);
            return this;
        }
        const data = this._data[id];
        if (data) {
            panel.render(data);
        }
        return this;
    }

    // 检查面板是否可见
    isPanelVisible(id) {
        const panel = this._panels[id];
        return panel ? panel.isVisible : false;
    }
}

// 导出单例实例
export const uiManager = new UIManager();

// 在控制台暴露 uiManager，方便调试
if (typeof window !== 'undefined') {
    window.__uiManager = uiManager;
    console.log('[UIManager] 单例已创建，可通过 window.__uiManager 访问');
}
