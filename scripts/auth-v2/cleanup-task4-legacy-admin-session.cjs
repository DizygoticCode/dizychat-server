'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../../index.js');
let source = fs.readFileSync(target, 'utf8');

const staleBlock = `
    if (adminSession) {
      socket.emit('admin status', {
        isAdmin: true,
        token: adminSession.token,
        expiresAt: adminSession.expiresAt,
      });
    }
`;

const first = source.indexOf(staleBlock);
if (first !== -1) {
  if (source.indexOf(staleBlock, first + staleBlock.length) !== -1) {
    throw new Error('Task 4 legacy admin-session block is not unique');
  }
  source = `${source.slice(0, first)}${source.slice(first + staleBlock.length)}`;
  fs.writeFileSync(target, source);
  console.log('Removed stale Task 4 legacy admin-session join block.');
} else {
  console.log('Task 4 legacy admin-session join block already absent.');
}
