#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const SOUND_DATA_DIR = path.join(process.cwd(), 'data', 'soundboards');
const SOUND_PUBLIC_DIR = path.join(process.cwd(), 'public', 'soundboards');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/soundboards-clean.mjs <board-slug>');
  process.exit(1);
}

const jsonPath = path.join(SOUND_DATA_DIR, `${slug}.json`);
const folder   = path.join(SOUND_PUBLIC_DIR, slug);
const index    = path.join(SOUND_DATA_DIR, 'index.json');

async function rmrf(p) {
  try { await fs.rm(p, { recursive: true, force: true }); } catch {}
}

(async () => {
  await rmrf(folder);
  await rmrf(jsonPath);
  let idx = { boards: [] };
  try { idx = JSON.parse(await fs.readFile(index, 'utf8')); } catch {}
  idx.boards = (idx.boards||[]).filter(b => b !== slug);
  await fs.writeFile(index, JSON.stringify(idx, null, 2) + '\n');
  console.log(`Cleaned board '${slug}'.`);
})();