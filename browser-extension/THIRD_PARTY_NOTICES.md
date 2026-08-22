# Third-party notices

The browser-extension build bundles two libraries that the Tampermonkey edition loads remotely:

- **compromise 14.7.0** — MIT License — https://github.com/spencermountain/compromise
- **RiTa 2.0.2** — GPL-3.0 — https://github.com/dhowe/ritajs

Manifest V3 store packages cannot execute remotely hosted JavaScript, so these libraries are copied into the extension package at build time instead of being loaded from a CDN.

Before publishing a store build that bundles RiTa, review the GPL-3.0 obligations for the combined distribution and include the applicable license text/source offer as required. If you do not want the browser-extension distribution to carry GPL obligations, remove the RiTa vendor file and disable the `rita` burn-engine option in the extension build before public release.
