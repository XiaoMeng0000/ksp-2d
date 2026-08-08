import { sceneManager } from '../sceneManager.js';
import { shipSystem } from '../ship/shipSystem.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { camera } from '../camera.js';
import { updateShipPhysics } from '../physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from '../physics/physics.js';
import { render } from '../renderer.js';
import { eventBus, Events } from '../eventBus.js';
import { gameState } from '../gameState.js';
import { timeWarp } from '../timeWarp.js';

// 追踪站内部状态
let trackingFocusPos = null;
let trackingSelectedId = null;
let trackingFrameCount = 0;

// 折叠状态 — 持久化，ui.js 飞船摧毁后刷新追踪树时需要
export const trackingCollapsed = {};

// 由 main.js 注册时注入
let _getCelestialTime = null;
let _setCelestialTime = null;
let _canvas = null;

// 构建天体层级树（单一数据源：GameState.ships）
export function buildTrackingTree() {
    const bodies = celestialBodies;

    const tree = [];

    // 创建节点映射
    const nodeMap = new Map();
    for (const body of bodies) {
        nodeMap.set(body.name, {
            name: body.name,
            id: body.name,
            type: body.type,
            children: []
        });
    }

    // 飞船列表只从 GameState 读取，不再创建 temp-ship 假节点
    const gameStateShips = gameState.getAllShipsRef();

    // 构建层级
    for (const body of bodies) {
        const node = nodeMap.get(body.name);
        if (!node) continue;

        if (body.orbitParent) {
            const parentNode = nodeMap.get(body.orbitParent);
            if (parentNode) {
                parentNode.children.push(node);
            }
        } else {
            tree.push(node);
        }
    }

    // 将飞船添加到对应的 SOI 宿主下
    for (const ship of gameStateShips) {
        const shipNode = {
            name: ship.displayName || ship.id || '飞船',
            type: 'ship',
            children: [],
            id: ship.id,
            // 追踪站摧毁 — 统一 delete 接口，未来设施节点也会有此接口
            delete: () => shipSystem.deleteShip(ship.id)
        };

        const soiHostName = ship.currentSOI;
        if (soiHostName && nodeMap.has(soiHostName)) {
            nodeMap.get(soiHostName).children.push(shipNode);
        } else if (tree.length > 0) {
            tree[0].children.push(shipNode);
        }
    }

    // 将设施添加到对应的 SOI 宿主下
    const allFacilities = facilitySystem.getAllFacilities();
    for (const f of allFacilities) {
        const facilityNode = {
            name: f.name || '设施',
            type: 'facility',
            children: [],
            id: f.id,
            facilityTypeId: f.typeId,
            usedDocks: f.usedDocks,
            maxDocks: f.maxDocks,
            delete: () => facilitySystem.deleteFacility(f.id)
        };
        const soiHostName = f.hostSOI;
        if (soiHostName && nodeMap.has(soiHostName)) {
            nodeMap.get(soiHostName).children.push(facilityNode);
        }
    }

    return tree;
}

