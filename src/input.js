// 键盘输入管理器

class InputManager {
    constructor() {
        if (InputManager._instance) {
            return InputManager._instance;
        }
        InputManager._instance = this;
        this._keys = {};
        this._prevKeys = {};
        this._enabled = false;
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
    }

    _onKeyDown(e) {
        this._keys[e.code] = true;
    }

    _onKeyUp(e) {
        this._keys[e.code] = false;
    }

    // 查询某键是否按住
    isDown(code) {
        return !!this._keys[code];
    }

    // 每帧调用，记录上一帧按键状态
    update() {
        this._prevKeys = { ...this._keys };
    }

    // 查询某键是否刚按下（单次触发，不重复）
    justPressed(code) {
        return !!this._keys[code] && !this._prevKeys[code];
    }

    // 启用键盘监听
    enable() {
        if (this._enabled) return;
        this._enabled = true;
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    // 禁用键盘监听
    disable() {
        if (!this._enabled) return;
        this._enabled = false;
        this._keys = {};
        this._prevKeys = {};
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
    }
}

// 导出单例实例
export const inputManager = new InputManager();

// 挂载到 window 供调试
if (typeof window !== 'undefined') {
    window.__input = inputManager;
    console.log('[InputManager] 单例已创建，可通过 window.__input 访问');
}
