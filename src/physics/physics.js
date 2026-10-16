'use strict';
// 天体驱动器 6.5步
import {
    getSystemById,
    getHomeworldSystemId,
    computeSystemPosition,
    getDefaultSystemIds,
    validateSystemSelection
} from '../config/world/starSystemIndex.js';
import { keplerPositionAtTime, keplerToState } from './orbitalMechanics.js';

// 天体集合:数组引用全生命周期不变,内容随激活集原地重建(所有引用方自动生效)
export const celestialBodies = [];

// 当前激活的星系组合(默认:第一个 homeworld 星系,与历史行为等价)
let _activeSystemIds = [];

// 按星系组合重建天体集合(原地替换,保持 celestialBodies 引用不变)
// 只负责"星系加载":克隆配置数据 + 注入恒星固定位置,不触碰任何物理逻辑
function _applyActiveSystems(ids) {
    const validation = validateSystemSelection(ids);
    if (!validation.ok) {
        console.warn(`[Physics] 星系组合校验失败: ${validation.reason}`, validation.id || '');
        return false;
    }

    const homeworldId = getHomeworldSystemId(ids);
    const next = [];
    for (const id of ids) {
        const system = getSystemById(id);
        const cloned = structuredClone(system.bodies);
        // 恒星(无 orbitParent 的天体)位置固定:homeworld 星系在原点,其余按距离+方位角摆放
        const starPos = computeSystemPosition(system.meta, homeworldId);
        for (const body of cloned) {
            if (!body.orbitParent) {
                body.position = { x: starPos.x, y: starPos.y };
            }
        }
        next.push(...cloned);
    }

    celestialBodies.length = 0;
    celestialBodies.push(...next);
    _activeSystemIds = [...ids];
    return true;
}

// 切换激活星系组合(创建世界/读档时调用;失败返回 false 且天体集合不变)
export function setActiveSystems(ids) {
    return _applyActiveSystems(ids);
}

// 读取当前激活星系组合(副本)
export function getActiveSystemIds() {
    return [..._activeSystemIds];
}

// 模块加载时按默认组合初始化(与旧行为等价:全部 Kerbolar 天体)
_applyActiveSystems(getDefaultSystemIds());

// 获取飞船相对于宿主天体的位置（世界坐标 → 宿主参考系）
export function getRelativePosition(pos, host) {
    if (!host) return { x: pos.x, y: pos.y };
    return {
        x: pos.x - host.position.x,
        y: pos.y - host.position.y
    };
}

// 将飞船/设施的相对位置转换为绝对世界坐标
export function getAbsolutePosition(entity) {
    if (!entity.currentSOI) return entity.pos;
    const host = celestialBodies.find(b => b.name === entity.currentSOI);
    if (!host) return entity.pos;
    return {
        x: host.position.x + entity.pos.x,
        y: host.position.y + entity.pos.y
    };
}

// SOI 归属判定：判断 pos 属于哪个天体的 SOI
export function getSOIHost(pos) {
    let starHost = null;
    let closestNonStar = null;
    let closestDist = Infinity;

    for (const body of celestialBodies) {
        const dx = body.position.x - pos.x;
        const dy = body.position.y - pos.y;
        const r = Math.sqrt(dx * dx + dy * dy);

        if (r < body.soiRadius) {
            if (body.type === 'star') {
                starHost = body;
            } else {
                if (r < closestDist) {
                    closestDist = r;
                    closestNonStar = body;
                }
            }
        }
    }
    return closestNonStar || starHost;
}

// 获取指定 SOI 宿主天体的音乐分类（音频层使用）
// 规则：深空（soiName 为空或找不到天体）→ 'deepSpace'；天体存在但未分类 → 兜底 'rocky'
export function getMusicTypeForSOI(soiName) {
    if (!soiName) {
        return 'deepSpace';
    }
    const body = celestialBodies.find(b => b.name === soiName);
    if (!body) {
        return 'deepSpace';
    }
    return body.musicType || 'rocky';
}

// 将速度向量从一个天体参考系转换到另一个天体参考系，直接修改 vel 对象
export function convertVelocityFrame(vel, fromHostName, toHostName) {
    const oldHost = fromHostName
        ? celestialBodies.find(b => b.name === fromHostName)
        : null;
    const newHost = toHostName
        ? celestialBodies.find(b => b.name === toHostName)
        : null;

    const oldVel = oldHost ? oldHost.velocity : { x: 0, y: 0 };
    const newVel = newHost ? newHost.velocity : { x: 0, y: 0 };

    vel.x = vel.x + oldVel.x - newVel.x;
    vel.y = vel.y + oldVel.y - newVel.y;
}

