#!/usr/bin/env node
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const board = process.argv[2];
const COPY = process.argv.includes('--copy'); // write new *_norm.mp3 instead of replacing
if (!board) { console.error('Usage: node scripts/normalize-audio.mjs <board-slug> [--copy]'); process.exit(1); }

const ROOT = path.join(process.cwd(), 'public', 'soundboards', board);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => err ? reject(new Error(stderr||err.message)) : resolve(stdout));
  });
}

(async ()=>{
  const files = (await fs.readdir(ROOT)).filter(f => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f));
  for (const f of files) {
    const src = path.join(ROOT, f);
    const out = COPY ? path.join(ROOT, f.replace(/\.(\w+)$/i, '_norm.mp3')) : path.join(ROOT, f.replace(/\.(\w+)$/i, '.mp3'));
    console.log('Normalizing', f);
    await run('ffmpeg', ['-y','-i',src,'-af','loudnorm=I=-16:TP=-1.5:LRA=11', out]);
    if (!COPY && out !== src) { try { await fs.rm(src); } catch {} }
  }
  console.log('Done.');
})();