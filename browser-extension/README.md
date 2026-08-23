# Dizygotic Rumble Chat Companion — Browser Extension

Store-ready WebExtension packaging for the Rumble companion userscript. Chrome, Brave and Edge share one Chromium Manifest V3 package; Firefox gets a Firefox MV3 package; Safari uses the same WebExtension source and can be wrapped by Apple's Safari Web Extension Packager.

## One source of truth

The extension build reads the canonical userscript at:

`scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`

It extracts that file's `@version`, strips only the Tampermonkey metadata block, and packages the same companion core. There is deliberately no second copy of the Rumble feature logic under `browser-extension/`, so Greasy Fork/Tampermonkey and browser-store editions cannot silently drift apart.

The extension preserves the blocker/highlighter, keyword filters, compact mode, timestamps, notifications, autoscroll lock, long-message handling, DizyChat DM handoff, transcript recorder/export, automatic local curated-burn memory, outgoing Unicode font styles and outgoing single/rainbow/multi-colour rich-composer formatting, portable settings, draggable settings UI, and selectable burn engines.

## Manifest V3 dependency handling

The Tampermonkey edition loads Compromise and RiTa with `@require`. Browser-store Manifest V3 builds instead download the pinned versions **at build time** and place them inside the extension package:

- Compromise `14.14.4`
- RiTa `3.2.16`

The installed extension therefore executes packaged code only; it does not fetch executable JavaScript from a CDN at runtime.

## Build locally

```bash
cd browser-extension
./scripts/fetch-vendor.sh
node build.mjs
./scripts/package.sh
```

Output:

```text
dist/chromium/
dist/firefox/
dist/safari/
dist/dizygotic-rumble-chat-companion-vX.Y-chromium.zip
dist/dizygotic-rumble-chat-companion-vX.Y-firefox.zip
dist/dizygotic-rumble-chat-companion-vX.Y-safari-source.zip
dist/SHA256SUMS.txt
```

The icons are generated during the build, so the repository does not carry duplicate binary icon sets.

## Development install

### Chrome / Brave / Edge

1. Build the extension.
2. Open the browser's extensions page.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `browser-extension/dist/chromium`.

The same Chromium ZIP is the release package for Chrome, Brave and Edge.

### Firefox

1. Build the extension.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select `browser-extension/dist/firefox/manifest.json`.

For normal permanent installation and automatic updates, submit/sign the Firefox ZIP through AMO.

### Safari

Build the Safari source, then on macOS with Xcode installed run:

```bash
./scripts/package-safari.sh
```

This creates an Xcode Safari Web Extension wrapper under `dist/safari-xcode`. Final signing/App Store or TestFlight distribution requires the publisher's Apple Developer account and signing identity.

## GitHub build/update pipeline

`.github/workflows/build-rumble-extension.yml` rebuilds and validates the browser packages whenever the canonical userscript or `browser-extension/` source changes. It also produces a Safari Xcode wrapper on a macOS runner.

For a new release:

1. update and test the canonical userscript;
2. bump its `@version` once;
3. commit it;
4. let the workflow rebuild every browser target;
5. publish the generated Chromium ZIP to Chrome Web Store, Firefox ZIP to AMO, and Safari wrapper through Apple's distribution flow.

Once published in those stores, subsequent approved versions use the normal store auto-update mechanisms. Greasy Fork remains the userscript/beta channel.

## Popup

The toolbar popup shows whether the active Rumble tab has the companion running, recorder status, Burn Bot status and current locally recorded message count. It can open the in-page **Chat Settings** panel, Rumble, or DizyChat directly.

## Data and permissions

The extension requests Rumble host access only. Existing companion settings, blocklists and transcript data continue to live in the browser's Rumble-origin local storage for compatibility with current Tampermonkey data/export behaviour. Transcript export is user-triggered; DizyChat is opened only when the user explicitly chooses the DM handoff. Outgoing Unicode font transforms are plain-text compatible; colour spans are used only when Rumble exposes a contenteditable/rich composer, because a plain textarea cannot transport CSS colour.

## Third-party licensing

See `THIRD_PARTY_NOTICES.md`. Compromise is MIT licensed. RiTa is GPL-3.0; review the GPL obligations before public store distribution of a bundle containing RiTa, or replace/remove that optional engine before publication if a different licensing model is preferred.
