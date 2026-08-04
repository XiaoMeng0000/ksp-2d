// TEMP: 飞船系统 - 飞船实例创建、存储和管理核心模块
import { gameState } from './gameState.js';
import { SHIP_TEMPLATES } from './config/shipTemplates.js';

class ShipSystem {
    constructor() {
        if (ShipSystem._instance) {
            return ShipSystem._instance;
        }
        ShipSystem._instance = this;
    }

    // TEMP: 飞船系统 - 根据模板创建飞船实例
    createShip(templateId, name) {
        const template = SHIP_TEMPLATES.find(t => t.id === templateId);
        if (!template) {
            console.warn(`[ShipSystem] 模板 ${templateId} 不存在`);
            return null;
        }

        const state = gameState.getState();
        const shipId = `ship_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // TEMP: 飞船系统 - 从模板复制属性，增加运行时状态
        const shipInstance = {
            id: shipId,
            templateId: template.id,
            displayName: name || template.name,
            // 模板属性
            dryMass: template.dryMass,
            fuelCapacity: template.fuelCapacity,
            isp: template.isp,
            maxThrust: template.maxThrust,
            moduleSlots: template.moduleSlots,
            // TEMP: 第六阶段-物理旋转 — 继承模板的旋转物理参数
            momentOfInertia: template.momentOfInertia || 1.0,
            reactionWheelTorque: template.reactionWheelTorque || 0,
            // 运行时属性
            fuel: template.fuelCapacity,
            modules: [],
            // 轨道状态属性
            pos: { x: 0, y: 0 },
            vel: { x: 0, y: 0 },
            mode: 'on_rails',
            kepler: null,
            orbitTime: 0,
            currentSOI: null,
            currentGM: null,
            currentHostPos: { x: 0, y: 0 },
            controlsLocked: false,
            thrust: { ax: 0, ay: 0 },  // 推力加速度向量，始终存在，无推力时为 { ax:0, ay:0 }
            // 机动节点数组，每个节点的数据结构见 renderer.js renderManeuverOrbits 上方注释
            maneuverNodes: [],
            // 机动节点燃烧持续时间（秒），可配置
            burnDuration: 120,
            // TEMP: 第六阶段-步骤1 — 朝向与SAS预留字段
            heading: 0,              // 当前朝向（弧度，0 = 正上方/-Y方向）
            angularVelocity: 0,      // TEMP: 第六阶段-物理旋转 — 当前角速度（rad/s）
            throttle: 0,             // TEMP: 第六阶段-步骤2 — 油门 0.0~1.0
            sasMode: 'off',          // 预留：SAS模式 'off'|'hold'|'prograde'|'retrograde'
            sasTargetHeading: null   // 预留：SAS目标朝向（弧度）
        };

        state.ships.push(shipInstance);
        gameState.setState({ ships: state.ships });

        // TEMP: 飞船系统 - 如果没有活动飞船，自动设为活动
        if (!state.activeShipId) {
            gameState.setState({ activeShipId: shipId });
        }

        console.log(`[ShipSystem] 飞船创建成功: ${shipId} (${name || template.name})`);
        return shipInstance;
    }

    // TEMP: 飞船系统 - 根据 id 获取飞船实例（直接引用，物理/渲染循环使用）
    getShip(shipId) {
        return gameState.getShipRef(shipId);
    }

    // TEMP: 飞船系统 - 获取所有飞船实例（直接引用，物理/渲染循环使用）
    getAllShips() {
        return gameState.getAllShipsRef();
    }

    // TEMP: 飞船系统 - 获取当前活动飞船
    getActiveShip() {
        return gameState.getActiveShip();
    }

    // TEMP: 飞船系统 - 切换当前活动飞船
    switchShip(shipId) {
        const ship = this.getShip(shipId);
        if (!ship) {
            console.warn(`[ShipSystem] 飞船 ${shipId} 不存在，无法切换`);
            return false;
        }

        gameState.setState({ activeShipId: shipId });
        console.log(`[ShipSystem] 切换到飞船: ${shipId} (${ship.displayName})`);

        return true;
    }

    // TEMP: 飞船系统 - 持久化飞船修改到 GameState
    persistShip(shipData) {
        const state = gameState.getState();
        const index = state.ships.findIndex(s => s.id === shipData.id);
        if (index === -1) {
            console.warn(`[ShipSystem] 飞船 ${shipData.id} 不存在，无法持久化`);
            return false;
        }
        state.ships[index] = shipData;
        gameState.setState({ ships: state.ships });
        return true;
    }

    // TEMP: 飞船系统 - 删除飞船实例
    deleteShip(shipId) {
        const state = gameState.getState();
        const index = state.ships.findIndex(s => s.id === shipId);
        if (index === -1) {
            console.warn(`[ShipSystem] 飞船 ${shipId} 不存在，无法删除`);
            return false;
        }

        state.ships.splice(index, 1);
        gameState.setState({ ships: state.ships });

        // TEMP: 飞船系统 - 如果删除的是活动飞船，清除 activeShipId
        if (state.activeShipId === shipId) {
            const newActiveId = state.ships.length > 0 ? state.ships[0].id : null;
            gameState.setState({ activeShipId: newActiveId });
            console.log(`[ShipSystem] 活动飞船已删除，切换到: ${newActiveId || '无'}`);
        }

        console.log(`[ShipSystem] 飞船已删除: ${shipId}`);
        return true;
    }
}

// TEMP: 飞船系统 - 导出单例实例
export const shipSystem = new ShipSystem();

// TEMP: 飞船系统 - 挂载到 window 供调试
if (typeof window !== 'undefined') {
    window.__shipSystem = shipSystem;
    console.log('[ShipSystem] 单例已创建，可通过 window.__shipSystem 访问');
}
