"use strict";

/**
 * KSP 2D 启动器
 * 自动启动 server.js 并打开浏览器
 * 用法：node launcher.js
 */

const { spawn, exec } = require('child_process');

const PORT = 3000;
const URL = `http://localhost:${PORT}/`;

console.log('[启动器] 正在启动服务器...');

// 启动 server.js
const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

server.on('error', (err) => {
    console.error('[启动器] 服务器启动失败：', err.message);
    process.exit(1);
});

// 等 1.5 秒让服务器就绪，然后打开浏览器
setTimeout(() => {
    const cmd =
        process.platform === 'win32'   ? `start "" "${URL}"` :
        process.platform === 'darwin'  ? `open "${URL}"` :
                                         `xdg-open "${URL}"`;
    exec(cmd, (err) => {
        if (err) {
            console.log(`[启动器] 浏览器未能自动打开，请手动访问：${URL}`);
        } else {
            console.log(`[启动器] 浏览器已打开：${URL}`);
        }
    });
}, 1500);

// 服务器退出时启动器也退出
server.on('exit', (code) => {
    console.log(`[启动器] 服务器已停止 (exit ${code})`);
    process.exit(code ?? 0);
});
