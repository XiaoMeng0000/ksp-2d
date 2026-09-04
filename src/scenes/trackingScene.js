import { sceneManager } from '../sceneManager.js';
import { shipSystem } from '../ship/shipSystem.js';
import { facilitySystem } from '../facility/facilitySystem.js';
import { getFacilityType } from '../facility/facilityTypes.js';
import { camera } from '../camera.js';
import { updateShipPhysics } from '../physics/physicsUpdate.js';
import { updateCelestialBodies, getAbsolutePosition, celestialBodies } from '../physics/physics.js';
import { timeToNextSOISwitch } from '../physics/orbitalPrediction.js';
import { render } from '../renderer.js';
import { eventBus, Events } from '../eventBus.js';
import { gameState } from '../gameState.js';
import { timeWarp } from '../timeWarp.js';
import { getSOIWarpProtectEnabled } from '../config/settingsConfig.js';
import { t } from '../config/strings.js';
import { renderIconHtml } from '../ui/uiComponents.js';
import { clearOrbitLabels } from '../ui/orbitLabels.js';

// 追踪站内部状态
let trackingFocusPos = null;
let trackingSelectedId = null;
let trackingFrameCount = 0;

// 导航栏 Tab 状态：'all' = 完整层级树，'vessels' = 航天器与聚落平铺
let trackingNavTab = 'all';

// 折叠状态 — 持久化，UI 模块飞船摧毁后刷新追踪树时需要
export const trackingCollapsed = {};

// 由 main.js 注册时注入
let _getCelestialTime = null;
let _setCelestialTime = null;
let _canvas = null;

// 构建飞船卡片节点（buildTrackingTree / buildVesselNodes 复用）
function buildShipNode(ship) {
    return {
        name: ship.displayName || ship.id || t('tracking.typeShip'),
        type: 'ship',
        children: [],
        id: ship.id,
        soiName: ship.currentSOI || t('tracking.deepSpace'),
        iconTextureKey: ship.iconTextureKey || 'ship_default_active',
        // 追踪站摧毁 — 统一 delete 接口，未来设施节点也会有此接口
        delete: () => shipSystem.deleteShip(ship.id)
    };
}

// 构建设施卡片节点
function buildFacilityNode(f) {
    const typeCfg = getFacilityType(f.typeId);
    return {
        name: f.name || t('tracking.typeFacility'),
        type: 'facility',
        children: [],
        id: f.id,
        facilityTypeId: f.typeId,
        usedDocks: f.usedDocks,
        maxDocks: f.maxDocks,
        soiName: f.hostSOI || t('tracking.deepSpace'),
        iconTextureKey: typeCfg ? typeCfg.iconTextureKey : null,
        delete: () => facilitySystem.deleteFacility(f.id)
    };
}

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
        const shipNode = buildShipNode(ship);

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
        const facilityNode = buildFacilityNode(f);
        const soiHostName = f.hostSOI;
        if (soiHostName && nodeMap.has(soiHostName)) {
            nodeMap.get(soiHostName).children.push(facilityNode);
        }
    }

    return tree;
}

// 构建"航天器与聚落"平铺列表（Tab 2 数据源：飞船 + 设施按类型分组）
export function buildVesselNodes() {
    const ships = gameState.getAllShipsRef().map(buildShipNode);
    const facilities = facilitySystem.getAllFacilities().map(buildFacilityNode);
    return { ships, facilities };
}

// 切换导航栏 Tab 并立即重渲染
export function setTrackingNavTab(tab) {
    trackingNavTab = tab;
    renderTrackingNav(buildTrackingTree());
}

// 导航树指纹 — 60帧周期重建时比对，无变化则跳过渲染，避免图标/hover 闪烁
let _lastNavFingerprint = '';

// 计算当前导航栏完整状态的指纹（Tab / 选中 / 折叠 / 树结构 / 平铺列表）
function computeNavFingerprint(tree) {
    const parts = [];
    parts.push('tab:' + trackingNavTab);
    parts.push('sel:' + (trackingSelectedId || ''));
    for (const key of Object.keys(trackingCollapsed).sort()) {
        parts.push(key + ':' + (trackingCollapsed[key] ? 1 : 0));
    }
    if (trackingNavTab === 'vessels') {
        const { ships, facilities } = buildVesselNodes();
        parts.push('S:' + ships.map(s => s.id + '>' + s.soiName).join(','));
        parts.push('F:' + facilities.map(f => f.id + '>' + f.soiName).join(','));
    } else {
        (function collect(nodes) {
            for (const n of nodes) {
                parts.push(n.type + ':' + n.id);
                if (n.children && n.children.length > 0) collect(n.children);
            }
        })(tree);
    }
    return parts.join('|');
}

