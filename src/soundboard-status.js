// src/soundboardStatus.js
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR   = path.resolve("data", "soundboards");
const PUBLIC_DIR = path.resolve("public", "soundboards");

async function safeJson(p) {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function getSoundboardStatus() {
  const index = await safeJson(path.join(DATA_DIR, "index.json")) || { boards: [] };
  const boardSlugs = Array.isArray(index.boards) ? index.boards : [];

  const boards = [];
  for (const slug of boardSlugs) {
    const jsonPath = path.join(DATA_DIR, `${slug}.json`);
    const board = await safeJson(jsonPath);
    if (!board || !Array.isArray(board.items)) {
      boards.push({
        slug,
        title: board?.title || slug,
        total: 0,
        downloaded: 0,
        pending: 0,
        path: `soundboards/${slug}/`,
      });
      continue;
    }

    let downloaded = 0;
    for (const item of board.items) {
      // item.file is like "<slug>/<filename>"
      const rel = item.file || "";
      const filename = rel.split("/").pop();
      if (!filename) continue;
      const filePath = path.join(PUBLIC_DIR, slug, filename);
      if (await exists(filePath)) downloaded++;
    }

    const total = board.items.length;
    boards.push({
      slug,
      title: board.title || slug,
      total,
      downloaded,
      pending: Math.max(0, total - downloaded),
      path: `soundboards/${slug}/`,
    });
  }

  const totals = boards.reduce(
    (acc, b) => {
      acc.total += b.total;
      acc.downloaded += b.downloaded;
      acc.pending += b.pending;
      return acc;
    },
    { total: 0, downloaded: 0, pending: 0 }
  );

  return { updatedAt: new Date().toISOString(), totals, boards };
}
