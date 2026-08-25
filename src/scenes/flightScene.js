import { shipSystem } from '../ship/shipSystem.js';
import { camera } from '../camera.js';
import { inputManager } from '../input.js';
import { eventBus, Events } from '../eventBus.js';
import { updateShipPhysics } from '../physics/physicsUpdate.js';
import { updateCelestialBodies, getSOIHost, getAbsolutePosition, getRelativePosition, convertVelocityFrame, celestialBodies } from '../physics/physics.js';
import { stateToKepler } from '../physics/orbitalMechanics.js';
import { timeToNextSOISwitch } from '../physics/orbitalPrediction.js';
import { render, renderFlightHud } from '../renderer.js';
import { sceneManager } from '../sceneManager.js';
import { gameState } from '../gameState.js';
import { SASController } from '../ship/sasController.js';
import { SAS_CYCLE_ORDER, SAS_DIRECTION_ORDER, computeNavballDirections as computeSasDirections } from '../ship/sasModes.js';
import { sasUI } from '../ui/sasUI.js';
import { showTooltip, hideTooltip } from '../ui/uiTooltip.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getModuleDef } from '../ship/moduleTypes.js';
import { getFacilityType } from '../facility/facilityTypes.js';
import { getTotalMass, getResource, getFuelAmount, getFuelCapacity } from '../resources/resourceSystem.js';
import { updateScanProgress } from '../resources/scanSystem.js';
import { getEngineType } from '../resources/engineConfig.js';
import { consumeCargo, hasCargoHold, getCargoAmount } from '../resources/cargoSystem.js';
import { isBalanceEnforced } from '../resources/modeRules.js';
import { timeWarp } from '../timeWarp.js';
import { getSOIWarpProtectEnabled } from '../config/settingsConfig.js';
import { t } from '../config/strings.js';

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
let _visibilityState = { ships: true, facilities: true, facilityRange: true, bodyOrbits: true };

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
            const host = getSOIHost(getAbsolutePosition(ship));
            if (!host) break;
            const r = Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y);
            const v = Math.sqrt(host.gm / r);
            const tangentX = -ship.pos.y / r;
            const tangentY = ship.pos.x / r;
            ship.vel.x = v * tangentX;
            ship.vel.y = v * tangentY;
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.kepler = stateToKepler(ship.pos, ship.vel, host.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            break;
        }
        case 'progradeThrust': {
            const dv = params.dv || 1;
            const host = getSOIHost(getAbsolutePosition(ship));
            if (!host) break;
            const r = Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y);
            const tangentX = -ship.pos.y / r;
            const tangentY = ship.pos.x / r;
            ship.vel.x += dv * tangentX;
            ship.vel.y += dv * tangentY;
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.kepler = stateToKepler(ship.pos, ship.vel, host.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            break;
        }
        case 'retrogradeThrust': {
            const dv = params.dv || 1;
            const host = getSOIHost(getAbsolutePosition(ship));
            if (!host) break;
            const r = Math.sqrt(ship.pos.x * ship.pos.x + ship.pos.y * ship.pos.y);
            const tangentX = -ship.pos.y / r;
            const tangentY = ship.pos.x / r;
            ship.vel.x -= dv * tangentX;
            ship.vel.y -= dv * tangentY;
            ship.currentSOI = host.name;
            ship.currentGM = host.gm;
            ship.kepler = stateToKepler(ship.pos, ship.vel, host.gm);
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
                ship.vel.y = Math.sqrt(10000 / 80);  // 顺行：pos 在 +x 时速度沿 +y
                ship.currentGM = 10000;
                ship.currentSOI = null;
            } else {
                const orbitR = homeworld.radius + (homeworld.defaultOrbitAltitude || 0);
                ship.pos.x = orbitR;
                ship.pos.y = 0;
                ship.vel.x = 0;
                ship.vel.y = Math.sqrt(homeworld.gm / orbitR);  // 顺行：pos 在 +x 时速度沿 +y
                ship.currentGM = homeworld.gm;
                ship.currentSOI = homeworld.name;
            }
            ship.kepler = stateToKepler(ship.pos, ship.vel, ship.currentGM);
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
            const host = getSOIHost(getAbsolutePosition(ship));
            if (!host) break;
            const newKepler = stateToKepler(ship.pos, ship.vel, host.gm);
            if (newKepler) {
                ship.currentSOI = host.name;
                ship.currentGM = host.gm;
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
                window.showNotification(t('deploy.noModule'), 'warning');
                break;
            }

            // 0.2.0 阶段5：部署设施消耗材料套装（从部署飞船货仓扣除）
            // 修复：扣费校验前置但实际扣除后移 —— 原实现在所有轨道校验之前扣费，
            // 校验失败（逃逸轨道/危险区）时材料套装已被扣但设施未部署（资源丢失）
            // 0.2.0 阶段7：自由模式跳过余额检查（不足不拦截），货仓存在性检查保留
            const deployTypeCfg = getFacilityType(typeId);
            const deployCost = (deployTypeCfg && deployTypeCfg.cost) || 0;
            if (deployCost > 0 && (!hasCargoHold(ship) || (isBalanceEnforced() && getCargoAmount(ship, 'materialKits') < deployCost))) {
                window.showNotification(t('deploy.noKits'), 'warning');
                break;
            }

            // 检查在宿主 SOI 内且在轨
            if (!ship.currentSOI || ship.mode !== 'on_rails') {
                window.showNotification(t('deploy.needStableOrbit'), 'warning');
                break;
            }

            // 检查是否为稳定轨道（禁止逃逸轨道上部署，防止设施 SOI 切换 Bug）
            // 双曲线轨道 kepler.a < 0（e>=1 无椭圆解），椭圆/圆轨道 a > 0
            if (!ship.kepler || ship.kepler.a < 0) {
                window.showNotification(t('deploy.noEscapeTrajectory'), 'warning');
                break;
            }

            // 检查是否处于危险边界内（大气边界 / 表面边界），禁止向危险区域部署设施
            const hostBody = celestialBodies.find(b => b.name === ship.currentSOI);
            if (hostBody) {
                const shipAbs = getAbsolutePosition(ship);
                const hdx = shipAbs.x - hostBody.position.x;
                const hdy = shipAbs.y - hostBody.position.y;
                const shipDist = Math.sqrt(hdx * hdx + hdy * hdy);
                const hazardBoundary = hostBody.hasAtmosphere && hostBody.atmosphereHeight > 0
                    ? hostBody.radius + hostBody.atmosphereHeight
                    : hostBody.radius;
                if (shipDist < hazardBoundary) {
                    window.showNotification(t('deploy.dangerZone'), 'warning');
                    break;
                }
            }

            // 创建设施（createFacility 期望绝对世界坐标，需从相对坐标转换）
            const absPos = getAbsolutePosition(ship);
            const typeCfg = getFacilityType(typeId);
            const facilityName = params?.facilityName || (typeCfg ? t('deploy.newName', { name: typeCfg.name }) : t('deploy.newFacility'));
            const facility = facilitySystem.createFacility(
                typeId,
                facilityName,
                { x: absPos.x, y: absPos.y },
                { x: ship.vel.x, y: ship.vel.y },
                ship.currentSOI
            );

            // 设施创建成功后才真正扣费 + 消耗建设模块（避免失败时资源/模块丢失）
            if (!facility) {
                window.showNotification(t('deploy.failed'), 'error');
                break;
            }
            if (deployCost > 0) consumeCargo(ship, 'materialKits', deployCost);

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

            window.showNotification(t('deploy.success', { name: facilityName }), 'success');
            break;
        }
        case 'deployToBody': {
            const targetBody = celestialBodies.find(b => b.name === params.targetBody);
            if (!targetBody) {
                window.showNotification(t('deploy.noTargetBody'), 'error');
                break;
            }
            const orbitR = targetBody.radius + params.altitude;
            if (orbitR >= targetBody.soiRadius) {
                window.showNotification(t('deploy.altitudeOutOfRange'), 'error');
                break;
            }
            ship.pos = { x: orbitR, y: 0 };
            const v = Math.sqrt(targetBody.gm / orbitR);
            // 顺行（逆时针，与天体公转同向）：pos 在 +x 时速度沿 +y
            ship.vel = { x: 0, y: v };
            ship.currentSOI = targetBody.name;
            ship.currentGM = targetBody.gm;
            ship.kepler = stateToKepler(ship.pos, ship.vel, targetBody.gm);
            ship.orbitTime = 0;
            ship.mode = 'on_rails';
            ship.thrust = { ax: 0, ay: 0 };
            window.showNotification(t('deploy.deployedAt', { name: targetBody.name, altitude: params.altitude }), 'success');
            break;
        }
    }
});

