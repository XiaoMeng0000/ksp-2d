import { shipSystem } from '../ship/shipSystem.js';
import { camera } from '../camera.js';
import { inputManager } from '../input.js';
import { eventBus, Events } from '../eventBus.js';
import { updateShipPhysics } from '../physics/physicsUpdate.js';
import { updateCelestialBodies, getSOIHost, getRelativePosition, convertVelocityFrame, celestialBodies } from '../physics/physics.js';
import { stateToKepler } from '../physics/orbitalMechanics.js';
import { render, renderFlightHud } from '../renderer.js';
import { sceneManager } from '../sceneManager.js';
import { gameState } from '../gameState.js';
import { SASController } from '../ship/sasController.js';
import { SAS_CYCLE_ORDER, SAS_DIRECTION_ORDER } from '../ship/sasModes.js';
import { sasUI } from '../ui/sasUI.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { getFacilityType } from '../facility/facilityTypes.js';

// 由 main.js 在注册时注入的依赖
let _throttleRate = 1.0;
let _getCelestialTime = null;
let _setCelestialTime = null;
let _canvas = null;
let _lastDt = 0;
let _nearFacility = null;      // 当前在交互范围内的设施
let _activeFacilityId = null;  // 当前控制的设施 ID（无活动飞船时使用）
let _dockPromptFacId = null;   // 当前显示对接弹窗的设施 ID（防止重复 show）
let _lastToolbarMode = null;         // 统一工具栏脏检测：上一次的 mode
let _lastToolbarFingerprint = null; // 统一工具栏脏检测：上一次的数据指纹（含模块列表）

// 可见性筛选状态 — 控制飞行场景中非活动飞船/设施的显示
let _visibilityState = { ships: true, facilities: true, facilityRange: true };

// 暴露到全局供 sasUI 面板调用
window.__visibilityState = _visibilityState;
window.__toggleVisibility = function(type) {
    _visibilityState[type] = !_visibilityState[type];
};