// 渲染导航栏树结构
export function renderTrackingNav(tree) {
    const container = document.getElementById('trackingTree');
    if (!container) return;

    container.innerHTML = '';

    const typeColors = {
        star: '#ffcc44',
        planet: '#4488ff',
        moon: '#aaaaaa',
        ship: '#88ff88',
        facility: '#ff8844'
    };

    // 层级折叠 — 递归渲染节点
    function renderNode(node, depth = 0) {
        const isCollapsed = trackingCollapsed[node.id] || false;
        const hasChildren = node.children && node.children.length > 0;
        const isSelected = node.id === trackingSelectedId;

        const div = document.createElement('div');
        div.style.cssText = `
            padding: 4px 8px; margin-left: ${depth * 15}px;
            cursor: pointer; color: ${typeColors[node.type] || '#fff'};
            border-radius: 2px; transition: background 0.2s;
            display: flex; align-items: center; gap: 4px;
            ${isSelected ? 'background: rgba(136, 204, 255, 0.15); border-left: 2px solid #88ccff;' : ''}
        `;

        // 折叠按钮（如果有子节点）
        if (hasChildren) {
            const toggle = document.createElement('span');
            toggle.textContent = isCollapsed ? '▶' : '▼';
            toggle.style.cursor = 'pointer';
            toggle.style.fontSize = '10px';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                trackingCollapsed[node.id] = !isCollapsed;
                renderTrackingNav(tree);
            });
            div.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.textContent = '·';
            spacer.style.opacity = '0';
            spacer.style.width = '12px';
            div.appendChild(spacer);
        }

        // 节点名称
        const nameSpan = document.createElement('span');
        nameSpan.textContent = node.name;
        nameSpan.style.cursor = 'pointer';
        nameSpan.addEventListener('mouseover', () => {
            if (!isSelected) {
                div.style.background = 'rgba(255,255,255,0.1)';
            }
        });
        nameSpan.addEventListener('mouseout', () => {
            if (!isSelected) {
                div.style.background = 'transparent';
            }
        });
        nameSpan.addEventListener('click', () => {
            trackingSelectedId = node.id;
            const bodies = celestialBodies;
            const body = bodies.find(b => b.name === node.name);
            if (body) {
                trackingFocusPos = { x: body.position.x, y: body.position.y };
            } else if (node.type === 'ship') {
                // 用真实 ID 从 shipSystem 获取飞船位置
                const focusedShip = shipSystem.getShip(node.id);
                if (focusedShip) {
                    const shipAbsPos = getAbsolutePosition(focusedShip);
                    trackingFocusPos = { x: shipAbsPos.x, y: shipAbsPos.y };
                }
            } else if (node.type === 'facility') {
                const focusedFacility = facilitySystem.getFacility(node.id);
                if (focusedFacility) {
                    const fAbsPos = getAbsolutePosition(focusedFacility);
                    trackingFocusPos = { x: fAbsPos.x, y: fAbsPos.y };
                }
            }
            window.updateTrackingInfo(node);
            renderTrackingNav(tree);
        });
        div.appendChild(nameSpan);

        container.appendChild(div);

        // 递归渲染子节点（如果不折叠）
        if (!isCollapsed && hasChildren) {
            node.children.forEach(child => renderNode(child, depth + 1));
        }
    }

    tree.forEach(node => renderNode(node));
}

/**
 * 注册追踪站场景
 * @param {Object} deps - 注入依赖
 * @param {Function} deps.getTime - 获取当前游戏时间
 * @param {Function} deps.setTime - 设置游戏时间
 * @param {HTMLCanvasElement} deps.canvas - 游戏画布
 */
