'use strict';

// 部件系统 - 6 大部件分类定义（数据驱动，纯标识与显示名）

export const PART_CATEGORIES = [
    { id: 'command',   name: '指挥与控制' },
    { id: 'tank',      name: '推进剂储罐' },
    { id: 'engine',    name: '推进引擎' },
    { id: 'structure', name: '结构与姿态' },
    { id: 'utility',   name: '科研与工程' },
    { id: 'cargo',     name: '货运载荷' }
];

export function getPartCategory(categoryId) {
    return PART_CATEGORIES.find(c => c.id === categoryId) || null;
}
