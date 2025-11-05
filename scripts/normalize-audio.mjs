#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// where your app serves from (symlinked to /var/soundboards on Render)
const PUBLIC_SOUNDBOARDS = path.resolve(__dirname, "..", "public", "soundboards");

function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

const AUDIO_RX = /\.(mp3|wav|ogg|m4a|aac)$/i;

// choose sane defaults per codec
function ffmpegArgsFor(input, output) {
  const ext = path.extname(output).toLowerCase();
  // Loudness normalization to ~-16 LUFS, TP -1.5dB
  const loudnorm = "loudnorm=I=-16:TP=-1.5:LRA=11";

  switch (ext) {
    case ".mp3":
      return ["-nostdin","-hide_banner","-y","-i", input, "-af", loudnorm, "-codec:a","libmp3lame","-q:a","3", output];
    case ".m4a":
    case ".aac":
      return ["-nostdin","-hide_banner","-y","-i", input, "-af", loudnorm, "-c:a","aac","-b:a","192k", output];
    case ".ogg":
      return ["-nostdin","-hide_banner","-y","-i", input, "-af", loudnorm, "-c:a","libvorbis","-q:a","5", output];
    case ".wav":
      return ["-nostdin","-hide_banner","-y","-i", input, "-af", loudnorm, "-c:a","pcm_s16le", output];
    default:
      // fallback: try libmp3lame
      return ["-nostdin","-hide_banner","-y","-i", input, "-af", loudnorm, "-codec:a","libmp3lame","-q:a","3", output];
  }
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function normalizeBoard(slug) {
  const boardDir = path.join(PUBLIC_SOUNDBOARDS, slug);
  await fs.access(boardDir).catch(() => { throw new Error(`Board not found: ${boardDir}`); });

  for await (const file of walk(boardDir)) {
    if (!AUDIO_RX.test(file)) continue;

    const normMarker = file + ".norm-ok";
    try {
      await fs.access(normMarker);
      // already normalized
      continue;
    } catch {}

    const tmpOut = file + ".tmp";
    const args = ffmpegArgsFor(file, tmpOut);

    console.log(`Normalizing ${path.relative(boardDir, file)}`);
    try {
      await run("ffmpeg", args);

      // Strip junky 101SB metadata; keep title only
      const ext = path.extname(file).toLowerCase();
      if (ext === ".mp3") {
        // re-tag minimal (optional). Comment out if not needed.
        await run("ffmpeg", ["-nostdin","-hide_banner","-y","-i", tmpOut, "-map_metadata","-1", "-codec","copy", tmpOut + ".tag"]);
        await fs.rename(tmpOut + ".tag", tmpOut);
      }

      // atomic replace
      await fs.rename(tmpOut, file);
      await fs.writeFile(normMarker, "ok\n");

    } catch (err) {
      // cleanup temp on failure
      await fs.rm(tmpOut, { force: true }).catch(() => {});
      console.error(`[normalize] Failed ${file}: ${err.message}`);
    }
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node scripts/normalize-audio.mjs <board-slug> | all");
    process.exit(1);
  }

  if (slug === "all") {
    const boards = await fs.readdir(PUBLIC_SOUNDBOARDS, { withFileTypes: true });
    for (const d of boards) {
      if (!d.isDirectory()) continue;
      // skip uploads pseudo-board
      if (d.name === "uploads") continue;
      await normalizeBoard(d.name);
    }
  } else {
    await normalizeBoard(slug);
  }

  console.log("✅ Done.");
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
