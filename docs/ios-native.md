# DizyChat native iOS path

DizyChat has a reproducible Capacitor iOS native build path alongside the existing Android client and iPhone/iPad Home Screen web app.

The native iOS work is **build-ready but not yet distributed as a signed IPA**. The current user-facing iPhone/iPad install remains the Safari **Add to Home Screen** flow. Native distribution can be enabled later without redesigning the app architecture.

## Current native identity

```text
App name:   DizyChat
Bundle ID:  com.chat.dizychat
Capacitor:  7.4.4
Minimum iOS target: 15.0
Firebase Apple SDK / Messaging: 12.19.0
```

The Xcode project is generated in CI rather than kept as a large checked-in generated tree. Tracked Swift/native sources live under `ios-native/`, and the preparation scripts patch those sources and required configuration into the generated Capacitor project.

## Build pipeline

The workflow is:

```text
.github/workflows/ios-capacitor-ci.yml
```

It:

1. installs the locked Node dependencies;
2. runs the deterministic Node test gate;
3. prepares the packaged mobile shell assets;
4. installs the matching `@capacitor/ios@7.4.4` platform without rewriting the repository lockfile;
5. generates the Capacitor iOS project;
6. prepares Firebase Messaging dependencies;
7. synchronizes Capacitor;
8. optionally provisions and validates the Firebase iOS config;
9. injects the DizyChat native Swift bridge;
10. compiles an unsigned iOS Simulator target;
11. compiles an unsigned physical-device `iphoneos` target with code signing disabled; and
12. uploads the generated iOS project as a short-lived CI artifact.

The unsigned device build is a compile/architecture validation. It is **not** an installable tester IPA.

## Native bridge

The generated iOS target uses the tracked native sources under `ios-native/` plus preparation logic in:

```text
scripts/prepare-ios-native.js
scripts/prepare-ios-firebase.js
```

The current native boundary includes:

- Keychain-backed DizyChat session persistence;
- native external-link handling;
- iOS camera/microphone permission descriptions and WKWebView-native media handling;
- the DizyChat verified server-managed web-bundle updater;
- Firebase Messaging/APNs registration;
- FCM token rotation handling;
- tap-to-open notification routing;
- notification **Reply**;
- notification **Mark as read**;
- background read-control reconciliation; and
- cold-launch notification routing.

The server stores the native device platform as either `android` or `ios`, while both native clients continue to use the server-side Firebase transport.

## Verified web-bundle model

The iOS native path mirrors the Android safety boundary rather than loading arbitrary remote JavaScript directly.

The updater:

- requires the configured backend to use HTTPS;
- downloads the DizyChat mobile-web manifest;
- accepts only the fixed declared frontend allowlist;
- enforces file and total-size limits;
- verifies SHA-256 for every downloaded asset;
- activates a bundle only after full verification;
- records the healthy bundle after the web client marks it healthy; and
- falls back to the last verified healthy bundle if an update fails.

Normal DizyChat HTML/CSS/JS changes therefore remain server-managed. A future signed iOS package only needs replacement when the native iOS boundary itself changes.

## Firebase iOS configuration

The repository does **not** commit `GoogleService-Info.plist`.

CI optionally reads this secret:

```text
DIZYCHAT_GOOGLE_SERVICE_INFO_PLIST_B64
```

When supplied, the workflow decodes the plist into the generated Xcode project and verifies:

```text
PROJECT_ID = dizychat
BUNDLE_ID  = com.chat.dizychat
```

The plist is excluded from the uploaded generated-project artifact.

The Firebase project also needs Apple push configuration before real iPhone push can work. The intended production path is:

```text
DizyChat server
    -> Firebase Admin / FCM
    -> Firebase Messaging on iOS
    -> APNs
    -> iPhone
```

Do not commit Apple APNs auth keys, Firebase service-account credentials, provisioning profiles or signing certificates.

## APNs and FCM sequencing

On iOS, DizyChat requests notification permission and remote-notification registration before treating the FCM registration as ready.

The native bridge waits for the APNs device token to be available before requesting the final Firebase registration token. This avoids racing FCM registration ahead of APNs association.

Firebase token rotation is surfaced back through the native bridge so the web/mobile runtime can refresh the server registration.

## Notification actions and reconciliation

Native iOS message notifications use the `DIZYCHAT_MESSAGE` category.

Supported actions include:

- tap the notification to route into the relevant room/message;
- **Reply** using an iOS text-input notification action; and
- **Mark as read** using the existing authenticated DizyChat read-state endpoint.

Background `read-control` pushes can clear already-delivered room notifications. Apple may delay or suppress background delivery, so foreground/reopen reconciliation remains authoritative and must still catch up when the app becomes active.

Cold-launch routing is also persisted from the AppDelegate launch notification so a notification can route correctly even when DizyChat was not already running.

## Current distribution boundary

No paid Apple Developer membership is needed for the current unsigned CI compile validation.

A properly installable tester/release IPA requires Apple-side signing and provisioning. At that point the remaining setup includes:

- an Apple Developer Program membership for normal external distribution;
- an Apple App ID / signing identity for `com.chat.dizychat`;
- a provisioning/distribution route such as TestFlight or registered-device distribution;
- Firebase iOS app configuration; and
- an APNs authentication key configured in Firebase.

Until that is worth maintaining, the iPhone/iPad Home Screen web app remains the supported zero-cost install path.

## Security boundary

Never commit:

- `GoogleService-Info.plist`;
- APNs `.p8` keys;
- `.p12` signing identities;
- `.mobileprovision` profiles;
- Apple signing passwords;
- Firebase service-account material; or
- generated signed IPA archives.

Keep the native bundle ID and public source code in Git; keep credentials and private signing material in protected Apple/Firebase/GitHub configuration.
