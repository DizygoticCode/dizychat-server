#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const SOUND_DATA_DIR = path.join(process.cwd(), 'data', 'soundboards');
const slug = process.argv[2];
const tags = (process.argv[3] || '').split(',').map(s=>s.trim()).filter(Boolean);

if (!slug) { console.error('Usage: node scripts/tag-board.mjs <board-slug> tag1,tag2,tag3'); process.exit(1); }

(async ()=>{
  const p = path.join(SOUND_DATA_DIR, `${slug}.json`);
  const json = JSON.parse(await fs.readFile(p,'utf8'));
  json.tags = Array.from(new Set([...(json.tags||[]), ...tags]));
  await fs.writeFile(p, JSON.stringify(json, null, 2) + '\n');
  console.log(`Updated tags on ${slug}:`, json.tags.join(', '));
})();