// 追踪站 - 按节点类型定位镜头（信息面板"聚焦"按钮复用）
export function focusTrackingNode(node) {
    const body = celestialBodies.find(b => b.name === node.name);
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
}

// 渲染导航栏树结构（按当前 Tab 分支：'all' 完整层级 / 'vessels' 航天器与聚落平铺）
export function renderTrackingNav(tree) {
    const container = document.getElementById('trackingTree');
    if (!container) return;

    container.innerHTML = '';

    // 选中节点统一行为：记录选中 → 聚焦 → 更新信息面板 → 重渲染
    function selectNode(node) {
        trackingSelectedId = node.id;
        focusTrackingNode(node);
        window.updateTrackingInfo(node);
        renderTrackingNav(tree);
    }

    // 卡片节点（飞船/设施）：图标 + 名称 + 副标题（类型 · SOI），整卡可点击
    function renderCardNode(node, depth = 0, parentContainer = container) {
        const isSelected = node.id === trackingSelectedId;
        const typeLabel = node.type === 'ship' ? t('tracking.typeShip') : t('tracking.typeFacility');

        const div = document.createElement('div');
        div.className = 'tracking-node-card' + (isSelected ? ' tracking-node-selected' : '');
        if (depth > 0) div.style.marginLeft = (depth * 15) + 'px';

        const main = document.createElement('div');
        main.className = 'tracking-node-main';
        main.innerHTML = `${renderIconHtml(node.iconTextureKey, '◈', 14)}<span>${node.name}</span>`;
        div.appendChild(main);

        const sub = document.createElement('div');
        sub.className = 'tracking-node-sub';
        sub.textContent = `${typeLabel} · ${node.soiName}`;
        div.appendChild(sub);

        div.addEventListener('click', () => selectNode(node));
        parentContainer.appendChild(div);
    }

    // 天体节点：折叠箭头 + 名称（统一文本色）
    // 在 renderTrackingNav 内部定义（或修改外部函数签名）
    function renderBodyNode(node, depth = 0, parentContainer = container) {
        const isCollapsed = trackingCollapsed[node.id] || false;
        const hasChildren = node.children && node.children.length > 0;

        // 整个节点包裹（行 + 子列表）
        const wrapper = document.createElement('div');
        wrapper.className = 'tracking-node-wrapper';

        // ---- 节点行 ----
        const row = document.createElement('div');
        row.className = 'tracking-node' + (node.id === trackingSelectedId ? ' tracking-node-selected' : '');
        row.style.marginLeft = (depth * 15) + 'px';

        // 折叠按钮
        if (hasChildren) {
            const toggle = document.createElement('span');
            toggle.className = 'tracking-node-toggle';
            toggle.textContent = isCollapsed ? '▶' : '▼';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                trackingCollapsed[node.id] = !isCollapsed;
                renderTrackingNav(tree); // 重绘
            });
            row.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'tracking-node-spacer';
            row.appendChild(spacer);
        }

        const nameSpan = document.createElement('span');
        nameSpan.textContent = node.name;
        row.appendChild(nameSpan);

        // 点击行选择节点
        row.addEventListener('click', () => selectNode(node));
        wrapper.appendChild(row);

        // ---- 子节点列表容器（仅在展开且有子时添加） ----
        if (hasChildren && !isCollapsed) {
            const subContainer = document.createElement('div');
            subContainer.className = 'subnodes_container';
            // 设置虚线缩进位置（与当前缩进 + 一个单位对齐）
            const indent = (depth + 1) * 15; // 子节点缩进量
            subContainer.style.setProperty('--deepth', indent + 'px');
            // 递归渲染子节点，传入 subContainer 作为父容器
            node.children.forEach(child => {
                if (child.type === 'ship' || child.type === 'facility') {
                    // 卡片节点同样传入容器参数（需修改 renderCardNode 签名）
                    renderCardNode(child, depth + 1, subContainer);
                } else {
                    renderBodyNode(child, depth + 1, subContainer);
                }
            });
            wrapper.appendChild(subContainer);
        }

        parentContainer.appendChild(wrapper);
    }

    // "航天器与聚落" Tab：分组标题（可折叠）+ 平铺卡片
    function renderGroup(title, groupKey, items, emptyText) {
        const isCollapsed = trackingCollapsed[groupKey] || false;

        const header = document.createElement('div');
        header.className = 'tracking-group-header';
        header.innerHTML = `<span class="tracking-node-toggle">${isCollapsed ? '▶' : '▼'}</span>` +
            `<span>${title}</span>` +
            `<span class="tracking-group-count">${items.length}</span>`;
        header.addEventListener('click', () => {
            trackingCollapsed[groupKey] = !isCollapsed;
            renderTrackingNav(tree);
        });
        container.appendChild(header);

        if (!isCollapsed) {
            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'tracking-list-empty';
                empty.textContent = emptyText;
                container.appendChild(empty);
            } else {
                items.forEach(item => renderCardNode(item, 0));
            }
        }
    }

    if (trackingNavTab === 'vessels') {
        const { ships, facilities } = buildVesselNodes();
        renderGroup(t('tracking.groupVessels'), 'vessels-ships', ships, t('tracking.noVessels'));
        renderGroup(t('tracking.groupFacilities'), 'vessels-facilities', facilities, t('tracking.noFacilities'));
    } else {
        tree.forEach(node => renderBodyNode(node));
    }

    // 记录本次渲染后的指纹，供 60 帧周期重建比对
    _lastNavFingerprint = computeNavFingerprint(tree);
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
        name: t('tracking.stationName'),
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
                const shipName = activeShip.displayName || activeShip.id || t('tracking.typeShip');
                window.updateTrackingInfo({
                    id: activeShip.id,
                    name: shipName,
                    type: 'ship',
                    soi: activeShip.currentSOI,
                    // 追踪站摧毁 — 统一 delete 接口
                    delete: () => shipSystem.deleteShip(activeShip.id)
                }, { silent: true });
            }
        },
        exit: () => {
            // 解锁飞船控制
            const activeShip = shipSystem.getActiveShip();
            if (activeShip) {
                activeShip.controlsLocked = false;
            }
            // 隐藏信息窗口（场景退出自动关闭，不产生关闭音效）
            window.hideTrackingInfo && window.hideTrackingInfo({ silent: true });
            // 清空轨道标签（追踪站同样产生 Ap/Pe 标记，退出后必须显式清理，防残留其他场景）
            clearOrbitLabels();
        },
        update: (dt) => {
            const activeShip = shipSystem.getActiveShip();
            const activeId = activeShip ? activeShip.id : null;
            const allShips = shipSystem.getAllShips();

            // 时间加速 — 追踪站无推力放开全部档位；SOI 切换时间保护：仅活动飞船按
            // "到下一次切换剩余时间 T"限档（保护最高档 = ≤T 的最大档位）；
            // 非活动飞船即将切 SOI 不触发降档（与飞行场景一致）。
            // 可在设置 → 游戏 中关闭（关闭后放开全部档位，RK4 兜底限档不受影响）
            let warpMaxIndex = timeWarp.getMaxIndex();
            if (getSOIWarpProtectEnabled() && activeShip) {
                const warpHost = activeShip.currentSOI
                    ? celestialBodies.find(b => b.name === activeShip.currentSOI)
                    : null;
                const tSwitch = timeToNextSOISwitch(activeShip, warpHost);
                if (tSwitch !== null) {
                    warpMaxIndex = Math.min(warpMaxIndex, timeWarp.getSOIProtectMaxIndex(tSwitch));
                }
            }
            // 病态区间限档：任一飞船/设施处于"无解析轨道且受引力"（RK4 兜底积分）时限档 ≤50x。
            // 与上方 SOI 边界限档叠加取更严，防止高倍率下 RK4 子步卡顿。
            if (warpMaxIndex > timeWarp.getRk4FallbackMaxIndex()) {
                const rk4Fallback = allShips.some(s => !s.kepler && s.currentGM > 0) ||
                    facilitySystem.getAllFacilities().some(f => !f.kepler && f.currentGM > 0);
                if (rk4Fallback) {
                    warpMaxIndex = timeWarp.getRk4FallbackMaxIndex();
                }
            }
            timeWarp.setMaxIndex(warpMaxIndex);
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

            // 每60帧检查导航树：仅当状态指纹变化时才重建（无变化跳过，避免图标/hover 闪烁）
            trackingFrameCount++;
            if (trackingFrameCount % 60 === 0) {
                const tree = buildTrackingTree();
                if (computeNavFingerprint(tree) !== _lastNavFingerprint) {
                    const container = document.getElementById('trackingTree');
                    const scrollTop = container ? container.scrollTop : 0;
                    renderTrackingNav(tree);
                    if (container) {
                        container.scrollTop = scrollTop;
                    }
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
