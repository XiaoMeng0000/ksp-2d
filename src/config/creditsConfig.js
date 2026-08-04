'use strict';

const CREDITS = {
    sections: [
        {
            title: '开发',
            lead: '【逃逸速度】',
            groups: [
                {
                    name: '【逃逸速度】',
                    rows: [
                        { role: '创意总监',  members: [{ name: 'XiaoMeng',       icon: null }] },
                        { role: '使用平台',  members: [{ name: 'TRAE CN',        icon: null }] },
                        { role: '使用API',   members: [
                            { name: 'DEEPSEEK V4 PRO', icon: null },
                            { name: 'KIMI K3',         icon: null },
                            { name: 'QWEN 3.7 PLUS',   icon: null }
                        ]}
                    ]
                },
                {
                    name: '美术',
                    rows: [
                        { role: '美术设计',    members: [{ name: 'XiaoMeng', icon: null }, { name: '离川', icon: null }] },
                        { role: 'UI图标绘制',  members: [{ name: 'XiaoMeng', icon: null }] }
                    ]
                }
            ]
        },
        {
            title: '灵感来源',
            lead: 'KERBAL SPACE PROGRAM'
        }
    ]
};

export { CREDITS };
