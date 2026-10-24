"use strict";

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    // 路径穿越防护：解析为绝对路径后校验是否在项目目录内
    const absolutePath = path.resolve(filePath);
    const normalizedRoot = path.resolve(__dirname);
    if (!absolutePath.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(absolutePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
            res.end(content);
        }
    });
});

// 端口可用 PORT 环境变量覆盖（默认 3000）：本机 3000 被占用时用 PORT=3100 node server.js
const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, () => {
    console.log('Server running on http://localhost:' + PORT + '/');
});
