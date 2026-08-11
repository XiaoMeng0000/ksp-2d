'use strict';

import { uiManager } from './uiManager.js';
import { eventBus, Events } from '../eventBus.js';
import { celestialBodies } from '../physics/physics.js';

// 缓存最近一帧的飞船渲染数据
let _cachedShipData = null;
eventBus.on(Events.RENDER_DATA, (data) => {
    _cachedShipData = data;
    // 如果调试面板可见，立即刷新（仅更新数据，不重建 DOM）
    if (debugVisible) {
        updateDebugData();
    }
});

// ==================== 面板容器 ====================
const debugPanel = document.createElement('div');
debugPanel.id = 'debugPanel';
debugPanel.style.display = 'none';
debugPanel.style.position = 'fixed';
debugPanel.style.top = '10px';
debugPanel.style.right = '10px';
debugPanel.style.background = 'rgba(0, 0, 0, 0.85)';
debugPanel.style.color = 'white';
debugPanel.style.padding = '15px';
debugPanel.style.fontFamily = 'monospace';
debugPanel.style.fontSize = '13px';
debugPanel.style.border = '1px solid #555';
debugPanel.style.borderRadius = '5px';
debugPanel.style.minWidth = '220px';
// 面板内容过长时可滚动，避免部署区溢出屏幕
debugPanel.style.maxHeight = 'calc(100vh - 20px)';
debugPanel.style.overflowY = 'auto';
debugPanel.style.zIndex = '1000';
document.body.appendChild(debugPanel);

const debugMainContent = document.createElement('div');
debugPanel.appendChild(debugMainContent);

let debugVisible = false;

// ==================== 静态面板结构 ====================
// 结构只构建一次，之后仅更新数值 span 的 textContent，避免 innerHTML 重建打断输入框/下拉框/按钮交互
const _els = {};
const ROW_STYLE = 'margin:5px 0;display:flex;justify-content:space-between;';

// 天体部署独立渲染区 —— 仅在 bodyList 变化时重建，防止打断原生 select 交互
const _deploySection = document.createElement('div');
let _deployVersion = null;

