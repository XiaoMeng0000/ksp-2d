'use strict';

// 设施系统 — 设施注册表/管理器单例
import { gameState } from '../gameState.js';
import { eventBus, Events } from '../eventBus.js';
import { getFacilityType } from './facilityTypes.js';
import { stateToKepler, keplerToState } from '../physics/orbitalMechanics.js';
import { celestialBodies } from '../physics/physics.js';
import { shipSystem } from '../ship/shipSystem.js';

class FacilitySystem {
    constructor() {
        if (FacilitySystem._instance) {
            return FacilitySystem._instance;
        }
        FacilitySystem._instance = this;
        // 记录最后一艘飞船对接到的设施 ID，供外部判断"无活动飞船时切到设施控制"
        this.lastDockedFacilityId = null;
    }

    // ========== 创建设施 ==========
    createFacility(typeId, name, pos, vel, hostName) {
        const typeConfig = getFacilityType(typeId);
        if (!typeConfig) {
            console.warn(`[FacilitySystem] 设施类型 ${typeId} 不存在`);
            return null;
        }

        const host = celestialBodies.find(b => b.name === hostName);
        if (!host) {
            console.warn(`[FacilitySystem] 天体 ${hostName} 不存在`);
            return null;
        }

        const facilityId = 'facility_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

        // 计算相对位置（vel 已经是相对宿主速度，符合项目约定）
        const relPos = {
            x: pos.x - host.position.x,
            y: pos.y - host.position.y
        };

        const keplerData = stateToKepler(relPos, vel, host.gm);
        if (!keplerData) {
            console.warn('[FacilitySystem] 无法计算设施轨道（可能是逃逸轨道），创建失败');
            return null;
        }

        const facility = {
            id: facilityId,
            typeId: typeId,
            name: name,

            // 轨道参数（部署后锁死）
            hostSOI: hostName,
            currentGM: host.gm,
            currentHostPos: {
                x: host.position.x,
                y: host.position.y
            },
            kepler: keplerData,
            orbitTime: 0,
            // 设施 pos 存相对宿主坐标（与飞船统一），外部需要绝对坐标时用 getAbsolutePosition
            pos: { x: relPos.x, y: relPos.y },
            vel: { x: vel.x, y: vel.y },
            currentSOI: hostName,
            mode: 'on_rails',

            // 交互
            interactionRange: 5000,

            // 对接口
            maxDocks: typeConfig.baseDocks,
            usedDocks: 0,
            dockedShips: [],

            // 预留字段
            upgradeLevel: 1,
            missionServices: []
        };

        const state = gameState.getState();
        state.facilities.push(facility);
        gameState.setState({ facilities: state.facilities });

        eventBus.emit(Events.FACILITY_CREATED, { facilityId, name, typeId, hostName });
        console.log(`[FacilitySystem] 设施创建成功: ${facilityId} (${name})`);

        return gameState.getAllFacilitiesRef().find(f => f.id === facilityId) || null;
    }

    // ========== 删除设施 ==========
    deleteFacility(id) {
        const state = gameState.getState();
        const index = state.facilities.findIndex(f => f.id === id);
        if (index === -1) {
            console.warn(`[FacilitySystem] 设施 ${id} 不存在，无法删除`);
            return false;
        }

        const facility = state.facilities[index];

        // 将停靠飞船移回 GameState.ships
        if (facility.dockedShips.length > 0) {
            const ships = gameState.getState().ships;
            // 从 kepler 反算设施相对速度（所有停靠飞船共用，提到循环外）
            const relState = keplerToState(facility.kepler, facility.currentGM, facility.orbitTime);
            for (const dockedShip of facility.dockedShips) {
                // 位置 = 设施当前位置（相对宿主坐标）+ 随机偏移
                dockedShip.pos = {
                    x: facility.pos.x + (Math.random() - 0.5) * 10,
                    y: facility.pos.y + (Math.random() - 0.5) * 10
                };
                // 速度 = 设施相对轨道速度（不再加宿主速度）
                dockedShip.vel = {
                    x: relState.vel.x,
                    y: relState.vel.y
                };
                dockedShip.currentSOI = facility.hostSOI;
                dockedShip.currentGM = facility.currentGM;
                dockedShip.currentHostPos = { x: facility.currentHostPos.x, y: facility.currentHostPos.y };
                dockedShip.kepler = { ...facility.kepler };
                dockedShip.orbitTime = facility.orbitTime;
                dockedShip.mode = 'on_rails';
                dockedShip.thrust = { ax: 0, ay: 0 };
                dockedShip.throttle = 0;
                ships.push(dockedShip);
            }
            gameState.setState({ ships });
        }

        state.facilities.splice(index, 1);
        gameState.setState({ facilities: state.facilities });

        if (this.lastDockedFacilityId === id) {
            this.lastDockedFacilityId = null;
        }

        eventBus.emit(Events.FACILITY_DELETED, { facilityId: id });
        console.log(`[FacilitySystem] 设施已删除: ${id}`);
        return true;
    }

