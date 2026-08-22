# Dizygotic Rumble Chat Companion — Browser Extension

Standalone WebExtension packaging for the Dizygotic Rumble Chat Companion. The extension deliberately reuses the canonical userscript at `../scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`, so Tampermonkey/Greasy Fork and browser-extension releases do not drift into separate products.

## Supported targets

- **Chrome / Brave / Edge** — Manifest V3 Chromium package.
- **Firefox** — Manifest V3 WebExtension package with a stable Gecko extension ID.
- **Safari** — Safari-WebExtension-ready output. Apple packaging/signing is performed from the generated Safari folder using Apple's Safari Web Extension packager and an Apple Developer account.

## Build

```bash
cd browser-extension
npm install
npm run build
```

Output:

```text
dist/chromium/
dist/firefox/
dist/safari/
dist/dizygotic-rumble-chat-chromium-vX.Y.Z.zip
dist/dizygotic-rumble-chat-firefox-vX.Y.Z.zip
dist/dizygotic-rumble-chat-safari-vX.Y.Z.zip
```

The build reads `@version` from the canonical Tampermonkey userscript automatically. A userscript version such as `1.8` becomes extension version `1.8.0`.

## What the extension preserves

The packaged content script carries the same Rumble DOM companion behaviour as the userscript: block/highlight/filter tools, timestamps, compact mode, notifications, transcript capture/export, font/colour controls, DizyChat DM handoff, selectable burn engines, portable settings and the draggable settings panel.

`compromise` and `rita` are bundled into `content.js`; the extension does **not** execute remotely hosted JavaScript. `GM_download` is replaced by a small WebExtension bridge to the browser downloads API.

## Development install

### Chrome / Brave / Edge

1. Run `npm run build:chromium`.
2. Open the browser extensions page.
3. Enable Developer mode.
4. Choose **Load unpacked** and select `browser-extension/dist/chromium`.

### Firefox

1. Run `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select `browser-extension/dist/firefox/manifest.json`.

For permanent public distribution, submit the generated ZIP to Firefox Add-ons (AMO).

### Safari

1. Run `npm run build:safari`.
2. On macOS with current Xcode installed, run:

```bash
xcrun safari-web-extension-packager dist/safari \
  --app-name "Dizygotic Rumble Chat Companion" \
  --bundle-identifier "dev.dizygotic.rumblechat" \
  --swift
```

Apple previously called this tool `safari-web-extension-converter`; current Xcode uses `safari-web-extension-packager`.

## Updating all editions

1. Update and test the canonical Tampermonkey userscript.
2. Bump its `@version`.
3. Run the extension build.
4. Publish the generated Chromium ZIP to the Chrome Web Store, Firefox ZIP to AMO, and the Safari package through Apple's distribution flow.

The browser stores then deliver normal extension updates. Greasy Fork remains the userscript/beta distribution path.

## Permissions

The extension requests only the capabilities used by the companion:

- host access to `https://rumble.com/*`
- `downloads` for transcript/settings exports
- `storage` for extension persistence/migration work
- `tabs` for the popup's Open Rumble/Open DizyChat shortcuts

The existing companion data remains local to the browser unless the user explicitly opens the DizyChat DM handoff.