function buildPanelStructure() {
    debugMainContent.innerHTML = `
        <h3 style="margin:0 0 10px 0;color:#88ccff;border-bottom:1px solid #444;padding-bottom:5px;">调试面板</h3>
        <div style="${ROW_STYLE}">
            <span style="color:#aaa;">模式:</span>
            <span id="dbgMode" style="color:#fff;font-weight:bold;">—</span>
        </div>
        <div style="${ROW_STYLE}">
            <span style="color:#aaa;">引力范围:</span>
            <span id="dbgSOI" style="color:#fff;font-weight:bold;">—</span>
        </div>
        <div style="${ROW_STYLE}">
            <span style="color:#aaa;">引力常数:</span>
            <span id="dbgGM" style="color:#fff;font-weight:bold;">—</span>
        </div>
        <div style="${ROW_STYLE}">
            <span style="color:#aaa;">推力X:</span>
            <span id="dbgThrustX" style="color:#fff;font-weight:bold;">—</span>
        </div>
        <div style="${ROW_STYLE}">
            <span style="color:#aaa;">推力Y:</span>
            <span id="dbgThrustY" style="color:#fff;font-weight:bold;">—</span>
        </div>
        <div id="dbgKeplerBlock">
            <div style="${ROW_STYLE}">
                <span style="color:#aaa;">半长轴:</span>
                <span id="dbgA" style="color:#fff;font-weight:bold;">—</span>
            </div>
            <div style="${ROW_STYLE}">
                <span style="color:#aaa;">离心率:</span>
                <span id="dbgE" style="color:#fff;font-weight:bold;">—</span>
            </div>
            <div style="${ROW_STYLE}">
                <span style="color:#aaa;">近地点:</span>
                <span id="dbgPeriapsis" style="color:#fff;font-weight:bold;">—</span>
            </div>
            <div style="${ROW_STYLE}">
                <span style="color:#aaa;">远地点:</span>
                <span id="dbgApoapsis" style="color:#fff;font-weight:bold;">—</span>
            </div>
            <div style="${ROW_STYLE}">
                <span style="color:#aaa;">速度:</span>
                <span id="dbgV" style="color:#fff;font-weight:bold;">—</span>
            </div>
        </div>
        <div id="dbgNoKeplerBlock" style="display:none;">
            <p style="color:#ff6666;">无轨道数据（双曲线轨道？）</p>
        </div>
        <div style="margin-top:10px;border-top:1px solid #444;padding-top:10px;">
            <span style="color:#aaa;">推力角度:</span>
            <input type="number" id="thrustAngleInput" value="90" min="0" max="360" step="1" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;width:60px;text-align:center;">
            <span style="color:#aaa;">度</span>
        </div>
        <div style="margin-top:5px;">
            <span style="color:#aaa;">推力大小:</span>
            <input type="number" id="thrustMagInput" value="0.5" min="0" step="0.1" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;width:60px;text-align:center;">
            <span style="color:#aaa;">米/秒²</span>
        </div>
        <div style="margin-top:10px;">
            <button onclick="window.switchToThrustMode()" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">切换到推力模式</button>
            <button onclick="window.switchToOrbitMode()" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">切回在轨模式</button>
        </div>
        <div id="dbgOrbitCtrl">
            <div style="margin-top:10px;border-top:1px solid #444;padding-top:10px;">
                <button onclick="window.circularizeOrbit()" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">圆化轨道</button>
            </div>
            <div style="margin-top:10px;border-top:1px solid #444;padding-top:10px;">
                <span style="color:#aaa;">加速:</span>
                <input type="number" id="progradeInput" value="1" step="0.1" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;width:60px;text-align:center;">
                <button onclick="window.progradeThrust()" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">+</button>
            </div>
            <div style="margin-top:10px;border-top:1px solid #444;padding-top:10px;">
                <span style="color:#aaa;">减速:</span>
                <input type="number" id="retrogradeInput" value="1" step="0.1" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;width:60px;text-align:center;">
                <button onclick="window.retrogradeThrust()" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">-</button>
            </div>
        </div>
        <div style="margin-top:10px;border-top:1px solid #444;padding-top:10px;">
            <button onclick="window.resetShip()" style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;cursor:pointer;">重置默认</button>
        </div>
        <p style="margin-top:10px;color:#666;font-size:11px;">
            F1切换 | Z=推力 | X=在轨
        </p>
    `;

    // 缓存动态数值 span 与条件区块的引用
    const valueIds = ['dbgMode', 'dbgSOI', 'dbgGM', 'dbgThrustX', 'dbgThrustY',
        'dbgA', 'dbgE', 'dbgPeriapsis', 'dbgApoapsis', 'dbgV'];
    for (const id of valueIds) {
        _els[id] = document.getElementById(id);
    }
    _els.keplerBlock = document.getElementById('dbgKeplerBlock');
    _els.noKeplerBlock = document.getElementById('dbgNoKeplerBlock');
    _els.orbitCtrl = document.getElementById('dbgOrbitCtrl');

    // 部署区置于面板底部
    debugPanel.appendChild(_deploySection);
}

// 注册 debug 面板
uiManager.registerPanel('debug', {
    element: debugPanel,
    render: () => {
        // 结构固定后不再由 setData 重建，此处仅做兜底刷新
        if (debugVisible) updateDebugData();
    },
    show: () => {
        debugPanel.style.display = 'block';
    },
    hide: () => {
        debugPanel.style.display = 'none';
    }
});

// ==================== 动态数据更新（不重建 DOM） ====================
function updateDebugData() {
    if (!debugVisible) return;
    const data = buildDebugData();
    if (!data) return;

    _setText('dbgMode', data.currentMode);
    _setText('dbgSOI', data.currentSOI || '深空');
    _setText('dbgGM', data.currentGM);
    _setText('dbgThrustX', data.thrustAx);
    _setText('dbgThrustY', data.thrustAy);

    const hasKepler = !!data.kepler;
    _els.keplerBlock.style.display = hasKepler ? 'block' : 'none';
    _els.noKeplerBlock.style.display = hasKepler ? 'none' : 'block';
    _els.orbitCtrl.style.display = hasKepler ? 'block' : 'none';

    if (hasKepler) {
        _setText('dbgA', data.kepler.a.toFixed(2));
        _setText('dbgE', data.kepler.e.toFixed(4));
        _setText('dbgPeriapsis', data.periapsis.toFixed(2));
        _setText('dbgApoapsis', data.apoapsis.toFixed(2));
        _setText('dbgV', data.v.toFixed(2));
    }

    _updateDeploySection(data);
}

