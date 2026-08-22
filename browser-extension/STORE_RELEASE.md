# Store release and update channels

## Chrome / Brave / Edge

Use `dist/dizygotic-rumble-chat-companion-v<version>-chromium.zip` for Chrome Web Store submission. Brave and Edge can install Chrome Web Store extensions, so one Chromium package covers all three browsers. Normal users receive updates from the store when a newer package version is approved.

Do not add CDN script tags or runtime-downloaded JavaScript to the Manifest V3 package. Executable third-party libraries are bundled at build time.

## Firefox

Use `dist/dizygotic-rumble-chat-companion-v<version>-firefox.zip` for AMO signing/submission. The manifest includes a stable Gecko extension ID and declares that the extension does not collect/transmit data outside the extension as part of normal operation.

AMO is the recommended public update channel. If a self-hosted signed Firefox distribution is wanted later, add a controlled `browser_specific_settings.gecko.update_url` and publish the matching update manifest.

## Safari

Use `dist/dizygotic-rumble-chat-companion-v<version>-safari-source.zip` with Apple's Safari Web Extension Packager in App Store Connect, or run `scripts/package-safari.sh` on a Mac with Xcode. Apple packaging/signing requires the developer's Apple Developer account and bundle identifier.

Safari updates are delivered through the App Store/TestFlight release flow.

## Versioning

The canonical version is the userscript `@version` in:

`scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`

The browser-extension build reads that value and writes it into every manifest. Bump the userscript version once, rebuild, and every browser package moves together.
