'use strict';

// 部件系统 - 飞船物理、三心（CoM/CoT/CoL）、分级树（Staging）与工程师报告校验计算引擎

import { getPartType } from '../config/entities/partTypes.js';
import { getEngineType } from '../config/entities/engineConfig.js';
import { getPartTypeMetrics } from './partPrimitives.js';

export const G0 = 9.81;

/**
 * 从飞船装配树 design.parts 实时汇总全部物理、三心、分级与工程师校验报告。
 * @param {object} design { parts: Array }
 * @returns {object}
 */
export function computeShipPhysics(design) {
    const parts = (design && Array.isArray(design.parts)) ? design.parts : [];

    let dryMass = 0;
    let propellantMass = 0;
    let cargoMass = 0;
    let reactionWheelTorque = 0;
    let totalCost = 0;
    let cargoCapacity = 0;
    let maxScanTier = 0;
    let hasCommand = false;
    const capabilitySet = new Set();
    const resources = {};
    const engines = [];
    const partMassItems = [];

    let minY = Infinity;
    let maxY = -Infinity;
    let maxRadius = 0.6;

    // 几何中心（CoL）按部件外包络体积加权
    let volSum = 0;
    let colX = 0;
    let colY = 0;
    let colZ = 0;

    // 推力中心（CoT）按引擎有效推力加权
    let cotX = 0;
    let cotY = 0;
    let cotZ = 0;

    // 分级统计映射：stageIndex -> { stage, items: [], thrust: 0 }
    const stageMap = new Map();

    for (const part of parts) {
        const type = getPartType(part.typeId);
        if (!type) continue;

        if (type.category === 'command') {
            hasCommand = true;
        }

        const metrics = getPartTypeMetrics(type);
        const pDry = Number(type.mass) || 0;
        let pFuel = 0;

        if (type.resources) {
            for (const [resId, slot] of Object.entries(type.resources)) {
                const cap = Number(slot.capacity) || 0;
                const overrideAmt = (part.resourceAmounts && part.resourceAmounts[resId] !== undefined)
                    ? Number(part.resourceAmounts[resId])
                    : Number(slot.amount);
                const amt = Math.max(0, Math.min(cap, isFinite(overrideAmt) ? overrideAmt : cap));
                pFuel += amt;
                if (!resources[resId]) {
                    resources[resId] = { amount: 0, capacity: 0 };
                }
                resources[resId].amount += amt;
                resources[resId].capacity += cap;
            }
        }

        const pCargo = (type.cargoCapacity > 0 && typeof part.cargoMass === 'number')
            ? Math.max(0, Math.min(type.cargoCapacity, part.cargoMass))
            : 0;

        const pWet = pDry + pFuel + pCargo;
        dryMass += pDry;
        propellantMass += pFuel;
        cargoMass += pCargo;
        reactionWheelTorque += Number(type.reactionWheelTorque) || 0;
        totalCost += Number(type.cost) || 0;
        cargoCapacity += Number(type.cargoCapacity) || 0;

        if (type.capability) {
            capabilitySet.add(type.capability);
        }
        if (type.scanTier && type.scanTier > maxScanTier) {
            maxScanTier = type.scanTier;
        }

        const stageNum = Math.max(0, Number(part.stage) || 0);
        if (!stageMap.has(stageNum)) {
            stageMap.set(stageNum, { stage: stageNum, items: [], thrust: 0 });
        }
        const stageBucket = stageMap.get(stageNum);

        if (type.engine && type.engine.maxThrust > 0 && type.engine.isp > 0) {
            const limit = (typeof part.thrustLimit === 'number')
                ? Math.max(0.05, Math.min(1.0, part.thrustLimit))
                : 1.0;
            const effThrust = Number(type.engine.maxThrust) * limit;
            engines.push({
                partId: part.id,
                typeId: type.id,
                name: type.name,
                stage: stageNum,
                engineType: type.engine.engineType || 'chemical',
                maxThrust: effThrust,
                rawMaxThrust: Number(type.engine.maxThrust),
                thrustLimit: limit,
                isp: Number(type.engine.isp) || 0,
                position: [part.position[0], part.position[1], part.position[2]]
            });

            cotX += effThrust * part.position[0];
            cotY += effThrust * (part.position[1] - metrics.halfHeight * 0.7);
            cotZ += effThrust * part.position[2];

            stageBucket.thrust += effThrust;
            stageBucket.items.push({
                partId: part.id,
                typeId: type.id,
                name: type.name,
                role: 'engine',
                icon: '🚀',
                detail: `${(effThrust / 1000).toFixed(0)} kN`
            });
        } else if (type.id === 'struct_decoupler') {
            stageBucket.items.push({
                partId: part.id,
                typeId: type.id,
                name: type.name,
                role: 'decoupler',
                icon: '✂',
                detail: '分离环'
            });
        } else if (type.category === 'command') {
            stageBucket.items.push({
                partId: part.id,
                typeId: type.id,
                name: type.name,
                role: 'command',
                icon: '🛰',
                detail: '控制核心'
            });
        }

        // 计算该部件形心在飞船坐标系中的位置
        const rotY = part.rotationY || 0;
        const c = Math.cos(rotY);
        const s = Math.sin(rotY);
        const lc = metrics.centroid;
        const wx = part.position[0] + c * lc[0] + s * lc[2];
        const wy = part.position[1] + lc[1];
        const wz = part.position[2] - s * lc[0] + c * lc[2];

        partMassItems.push({
            mass: pWet,
            pos: [wx, wy, wz],
            ownMoiZ: pWet * metrics.unitMoiZ
        });

        // 几何体积加权（CoL）
        const approxVol = Math.PI * metrics.radius * metrics.radius * (metrics.halfHeight * 2);
        volSum += approxVol;
        colX += approxVol * wx;
        colY += approxVol * wy;
        colZ += approxVol * wz;

        const topY = part.position[1] + metrics.halfHeight;
        const botY = part.position[1] - metrics.halfHeight;
        const radialExtent = Math.hypot(part.position[0], part.position[2]) + metrics.radius;
        if (topY > maxY) maxY = topY;
        if (botY < minY) minY = botY;
        if (radialExtent > maxRadius) maxRadius = radialExtent;
    }

    const wetMass = dryMass + propellantMass + cargoMass;

    // 1. 三维质心 CoM
    let com = [0, 0, 0];
    if (wetMass > 1e-6) {
        let mx = 0;
        let my = 0;
        let mz = 0;
        for (const item of partMassItems) {
            mx += item.mass * item.pos[0];
            my += item.mass * item.pos[1];
            mz += item.mass * item.pos[2];
        }
        com = [mx / wetMass, my / wetMass, mz / wetMass];
    }

    // 2. 几何/气动中心 CoL
    const col = volSum > 1e-6
        ? [colX / volSum, colY / volSum, colZ / volSum]
        : [com[0], com[1], com[2]];

    // 3. 绕屏幕法向轴（Z 轴，过质心）的转动惯量 Iz
    let moi = 0;
    for (const item of partMassItems) {
        const dx = item.pos[0] - com[0];
        const dy = item.pos[1] - com[1];
        moi += item.ownMoiZ + item.mass * (dx * dx + dy * dy);
    }

    // 4. 多引擎合推力、推力中心 CoT、加权比冲与按配方限流的真实 ΔV
    let totalThrust = 0;
    let totalMassFlow = 0;
    const engineTypeSet = new Set();

    for (const eng of engines) {
        totalThrust += eng.maxThrust;
        totalMassFlow += eng.maxThrust / (eng.isp * G0);
        engineTypeSet.add(eng.engineType);
    }

    const cotPos = totalThrust > 0
        ? [cotX / totalThrust, cotY / totalThrust, cotZ / totalThrust]
        : [com[0], minY, com[2]];
    const thrustTorqueOffset = totalThrust > 0
        ? Math.hypot(cotPos[0] - com[0], cotPos[2] - com[2])
        : 0;

    const cot = {
        pos: cotPos,
        dir: [0, 1, 0],
        hasThrust: totalThrust > 0,
        torqueOffset: thrustTorqueOffset
    };

    const averageIsp = (totalThrust > 0 && totalMassFlow > 0)
        ? totalThrust / (totalMassFlow * G0)
        : 0;

    let usablePropellantMass = 0;
    const starvedEngineTypes = [];
    for (const engTypeId of engineTypeSet) {
        const engDef = getEngineType(engTypeId);
        if (!engDef || !Array.isArray(engDef.props) || engDef.props.length === 0) continue;

        let minBatches = Infinity;
        let ratioSum = 0;
        for (const prop of engDef.props) {
            const slot = resources[prop.id];
            const available = slot ? slot.amount : 0;
            const ratio = prop.ratio || 1;
            ratioSum += ratio;
            minBatches = Math.min(minBatches, available / ratio);
        }
        if (isFinite(minBatches) && minBatches > 0) {
            usablePropellantMass += minBatches * ratioSum;
        } else {
            starvedEngineTypes.push(engTypeId);
        }
    }
    usablePropellantMass = Math.min(propellantMass, usablePropellantMass);

    let deltaV = 0;
    let burnTime = 0;
    if (totalThrust > 0 && averageIsp > 0 && usablePropellantMass > 1e-6 && wetMass > usablePropellantMass) {
        const endMass = wetMass - usablePropellantMass;
        deltaV = averageIsp * G0 * Math.log(wetMass / endMass);
        burnTime = totalMassFlow > 0 ? usablePropellantMass / totalMassFlow : 0;
    }

    const twr = (wetMass > 0 && totalThrust > 0) ? totalThrust / (wetMass * G0) : 0;

    if (!isFinite(minY)) {
        minY = -1;
        maxY = 1;
    }

    // 5. 整理分级树列表（按 stage 升序排列）
    if (stageMap.size === 0) {
        stageMap.set(0, { stage: 0, items: [], thrust: 0 });
    }
    const stages = [...stageMap.values()].sort((a, b) => a.stage - b.stage);

    // 6. 生成 KSP 工程师适航校验报告
    const engineerReport = buildEngineerReport({
        hasCommand,
        engines,
        starvedEngineTypes,
        propellantMass,
        usablePropellantMass,
        deltaV,
        twr,
        thrustTorqueOffset,
        reactionWheelTorque,
        capabilities: [...capabilitySet],
        scanTier: maxScanTier,
        cargoCapacity,
        cargoMass
    });

    return {
        partCount: parts.length,
        dryMass,
        propellantMass,
        usablePropellantMass,
        cargoMass,
        wetMass,
        com,
        cot,
        col,
        moi: Math.max(1, moi),
        reactionWheelTorque,
        engines,
        totalThrust,
        averageIsp,
        deltaV,
        burnTime,
        twr,
        totalCost,
        cargoCapacity,
        capabilities: [...capabilitySet],
        scanTier: maxScanTier,
        resources,
        stages,
        engineerReport,
        bounds: {
            minY,
            maxY,
            height: Math.max(1.0, maxY - minY),
            centerY: 0.5 * (minY + maxY),
            maxRadius
        }
    };
}

