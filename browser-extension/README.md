# Dizygotic Rumble Chat Companion — Browser Extension

Store-ready WebExtension packaging for the Rumble companion userscript. Chrome, Brave and Edge share the Chromium Manifest V3 package; Firefox gets its own MV3 manifest; Safari uses the same web-extension source and can be packaged by Apple's Safari Web Extension Packager.

## Single source of truth

The build reads `../scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js` and extracts its `@version`. Updating the canonical userscript therefore updates the extension core and browser package version together. There is deliberately no second copy of the Rumble core under `browser-extension/`, so the userscript and store packages cannot silently drift apart.

## Build

```bash
cd browser-extension
./scripts/fetch-vendor.sh
node scripts/build.mjs
./scripts/package.sh
```

Output:

- `dist/chromium/` and `*-chromium.zip` — Chrome, Brave and Edge.
- `dist/firefox/` and `*-firefox.zip` — Firefox / AMO.
- `dist/safari/` and `*-safari-source.zip` — Safari Web Extension source.

On macOS with Xcode installed:

```bash
./scripts/package-safari.sh
```

That creates the Safari Xcode wrapper. The Safari App Store / TestFlight build still requires the user's Apple Developer account and signing identity.

## Local install

### Chrome / Brave / Edge

Open the browser's extensions page, enable Developer mode, choose **Load unpacked**, and select `dist/chromium`.

### Firefox

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Permanent public installation should be signed through AMO.

### Safari

Safari can temporarily load a web-extension folder for development on supported macOS versions, or use `scripts/package-safari.sh` / App Store Connect's Safari Web Extension Packager for a distributable app wrapper.

## Updating users

For the public stable channel, publish each package through its normal store. Chrome/Brave/Edge receive Chrome Web Store updates, Firefox receives AMO updates, and Safari receives App Store updates. The repository build pipeline keeps all packages on the same version and recreates the ZIPs whenever the canonical userscript changes.

A self-hosted Firefox build can later add `browser_specific_settings.gecko.update_url`, but the store route is recommended for ordinary users. Chrome Manifest V3 does not permit replacing packaged executable code with remotely hosted code, so browser-extension updates are shipped as new extension versions rather than downloading JavaScript at runtime.

## Permissions and privacy

The extension requests access only to `https://rumble.com/*`. The current companion stores its blocklist, preferences and transcript data in the browser's Rumble-origin local storage for compatibility with existing Tampermonkey exports. It does not transmit the transcript as part of normal Rumble filtering/recording. DizyChat is opened only when the user explicitly uses the DM handoff.

## Third-party code

See `THIRD_PARTY_NOTICES.md`. Compromise is MIT licensed. RiTa is GPL-3.0; review the GPL obligations before public store distribution of a bundle that includes RiTa.