// 数值 span 更新（值未变化时跳过，避免无谓 DOM 写入）
function _setText(id, text) {
    const el = _els[id];
    if (!el) return;
    const str = String(text);
    if (el.textContent !== str) {
        el.textContent = str;
    }
}

// 天体部署独立渲染区 —— 仅在 bodyList 变化时重建，防止打断原生 select 交互
function _updateDeploySection(data) {
    const version = JSON.stringify(data.bodyList || []);
    let savedBody = '';
    let savedAlt = '';
    if (_deploySection.children.length > 0) {
        savedBody = _deploySection.querySelector('#deployBodySelect')?.value || '';
        savedAlt = _deploySection.querySelector('#deployAltitudeInput')?.value || '';
    }
    if (_deployVersion !== version) {
        _deploySection.innerHTML = `
            <div style="margin-top:10px;border-top:1px solid #444;padding-top:10px;">
                <span style="color:#88ccff;">=== 天体部署 ===</span>
            </div>
            <div style="margin-top:5px;">
                <select id="deployBodySelect" onchange="window.onDeployBodyChanged()"
                    style="margin:3px;padding:4px 8px;background:#333;color:white;border:1px solid #555;
                    border-radius:3px;font-family:monospace;font-size:12px;max-width:180px;">
                    ${(data.bodyList || []).map(b => `<option value="${b.name}" ${savedBody === b.name ? 'selected' : ''}>${b.name}</option>`).join('')}
                </select>
            </div>
            <div style="margin-top:5px;">
                <span style="color:#aaa;">轨道高度:</span>
                <input type="number" id="deployAltitudeInput" value="${savedAlt || ''}"
                    min="1" step="1" style="margin:3px;padding:4px 8px;background:#333;color:white;
                    border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;
                    width:60px;text-align:center;">
            </div>
            <div style="margin-top:5px;">
                <button onclick="window.deploySelectPreset('low')" id="deployPresetLow"
                    style="margin:2px;padding:3px 6px;background:#333;color:white;border:1px solid #555;
                    border-radius:3px;font-family:monospace;font-size:11px;cursor:pointer;">低轨</button>
                <button onclick="window.deploySelectPreset('mid')" id="deployPresetMid"
                    style="margin:2px;padding:3px 6px;background:#333;color:white;border:1px solid #555;
                    border-radius:3px;font-family:monospace;font-size:11px;cursor:pointer;">中轨</button>
                <button onclick="window.deploySelectPreset('high')" id="deployPresetHigh"
                    style="margin:2px;padding:3px 6px;background:#333;color:white;border:1px solid #555;
                    border-radius:3px;font-family:monospace;font-size:11px;cursor:pointer;">高轨</button>
            </div>
            <div style="margin-top:5px;">
                <button onclick="window.deployShipToBody()"
                    style="margin:3px;padding:4px 8px;background:#333;color:#88ccff;
                    border:1px solid #555;border-radius:3px;font-family:monospace;font-size:12px;
                    cursor:pointer;">部署</button>
            </div>
        `;
        _deployVersion = version;
    }
}

// 调试面板刷新在 toggle 时按需启动/停止定时器
let _debugTimer = null;

function toggleDebugPanel() {
    debugVisible = !debugVisible;
    if (debugVisible) {
        uiManager.showPanel('debug');
        updateDebugData();
        if (!_debugTimer) {
            _debugTimer = setInterval(() => {
                if (debugVisible && _cachedShipData && _cachedShipData.exists) {
                    updateDebugData();
                }
            }, 100);
        }
    } else {
        uiManager.hidePanel('debug');
        if (_debugTimer) {
            clearInterval(_debugTimer);
            _debugTimer = null;
        }
    }
}

