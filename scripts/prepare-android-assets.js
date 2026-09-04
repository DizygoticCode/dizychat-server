'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const socketIoEntry = require.resolve('socket.io');
const socketIoRoot = path.resolve(path.dirname(socketIoEntry), '..');
const source = path.join(socketIoRoot, 'client-dist', 'socket.io.min.js');
const targetDir = path.join(root, 'public/vendor');
const target = path.join(targetDir, 'socket.io.min.js');

if (!fs.existsSync(source)) {
  throw new Error(`Socket.IO browser client not found at ${source}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Prepared Android Socket.IO client: ${target}`);
