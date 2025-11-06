#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import archiver from 'archiver';

const DIST_DIR = path.join(process.cwd(), 'dist');
await fs.mkdir(DIST_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const out = path.join(DIST_DIR, `soundboards-${ts}.zip`);

import { createWriteStream } from 'fs';
const archive = archiver('zip', { zlib: { level: 9 }});
const stream = createWriteStream(out);

archive.pipe(stream);
archive.directory('data/soundboards/', 'data/soundboards');
archive.directory('public/soundboards/', 'public/soundboards');
await archive.finalize();

console.log('Wrote', out);
