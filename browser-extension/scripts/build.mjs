import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, "..");
const repoRoot = path.resolve(extRoot, "..");
const canonical = path.join(repoRoot, "scripts", "tampermonkey", "dizygotic-rumble-chat-tool.user.js");
if (!fs.existsSync(canonical)) throw new Error(`Canonical userscript not found: ${canonical}`);
const source = fs.readFileSync(canonical, "utf8");
const versionMatch = source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m);
if (!versionMatch) throw new Error(`Could not read @version from ${canonical}`);
const version = versionMatch[1].trim();
if (!/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error(`Unsupported extension version: ${version}`);

const vendorDir = path.join(extRoot, "vendor");
const compromise = path.join(vendorDir, "compromise.min.js");
const rita = path.join(vendorDir, "rita.min.js");
if (!fs.existsSync(compromise) || !fs.existsSync(rita)) {
  throw new Error("Missing browser-extension/vendor libraries. Run scripts/fetch-vendor.sh first.");
}

const stripMetadata = (text) => text
  .replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m, "")
  .replace(
    "Compromise and RiTa are loaded by Tampermonkey via @require. Markov uses a local word-chain generator so a CDN package change cannot kill the whole userscript.",
    "Compromise and RiTa are bundled inside the browser extension. Markov uses a local word-chain generator so an external package/CDN outage cannot kill the companion."
  );

const core = stripMetadata(source);
const targets = ["chromium", "firefox", "safari"];
const iconSizes = [16, 32, 48, 64, 96, 128, 256, 512];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data = Buffer.alloc(0)) => {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};
const makeIcon = (size) => {
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  const bg = [20, 22, 28, 255];
  const fg = [255, 214, 72, 255];
  for (let y = 0; y < size; y += 1) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const edge = Math.min(nx, ny, 1 - nx, 1 - ny);
      const frame = edge > 0.055 && edge < 0.105;
      const vertical = nx > 0.23 && nx < 0.34 && ny > 0.20 && ny < 0.80;
      const cap = nx >= 0.30 && nx < 0.56 && ((ny > 0.20 && ny < 0.31) || (ny > 0.69 && ny < 0.80));
      const ex = (nx - 0.53) / 0.26;
      const ey = (ny - 0.50) / 0.30;
      const ellipse = ex * ex + ey * ey;
      const arc = nx >= 0.50 && ellipse > 0.62 && ellipse < 1.08;
      const color = frame || vertical || cap || arc ? fg : bg;
      const i = y * row + 1 + x * 4;
      raw[i] = color[0]; raw[i + 1] = color[1]; raw[i + 2] = color[2]; raw[i + 3] = color[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND")
  ]);
};

const common = {
  manifest_version: 3,
  name: "Dizygotic Rumble Chat Companion",
  version,
  description: "Rumble chat companion with blocking, highlights, keyword filters, transcript recording/export, appearance controls, DizyChat DM handoff and selectable burn engines.",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png",
    "128": "icons/icon-128.png"
  },
  action: {
    default_title: "Dizygotic Rumble Chat Companion",
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png"
    }
  },
  host_permissions: ["https://rumble.com/*"],
  content_scripts: [{
    matches: ["https://rumble.com/*"],
    js: ["vendor/compromise.min.js", "vendor/rita.min.js", "shim.js", "content-core.js", "bridge.js"],
    run_at: "document_idle"
  }]
};

const manifests = {
  chromium: { ...common },
  firefox: {
    ...common,
    browser_specific_settings: {
      gecko: {
        id: "dizygotic-rumble-chat-companion@dizygoticcode",
        data_collection_permissions: { required: ["none"] }
      }
    }
  },
  safari: {
    ...common,
    browser_specific_settings: { safari: { strict_min_version: "17.0" } }
  }
};

const copy = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
};

for (const target of targets) {
  const out = path.join(extRoot, "dist", target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifests[target], null, 2) + "\n");
  fs.writeFileSync(path.join(out, "content-core.js"), core);
  copy(path.join(extRoot, "src", "shim.js"), path.join(out, "shim.js"));
  copy(path.join(extRoot, "src", "bridge.js"), path.join(out, "bridge.js"));
  copy(path.join(extRoot, "src", "popup.html"), path.join(out, "popup.html"));
  copy(path.join(extRoot, "src", "popup.css"), path.join(out, "popup.css"));
  copy(path.join(extRoot, "src", "popup.js"), path.join(out, "popup.js"));
  copy(compromise, path.join(out, "vendor", "compromise.min.js"));
  copy(rita, path.join(out, "vendor", "rita.min.js"));
  for (const size of iconSizes) fs.writeFileSync(path.join(out, "icons", `icon-${size}.png`), makeIcon(size));
  copy(path.join(extRoot, "THIRD_PARTY_NOTICES.md"), path.join(out, "THIRD_PARTY_NOTICES.md"));
}

console.log(`Built Dizygotic Rumble Chat Companion v${version} for ${targets.join(", ")}`);
