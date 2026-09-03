'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../../public/chat.js');
let source = fs.readFileSync(target, 'utf8');

if (!source.includes('adminPasswordInput')) {
  console.log('Task 6 legacy admin-password hint block already absent.');
  process.exit(0);
}

const block = /function normaliseAdminHintValue\(value\) \{[\s\S]*?if \(usernameInput && adminPasswordInput\) \{[\s\S]*?\n\}\n/;
const match = source.match(block);
if (!match) {
  throw new Error('Task 6 legacy admin-password hint block seam not found');
}

source = source.replace(block, '');
fs.writeFileSync(target, source);
console.log('Removed legacy browser admin-password hint visibility block.');