// ========== 导航球数据（Step1：重构数据层） ==========

/**
 * 计算导航球四方向实时角度（世界系，与 heading 同约定：0=世界+Y，顺时针，弧度）
 * 核心数学统一委托 sasModes.computeNavballDirections，此处仅做 { angle } 结构包装
 * @param {Object} ship - 飞船对象（含相对宿主的 vel/pos）
 * @param {Object|null} host - 宿主天体对象（getSOIHost 返回值），无宿主时为 null
 * @returns {Object} 四方向角度 { prograde, retrograde, radialIn, radialOut }，
 *                   每项为 { angle }（弧度）或 null（速度过小 / 无宿主）
 */
export function computeNavballDirections(ship, host) {
    const shipAbs = getAbsolutePosition(ship);
    const dirs = computeSasDirections(
        ship.vel.x, ship.vel.y,
        shipAbs.x, shipAbs.y,
        host ? host.position.x : undefined,
        host ? host.position.y : undefined
    );
    return {
        prograde: dirs.prograde !== null ? { angle: dirs.prograde } : null,
        retrograde: dirs.retrograde !== null ? { angle: dirs.retrograde } : null,
        radialIn: dirs.radialIn !== null ? { angle: dirs.radialIn } : null,
        radialOut: dirs.radialOut !== null ? { angle: dirs.radialOut } : null
    };
}

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
                    const facAbsPos = getAbsolutePosition(fac);
                    camera.x = facAbsPos.x;
                    camera.y = facAbsPos.y;
                }
                delete window.__pendingFacilityId;
            }

            // 显示可见性筛选面板（场景进入自动打开，不产生打开音效）
            sasUI.showVisibilityPanel({ silent: true });

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
                    const fAbsPos = getAbsolutePosition(f);
                    const screenX = _canvas.width / 2 + (fAbsPos.x - camera.x) * camera.zoom;
                    const screenY = _canvas.height / 2 + (fAbsPos.y - camera.y) * camera.zoom;
                    const hitRadius = Math.max(6, 10 * camera.zoom);
                    if (Math.abs(canvasX - screenX) <= hitRadius && Math.abs(canvasY - screenY) <= hitRadius) {
                        // 清除活动飞船 + 设置设施焦点，防止下一帧被 activeShip 覆盖
                        gameState.setState({ activeShipId: null, activeFacilityId: f.id });
                        _activeFacilityId = f.id;
                        camera.x = fAbsPos.x;
                        camera.y = fAbsPos.y;
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
                // 仅响应鼠标左键，避免右键等误触发拖拽
                if (e.button !== 0) return;
                const rect = _canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                // 仅当点击在节流阀弧形区域时开始拖拽
                if (sasUI.isInThrottleArc(x, y)) {
                    sasUI._isDragging = true;
                    // 立即应用按下位置的油门（避免拖动时跳变）
                    const result = sasUI.handleDrag(x, y);
                    const ship = shipSystem.getActiveShip();
                    if (ship && result) ship.throttle = result.throttle;
                }
            };
            const onMouseMove = (e) => {
                const rect = _canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // 拖拽更新节流阀
                if (sasUI._isDragging) {
                    // 兜底：左键实际已松开（如拖出画布后松开导致 mouseup 丢失）→ 立即结束拖拽
                    if ((e.buttons & 1) === 0) {
                        sasUI._isDragging = false;
                        return;
                    }
                    const result = sasUI.handleDrag(x, y);
                    if (result) {
                        const ship = shipSystem.getActiveShip();
                        if (ship) ship.throttle = result.throttle;
                    }
                } else {
                    // 非拖拽时检测悬停目标；仅在悬停目标变化时触发全局 tooltip（延迟显示、位置固定）
                    const ship = shipSystem.getActiveShip();
                    if (ship) {
                        const res = sasUI.handleHover(x, y, ship.sasMode || 'off');
                        if (res.label && res.changed) {
                            showTooltip(res.label, e.clientX, e.clientY);
                        } else if (!res.label) {
                            hideTooltip();
                        }
                    } else {
                        hideTooltip();
                    }
                }
            };
            const onMouseUp = () => {
                sasUI._isDragging = false;
            };
            _canvas.addEventListener('mousedown', onMouseDown);
            _canvas.addEventListener('mousemove', onMouseMove);
            // mouseup 绑定到 window：拖拽中鼠标移出画布松开也能清除拖拽态，防止 _isDragging 残留
            window.addEventListener('mouseup', onMouseUp);
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

            // SAS 集成 — 鼠标离开 canvas 时清除悬停状态与拖拽状态
            const onMouseLeave = () => {
                sasUI.clearHover();
                sasUI._isDragging = false;
            };
            _canvas.addEventListener('mouseleave', onMouseLeave);
            _canvas._sasMouseLeaveHandler = onMouseLeave;
        },
        exit: () => {
            // 隐藏对接提示框，防止遗留到其他场景
            window.hideDockPrompt();
            _dockPromptFacId = null;

            inputManager.disable();

            // 隐藏可见性筛选面板（场景退出自动关闭，不产生关闭音效）
            sasUI.hideVisibilityPanel({ silent: true });

            // 隐藏悬停提示（防切场景后 tooltip 残留）
            hideTooltip();

            // SAS 集成 — 清理 Canvas 事件监听
            if (_canvas._sasClickHandler) {
                _canvas.removeEventListener('click', _canvas._sasClickHandler);
                delete _canvas._sasClickHandler;
            }
            if (_canvas._sasDragHandlers) {
                _canvas.removeEventListener('mousedown', _canvas._sasDragHandlers.onMouseDown);
                _canvas.removeEventListener('mousemove', _canvas._sasDragHandlers.onMouseMove);
                // mouseup 已在 enter 内改绑到 window（防拖出画布后状态残留），此处同步解绑
                window.removeEventListener('mouseup', _canvas._sasDragHandlers.onMouseUp);
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
            const activeShip = shipSystem.getActiveShip();
            const activeId = activeShip ? activeShip.id : null;
            const allShips = shipSystem.getAllShips();
            const allFacilities = facilitySystem.getAllFacilities();

            // 时间加速 — 档位上限：点火 → 物理加速档(≤4x)；SOI 切换时间保护（剩余时间 T →
            // ≤T 最大档位：切换点至少 1 真实秒帧预算且保护最高档下 10s 内必达）；否则放开全部档位
            // 先设置档位上限再算 simDt：保证降档在本帧物理推进前生效（否则边界穿越帧会按旧高倍率大步长穿越导致位置跳变）
            let warpMaxIndex = timeWarp.getMaxIndex();
            if (activeShip && activeShip.throttle > 0) {
                warpMaxIndex = timeWarp.getPhysicsMaxIndex();
            } else if (activeShip) {
                // SOI 切换时间保护（替代旧"≥99% 半径 → 限 100x"距离制）：
                // 按预测的"到下一次 SOI 切换剩余时间 T"限档——保护最高档 = ≤T 的最大档位。
                // 与预测线同口径（含嵌套 SOI 进入）；深空/无解析轨道/永不切换返回 null → 不限档。
                // 可在设置 → 游戏 中关闭（关闭后放开全部档位，物理加速/RK4 兜底限档不受影响）
                if (getSOIWarpProtectEnabled()) {
                    const warpHost = activeShip.currentSOI
                        ? celestialBodies.find(b => b.name === activeShip.currentSOI)
                        : null;
                    const tSwitch = timeToNextSOISwitch(activeShip, warpHost);
                    if (tSwitch !== null) {
                        warpMaxIndex = Math.min(warpMaxIndex, timeWarp.getSOIProtectMaxIndex(tSwitch));
                    }
                }
            }
            // 病态区间限档：任一飞船/设施处于"无解析轨道且受引力"（RK4 兜底积分）时，
            // 限制到 RK4 安全档（≤50x）。高倍率下 RK4 子步数随倍率线性增长（1e6x 一帧约 33 万步
            // → 明显卡顿），该状态由 stateToKepler 病态回退产生（径向/近抛物线），窗口有界。
            if (warpMaxIndex > timeWarp.getRk4FallbackMaxIndex()) {
                const rk4Fallback = allShips.some(s => !s.kepler && s.currentGM > 0) ||
                    allFacilities.some(f => !f.kepler && f.currentGM > 0);
                if (rk4Fallback) {
                    warpMaxIndex = timeWarp.getRk4FallbackMaxIndex();
                }
            }
            // 存在撞击点（预测轨道近拱点低于危险边界）时限档到物理加速档（≤4x）。
            // 仅当轨道会真正进入大气/表面危险区时限制——稳定轨道即使接近危险区也不限档。
            // 与轨道线截断逻辑一致：预测线被引爆层截断的轨道才视为有撞击点。
            if (warpMaxIndex > timeWarp.getPhysicsMaxIndex() && activeShip && activeShip.currentSOI) {
                const hazardHost = celestialBodies.find(b => b.name === activeShip.currentSOI);
                if (hazardHost && activeShip.kepler && activeShip.kepler.a > 0) {
                    const hazardBoundary = hazardHost.hasAtmosphere && hazardHost.atmosphereHeight > 0
                        ? hazardHost.radius + hazardHost.atmosphereHeight
                        : hazardHost.radius;
                    // 近拱点半径 = a(1-e)，低于危险边界即存在撞击点
                    const periapsisR = activeShip.kepler.a * (1 - activeShip.kepler.e);
                    if (periapsisR < hazardBoundary) {
                        warpMaxIndex = timeWarp.getPhysicsMaxIndex();
                    }
                }
            }
            timeWarp.setMaxIndex(warpMaxIndex);
            const warpRate = timeWarp.getRate();
            const simDt = dt * warpRate;

            // 推进时间和天体（飞船/设施存相对宿主坐标，无需位置补偿）
            _setCelestialTime(_getCelestialTime() + simDt);
            updateCelestialBodies(_getCelestialTime());
            eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: _getCelestialTime(), dt: simDt });

            // 0.2.0 阶段6：扫描任务推进（随 simDt，时间加速下同步加速）
            updateScanProgress(simDt);

            // 物理推进
            for (const s of allShips) {
                const isActive = s.id === activeId;
                updateShipPhysics(s, simDt, isActive);
            }

            // 4b. 设施物理推进（走飞船物理的 on_rails 路径，isActive=false 强制无推力）
            for (const f of allFacilities) {
                updateShipPhysics(f, simDt, false);
            }

            // 5. 设施交互检测（活动飞船进入设施交互范围）
            _nearFacility = null;
            if (activeShip) {
                let nearestDist = Infinity;
                const shipAbsPos = getAbsolutePosition(activeShip);
                for (const f of allFacilities) {
                    const fAbsPos = getAbsolutePosition(f);
                    const dx = fAbsPos.x - shipAbsPos.x;
                    const dy = fAbsPos.y - shipAbsPos.y;
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
                    window.showNotification(t('dock.success'), 'success');
                } else {
                    window.showNotification(t('dock.failFull'), 'warning');
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

            // 5d. 对接弹窗状态驱动（委托 UI 模块管理 HTML DOM，渲染函数不碰 UI）
            if (_nearFacility && activeShip) {
                if (_dockPromptFacId !== _nearFacility.id) {
                    if (_dockPromptFacId) window.hideDockPrompt();
                    const facId = _nearFacility.id;
                    window.showDockPrompt(_nearFacility, () => {
                        const ship = shipSystem.getActiveShip();
                        if (ship && _nearFacility) {
                            const result = facilitySystem.dockShip(facId, ship.id);
                            if (result) {
                                window.showNotification(t('dock.success'), 'success');
                            } else {
                                window.showNotification(t('dock.failFull'), 'warning');
                            }
                        }
                    });
                    _dockPromptFacId = facId;
                }
            } else if (_dockPromptFacId) {
                window.hideDockPrompt();
                _dockPromptFacId = null;
            }

            // 朝向控制（仅对活动飞船生效；加速时锁输入，飞船保持朝向）
            if (activeShip && warpRate <= 1) {
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
                const host = getSOIHost(getAbsolutePosition(activeShip));
                const sasContext = {
                    shipVx: activeShip.vel.x,
                    shipVy: activeShip.vel.y,
                    shipX: getAbsolutePosition(activeShip).x,
                    shipY: getAbsolutePosition(activeShip).y,
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
                // 0.2.0 阶段2：引擎停机（燃料耗尽）时禁止点火，油门强制归零
                if (activeShip.engineOut) {
                    activeShip.throttle = 0;
                }
            }

            // 推力模式自动切换（油门驱动）
            if (activeShip) {
                if (activeShip.throttle > 0 && activeShip.mode === 'on_rails') {
                    activeShip.mode = 'thrust';
                }
                if (activeShip.throttle === 0 && activeShip.mode === 'thrust') {
                    // 油门归零 → 熄火：从当前pos/vel重算kepler（SOI检测仍由physicsUpdate负责）
                    const host = getSOIHost(getAbsolutePosition(activeShip));
                    if (host) {
                        activeShip.kepler = stateToKepler(activeShip.pos, activeShip.vel, host.gm) || null;
                        activeShip.orbitTime = 0;
                    } else {
                        activeShip.kepler = null;
                    }
                    activeShip.mode = 'on_rails';
                    activeShip.thrust = { ax: 0, ay: 0 };
                }
            }

            // 推力向量计算 + 燃料消耗（活动飞船，每帧）
            if (activeShip && activeShip.throttle > 0 && !activeShip.engineOut) {
                // 0.2.0：总质量 = 干质量 + 全部推进剂存量（资源模型）
                const totalMass = getTotalMass(activeShip);
                const thrustAccel = activeShip.throttle * activeShip.maxThrust / totalMass;
                activeShip.thrust = {
                    ax: Math.sin(activeShip.heading) * thrustAccel,
                    ay: Math.cos(activeShip.heading) * thrustAccel
                };

                // 燃料消耗（火箭方程：质量流量 = 推力 / (比冲 × g0)）
                // 0.2.0 阶段2：按引擎配方向各推进剂槽独立分配消耗（chemical: 氢:氧 = 1:8）
                const massFlow = activeShip.throttle * activeShip.maxThrust / (activeShip.isp * 9.81);
                const engineDef = getEngineType(activeShip.engineType) || getEngineType('chemical');
                if (engineDef && engineDef.props.length > 0) {
                    const totalRatio = engineDef.props.reduce((sum, p) => sum + p.ratio, 0);
                    for (const prop of engineDef.props) {
                        const slot = getResource(activeShip, prop.id);
                        if (slot) {
                            slot.amount = Math.max(0, slot.amount - massFlow * prop.ratio / totalRatio * simDt);
                        }
                    }
                    // 任一配方燃料耗尽 → 引擎停机（不修改 maxThrust，修复 B1）
                    const anyEmpty = engineDef.props.some(prop => {
                        const slot = getResource(activeShip, prop.id);
                        return !slot || slot.amount <= 0;
                    });
                    if (anyEmpty) {
                        activeShip.engineOut = true;
                        activeShip.throttle = 0;
                        activeShip.mode = 'on_rails';
                        activeShip.thrust = { ax: 0, ay: 0 };
                        // 停机时从当前 pos/vel 重算 kepler（与手动熄火一致，避免旧轨道跳变）
                        const host = getSOIHost(getAbsolutePosition(activeShip));
                        if (host) {
                            activeShip.kepler = stateToKepler(activeShip.pos, activeShip.vel, host.gm) || null;
                            activeShip.orbitTime = 0;
                        } else {
                            activeShip.kepler = null;
                        }
                        eventBus.emit(Events.SHIP_THRUST_ENDED, { shipId: activeShip.id, reason: 'out_of_fuel' });
                    }
                }
            } else if (activeShip && activeShip.throttle === 0) {
                activeShip.thrust = { ax: 0, ay: 0 };
            }

            // 相机跟随活动飞船，无活动飞船且选中设施时跟随设施
            if (activeShip) {
                const shipAbs = getAbsolutePosition(activeShip);
                camera.x = shipAbs.x;
                camera.y = shipAbs.y;
                _activeFacilityId = null;
                gameState.setState({ activeFacilityId: null });
            } else if (_activeFacilityId) {
                const focusedFacility = facilitySystem.getFacility(_activeFacilityId);
                if (focusedFacility) {
                    const facAbsPos = getAbsolutePosition(focusedFacility);
                    camera.x = facAbsPos.x;
                    camera.y = facAbsPos.y;
                }
            }

            _lastDt = dt;

            // SAS 集成 — 每帧帧末记录按键状态（供 justPressed 使用）
            // 必须在帧末快照：浏览器按键事件只能在下一次 rAF 前派发，
            // 若帧首快照会把本帧要触发的按键提前写入 _prevKeys，导致 justPressed 恒为 false
            inputManager.update();
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
            const directions = activeShip
                ? computeNavballDirections(activeShip, getSOIHost(getAbsolutePosition(activeShip)))
                : null;
            eventBus.emit(Events.RENDER_DATA, {
                exists: !!activeShip,
                // 世界游戏时间（秒）— 时间加速面板 UT 显示数据源（tracking 场景用 CELESTIAL_TIME_UPDATED）
                time: _getCelestialTime(),
                mode: activeShip?.mode ?? null,
                currentSOI: activeShip?.currentSOI ?? null,
                currentGM: activeShip?.currentGM ?? null,
                thrust: activeShip?.thrust ?? { ax: 0, ay: 0 },
                kepler: activeShip?.kepler ?? null,
                vel: activeShip?.vel ?? { x: 0, y: 0 },
                pos: activeShip?.pos ?? { x: 0, y: 0 },
                fuel: getFuelAmount(activeShip),
                // 0.2.0：修复 B2 — 广播推进剂总容量与资源槽，供 UI 正确显示
                fuelCapacity: getFuelCapacity(activeShip),
                resources: activeShip?.resources ?? null,
                isp: activeShip?.isp ?? 0,
                dryMass: activeShip?.dryMass ?? 0,
                maxThrust: activeShip?.maxThrust ?? 0,
                heading: activeShip?.heading ?? 0,
                throttle: activeShip?.throttle ?? 0,
                // 0.2.0 阶段2：引擎停机状态（燃料耗尽），供 UI 显示
                engineOut: activeShip?.engineOut ?? false,
                controlsLocked: activeShip?.controlsLocked ?? false,
                displayName: activeShip?.displayName ?? '',
                nearFacilityId: _nearFacility?.id ?? null,
                activeFacilityId: _activeFacilityId ?? null,
                // 导航球四方向实时角度（Step1：数据层广播），无活动飞船时为 null
                directions: directions
            });
        }
    });
}