    // ========== 查询 ==========
    getFacility(id) {
        return gameState.getAllFacilitiesRef().find(f => f.id === id) || null;
    }

    getAllFacilities() {
        return gameState.getAllFacilitiesRef();
    }

    // ========== 对接 ==========
    dockShip(facilityId, shipId) {
        const facility = this.getFacility(facilityId);
        if (!facility) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 不存在，无法对接`);
            return false;
        }

        if (facility.usedDocks >= facility.maxDocks) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 对接口已满 (${facility.usedDocks}/${facility.maxDocks})`);
            return false;
        }

        const ships = gameState.getState().ships;
        const shipIndex = ships.findIndex(s => s.id === shipId);
        if (shipIndex === -1) {
            console.warn(`[FacilitySystem] 飞船 ${shipId} 不在活动列表中，无法对接`);
            return false;
        }

        // 从活动列表移除
        const ship = ships.splice(shipIndex, 1)[0];

        // 存入设施
        facility.dockedShips.push(ship);
        facility.usedDocks += 1;

        // 更新 GameState.ships
        gameState.setState({ ships });

        // 如果对接的是活动飞船
        const state = gameState.getState();
        if (state.activeShipId === shipId) {
            if (ships.length > 0) {
                gameState.setState({ activeShipId: ships[0].id });
            } else {
                this.lastDockedFacilityId = facilityId;
                gameState.setState({ activeShipId: null });
            }
        }

        this.persistFacility(facility);

        eventBus.emit(Events.FACILITY_DOCKED, { facilityId, shipId });
        console.log(`[FacilitySystem] 飞船 ${shipId} 对接至 ${facilityId}`);

        return true;
    }

    // ========== 起飞 ==========
    undockShip(facilityId, shipId) {
        const facility = this.getFacility(facilityId);
        if (!facility) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 不存在，无法起飞`);
            return false;
        }

        const shipIndex = facility.dockedShips.findIndex(s => s.id === shipId);
        if (shipIndex === -1) {
            console.warn(`[FacilitySystem] 飞船 ${shipId} 不在设施 ${facilityId} 的停靠列表中`);
            return false;
        }

        const ship = facility.dockedShips.splice(shipIndex, 1)[0];
        facility.usedDocks -= 1;

        // 计算设施当前轨道速度
        const relState = keplerToState(facility.kepler, facility.currentGM, facility.orbitTime);

        // 飞船位置 = 设施当前位置 + 偏移（相对宿主坐标，防止起飞后立即触发交互检测）
        ship.pos = {
            x: facility.pos.x + 5,
            y: facility.pos.y + 5
        };
        // 飞船速度 = 设施当前相对轨道速度
        ship.vel = {
            x: relState.vel.x,
            y: relState.vel.y
        };
        ship.currentSOI = facility.hostSOI;
        ship.currentGM = facility.currentGM;
        ship.currentHostPos = {
            x: facility.currentHostPos.x,
            y: facility.currentHostPos.y
        };
        ship.kepler = { ...facility.kepler };
        ship.orbitTime = facility.orbitTime;
        ship.mode = 'on_rails';
        ship.thrust = { ax: 0, ay: 0 };
        ship.throttle = 0;

        // 放回活动飞船列表
        const state = gameState.getState();
        state.ships.push(ship);
        gameState.setState({ ships: state.ships });

        // 设为活动飞船
        gameState.setState({ activeShipId: shipId });

        this.persistFacility(facility);

        eventBus.emit(Events.FACILITY_UNDOCKED, { facilityId, shipId });
        console.log(`[FacilitySystem] 飞船 ${shipId} 从 ${facilityId} 起飞`);

        return true;
    }

    // ========== 补给燃料 ==========
    refuelShip(facilityId, shipId) {
        const facility = this.getFacility(facilityId);
        if (!facility) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 不存在，无法补给`);
            return false;
        }

        const ship = facility.dockedShips.find(s => s.id === shipId);
        if (!ship) {
            console.warn(`[FacilitySystem] 飞船 ${shipId} 不在设施 ${facilityId} 中`);
            return false;
        }

        // TODO: 点数系统启用后扣除点数（阶段 3）
        // 0.2.0：补满推进剂资源槽（旧 ship.fuel 字段已废弃）
        const hyd = ship.resources ? ship.resources.hydrogen : null;
        const ox = ship.resources ? ship.resources.oxygen : null;
        if (hyd) hyd.amount = hyd.capacity;
        if (ox) ox.amount = ox.capacity;

        this.persistFacility(facility);
        console.log(`[FacilitySystem] 飞船 ${shipId} 燃料已补满`);
        return true;
    }

    // ========== 安装模块 ==========
    addModuleToShip(facilityId, shipId, moduleTypeId) {
        const facility = this.getFacility(facilityId);
        if (!facility) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 不存在`);
            return false;
        }

        const ship = facility.dockedShips.find(s => s.id === shipId);
        if (!ship) {
            console.warn(`[FacilitySystem] 飞船 ${shipId} 不在设施 ${facilityId} 中`);
            return false;
        }

        const def = shipSystem.getModuleDef(moduleTypeId);
        if (!def) {
            console.warn(`[FacilitySystem] 模块类型 ${moduleTypeId} 不存在`);
            return false;
        }

        if (ship.modules.length >= ship.moduleSlots) {
            console.warn(`[FacilitySystem] 飞船 ${shipId} 模块槽已满`);
            return false;
        }

        ship.modules.push({
            id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
            type: def.id,
            installedAt: Date.now()
        });
        ship.dryMass += def.massBonus;
        ship.momentOfInertia += def.momentOfInertiaBonus;
        // TODO: 点数系统启用后扣除点数

        this.persistFacility(facility);
        console.log(`[FacilitySystem] 模块 ${moduleTypeId} 已安装到飞船 ${shipId}`);
        return true;
    }

    // ========== 卸载模块 ==========
    removeModuleFromShip(facilityId, shipId, moduleInstanceId) {
        const facility = this.getFacility(facilityId);
        if (!facility) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 不存在`);
            return false;
        }

        const ship = facility.dockedShips.find(s => s.id === shipId);
        if (!ship) {
            console.warn(`[FacilitySystem] 飞船 ${shipId} 不在设施 ${facilityId} 中`);
            return false;
        }

        const modIndex = ship.modules.findIndex(m => m.id === moduleInstanceId);
        if (modIndex === -1) {
            console.warn(`[FacilitySystem] 模块实例 ${moduleInstanceId} 不在飞船 ${shipId} 上`);
            return false;
        }

        const removed = ship.modules.splice(modIndex, 1)[0];
        const def = shipSystem.getModuleDef(removed.type);
        if (def) {
            ship.dryMass -= def.massBonus;
            ship.momentOfInertia -= def.momentOfInertiaBonus;
        }

        this.persistFacility(facility);
        console.log(`[FacilitySystem] 模块 ${moduleInstanceId} 已从飞船 ${shipId} 卸载`);
        return true;
    }

    // ========== 建造飞船 ==========
    buildShip(facilityId, templateId, name, moduleTypeIds = []) {
        const facility = this.getFacility(facilityId);
        if (!facility) {
            console.warn(`[FacilitySystem] 设施 ${facilityId} 不存在，无法建造`);
            return null;
        }

        // 调用 ShipSystem 创建基础飞船实例
        const newShip = shipSystem.createShip(templateId, name, moduleTypeIds);
        if (!newShip) {
            console.warn(`[FacilitySystem] 飞船创建失败，模板: ${templateId}`);
            return null;
        }

        // 计算设施当前轨道速度
        const relState = keplerToState(facility.kepler, facility.currentGM, facility.orbitTime);

        // 设置飞船位置和轨道属性，匹配设施（pos 为相对宿主坐标）
        newShip.pos = {
            x: facility.pos.x + 8,
            y: facility.pos.y + 8
        };
        newShip.vel = {
            x: relState.vel.x,
            y: relState.vel.y
        };
        newShip.currentSOI = facility.hostSOI;
        newShip.currentGM = facility.currentGM;
        newShip.currentHostPos = {
            x: facility.currentHostPos.x,
            y: facility.currentHostPos.y
        };
        newShip.kepler = { ...facility.kepler };
        newShip.orbitTime = facility.orbitTime;
        newShip.mode = 'on_rails';
        newShip.thrust = { ax: 0, ay: 0 };
        newShip.throttle = 0;

        shipSystem.persistShip(newShip);
        // TODO: 点数系统启用后扣除点数

        console.log(`[FacilitySystem] 飞船建造完成: ${newShip.id} (${name}) 在 ${facilityId}`);
        return newShip;
    }

    // ========== 持久化 ==========
    persistFacility(facilityData) {
        const state = gameState.getState();
        const index = state.facilities.findIndex(f => f.id === facilityData.id);
        if (index === -1) {
            console.warn(`[FacilitySystem] 设施 ${facilityData.id} 不存在，无法持久化`);
            return false;
        }
        state.facilities[index] = facilityData;
        gameState.setState({ facilities: state.facilities });
        return true;
    }
}

// 导出单例实例
export const facilitySystem = new FacilitySystem();

// 挂载到 window 供调试
if (typeof window !== 'undefined') {
    window.__facilitySystem = facilitySystem;
    console.log('[FacilitySystem] 单例已创建，可通过 window.__facilitySystem 访问');
}
