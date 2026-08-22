import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, "..");
const repoRoot = path.resolve(extRoot, "..");
const canonical = path.join(repoRoot, "scripts", "tampermonkey", "dizygotic-rumble-chat-tool.user.js");
if (!fs.existsSync(canonical)) throw new Error(`Canonical userscript not found: ${canonical}`);
const sourcePath = canonical;
const source = fs.readFileSync(sourcePath, "utf8");
const versionMatch = source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m);
if (!versionMatch) throw new Error(`Could not read @version from ${sourcePath}`);
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
const icons = JSON.parse(fs.readFileSync(path.join(extRoot, "assets", "icons.base64.json"), "utf8"));
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
    js: [
      "vendor/compromise.min.js",
      "vendor/rita.min.js",
      "shim.js",
      "content-core.js",
      "bridge.js"
    ],
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
    browser_specific_settings: {
      safari: { strict_min_version: "17.0" }
    }
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
  for (const [name, encoded] of Object.entries(icons)) {
    fs.writeFileSync(path.join(out, "icons", name), Buffer.from(encoded, "base64"));
  }
  copy(path.join(extRoot, "THIRD_PARTY_NOTICES.md"), path.join(out, "THIRD_PARTY_NOTICES.md"));
}

console.log(`Built Dizygotic Rumble Chat Companion v${version} for ${targets.join(", ")}`);