export function registerTrackingScene({ getTime, setTime, canvas }) {
    _getCelestialTime = getTime;
    _setCelestialTime = setTime;
    _canvas = canvas;

    sceneManager.registerScene('tracking', {
        name: '追踪站',
        enter: () => {
            // 锁定飞船控制
            const activeShip = shipSystem.getActiveShip();
            if (activeShip) {
                activeShip.controlsLocked = true;
            }
            // 重置聚焦位置和选中状态，默认聚焦飞船
            trackingFocusPos = null;
            trackingSelectedId = null;
            trackingFrameCount = 0;
            // 构建并渲染天体树
            const tree = buildTrackingTree();
            renderTrackingNav(tree);
            // 默认选中飞船（使用真实 ID）
            if (activeShip) {
                trackingSelectedId = activeShip.id;
                const absPos = getAbsolutePosition(activeShip);
                trackingFocusPos = { x: absPos.x, y: absPos.y };
                const shipName = activeShip.displayName || activeShip.id || '飞船';
                window.updateTrackingInfo({
                    id: activeShip.id,
                    name: shipName,
                    type: 'ship',
                    soi: activeShip.currentSOI,
                    // 追踪站摧毁 — 统一 delete 接口
                    delete: () => shipSystem.deleteShip(activeShip.id)
                });
            }
        },
        exit: () => {
            // 解锁飞船控制
            const activeShip = shipSystem.getActiveShip();
            if (activeShip) {
                activeShip.controlsLocked = false;
            }
            // 隐藏信息窗口
            window.hideTrackingInfo && window.hideTrackingInfo();
        },
        update: (dt) => {
            const activeShip = shipSystem.getActiveShip();
            const activeId = activeShip ? activeShip.id : null;
            const allShips = shipSystem.getAllShips();

            // 时间加速 — 追踪站无推力，放开全部档位；物理时间步长 = 真实帧长 × 倍率
            timeWarp.setMaxIndex(timeWarp.getMaxIndex());
            const simDt = dt * timeWarp.getRate();

            // 推进时间和天体（飞船/设施存相对宿主坐标，无需位置补偿）
            _setCelestialTime(_getCelestialTime() + simDt);
            updateCelestialBodies(_getCelestialTime());
            eventBus.emit(Events.CELESTIAL_TIME_UPDATED, { time: _getCelestialTime(), dt: simDt });

            // 物理推进（追踪站）
            for (const s of allShips) {
                const isActive = s.id === activeId;
                updateShipPhysics(s, simDt, isActive);
            }

            // 4b. 设施物理推进（设施同样存相对宿主坐标）
            const allFacilities = facilitySystem.getAllFacilities();
            for (const f of allFacilities) {
                updateShipPhysics(f, simDt, false);
            }

            // 每帧更新聚焦位置（平滑跟随选中物体，用真实 ID 匹配）
            if (trackingSelectedId) {
                const bodies = celestialBodies;
                const body = bodies.find(b => b.name === trackingSelectedId);
                if (body) {
                    trackingFocusPos = { x: body.position.x, y: body.position.y };
                } else if (activeShip && trackingSelectedId === activeShip.id) {
                    const absPos = getAbsolutePosition(activeShip);
                    trackingFocusPos = { x: absPos.x, y: absPos.y };
                } else {
                    // 多飞船追踪 — 如果选中的是非活动飞船，从 shipSystem 获取位置
                    const focusedShip = shipSystem.getShip(trackingSelectedId);
                    if (focusedShip) {
                        const focusedAbsPos = getAbsolutePosition(focusedShip);
                        trackingFocusPos = { x: focusedAbsPos.x, y: focusedAbsPos.y };
                    } else {
                        // 设施追踪
                        const focusedFacility = facilitySystem.getFacility(trackingSelectedId);
                        if (focusedFacility) {
                            const fAbsPos = getAbsolutePosition(focusedFacility);
                            trackingFocusPos = { x: fAbsPos.x, y: fAbsPos.y };
                        }
                    }
                }
            }

            // 每60帧重建导航树
            trackingFrameCount++;
            if (trackingFrameCount % 60 === 0) {
                const container = document.getElementById('trackingTree');
                const scrollTop = container ? container.scrollTop : 0;
                const tree = buildTrackingTree();
                renderTrackingNav(tree);
                if (container) {
                    container.scrollTop = scrollTop;
                }
            }
        },
        render: (ctx) => {
            // 设置相机聚焦位置（只使用 trackingFocusPos）
            const activeShip = shipSystem.getActiveShip();
            let focusPos = { x: 0, y: 0 };
            if (trackingFocusPos) {
                focusPos = trackingFocusPos;
            } else if (activeShip) {
                const absPos = getAbsolutePosition(activeShip);
                focusPos = { x: absPos.x, y: absPos.y };
            }
            camera.x = focusPos.x;
            camera.y = focusPos.y;

            // 多飞船渲染 — 追踪站显示所有飞船
            const renderFacilities = facilitySystem.getAllFacilities();
            let selectedFacId = null;
            if (trackingSelectedId && facilitySystem.getFacility(trackingSelectedId)) {
                selectedFacId = trackingSelectedId;
            }
            render(ctx, _canvas, activeShip, {
                visibility: { ships: true, facilities: true, bodyOrbits: true },
                facilities: renderFacilities,
                selectedFacilityId: selectedFacId
            });
        }
    });
}
