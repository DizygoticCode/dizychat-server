import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import archiver from "archiver";
import { PNG } from "pngjs";
import { createWriteStream } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const userscriptPath = path.join(repoRoot, "scripts", "tampermonkey", "dizygotic-rumble-chat-tool.user.js");
const distRoot = path.join(here, "dist");
const requested = process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "safari"];

const userscript = await fs.readFile(userscriptPath, "utf8");
const versionMatch = userscript.match(/^\/\/\s*@version\s+([^\s]+)$/m);
if (!versionMatch) throw new Error("Unable to read @version from canonical userscript");
const userscriptVersion = versionMatch[1];
const extensionVersion = /^\d+\.\d+\.\d+$/.test(userscriptVersion) ? userscriptVersion : `${userscriptVersion}.0`;
const core = userscript.replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m, "");

const prelude = `
import nlp from "compromise";
import { RiTa } from "rita";

globalThis.nlp = nlp;
globalThis.RiTa = RiTa;

globalThis.GM_download = function GM_download(arg1, arg2) {
  const options = typeof arg1 === "string" ? { url: arg1, name: arg2 } : (arg1 || {});
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.sendMessage) throw new Error("Extension runtime messaging is unavailable");
  const payload = {
    type: "dizygotic-download",
    url: String(options.url || ""),
    filename: String(options.name || options.filename || "download"),
    saveAs: Boolean(options.saveAs)
  };
  const result = api.runtime.sendMessage(payload);
  if (result && typeof result.then === "function") {
    result.then((response) => {
      if (response?.ok) options.onload?.(response);
      else options.onerror?.(response);
    }).catch((error) => options.onerror?.(error));
  }
  return result;
};
`;

const generatedEntry = path.join(here, ".generated-content-entry.js");
await fs.writeFile(generatedEntry, `${prelude}\n${core}\n`, "utf8");

function manifestFor(target) {
  const base = {
    manifest_version: 3,
    name: "Dizygotic Rumble Chat Companion",
    short_name: "Dizy Rumble Chat",
    version: extensionVersion,
    description: "Rumble chat companion with moderation, transcript export, appearance controls, DizyChat DM handoff and burn engines.",
    permissions: ["downloads", "storage", "tabs"],
    host_permissions: ["https://rumble.com/*"],
    action: {
      default_title: "Dizygotic Rumble Chat Companion",
      default_popup: "popup.html",
      default_icon: { "16": "icons/icon16.png", "32": "icons/icon32.png" }
    },
    icons: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    content_scripts: [{
      matches: ["https://rumble.com/*"],
      js: ["content.js"],
      run_at: "document_idle"
    }]
  };

  if (target === "chromium") {
    base.background = { service_worker: "background.js" };
  } else if (target === "firefox") {
    base.background = { scripts: ["background.js"] };
    base.browser_specific_settings = {
      gecko: {
        id: "rumble-chat@dizygotic.dev",
        strict_min_version: "121.0"
      }
    };
  } else if (target === "safari") {
    base.background = {
      scripts: ["background.js"],
      service_worker: "background.js"
    };
  } else {
    throw new Error(`Unknown target: ${target}`);
  }
  return base;
}

async function makeIcon(file, size) {
  const png = new PNG({ width: size, height: size });
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * 0.46;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      const inside = Math.hypot(x - cx, y - cy) <= radius;
      png.data[i] = inside ? 25 : 0;
      png.data[i + 1] = inside ? 118 : 0;
      png.data[i + 2] = inside ? 210 : 0;
      png.data[i + 3] = inside ? 255 : 0;
    }
  }
  const stroke = Math.max(1, Math.floor(size * 0.09));
  const left = Math.floor(size * 0.31);
  const top = Math.floor(size * 0.24);
  const bottom = Math.ceil(size * 0.76);
  const right = Math.ceil(size * 0.70);
  const mid = (top + bottom) / 2;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const vertical = x < left + stroke;
      const outer = Math.hypot((x - left) / (right - left), (y - mid) / ((bottom - top) / 2)) <= 1.02;
      const inner = Math.hypot((x - left) / Math.max(1, right - left - stroke * 2), (y - mid) / Math.max(1, (bottom - top) / 2 - stroke)) <= 1;
      if (vertical || (outer && !inner)) {
        if (x >= 0 && y >= 0 && x < size && y < size) {
          const i = (size * y + x) << 2;
          png.data[i] = 255;
          png.data[i + 1] = 255;
          png.data[i + 2] = 255;
          png.data[i + 3] = 255;
        }
      }
    }
  }
  await fs.writeFile(file, PNG.sync.write(png));
}

async function zipDirectory(sourceDir, outPath) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

for (const target of requested) {
  const outDir = path.join(distRoot, target);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, "icons"), { recursive: true });

  await build({
    entryPoints: [generatedEntry],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2022"],
    outfile: path.join(outDir, "content.js"),
    legalComments: "none"
  });

  await fs.copyFile(path.join(here, "src", "background.js"), path.join(outDir, "background.js"));
  await fs.copyFile(path.join(here, "src", "popup.html"), path.join(outDir, "popup.html"));
  await fs.copyFile(path.join(here, "src", "popup.css"), path.join(outDir, "popup.css"));
  await fs.copyFile(path.join(here, "src", "popup.js"), path.join(outDir, "popup.js"));
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifestFor(target), null, 2) + "\n");
  for (const size of [16, 32, 48, 128]) {
    await makeIcon(path.join(outDir, "icons", `icon${size}.png`), size);
  }

  await zipDirectory(outDir, path.join(distRoot, `dizygotic-rumble-chat-${target}-v${extensionVersion}.zip`));
}

await fs.rm(generatedEntry, { force: true });
console.log(`Built Dizygotic Rumble Chat Companion ${extensionVersion}: ${requested.join(", ")}`);
