// UI 管理器模块

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
        panel.show();
        panel.isVisible = true;
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
        panel.hide();
        panel.isVisible = false;
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
