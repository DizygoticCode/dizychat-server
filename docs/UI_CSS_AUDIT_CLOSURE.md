# DizyChat UI/CSS audit automated closure — 30 September 2026

Tracking: [#485](https://github.com/DizygoticCode/dizychat-server/issues/485).

## Repository-side coverage completed

The existing self-host CI covers guest and registered navigation, persistent DIZY admission, Recent Rooms, the fixed mobile chat shell, phone portrait/landscape, tablet and desktop geometry, account/guest privacy, LiveKit join/share regression, and the deterministic server suite. Separate tests cover inline-media generation, Facebook/Rumble handling, link-preview admission/queue/SSRF safety, local and web soundboard behavior, native relative-media URLs, Android notifications/push reconciliation, uploads and voice-message compatibility.

The final automated #485 slice adds real browser interaction for the remaining layout-heavy surfaces: a long unbroken chat message, emoji picker, mocked GIPHY picker, mocked local soundboard picker with a deliberately long clip title, and an actual inline image preview opened in the media lightbox. It runs at phone portrait and desktop widths against the isolated loopback fixture server and fails on page-level horizontal overflow, clipped panels/lightboxes or uncaught browser exceptions.

All browser fixtures are hard-gated to loopback. They must never be pointed at the public DizyChat deployment or populated with production accounts/private conversations.

## Human/device acceptance still required

CI cannot prove physical Android/iOS behavior or external service delivery. Before closing #485, check on the target Android device and iOS/PWA device where available: software-keyboard resize and safe areas; background/resume FCM or Web Push delivery; inline Reply/Mark read; camera/microphone/file permission prompts; real voice/photo/video upload/playback; LiveKit audio/video/screen share; DizyJam/Music Mode; Watch Party; and installed PWA/native app resume/disconnect cleanup.

Use a safe test room. Do not reset host-local soundboards or replace the production APK merely to complete this checklist.