function buildEngineerReport(info) {
    const checks = [];
    let canLaunch = true;

    // 1. 制导与控制核心校验
    if (info.hasCommand) {
        checks.push({
            severity: 'ok',
            title: '制导与指挥核心就绪',
            detail: `已安装控制核心，整船动量轮总扭矩 ${info.reactionWheelTorque.toFixed(1)} N·m。`
        });
    } else {
        canLaunch = false;
        checks.push({
            severity: 'error',
            title: '缺少指挥舱或无人探测核心',
            detail: '飞行器无法受控，请至少安装一个指挥舱或 OKTO 探测核心。'
        });
    }

    // 2. 推进系统与燃料匹配校验
    if (info.engines.length === 0) {
        canLaunch = false;
        checks.push({
            severity: 'error',
            title: '未安装推进引擎',
            detail: '当前飞行器无主推进能力（ΔV = 0 m/s），无法执行轨道机动。请安装引擎与燃料罐后再发射。'
        });
    } else if (info.starvedEngineTypes.length > 0 || info.usablePropellantMass <= 0) {
        const missingIon = info.starvedEngineTypes.includes('ion');
        checks.push({
            severity: 'error',
            title: missingIon ? '离子引擎缺少高压氙气储罐' : '推进引擎缺少匹配的推进剂储罐',
            detail: missingIon
                ? 'IX-6315 离子引擎需要搭配 PB-X200 高压氙气罐方可产生推力。'
                : '化学火箭引擎需要搭载液氢/液氧储罐（FL-T200 / T400 / R-100）。'
        });
    } else {
        const wastedFuel = info.propellantMass - info.usablePropellantMass;
        if (wastedFuel > 5) {
            checks.push({
                severity: 'warn',
                title: '推进剂配比存在余量未完全利用',
                detail: `约 ${Math.round(wastedFuel)} kg 推进剂因配方比例或引擎不匹配无法参与燃烧。`
            });
        } else {
            checks.push({
                severity: 'ok',
                title: `推进与燃料配比正常 (ΔV ${Math.round(info.deltaV)} m/s)`,
                detail: `共 ${info.engines.length} 台引擎，基准推重比 TWR = ${info.twr.toFixed(2)}。`
            });
        }
    }

    // 3. 推力轴线偏心校验
    if (info.thrustTorqueOffset > 0.05) {
        checks.push({
            severity: 'warn',
            title: `推力轴线偏离质心 (${(info.thrustTorqueOffset * 100).toFixed(1)} cm)`,
            detail: '建议开启对称模式（2x/4x）挂载径向部件，保持质心（CoM）与推力线（CoT）对齐。'
        });
    }

    // 4. 特殊任务能力汇总
    const capItems = [];
    if (info.capabilities.includes('scan_resources')) {
        capItems.push(`🔭 行星资源扫描 (Tier ${info.scanTier})`);
    }
    if (info.capabilities.includes('deploy_facility')) {
        capItems.push('🏗 稳定圆轨部署设施');
    }
    if (info.cargoCapacity > 0) {
        capItems.push(`📦 货运仓储 (${Math.round(info.cargoMass)} / ${info.cargoCapacity} kg)`);
    }
    checks.push({
        severity: 'ok',
        title: '已搭载飞船任务模块能力',
        detail: capItems.length > 0 ? capItems.join(' · ') : '标准轨道机动飞行（未挂载科研扫描/建设/货仓部件）'
    });

    const errorCount = checks.filter(c => c.severity === 'error').length;
    const warnCount = checks.filter(c => c.severity === 'warn').length;

    return {
        canLaunch: canLaunch && errorCount === 0,
        errorCount,
        warnCount,
        checks
    };
}
