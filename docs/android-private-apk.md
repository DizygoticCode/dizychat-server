# DizyChat Android APK

DizyChat's Android client is a signed, sideload-only Capacitor/native application for DizyChat users and testers. It is not distributed through Google Play.

The current architecture is a **thin native shell plus a server-managed web bundle**. The APK contains the permanent Android/native layer, while the DizyChat HTML/CSS/JS bundle is published by the production server and retrieved by the app after launch.

The production backend is exactly:

```text
https://dizychat.com
```

Possessing the APK does not bypass DizyChat account or room authorization. MongoDB credentials, server API keys, Firebase server credentials, LiveKit secrets and Android release-signing passwords are not embedded in the APK.

## Current tester release

Release page asset:

```text
https://github.com/DizygoticCode/dizychat-server/releases/download/v1.0.0/dizychat-v1.apk
```

Verified current release APK:

```text
File:    dizychat-v1.apk
Size:    3,951,226 bytes
SHA-256: 26c47392baab81b2c5dee8dfc976c1c23fbba03769c41c102cbd755c75d0ab35
Package: com.chat.dizychat
```

This APK is the current native baseline. Server-managed DizyChat frontend changes do **not** require replacing the APK unless the native Android shell itself changes.

## Thin-shell / server-managed bundle architecture

The Android app is deliberately split into two layers.

### Native shell
The APK owns the pieces that must remain native or signed with the permanent Android identity:

- Capacitor bootstrap and `MainActivity`
- secure durable mobile session storage
- Firebase/FCM device registration and message handling
- Android notification rendering and actions
- notification tap routing back into DizyChat rooms
- inline notification **Reply** and **Mark as read** actions
- native back/navigation and permission boundaries
- native relative-media URL handling
- the server-managed bundle downloader/verifier/store

The minimal bootstrap web shell is under `android-shell/`; the native implementation is under `android/`.

### Server-managed web bundle
The production DizyChat server exposes a manifest plus the declared frontend assets from `public/`. The Android updater:

1. fetches the current bundle manifest from the configured DizyChat backend;
2. downloads only the declared bundle assets;
3. validates the manifest/asset paths and SHA-256 hashes;
4. promotes the new bundle only after verification succeeds; and
5. preserves a previously verified local bundle as the last-known-good fallback.

A partial, malformed or failed update must not replace the last-known-good bundle or create a permanent reload/update loop.

This design is why normal DizyChat web/UI changes can be deployed from the server without shipping another APK. A new APK is required when Java/native code, AndroidManifest settings, Capacitor/native plugins, signing identity or another native boundary changes.

## Native media URL behaviour

A normal browser resolves relative media paths such as `/uploads/...`, `/soundboards/...`, custom emoji/GIF assets and notification audio against the browser's current origin.

Inside the Capacitor Android shell, the page itself runs from a local native origin. DizyChat therefore resolves relevant relative DOM media sources against the configured production backend instead of incorrectly requesting them from `https://localhost`.

This native-aware boundary covers uploaded images/audio/video, soundboard audio, custom emoji/GIF assets and DizyChat notification audio while preserving ordinary browser-origin behaviour outside Capacitor.

## Durable Android session

The Android client persists its authenticated device session through the native `SecureSession` boundary rather than relying only on browser `sessionStorage`.

Expected behaviour:

- closing/swiping away and reopening the app should normally restore the valid mobile session;
- temporary DNS/server/network failure must not erase a still-valid stored login;
- explicit logout clears the native stored session; and
- a server-declared invalid or revoked session clears the stored native session.

The normal website retains its browser/session behaviour; the native durable-session contract is Android-specific.

## Android push notifications

Android push is no longer a deferred slice. The current native app includes the notification stack and FCM client boundary.

Current behaviour includes:

- room/message push delivery through FCM when the production push transport is enabled;
- notification permission handling on Android versions that require it;
- room-aware grouped/message-style notifications;
- tapping a notification routes back into the relevant DizyChat room/message context;
- inline **Reply** using Android `RemoteInput` where supported;
- **Mark as read** from the notification where supported; and
- per-room unread/read reconciliation so stale or out-of-order controls do not clear unrelated state.

The Android app also retains the normal in-app DizyChat notification-sound toggle. Relative notification audio is resolved against the production backend inside the native shell.

## LiveKit calls and Music Mode

LiveKit remains a server/web-managed DizyChat feature and therefore does not require a new APK for ordinary call-UI or publish-setting changes.

The Android app can join the same DizyChat LiveKit rooms as browser users. Current call behaviour supports normal voice mode plus the explicit per-connection **Music Mode** choice.

Normal mode enables browser voice processing. Music Mode requests:

```text
48 kHz capture
stereo
510 kb/s Opus target/max
echo cancellation off
noise suppression off
automatic gain control off
DTX off
RED off
force stereo on
```

The Music Mode choice is made before joining, locked while joining/connected, and reset after disconnect. The web client inspects the resulting capture settings and fails closed rather than knowingly publishing a Music Mode track if browser voice processing remains enabled after strict constraints are reapplied.

`510 kb/s` is the requested application target/max, not a guarantee that every WebRTC session will transmit exactly that bitrate.

## CI release APKs