// 天体轨道根数构造（位置与速度共用同一构造，保证两者同源）
function bodyOrbitKepler(body) {
    return {
        a: body.orbitA,
        e: body.orbitE,
        theta: body.orbitTheta0,
        omega: body.orbitOmega
    };
}

// 天体相对父天体的解析位置（与历史位置推进完全同一调用，逐位一致）
function relativeOrbitPos(body, parent, time) {
    return keplerPositionAtTime(bodyOrbitKepler(body), parent.gm, time, body.orbitOmega);
}

// 天体相对父天体的解析状态 { pos, vel }（无父天体/父天体缺失 → null）。
// 速度用 keplerToState 解析式（由 r = p/(1+e·cosθ) 的真近点角反推径向/切向分量），
// 其 pos 即同参数的 keplerPositionAtTime 结果 → 位置与速度严格同源、零差分噪声。
export function getBodyRelativeState(body, time) {
    if (!body || !body.orbitParent) return null;
    const parent = celestialBodies.find(b => b.name === body.orbitParent);
    if (!parent) return null;
    return keplerToState(bodyOrbitKepler(body), parent.gm, time);
}

// 天体绝对解析位置（沿 orbitParent 递归累加父位置）
export function getBodyAbsolutePos(body, time) {
    if (!body) return { x: 0, y: 0 };
    const parent = body.orbitParent ? celestialBodies.find(b => b.name === body.orbitParent) : null;
    if (!parent) return { x: body.position.x, y: body.position.y };
    const parentPos = getBodyAbsolutePos(parent, time);
    const relPos = relativeOrbitPos(body, parent, time);
    return { x: parentPos.x + relPos.x, y: parentPos.y + relPos.y };
}

// 天体绝对解析状态 { pos, vel }（沿 orbitParent 递归累加父状态；无父天体 → 当前位置 + 零速度）
export function getBodyAbsoluteState(body, time) {
    if (!body) return { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
    const parent = body.orbitParent ? celestialBodies.find(b => b.name === body.orbitParent) : null;
    if (!parent) return { pos: { x: body.position.x, y: body.position.y }, vel: { x: 0, y: 0 } };
    const parentState = getBodyAbsoluteState(parent, time);
    const rel = getBodyRelativeState(body, time);
    return {
        pos: { x: parentState.pos.x + rel.pos.x, y: parentState.pos.y + rel.pos.y },
        vel: { x: parentState.vel.x + rel.vel.x, y: parentState.vel.y + rel.vel.y }
    };
}

// 天体驱动器 6.6步
export function updateCelestialBodies(time) {
    // 先更新所有位置，再计算绝对速度
    // 第一遍：更新位置 + 存储相对速度
    const relVelocities = {};

    for (const body of celestialBodies) {
        if (!body.orbitParent) {
            body.velocity = { x: 0, y: 0 };
            continue;
        }

        const parent = celestialBodies.find(b => b.name === body.orbitParent);
        if (!parent) continue;

        // 相对解析状态（位置推进沿用 keplerPositionAtTime，逐位不变）
        const rel = getBodyRelativeState(body, time);

        body.position.x = parent.position.x + rel.pos.x;
        body.position.y = parent.position.y + rel.pos.y;

        // 相对速度用解析式（旧实现为 pos(t+1ms)−pos(t) 差商：绝对坐标 1e10~1e11 m 下
        // 浮点分辨率 ~1e-6 m 与 1ms 位移（0.5~30 m）同阶 → 灾难性抵消，噪声 2e-3~6e-2 m/s
        // 且逐帧伪随机；该速度经 convertVelocityFrame 用于真实 SOI 切换换系，会污染切换后轨道）
        relVelocities[body.name] = rel.vel;
    }

    // 第二遍：累加父天体速度，得到绝对速度
    // 依赖：celestialBodies 数组中父天体排在子天体之前（Kerbol → Kerbin）
    for (const body of celestialBodies) {
        if (!body.orbitParent) continue;
        if (!relVelocities[body.name]) continue;

        const parent = celestialBodies.find(b => b.name === body.orbitParent);
        if (!parent) continue;

        body.velocity = {
            x: parent.velocity.x + relVelocities[body.name].x,
            y: parent.velocity.y + relVelocities[body.name].y
        };
    }
}
