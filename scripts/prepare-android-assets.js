'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const copies = [
  ['public/app-config.js', 'android-shell/app-config.js'],
  ['public/logo.svg', 'android-shell/logo.svg'],
];

for (const [sourcePath, targetPath] of copies) {
  const source = path.join(root, sourcePath);
  const target = path.join(root, targetPath);
  if (!fs.existsSync(source)) {
    throw new Error(`Required Android shell source not found: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`Prepared Android shell asset: ${targetPath}`);
}