// SHIP_COMMAND 处理器 — 接收 UI 层发出的飞船操作命令，由物理层统一执行
eventBus.on(Events.SHIP_COMMAND, ({ action, params }) => {
    const ship = shipSystem.getActiveShip();
    if (!ship) return;

    switch (action) {
        case 'circularize': {
            const host = getSOIHost(ship.pos);
            if (!host) break;
            const relPos = getRelativePosition(ship.pos, host);
            const r = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
            const v = Math.sqrt(host.gm / r);
            const tangentX = -relPos.y / r;
            const tangentY = relPos.x / r;
            ship.vel.x = v * tangentX;
            ship.vel.y = v * tangentY;
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.currentHostPos = { x: host.position.x, y: host.position.y };
            ship.kepler = stateToKepler(relPos, ship.vel, host.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            break;
        }
        case 'progradeThrust': {
            const dv = params.dv || 1;
            const host = getSOIHost(ship.pos);
            if (!host) break;
            const relPos = getRelativePosition(ship.pos, host);
            const r = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
            const tangentX = -relPos.y / r;
            const tangentY = relPos.x / r;
            ship.vel.x += dv * tangentX;
            ship.vel.y += dv * tangentY;
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.currentHostPos = { x: host.position.x, y: host.position.y };
            ship.kepler = stateToKepler(relPos, ship.vel, host.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            break;
        }
        case 'retrogradeThrust': {
            const dv = params.dv || 1;
            const host = getSOIHost(ship.pos);
            if (!host) break;
            const relPos = getRelativePosition(ship.pos, host);
            const r = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
            const tangentX = -relPos.y / r;
            const tangentY = relPos.x / r;
            ship.vel.x -= dv * tangentX;
            ship.vel.y -= dv * tangentY;
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.currentHostPos = { x: host.position.x, y: host.position.y };
            ship.kepler = stateToKepler(relPos, ship.vel, host.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            break;
        }
        case 'resetPosition': {
            const homeworld = celestialBodies.find(b => b.isHomeworld);
            if (!homeworld) {
                console.warn('[SHIP_COMMAND] 找不到起始天体数据，使用硬编码默认值');
                ship.pos.x = 580;
                ship.pos.y = 0;
                ship.vel.x = 0;
                ship.vel.y = -Math.sqrt(10000 / 80);
                ship.currentGM = 10000;
            } else {
                const orbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);
                ship.pos.x = homeworld.position.x + orbitR;
                ship.pos.y = homeworld.position.y;
                ship.vel.x = 0;
                ship.vel.y = -Math.sqrt(homeworld.gm / orbitR);
                ship.currentGM = homeworld.gm;
            }
            const resetHost = getSOIHost(ship.pos);
            ship.currentSOI = resetHost ? resetHost.name : null;
            ship.currentHostPos = resetHost ? { x: resetHost.position.x, y: resetHost.position.y } : { x: 0, y: 0 };
            const resetRelPos = {
                x: ship.pos.x - ship.currentHostPos.x,
                y: ship.pos.y - ship.currentHostPos.y
            };
            ship.kepler = stateToKepler(resetRelPos, ship.vel, ship.currentGM);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            break;
        }
        case 'switchToThrust': {
            ship.mode = 'thrust';
            ship.thrust = { ax: params.ax, ay: params.ay };
            break;
        }
        case 'switchToOrbit': {
            const host = getSOIHost(ship.pos);
            if (!host) break;
            const relPos = getRelativePosition(ship.pos, host);
            const newKepler = stateToKepler(relPos, ship.vel, host.gm);
            if (newKepler) {
                ship.currentSOI = host.name;
                ship.currentGM = host.gm;
                ship.currentHostPos = { x: host.position.x, y: host.position.y };
                ship.kepler = newKepler;
                ship.mode = 'on_rails';
                ship.orbitTime = 0;
                ship.thrust = { ax: 0, ay: 0 };
            }
            break;
        }
        case 'deployFacility': {
            const typeId = params?.typeId;
            if (!typeId) break;

            // 检查是否有建设模块
            const hasModule = ship.modules?.some(m => {
                const def = getModuleDef(m.type);
                return def?.capability === 'deploy_facility';
            });
            if (!hasModule) {
                window.showNotification('未挂载建设集成模块', 'warning');
                break;
            }

            // 检查在宿主 SOI 内且在轨
            if (!ship.currentSOI || ship.mode !== 'on_rails') {
                window.showNotification('必须在稳定轨道上才能部署设施', 'warning');
                break;
            }

            // 检查是否为稳定轨道（禁止逃逸轨道上部署，防止设施 SOI 切换 Bug）
            // 逃逸/双曲线轨道下 stateToKepler 返回 null（e>=1 无椭圆解），
            // 因此 ship.kepler === null 且 mode === on_rails 即表示逃逸轨道
            if (!ship.kepler) {
                window.showNotification('逃逸轨道上无法部署设施，需在椭圆/圆轨道上进行', 'warning');
                break;
            }

            // 消耗建设模块（移除第一个匹配的）
            const modIndex = ship.modules.findIndex(m => {
                const def = getModuleDef(m.type);
                return def?.capability === 'deploy_facility';
            });
            const removed = ship.modules.splice(modIndex, 1)[0];
            const removedDef = getModuleDef(removed.type);
            if (removedDef) {
                ship.dryMass -= removedDef.massBonus;
                ship.momentOfInertia -= removedDef.momentOfInertiaBonus;
            }
            shipSystem.persistShip(ship);

            // 创建设施（createFacility 期望 ship.vel 的相对速度，符合项目约定）
            const typeCfg = getFacilityType(typeId);
            const facilityName = params?.facilityName || (typeCfg ? '新建' + typeCfg.name : '新建设施');
            const facility = facilitySystem.createFacility(
                typeId,
                facilityName,
                { x: ship.pos.x, y: ship.pos.y },
                { x: ship.vel.x, y: ship.vel.y },
                ship.currentSOI
            );

            if (facility) {
                window.showNotification(`${facilityName} 部署成功`, 'success');
            } else {
                window.showNotification('设施部署失败', 'error');
            }
            break;
        }
        case 'deployToBody': {
            const targetBody = celestialBodies.find(b => b.name === params.targetBody);
            if (!targetBody) {
                window.showNotification('目标天体不存在', 'error');
                break;
            }
            const orbitR = targetBody.displayRadius + params.altitude;
            if (orbitR >= targetBody.soiRadius) {
                window.showNotification('轨道高度超出天体引力范围', 'error');
                break;
            }
            ship.pos = { x: targetBody.position.x + orbitR, y: targetBody.position.y };
            const v = Math.sqrt(targetBody.gm / orbitR);
            ship.vel = { x: 0, y: -v };
            ship.currentSOI = targetBody.name;
            ship.currentGM = targetBody.gm;
            ship.currentHostPos = { x: targetBody.position.x, y: targetBody.position.y };
            const relPos = {
                x: ship.pos.x - ship.currentHostPos.x,
                y: ship.pos.y - ship.currentHostPos.y
            };
            ship.kepler = stateToKepler(relPos, ship.vel, targetBody.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            window.showNotification(`已部署到 ${targetBody.name} 轨道，高度 ${params.altitude}`, 'success');
            break;
        }
    }
});

/**
 * 注册飞行场景
 * @param {Object} deps - 注入依赖
 * @param {number} deps.throttleRate - 油门调节速率
 * @param {Function} deps.getTime - 获取当前游戏时间 () => number
 * @param {Function} deps.setTime - 设置游戏时间 (time: number) => void
 * @param {HTMLCanvasElement} deps.canvas - 游戏画布
 */
export function registerFlightScene({ throttleRate, getTime, setTime, canvas }) {
    _throttleRate = throttleRate;
    _getCelestialTime = getTime;
    _setCelestialTime = setTime;
    _canvas = canvas;

    sceneManager.registerScene('flight', {
        name: '飞行场景',
        enter: () => {
            inputManager.enable();

            // 接收追踪站的设施聚焦请求
            if (window.__pendingFacilityId) {
                const fac = facilitySystem.getFacility(window.__pendingFacilityId);
                if (fac) {
                    _activeFacilityId = fac.id;
                    gameState.setState({ activeShipId: null, activeFacilityId: fac.id });
                    camera.x = fac.pos.x;
                    camera.y = fac.pos.y;
                }
                delete window.__pendingFacilityId;
            }

            // 显示可见性筛选面板
            sasUI.showVisibilityPanel();

            // SAS 集成 — 为所有现有飞船初始化 SAS 控制器（新建 / 读档后都需要）
            for (const ship of shipSystem.getAllShips()) {
                if (!ship._sasController) {
                    ship._sasController = new SASController(ship);
                }
            }

            // SAS 集成 — Canvas 点击处理
            const onClick = (e) => {
                const rect = _canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const cssX = e.clientX - rect.left;
                const cssY = e.clientY - rect.top;
                const canvasX = cssX * dpr;
                const canvasY = cssY * dpr;

                // 1. 检测是否点击了设施
                const allFacilities = facilitySystem.getAllFacilities();
                for (const f of allFacilities) {
                    const screenX = _canvas.width / 2 + (f.pos.x - camera.x) * camera.zoom;
                    const screenY = _canvas.height / 2 + (f.pos.y - camera.y) * camera.zoom;
                    const hitRadius = Math.max(6, 10 * camera.zoom);
                    if (Math.abs(canvasX - screenX) <= hitRadius && Math.abs(canvasY - screenY) <= hitRadius) {
                        // 清除活动飞船 + 设置设施焦点，防止下一帧被 activeShip 覆盖
                        gameState.setState({ activeShipId: null, activeFacilityId: f.id });
                        _activeFacilityId = f.id;
                        camera.x = f.pos.x;
                        camera.y = f.pos.y;
                        return;
                    }
                }

                // 2. 未命中设施，继续走 SAS 处理（用 CSS 像素坐标）
                const ship = shipSystem.getActiveShip();
                if (!ship) return;

                const result = sasUI.handleClick(cssX, cssY, ship.sasMode || 'off');
                if (!result.hit) return;

                if (result.action === 'toggle') {
                    ship.sasMode = ship.sasMode === 'off' ? 'stability' : 'off';
                } else if (result.action === 'mode') {
                    ship.sasMode = result.value;
                } else if (result.action === 'throttle') {
                    ship.throttle = result.value;
                }
            };
            _canvas.addEventListener('click', onClick);
            _canvas._sasClickHandler = onClick;

            // SAS 集成 — Canvas 拖拽处理（节流阀）
            const onMouseDown = (e) => {
                const rect = _canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const distCenter = Math.sqrt(
                    (x - sasUI._centerPos.x) ** 2 + (y - sasUI._centerPos.y) ** 2
                );
                const scale = sasUI._scale;
                // 仅当点击在节流阀弧附近区域时开始拖拽
                if (distCenter >= (92 - 10) * scale && distCenter <= (105 + 10) * scale) {
                    sasUI._isDragging = true;
                }
            };
            const onMouseMove = (e) => {
                const rect = _canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // 拖拽更新节流阀
                if (sasUI._isDragging) {
                    const result = sasUI.handleDrag(x, y);
                    if (result) {
                        const ship = shipSystem.getActiveShip();
                        if (ship) ship.throttle = result.throttle;
                    }
                } else {
                    // 非拖拽时检测悬停目标
                    const ship = shipSystem.getActiveShip();
                    if (ship) {
                        sasUI.handleHover(x, y, ship.sasMode || 'off');
                    }
                }
            };
            const onMouseUp = () => {
                sasUI._isDragging = false;
            };
            _canvas.addEventListener('mousedown', onMouseDown);
            _canvas.addEventListener('mousemove', onMouseMove);
            _canvas.addEventListener('mouseup', onMouseUp);
            _canvas._sasDragHandlers = { onMouseDown, onMouseMove, onMouseUp };

            // SAS 集成 — Canvas 右键处理（右键中心 → 回到 STABILITY）
            const onContextMenu = (e) => {
                e.preventDefault();
                const rect = _canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const ship = shipSystem.getActiveShip();
                if (!ship) return;

                const result = sasUI.handleRightClick(x, y, ship.sasMode || 'off');
                if (result.hit && result.action === 'back_to_stability') {
                    ship.sasMode = 'stability';
                }
            };
            _canvas.addEventListener('contextmenu', onContextMenu);
            _canvas._sasContextMenuHandler = onContextMenu;

            // SAS 集成 — 鼠标离开 canvas 时清除悬停状态
            const onMouseLeave = () => {
                sasUI.clearHover();
            };
            _canvas.addEventListener('mouseleave', onMouseLeave);
            _canvas._sasMouseLeaveHandler = onMouseLeave;
        },
        exit: () => {
            // 隐藏对接提示框，防止遗留到其他场景
            window.hideDockPrompt();
            _dockPromptFacId = null;

            inputManager.disable();

            // 隐藏可见性筛选面板
            sasUI.hideVisibilityPanel();

            // SAS 集成 — 清理 Canvas 事件监听
            if (_canvas._sasClickHandler) {
                _canvas.removeEventListener('click', _canvas._sasClickHandler);
                delete _canvas._sasClickHandler;
            }
            if (_canvas._sasDragHandlers) {
                _canvas.removeEventListener('mousedown', _canvas._sasDragHandlers.onMouseDown);
                _canvas.removeEventListener('mousemove', _canvas._sasDragHandlers.onMouseMove);
                _canvas.removeEventListener('mouseup', _canvas._sasDragHandlers.onMouseUp);
                delete _canvas._sasDragHandlers;
            }
            if (_canvas._sasContextMenuHandler) {
                _canvas.removeEventListener('contextmenu', _canvas._sasContextMenuHandler);
                delete _canvas._sasContextMenuHandler;
            }
            if (_canvas._sasMouseLeaveHandler) {
                _canvas.removeEventListener('mouseleave', _canvas._sasMouseLeaveHandler);
                delete _canvas._sasMouseLeaveHandler;
            }
        },
        update: (dt) => {
            // 宿主位移补偿法 — 天体先推进，补偿飞船位置后再做物理，使 SOI 检测时间差为零
            const activeShip = shipSystem.getActiveShip();
            const activeId = activeShip ? activeShip.id : null;
            const allShips = shipSystem.getAllShips();
            const allFacilities = facilitySystem.getAllFacilities();

            // SAS 集成 — 每帧记录上一帧按键状态（供 justPressed 使用）
            inputManager.update();

            // 1. 保存所有天体旧位置
            const oldBodyPos = {};
            for (const b of celestialBodies) {
                oldBodyPos[b.name] = { x: b.position.x, y: b.position.y };
            }

            // 2. 推进时间和天体
            _setCelestialTime(_getCelestialTime() + dt);
            updateCelestialBodies(_getCelestialTime());
            eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: _getCelestialTime(), dt });

            // 3. 补偿飞船绝对位置：跟上宿主本帧位移
            for (const s of allShips) {
                if (s.currentSOI && oldBodyPos[s.currentSOI]) {
                    const oldP = oldBodyPos[s.currentSOI];
                    const hostBody = celestialBodies.find(b => b.name === s.currentSOI);
                    if (hostBody) {
                        const dHostX = hostBody.position.x - oldP.x;
                        const dHostY = hostBody.position.y - oldP.y;
                        s.pos.x += dHostX;
                        s.pos.y += dHostY;
                        s.currentHostPos = { x: hostBody.position.x, y: hostBody.position.y };
                    }
                }
            }

            // 3b. 补偿设施绝对位置（复用飞船的宿主位移补偿逻辑）
            for (const f of allFacilities) {
                if (f.hostSOI && oldBodyPos[f.hostSOI]) {
                    const oldP = oldBodyPos[f.hostSOI];
                    const hostBody = celestialBodies.find(b => b.name === f.hostSOI);
                    if (hostBody) {
                        const dHostX = hostBody.position.x - oldP.x;
                        const dHostY = hostBody.position.y - oldP.y;
                        f.pos.x += dHostX;
                    f.pos.y += dHostY;
                        f.currentHostPos = { x: hostBody.position.x, y: hostBody.position.y };
                    }
                }
            }

            // 4. 物理推进（此时 ship.pos 和 body.position 同处 T+dt，时间差为零）
            for (const s of allShips) {
                const isActive = s.id === activeId;
                updateShipPhysics(s, dt, isActive);
            }

            // 4b. 设施物理推进（走飞船物理的 on_rails 路径，isActive=false 强制无推力）
            for (const f of allFacilities) {
                updateShipPhysics(f, dt, false);
            }

            // 5. 设施交互检测（活动飞船进入设施交互范围）
            _nearFacility = null;
            if (activeShip) {
                let nearestDist = Infinity;
                for (const f of allFacilities) {
                    const dx = f.pos.x - activeShip.pos.x;
                    const dy = f.pos.y - activeShip.pos.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < f.interactionRange && dist < nearestDist) {
                        nearestDist = dist;
                        _nearFacility = f;
                    }
                }
            }

            // 5b. B 键对接
            if (inputManager.justPressed('KeyB') && _nearFacility && activeShip) {
                const result = facilitySystem.dockShip(_nearFacility.id, activeShip.id);
                if (result) {
                    window.showNotification('对接成功', 'success');
                } else {
                    window.showNotification('对接失败（对接口已满或其他原因）', 'warning');
                }
            }

            // 5c. 对接后无活动飞船：自动切到设施控制
            if (!activeShip && facilitySystem.lastDockedFacilityId) {
                const dockedFacility = facilitySystem.getFacility(facilitySystem.lastDockedFacilityId);
                if (dockedFacility) {
                    _activeFacilityId = dockedFacility.id;
                    gameState.setState({ activeFacilityId: _activeFacilityId });
                    camera.x = dockedFacility.pos.x;
                    camera.y = dockedFacility.pos.y;
                }
                facilitySystem.lastDockedFacilityId = null;
            }

            // 5d. 对接弹窗状态驱动（委托 ui.js 管理 HTML DOM，渲染函数不碰 UI）
            if (_nearFacility && activeShip) {
                if (_dockPromptFacId !== _nearFacility.id) {
                    if (_dockPromptFacId) window.hideDockPrompt();
                    const facId = _nearFacility.id;
                    window.showDockPrompt(_nearFacility, () => {
                        const ship = shipSystem.getActiveShip();
                        if (ship && _nearFacility) {
                            const result = facilitySystem.dockShip(facId, ship.id);
                            if (result) {
                                window.showNotification('对接成功', 'success');
                            } else {
                                window.showNotification('对接失败（对接口已满或其他原因）', 'warning');
                            }
                        }
                    });
                    _dockPromptFacId = facId;
                }
            } else if (_dockPromptFacId) {
                window.hideDockPrompt();
                _dockPromptFacId = null;
            }

            // 朝向控制（仅对活动飞船生效）
            if (activeShip) {
                // 确保 SAS 控制器存在（兜底：新建飞船 / 切换飞船）
                if (!activeShip._sasController) {
                    activeShip._sasController = new SASController(activeShip);
                }

                // 同步 ship.sasMode → controller.mode（UI / 键盘可能直接修改了 ship.sasMode）
                if (activeShip._sasController.getMode() !== (activeShip.sasMode || 'off')) {
                    activeShip._sasController.setMode(activeShip.sasMode || 'off');
                }

                // 手动输入
                let manualInput = 0;
                if (inputManager.isDown('KeyA')) manualInput -= 1;
                if (inputManager.isDown('KeyD')) manualInput += 1;

                // T 键开/关 SAS（OFF ↔ STABILITY）
                if (inputManager.justPressed('KeyT')) {
                    activeShip.sasMode = (activeShip.sasMode === 'off') ? 'stability' : 'off';
                }

                // G 键循环方向模式（SAS 关闭时按 G 自动开启）
                if (inputManager.justPressed('KeyG')) {
                    if (activeShip.sasMode === 'off' || activeShip.sasMode === undefined) {
                        activeShip.sasMode = 'stability';
                    } else {
                        const dirIdx = SAS_DIRECTION_ORDER.indexOf(activeShip.sasMode);
                        if (dirIdx >= 0) {
                            activeShip.sasMode = SAS_DIRECTION_ORDER[(dirIdx + 1) % SAS_DIRECTION_ORDER.length];
                        } else {
                            activeShip.sasMode = 'stability';
                        }
                    }
                }

                // 构建 SAS 目标朝向计算所需的飞行上下文
                const host = getSOIHost(activeShip.pos);
                const sasContext = {
                    shipVx: activeShip.vel.x,
                    shipVy: activeShip.vel.y,
                    shipX: activeShip.pos.x,
                    shipY: activeShip.pos.y,
                    hostX: host ? host.position.x : undefined,
                    hostY: host ? host.position.y : undefined,
                    shipHeading: activeShip.heading
                };

                // SAS 控制器计算扭矩（OFF 模式内部返回 0，即纯手动旋转）
                const torque = activeShip._sasController.update(dt, manualInput, sasContext);

                // 统一物理积分（替代旧的 A/D 分支和 SAS 预留分支）
                const moi = activeShip.momentOfInertia || 1.0;
                const angularAccel = torque / moi;
                if (typeof activeShip.angularVelocity !== 'number') activeShip.angularVelocity = 0;
                activeShip.angularVelocity += angularAccel * dt;

                // 角速度积分 → 朝向
                activeShip.heading += activeShip.angularVelocity * dt;
                activeShip.heading = ((activeShip.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

                // 油门调整（Shift/Ctrl 渐变，Z/X 瞬时）
                if (typeof activeShip.throttle !== 'number') activeShip.throttle = 0;
                if (inputManager.isDown('ShiftLeft')) activeShip.throttle += _throttleRate * dt;
                if (inputManager.isDown('ControlLeft')) activeShip.throttle -= _throttleRate * dt;
                if (inputManager.isDown('KeyZ')) activeShip.throttle = 1;
                if (inputManager.isDown('KeyX')) activeShip.throttle = 0;
                activeShip.throttle = Math.max(0, Math.min(1, activeShip.throttle));
            }

            // 推力模式自动切换（油门驱动）
            if (activeShip) {
                if (activeShip.throttle > 0 && activeShip.mode === 'on_rails') {
                    activeShip.mode = 'thrust';
                }
                if (activeShip.throttle === 0 && activeShip.mode === 'thrust') {
                    // 油门归零 → 熄火：从当前pos/vel重算kepler（SOI检测仍由physicsUpdate负责）
                    const host = getSOIHost(activeShip.pos);
                    if (host) {
                        const relPos = getRelativePosition(activeShip.pos, host);
                        const newKepler = stateToKepler(relPos, activeShip.vel, host.gm);
                        activeShip.kepler = newKepler || null;
                        activeShip.orbitTime = 0;
                    } else {
                        activeShip.kepler = null;
                    }
                    activeShip.mode = 'on_rails';
                    activeShip.thrust = { ax: 0, ay: 0 };
                }
            }

            // 推力向量计算 + 燃料消耗（活动飞船，每帧）
            if (activeShip && activeShip.throttle > 0) {
                const totalMass = activeShip.dryMass + activeShip.fuel;
                const thrustAccel = activeShip.throttle * activeShip.maxThrust / totalMass;
                activeShip.thrust = {
                    ax: Math.sin(activeShip.heading) * thrustAccel,
                    ay: Math.cos(activeShip.heading) * thrustAccel
                };

                // 燃料消耗（火箭方程：质量流量 = 推力 / (比冲 × g0)）
                const massFlow = activeShip.throttle * activeShip.maxThrust / (activeShip.isp * 9.81);
                activeShip.fuel -= massFlow * dt;
                if (activeShip.fuel <= 0) {
                    activeShip.fuel = 0;
                    activeShip.throttle = 0;
                    activeShip.mode = 'on_rails';
                    activeShip.maxThrust = 0;
                    activeShip.thrust = { ax: 0, ay: 0 };
                }
            } else if (activeShip && activeShip.throttle === 0) {
                activeShip.thrust = { ax: 0, ay: 0 };
            }

            // 相机跟随活动飞船，无活动飞船且选中设施时跟随设施
            if (activeShip) {
                camera.x = activeShip.pos.x;
                camera.y = activeShip.pos.y;
                _activeFacilityId = null;
                gameState.setState({ activeFacilityId: null });
            } else if (_activeFacilityId) {
                const focusedFacility = facilitySystem.getFacility(_activeFacilityId);
                if (focusedFacility) {
                    camera.x = focusedFacility.pos.x;
                    camera.y = focusedFacility.pos.y;
                }
            }

            _lastDt = dt;
        },
        render: (ctx) => {
            const activeShip = shipSystem.getActiveShip();
            const renderFacilities = facilitySystem.getAllFacilities();
            render(ctx, _canvas, activeShip, {
                visibility: _visibilityState,
                facilities: renderFacilities,
                selectedFacilityId: _activeFacilityId
            });

            // 状态驱动：统一工具栏图标切换
            let nextMode = 'off';
            let nextDataId = null;
            let nextData = null;
            if (activeShip) {
                nextMode = 'ship';
                nextDataId = activeShip.id;
                nextData = { modules: activeShip.modules || [] };
            } else if (_activeFacilityId) {
                nextMode = 'facility';
                nextDataId = _activeFacilityId;
                nextData = { facilityId: _activeFacilityId };
            }
            // 数据指纹：除 mode/id 外还感知模块列表变化（增/删/换模块必触发重绘）
            const dataFingerprint = nextMode === 'ship'
                ? (nextData.modules || []).map(m => m.type).sort().join(',')
                : nextDataId;
            if (nextMode !== _lastToolbarMode || dataFingerprint !== _lastToolbarFingerprint) {
                _lastToolbarMode = nextMode;
                _lastToolbarFingerprint = dataFingerprint;
                if (typeof window.renderToolbarIcons === 'function') {
                    window.renderToolbarIcons(nextMode, nextData);
                }
                // 模式切换时关闭弹出面板
                const panel = document.getElementById('toolbarPanel');
                if (panel) panel.style.display = 'none';
            }

            // SAS UI 渲染（仅在有活动飞船时显示）
            if (activeShip) {
                sasUI.updateLayout(_canvas);
                sasUI.update(_lastDt, activeShip.sasMode || 'off', activeShip.throttle || 0);
                sasUI.render(ctx, activeShip.sasMode || 'off', activeShip.throttle || 0);
            }

            renderFlightHud(ctx, _canvas, activeShip);

            // 每帧广播飞船渲染数据给 UI 层
            eventBus.emit(Events.RENDER_DATA, {
                exists: !!activeShip,
                mode: activeShip?.mode ?? null,
                currentSOI: activeShip?.currentSOI ?? null,
                currentGM: activeShip?.currentGM ?? null,
                thrust: activeShip?.thrust ?? { ax: 0, ay: 0 },
                kepler: activeShip?.kepler ?? null,
                vel: activeShip?.vel ?? { x: 0, y: 0 },
                pos: activeShip?.pos ?? { x: 0, y: 0 },
                fuel: activeShip?.fuel ?? 0,
                dryMass: activeShip?.dryMass ?? 0,
                maxThrust: activeShip?.maxThrust ?? 0,
                heading: activeShip?.heading ?? 0,
                throttle: activeShip?.throttle ?? 0,
                controlsLocked: activeShip?.controlsLocked ?? false,
                displayName: activeShip?.displayName ?? '',
                nearFacilityId: _nearFacility?.id ?? null,
                activeFacilityId: _activeFacilityId ?? null
            });
        }
    });
}