// 构建调试数据
function buildDebugData() {
    if (!_cachedShipData || !_cachedShipData.exists) return null;
    const s = _cachedShipData;

    const angleInput = document.getElementById('thrustAngleInput');
    const magInput = document.getElementById('thrustMagInput');
    const progradeInput = document.getElementById('progradeInput');
    const retrogradeInput = document.getElementById('retrogradeInput');

    const thrustAngle = angleInput ? parseFloat(angleInput.value) || 90 : 90;
    const thrustMag = magInput ? parseFloat(magInput.value) || 0.5 : 0.5;
    const progradeVal = progradeInput ? parseFloat(progradeInput.value) || 1 : 1;
    const retrogradeVal = retrogradeInput ? parseFloat(retrogradeInput.value) || 1 : 1;

    const data = {
        currentMode: s.mode,
        currentSOI: s.currentSOI,
        currentGM: s.currentGM,
        thrustAx: s.thrust ? s.thrust.ax.toFixed(3) : '0',
        thrustAy: s.thrust ? s.thrust.ay.toFixed(3) : '0',
        kepler: s.kepler,
        thrustAngle,
        thrustMag,
        progradeVal,
        retrogradeVal
    };

    if (s.kepler) {
        const v = Math.sqrt(s.vel.x * s.vel.x + s.vel.y * s.vel.y);
        data.periapsis = s.kepler.a * (1 - s.kepler.e) - 60;
        data.apoapsis = s.kepler.a * (1 + s.kepler.e) - 60;
        data.v = v;
    }

    data.bodyList = celestialBodies
        .filter(b => b.type !== 'star')
        .map(b => ({
            name: b.name,
            displayRadius: b.displayRadius,
            soiRadius: b.soiRadius,
            presetOrbits: b.presetOrbits || null
        }));

    return data;
}

function circularizeOrbit() {
    eventBus.emit(Events.SHIP_COMMAND, { action: 'circularize', params: {} });
}

function progradeThrust() {
    const dv = parseFloat(document.getElementById('progradeInput').value) || 1;
    eventBus.emit(Events.SHIP_COMMAND, { action: 'progradeThrust', params: { dv } });
}

function retrogradeThrust() {
    const dv = parseFloat(document.getElementById('retrogradeInput').value) || 1;
    eventBus.emit(Events.SHIP_COMMAND, { action: 'retrogradeThrust', params: { dv } });
}

// 测试便利 - 与 main.js 初始状态一致
function resetShip() {
    eventBus.emit(Events.SHIP_COMMAND, { action: 'resetPosition', params: {} });
}

function switchToThrustMode() {
    const angleDeg = parseFloat(document.getElementById('thrustAngleInput').value) || 90;
    const magnitude = parseFloat(document.getElementById('thrustMagInput').value) || 0.5;
    const angleRad = angleDeg * Math.PI / 180;
    const ax = magnitude * Math.cos(angleRad);
    const ay = magnitude * Math.sin(angleRad);
    eventBus.emit(Events.SHIP_COMMAND, { action: 'switchToThrust', params: { ax, ay } });
}

function switchToOrbitMode() {
    eventBus.emit(Events.SHIP_COMMAND, { action: 'switchToOrbit', params: {} });
}

window.circularizeOrbit = circularizeOrbit;
window.switchToThrustMode = switchToThrustMode;
window.switchToOrbitMode = switchToOrbitMode;
window.progradeThrust = progradeThrust;
window.retrogradeThrust = retrogradeThrust;
window.resetShip = resetShip;

function deploySelectPreset(presetKey) {
    const select = document.getElementById('deployBodySelect');
    const bodyName = select?.value;
    const body = celestialBodies.find(b => b.name === bodyName);
    if (!body?.presetOrbits) return;
    const alt = body.presetOrbits[presetKey];
    if (alt !== undefined) {
        document.getElementById('deployAltitudeInput').value = alt;
    }
}

function onDeployBodyChanged() {
    const select = document.getElementById('deployBodySelect');
    const bodyName = select?.value;
    const body = celestialBodies.find(b => b.name === bodyName);
    if (body?.presetOrbits) {
        document.getElementById('deployAltitudeInput').value = body.presetOrbits.low;
    } else {
        document.getElementById('deployAltitudeInput').value = '';
    }
}

function deployShipToBody() {
    const bodyName = document.getElementById('deployBodySelect')?.value;
    const altitude = parseFloat(document.getElementById('deployAltitudeInput')?.value);
    if (!bodyName || isNaN(altitude) || altitude <= 0) return;
    eventBus.emit(Events.SHIP_COMMAND, {
        action: 'deployToBody',
        params: { targetBody: bodyName, altitude }
    });
}

window.deploySelectPreset = deploySelectPreset;
window.onDeployBodyChanged = onDeployBodyChanged;
window.deployShipToBody = deployShipToBody;

// 模块加载时一次性构建面板结构
buildPanelStructure();

export { toggleDebugPanel };

export function refreshDebugPanel() {
    if (debugVisible) {
        updateDebugData();
    }
}
