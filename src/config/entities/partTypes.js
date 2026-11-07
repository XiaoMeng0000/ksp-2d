'use strict';

// 部件系统 - 3D 飞船部件类型配置（v3.1 高质感航天材质与精细机械结构版）
// 每个部件由多个子图元（primitives，含 hollowFrustum 镂空喷管）或外部 .obj 模型构成，
// 并指定 mat 材质类型以驱动 GLSL 程序化蒙皮接缝、铆钉、波纹绝热层、拉丝金属、喷管烤蓝与褶皱金箔着色。
//
// 另：KSP2 官方资产部件在文件末尾追加（见 ksp2PartTypes.js）。

import { KSP2_PART_TYPES } from './ksp2PartTypes.js';
import { ORIGINAL_PART_TYPES } from './originalPartTypes.js';

// 程序化部件 + KSP2 官方资产部件（两套资产管线共用同一装配/物理层）
export const PART_TYPES = [
    // ==================== 1. 指挥与控制 ====================
    {
        id: 'pod_mk1',
        name: 'Mk1 乘员指挥舱',
        category: 'command',
        description: '标准单人锥形航天指令舱，内置基础动量轮、蜂窝烧蚀防热底盾、伞舱顶盖与自发光观察舷窗。',
        mass: 900,
        cost: 80,
        collider: {
            radius: 0.65,
            halfHeight: 0.90,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 底部蜂窝烧蚀防热盾（弧形底盘 + 防热瓦层）
                { type: 'frustum', radiusTop: 0.71, radiusBottom: 0.60, height: 0.16, offset: [0, -0.82, 0], color: [0.22, 0.19, 0.17], mat: 'HEAT_SHIELD', emissive: 0.0 },
                // 底部金属密封对接法兰环
                { type: 'cylinder', radius: 0.715, height: 0.08, offset: [0, -0.70, 0], color: [0.36, 0.39, 0.44], mat: 'METAL_RING', emissive: 0.0 },
                // 主锥形乘员舱蒙皮（带纵向拼缝与铆钉）
                { type: 'frustum', radiusTop: 0.35, radiusBottom: 0.70, height: 1.24, offset: [0, -0.04, 0], color: [0.84, 0.87, 0.91], mat: 'HULL_PAINTED', emissive: 0.0 },
                // 中上部黑色姿态 RCS 配平环带
                { type: 'frustum', radiusTop: 0.41, radiusBottom: 0.45, height: 0.12, offset: [0, 0.44, 0], color: [0.18, 0.20, 0.24], mat: 'HEAT_SHIELD', emissive: 0.0 },
                // 顶部降落伞舱与对接鼻锥（拉丝钛合金）
                { type: 'frustum', radiusTop: 0.22, radiusBottom: 0.35, height: 0.32, offset: [0, 0.74, 0], color: [0.32, 0.36, 0.42], mat: 'METAL_RING', emissive: 0.0 },
                // 正前方双层舷窗金属外框 + 暖青色发光玻璃
                { type: 'box', width: 0.36, height: 0.24, depth: 0.12, offset: [0, 0.05, 0.48], color: [0.28, 0.31, 0.36], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.28, height: 0.16, depth: 0.14, offset: [0, 0.05, 0.50], color: [0.38, 0.88, 1.0], mat: 'EMISSIVE_GLOW', emissive: 0.78 },
                // 侧面出舱气闸门与把手凸起
                { type: 'box', width: 0.11, height: 0.46, depth: 0.30, offset: [0.51, -0.14, 0], color: [0.62, 0.65, 0.70], mat: 'HULL_PAINTED', emissive: 0.0 },
                { type: 'box', width: 0.13, height: 0.12, depth: 0.08, offset: [0.53, -0.14, 0.12], color: [0.88, 0.65, 0.18], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.90, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.90, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 12.0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'probe_okto',
        name: 'OKTO 无人探测核心',
        category: 'command',
        description: '包覆多层 Kapton 褶皱金箔隔热膜的轻量化无人制导核心，适合深空探测器与科学卫星。',
        mass: 180,
        cost: 50,
        collider: {
            radius: 0.52,
            halfHeight: 0.30,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 褶皱金箔隔热膜主体
                { type: 'cylinder', radius: 0.50, height: 0.44, offset: [0, 0, 0], color: [0.92, 0.72, 0.20], mat: 'KAPTON_FOIL', emissive: 0.0 },
                // 上下钛合金结构法兰盘
                { type: 'cylinder', radius: 0.535, height: 0.08, offset: [0,  0.26, 0], color: [0.34, 0.37, 0.43], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.535, height: 0.08, offset: [0, -0.26, 0], color: [0.34, 0.37, 0.43], mat: 'METAL_RING', emissive: 0.0 },
                // 四向星敏仪光学窗口与绿光导航信标
                { type: 'box', width: 1.06, height: 0.14, depth: 0.14, offset: [0, 0, 0], color: [0.26, 0.29, 0.34], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.16, height: 0.10, depth: 0.08, offset: [0, 0, 0.51], color: [0.22, 0.96, 0.48], mat: 'EMISSIVE_GLOW', emissive: 0.85 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.30, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.30, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 5.0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    // ==================== 2. 推进剂储罐 ====================
    {
        id: 'tank_fl_t200',
        name: 'FL-T200 氢氧燃料罐',
        category: 'tank',
        description: '紧凑型液氢/液氧双组元储罐（总推进剂 900 kg，按 1:8 配比），带金属法兰与波纹绝热层。',
        mass: 125,
        cost: 75,
        collider: {
            radius: 0.625,
            halfHeight: 0.55,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 上下钛合金对接法兰环
                { type: 'cylinder', radius: 0.635, height: 0.09, offset: [0,  0.505, 0], color: [0.38, 0.41, 0.46], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.635, height: 0.09, offset: [0, -0.505, 0], color: [0.38, 0.41, 0.46], mat: 'METAL_RING', emissive: 0.0 },
                // 罐体主蒙皮（航天白漆 + 拼缝铆钉）
                { type: 'cylinder', radius: 0.625, height: 0.94, offset: [0, 0, 0], color: [0.87, 0.89, 0.92], mat: 'HULL_PAINTED', emissive: 0.0 },
                // 上部深炭黑防滑识别带
                { type: 'cylinder', radius: 0.632, height: 0.16, offset: [0, 0.22, 0], color: [0.18, 0.20, 0.24], mat: 'HEAT_SHIELD', emissive: 0.0 },
                // 下部低温橙色波纹绝热泡沫环
                { type: 'cylinder', radius: 0.633, height: 0.18, offset: [0, -0.22, 0], color: [0.88, 0.46, 0.15], mat: 'CRYO_FOAM', emissive: 0.0 },
                // 外置液氧输送管与上下管卡
                { type: 'box', width: 0.06, height: 0.96, depth: 0.06, offset: [0.63, 0, 0], color: [0.58, 0.62, 0.68], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.09, height: 0.06, depth: 0.10, offset: [0.63,  0.30, 0], color: [0.32, 0.35, 0.40], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.09, height: 0.06, depth: 0.10, offset: [0.63, -0.30, 0], color: [0.32, 0.35, 0.40], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.55, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.55, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: {
            hydrogen: { amount: 100, capacity: 100 },
            oxygen:   { amount: 800, capacity: 800 }
        },
        engine: null,
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'tank_fl_t400',
        name: 'FL-T400 氢氧燃料罐',
        category: 'tank',
        description: '主力中型液氢/液氧储罐（总推进剂 1800 kg，按 1:8 配比），中部包覆低温波纹绝热泡沫层。',
        mass: 250,
        cost: 150,
        collider: {
            radius: 0.625,
            halfHeight: 0.95,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 顶部与底部铝合金法兰圈
                { type: 'cylinder', radius: 0.638, height: 0.10, offset: [0,  0.90, 0], color: [0.38, 0.42, 0.47], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.638, height: 0.10, offset: [0, -0.90, 0], color: [0.38, 0.42, 0.47], mat: 'METAL_RING', emissive: 0.0 },
                // 主白漆承力罐壁（带蒙皮分块与铆钉）
                { type: 'cylinder', radius: 0.625, height: 1.72, offset: [0, 0, 0], color: [0.88, 0.90, 0.93], mat: 'HULL_PAINTED', emissive: 0.0 },
                // 上下炭黑加强箍
                { type: 'cylinder', radius: 0.633, height: 0.16, offset: [0,  0.68, 0], color: [0.20, 0.22, 0.26], mat: 'HEAT_SHIELD', emissive: 0.0 },
                { type: 'cylinder', radius: 0.633, height: 0.16, offset: [0, -0.68, 0], color: [0.20, 0.22, 0.26], mat: 'HEAT_SHIELD', emissive: 0.0 },
                // 中段大型低温波纹橙色绝热层
                { type: 'cylinder', radius: 0.635, height: 0.48, offset: [0, 0.0, 0], color: [0.88, 0.47, 0.15], mat: 'CRYO_FOAM', emissive: 0.0 },
                // 双侧外部增压与液氧引流管线 + 3 道金属管卡
                { type: 'box', width: 0.07, height: 1.74, depth: 0.07, offset: [ 0.63, 0, 0], color: [0.60, 0.64, 0.70], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.05, height: 1.74, depth: 0.05, offset: [-0.63, 0, 0], color: [0.55, 0.58, 0.64], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.10, height: 0.07, depth: 0.11, offset: [0.63,  0.52, 0], color: [0.32, 0.35, 0.40], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.10, height: 0.07, depth: 0.11, offset: [0.63,  0.00, 0], color: [0.32, 0.35, 0.40], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.10, height: 0.07, depth: 0.11, offset: [0.63, -0.52, 0], color: [0.32, 0.35, 0.40], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.95, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.95, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: {
            hydrogen: { amount: 200, capacity: 200 },
            oxygen:   { amount: 1600, capacity: 1600 }
        },
        engine: null,
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'tank_radial_r100',
        name: 'R-100 径向副油箱',
        category: 'tank',
        description: '可侧面径向挂载的高压胶囊副燃料罐（总推进剂 450 kg），自带钛合金挂架，配合 2x/4x 对称大幅提升 ΔV。',
        mass: 65,
        cost: 60,
        collider: {
            radius: 0.30,
            halfHeight: 0.65,
            allowSurfaceAttach: true,
            allowSurfaceChildren: false,
            srfAttachOffset: [0.30, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 胶囊主柱体（白漆蒙皮）
                { type: 'cylinder', radius: 0.28, height: 0.86, offset: [0, 0, 0], color: [0.85, 0.88, 0.92], mat: 'HULL_PAINTED', emissive: 0.0 },
                // 上下金属卡箍环
                { type: 'cylinder', radius: 0.292, height: 0.08, offset: [0,  0.34, 0], color: [0.36, 0.39, 0.45], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.292, height: 0.08, offset: [0, -0.34, 0], color: [0.36, 0.39, 0.45], mat: 'METAL_RING', emissive: 0.0 },
                // 顶部与底部低温绝热球形封头
                { type: 'sphere', radius: 0.28, offset: [0,  0.43, 0], color: [0.88, 0.47, 0.15], mat: 'CRYO_FOAM', emissive: 0.0 },
                { type: 'sphere', radius: 0.28, offset: [0, -0.43, 0], color: [0.88, 0.47, 0.15], mat: 'CRYO_FOAM', emissive: 0.0 },
                // 内侧 (-X) 双支臂径向连接挂架
                { type: 'box', width: 0.22, height: 0.12, depth: 0.14, offset: [-0.24,  0.26, 0], color: [0.32, 0.36, 0.42], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.22, height: 0.12, depth: 0.14, offset: [-0.24, -0.26, 0], color: [0.32, 0.36, 0.42], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'bottom', position: [0, -0.65, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: {
            hydrogen: { amount: 50, capacity: 50 },
            oxygen:   { amount: 400, capacity: 400 }
        },
        engine: null,
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'tank_xenon_x200',
        name: 'PB-X200 高压氙气罐',
        category: 'tank',
        description: '为电推进离子引擎供气的复合材料缠绕高压球形氙气罐（氙气 400 kg），支持轴向与径向挂载。',
        mass: 55,
        cost: 140,
        collider: {
            radius: 0.42,
            halfHeight: 0.35,
            allowSurfaceAttach: true,
            allowSurfaceChildren: false,
            srfAttachOffset: [0.38, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 赤道钛合金承力环与四向支柱
                { type: 'cylinder', radius: 0.44, height: 0.12, offset: [0, 0, 0], color: [0.36, 0.40, 0.46], mat: 'METAL_RING', emissive: 0.0 },
                // 碳纤维缠绕高压球罐
                { type: 'sphere', radius: 0.38, offset: [0, 0, 0], color: [0.24, 0.46, 0.72], mat: 'CRYO_FOAM', emissive: 0.0 },
                // 上下端面金属接口盘
                { type: 'cylinder', radius: 0.32, height: 0.70, offset: [0, 0, 0], color: [0.28, 0.31, 0.36], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.35, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.35, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: {
            xenon: { amount: 400, capacity: 400 }
        },
        engine: null,
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    // ==================== 3. 推进引擎（镂空钟形喷管 + 再生冷却肋 + 烤蓝渐变） ====================
    {
        id: 'engine_lv909',
        name: 'LV-909 "猎犬" 真空引擎',
        category: 'engine',
        description: '高比冲液氢/液氧轨道真空引擎（推力 60 kN，比冲 355 s），带镂空再生冷却喷管与双轴摆动液压杆。',
        mass: 500,
        cost: 120,
        collider: {
            radius: 0.625,
            halfHeight: 0.55,
            allowSurfaceAttach: false,
            allowSurfaceChildren: false,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 顶部承力安装隔框
                { type: 'cylinder', radius: 0.625, height: 0.14, offset: [0, 0.48, 0], color: [0.34, 0.37, 0.42], mat: 'METAL_RING', emissive: 0.0 },
                // 燃烧室与铜合金涡轮泵组
                { type: 'cylinder', radius: 0.36, height: 0.24, offset: [0, 0.29, 0], color: [0.68, 0.52, 0.36], mat: 'METAL_RING', emissive: 0.0 },
                // 四向液压推力矢量作动杆
                { type: 'box', width: 0.92, height: 0.16, depth: 0.10, offset: [0, 0.32, 0], color: [0.42, 0.46, 0.52], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.10, height: 0.16, depth: 0.92, offset: [0, 0.32, 0], color: [0.42, 0.46, 0.52], mat: 'METAL_RING', emissive: 0.0 },
                // 镂空再生冷却钟形喷管（NOZZLE_BELL 材质自带冷却管细肋与热回火色带）
                { type: 'hollowFrustum', radiusTop: 0.24, radiusBottom: 0.56, height: 0.72, offset: [0, -0.19, 0], color: [0.26, 0.29, 0.35], mat: 'NOZZLE_BELL', emissive: 0.0 },
                // 喷管中部耐热加强箍
                { type: 'cylinder', radius: 0.45, height: 0.05, offset: [0, -0.24, 0], color: [0.58, 0.62, 0.68], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.55, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.55, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: {
            engineType: 'chemical',
            maxThrust: 60000,
            isp: 355
        },
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'engine_reliant',
        name: 'LV-T30 "信赖" 主引擎',
        category: 'engine',
        description: '大推力液氢/液氧第一级主力发动机（推力 240 kN，比冲 310 s），配重型镂空喷管与燃气涡轮排气管。',
        mass: 1250,
        cost: 220,
        collider: {
            radius: 0.625,
            halfHeight: 0.75,
            allowSurfaceAttach: false,
            allowSurfaceChildren: false,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                // 顶部重型推力承力法兰
                { type: 'cylinder', radius: 0.625, height: 0.18, offset: [0, 0.66, 0], color: [0.32, 0.36, 0.42], mat: 'METAL_RING', emissive: 0.0 },
                // 动力室与高压涡轮泵壳体
                { type: 'frustum', radiusTop: 0.58, radiusBottom: 0.34, height: 0.36, offset: [0, 0.39, 0], color: [0.56, 0.48, 0.38], mat: 'METAL_RING', emissive: 0.0 },
                // 侧面涡轮废气旁通管
                { type: 'cylinder', radius: 0.09, height: 0.68, offset: [0.42, 0.05, 0.18], color: [0.38, 0.34, 0.32], mat: 'METAL_RING', emissive: 0.0 },
                // 巨型镂空主喷管（带再生冷却螺旋凸肋与烤蓝渐变）
                { type: 'hollowFrustum', radiusTop: 0.30, radiusBottom: 0.64, height: 0.96, offset: [0, -0.27, 0], color: [0.24, 0.27, 0.33], mat: 'NOZZLE_BELL', emissive: 0.0 },
                // 双道铜合金防振加强箍
                { type: 'cylinder', radius: 0.50, height: 0.06, offset: [0, -0.18, 0], color: [0.78, 0.58, 0.32], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.59, height: 0.06, offset: [0, -0.50, 0], color: [0.78, 0.58, 0.32], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.75, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.75, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: {
            engineType: 'chemical',
            maxThrust: 240000,
            isp: 310
        },
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'engine_ion_dawn',
        name: 'IX-6315 "黎明" 离子引擎',
        category: 'engine',
        description: '消耗氙气的超高比冲电推进发动机（推力 12 kN，比冲 2800 s），配霍尔磁场环与电光蓝电离栅极。',
        mass: 250,
        cost: 320,
        collider: {
            radius: 0.50,
            halfHeight: 0.32,
            allowSurfaceAttach: false,
            allowSurfaceChildren: false,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                { type: 'cylinder', radius: 0.50, height: 0.12, offset: [0, 0.26, 0], color: [0.34, 0.38, 0.44], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'frustum', radiusTop: 0.48, radiusBottom: 0.42, height: 0.34, offset: [0, 0.03, 0], color: [0.80, 0.84, 0.90], mat: 'HULL_PAINTED', emissive: 0.0 },
                { type: 'hollowFrustum', radiusTop: 0.38, radiusBottom: 0.43, height: 0.16, offset: [0, -0.22, 0], color: [0.28, 0.32, 0.38], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.35, height: 0.08, offset: [0, -0.22, 0], color: [0.18, 0.82, 1.0], mat: 'EMISSIVE_GLOW', emissive: 0.92 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.32, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.32, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: {
            engineType: 'ion',
            maxThrust: 12000,
            isp: 2800
        },
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    // ==================== 4. 结构与姿态 ====================
    {
        id: 'struct_reaction_wheel',
        name: 'RW-20 高扭矩动量轮组',
        category: 'structure',
        description: '重型三轴磁悬浮飞轮姿态控制组件，大幅提升大质量飞船的 SAS 转向角加速度。',
        mass: 150,
        cost: 90,
        collider: {
            radius: 0.625,
            halfHeight: 0.22,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                { type: 'cylinder', radius: 0.625, height: 0.44, offset: [0, 0, 0], color: [0.28, 0.32, 0.38], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.636, height: 0.12, offset: [0, 0, 0], color: [0.92, 0.72, 0.16], mat: 'CRYO_FOAM', emissive: 0.0 },
                { type: 'box', width: 1.33, height: 0.24, depth: 0.24, offset: [0, 0, 0], color: [0.46, 0.50, 0.56], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.24, height: 0.24, depth: 1.33, offset: [0, 0, 0], color: [0.46, 0.50, 0.56], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.22, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.22, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 35.0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    {
        id: 'struct_decoupler',
        name: 'TD-12 级间分离环',
        category: 'structure',
        description: '带爆炸螺栓与红白警示标识的级间分离环（在右侧分级树中生成独立分离级）。',
        mass: 50,
        cost: 40,
        collider: {
            radius: 0.625,
            halfHeight: 0.16,
            allowSurfaceAttach: false,
            allowSurfaceChildren: false,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                { type: 'cylinder', radius: 0.625, height: 0.32, offset: [0, 0, 0], color: [0.78, 0.80, 0.84], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.638, height: 0.09, offset: [0, 0, 0], color: [0.90, 0.22, 0.20], mat: 'CRYO_FOAM', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.16, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.16, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 0,
        capability: null,
        scanTier: 0,
        cargoCapacity: 0
    },

    // ==================== 5. 科研与工程 ====================
    {
        id: 'science_scanner_m700',
        name: 'M700 多光谱资源扫描阵列',
        category: 'utility',
        description: '实体化行星资源探测雷达（赋予飞船 Tier 3 全频段资源扫描能力），支持顶部轴向或侧面径向安装；使用外部 .obj 雷达碟面网格。',
        mass: 80,
        cost: 120,
        collider: {
            radius: 0.38,
            halfHeight: 0.32,
            allowSurfaceAttach: true,
            allowSurfaceChildren: false,
            srfAttachOffset: [0.28, 0, 0]
        },
        visual: {
            modelPath: 'assets/models/scanner_dish.obj',
            primitives: [
                { type: 'box', width: 0.42, height: 0.32, depth: 0.42, offset: [0, -0.12, 0], color: [0.30, 0.34, 0.40], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'frustum', radiusTop: 0.48, radiusBottom: 0.12, height: 0.22, offset: [0, 0.14, 0], color: [0.92, 0.74, 0.24], mat: 'KAPTON_FOIL', emissive: 0.0 },
                { type: 'cylinder', radius: 0.06, height: 0.28, offset: [0, 0.20, 0], color: [0.30, 0.90, 0.95], mat: 'EMISSIVE_GLOW', emissive: 0.75 }
            ]
        },
        attachNodes: [
            { id: 'bottom', position: [0, -0.32, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 0,
        capability: 'scan_resources',
        scanTier: 3,
        cargoCapacity: 0
    },

    {
        id: 'utility_construction_bay',
        name: '轨道建设集成舱',
        category: 'utility',
        description: '实体化工程建造母舱（赋予飞船在稳定圆轨道上部署轨道船坞、补给站与科研站的能力）。',
        mass: 400,
        cost: 180,
        collider: {
            radius: 0.625,
            halfHeight: 0.50,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                { type: 'cylinder', radius: 0.625, height: 1.00, offset: [0, 0, 0], color: [0.86, 0.66, 0.18], mat: 'HULL_PAINTED', emissive: 0.0 },
                { type: 'cylinder', radius: 0.638, height: 0.14, offset: [0,  0.43, 0], color: [0.26, 0.29, 0.35], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.638, height: 0.14, offset: [0, -0.43, 0], color: [0.26, 0.29, 0.35], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.26, height: 0.66, depth: 0.22, offset: [0, 0, 0.56], color: [0.34, 0.38, 0.44], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.18, height: 0.10, depth: 0.06, offset: [0, 0.22, 0.66], color: [1.0, 0.86, 0.32], mat: 'EMISSIVE_GLOW', emissive: 0.85 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.50, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.50, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 0,
        capability: 'deploy_facility',
        scanTier: 0,
        cargoCapacity: 0
    },

    // ==================== 6. 货运载荷 ====================
    {
        id: 'cargo_bay_mk2',
        name: 'CH-2000 通用加压货仓',
        category: 'cargo',
        description: '实体化大容量货运舱段（提供 2000 kg 共享货仓容量，可装载材料套装、矿石与补给燃料）。',
        mass: 300,
        cost: 100,
        collider: {
            radius: 0.625,
            halfHeight: 0.65,
            allowSurfaceAttach: false,
            allowSurfaceChildren: true,
            srfAttachOffset: [0, 0, 0]
        },
        visual: {
            modelPath: null,
            primitives: [
                { type: 'cylinder', radius: 0.625, height: 1.30, offset: [0, 0, 0], color: [0.74, 0.78, 0.83], mat: 'HULL_PAINTED', emissive: 0.0 },
                { type: 'cylinder', radius: 0.638, height: 0.10, offset: [0,  0.60, 0], color: [0.34, 0.38, 0.44], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.638, height: 0.10, offset: [0, -0.60, 0], color: [0.34, 0.38, 0.44], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'cylinder', radius: 0.636, height: 0.09, offset: [0,  0.00, 0], color: [0.34, 0.38, 0.44], mat: 'METAL_RING', emissive: 0.0 },
                { type: 'box', width: 0.06, height: 1.18, depth: 1.29, offset: [0, 0, 0], color: [0.24, 0.27, 0.32], mat: 'METAL_RING', emissive: 0.0 }
            ]
        },
        attachNodes: [
            { id: 'top',    position: [0,  0.65, 0], direction: [0,  1, 0], size: 1 },
            { id: 'bottom', position: [0, -0.65, 0], direction: [0, -1, 0], size: 1 }
        ],
        resources: null,
        engine: null,
        reactionWheelTorque: 0,
        capability: 'cargo_hold',
        scanTier: 0,
        cargoCapacity: 2000
    }
];

// 追加 KSP2 官方资产部件（OBJ + MTL + PBR 贴图管线）。
// 注意：ksp2PartTypes.js / originalPartTypes.js 不反向依赖本文件，因此无循环 import。
PART_TYPES.push(...KSP2_PART_TYPES);
PART_TYPES.push(...ORIGINAL_PART_TYPES);

export function getPartType(typeId) {
    return PART_TYPES.find(p => p.id === typeId) || null;
}

export function getPartsByCategory(categoryId) {
    return PART_TYPES.filter(p => p.category === categoryId);
}

export function getAllPartTypes() {
    return [...PART_TYPES];
}

/**
 * 本地未导入 KSP2 资产时剔除这部分部件（资产不入库，见 .gitignore）。
 * 就地修改 PART_TYPES，保证 getPartType / getPartsByCategory 口径一致。
 * @returns {number} 被剔除的部件数
 */
export function pruneUnavailableKsp2Parts() {
    const before = PART_TYPES.length;
    for (let i = PART_TYPES.length - 1; i >= 0; i--) {
        if (PART_TYPES[i].ksp2) PART_TYPES.splice(i, 1);
    }
    return before - PART_TYPES.length;
}
