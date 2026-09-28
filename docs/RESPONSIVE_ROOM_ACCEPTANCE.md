# DizyChat responsive room acceptance (28 September 2026)

The existing single-phone mobile-shell test checks the 360×640 chat stack. This new **isolated CI** acceptance test exercises four representative viewports: 360×740 phone portrait, 740×360 phone landscape, 768×1024 tablet and 1280×800 desktop.

For each viewport it checks landing overflow, locked guest/registered separation, public persistent DIZY admission, the chat header/message/composer geometry, chat-page horizontal overflow, a usable input and return to the guest lobby. It fails on uncaught page errors and collects no screenshots or private account data.

This is Chromium-only: an Android 10 WebView, iOS Safari/Home Screen installed mode, virtual keyboard, actual device safe areas, LiveKit, notifications, upload permissions and production credentials remain separate manual/device checks. Passing this test does **not** prove those behaviours.

Tracking: [full UI/CSS audit #485](https://github.com/DizygoticCode/dizychat-server/issues/485). No production deploy or APK update is performed by CI.