The repository workflow `.github/workflows/android-slice1-ci.yml` runs the deterministic test gate, prepares/synchronizes the Android project, builds the debug package and builds the release package signed with the permanent DizyChat release identity.

Firebase client configuration is reconstructed in CI from:

```text
DIZYCHAT_GOOGLE_SERVICES_JSON_B64
```

Release signing requires all four signing secrets and fails closed if any are missing:

```text
DIZYCHAT_RELEASE_KEYSTORE_B64
DIZYCHAT_KEY_ALIAS
DIZYCHAT_KEYSTORE_PASSWORD
DIZYCHAT_KEY_PASSWORD
```

The workflow reconstructs `google-services.json` and `dizychat-release.jks` only on the ephemeral GitHub Actions runner. The release keystore and passwords are not committed to Git.

Gradle produces the release package as:

```text
android/app/build/outputs/apk/release/dizychat-v1.apk
```

CI verifies that APK with Android `apksigner` before uploading the release artifact. Producing the artifact does not publish the app to Google Play.

The debug artifact remains useful for reproducible build/native diagnostics but is signed with the debug identity, not the permanent release key.

## Create and protect the permanent release key

Create the release keystore once on a trusted operator machine, keep it outside the repository and back it up securely:

```bash
mkdir -p "$HOME/.dizychat"
keytool -genkeypair -v \
  -keystore "$HOME/.dizychat/dizychat-release.jks" \
  -alias dizychat \
  -keyalg RSA \
  -keysize 3072 \
  -validity 10000
```

Do not put the keystore or its passwords in source control, issue/PR comments, build logs or tester downloads. Losing the permanent private key would prevent a differently signed future APK from updating an existing release installation in place.

## Build a signed release locally

Export only the signing boundary expected by `android/app/build.gradle`:

```bash
export DIZYCHAT_KEYSTORE_PATH="$HOME/.dizychat/dizychat-release.jks"
export DIZYCHAT_KEY_ALIAS="dizychat"
export DIZYCHAT_KEYSTORE_PASSWORD
export DIZYCHAT_KEY_PASSWORD
npm run android:prepare
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon)
```

Expected output:

```text
android/app/build/outputs/apk/release/dizychat-v1.apk
```

Verify the package/signature before distributing any locally built release.

## Install or update a tester device

For ordinary sideloading, download the release APK on the Android device and open it.

Google Play Protect may offer to scan the unknown/sideloaded app. On the current tested install flow, choosing **Scan** is the simplest path: the scan completes, Play Protect reports its result and Android continues to the normal install screen. Avoid deliberately taking a skip-scan / additional-options route merely to bypass the prompt; that alternate path is not required for the current signed release.

ADB from a trusted development machine remains available:

```bash
adb install -r android/app/build/outputs/apk/release/dizychat-v1.apk
```

A device running a debug-signed `com.chat.dizychat` build cannot normally update directly to the permanent release-signed APK because Android requires matching signing identities. For that one-time transition, uninstall the debug build, install the release APK and sign in again. Future releases signed with the same permanent DizyChat key can update the existing release installation normally.

## Current real-device acceptance gate

A build should not be treated as a new Android baseline solely because CI produced an APK. For a native-shell release, exercise the relevant real-device boundary against production:

1. Install the signed APK and allow the Play Protect scan if offered.
2. Cold-launch the app and confirm the verified server-managed frontend boots without a blank/localhost page.
3. Register/sign in and confirm the account/session behaves normally.
4. Create/join a room and exchange two-way text messages.
5. Close/swipe away and reopen the app; confirm the registered session persists.
6. Exercise Android Back through transient UI, chat view and root state.
7. Send/render custom emoji and GIFs.
8. Upload/display an image and verify uploaded media resolves from the real DizyChat backend.
9. Record/play a voice message and exercise other audio/video media where practical.
10. Play soundboard audio and verify native relative media does not resolve to `https://localhost`.
11. Enable/check the DizyChat notification sound.
12. Exercise background push delivery, notification tap routing and room return.
13. Exercise inline **Reply** and **Mark as read** when Android exposes those actions.
14. Join a LiveKit call in normal voice mode and verify microphone/listening behaviour.
15. Disconnect, choose **Music Mode**, rejoin and verify the mode choice locks during the call and resets after disconnect.
16. Where practical, test two devices/users in the same LiveKit room with one in normal voice mode and one in Music Mode.
17. Temporarily lose network connectivity and reconnect without erasing a valid stored login.
18. Explicitly log out, close/reopen and confirm the cleared session is not restored.

Web-bundle-only server deployments do not require repeating an APK signing/release ceremony, but the changed web feature should still receive appropriate browser/native runtime QA.

## Rebuild boundary

**No APK rebuild normally required:**

- DizyChat HTML/CSS/JS changes in the server-managed frontend
- custom emoji/GIF catalog/assets
- ordinary UI changes
- LiveKit Music Mode web publish/capture changes
- other frontend fixes delivered through the verified bundle

**APK rebuild required:**

- Java/Kotlin/native Android changes
- AndroidManifest or permission changes
- native Capacitor plugin changes
- Firebase client/native configuration that must be packaged
- release signing/package changes
- native bundle-updater/bootstrap changes

Keeping that boundary explicit is the point of the current thin-shell architecture: frontend iteration stays server-managed while the signed native layer remains small and stable.
