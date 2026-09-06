# DizyChat private Android APK

DizyChat Android Slice 1 is a private, sideload-only Capacitor application. It bundles the existing DizyChat web client, uses the self-hosted production backend at `https://dizychat.com`, and is not distributed through Google Play.

The APK does not contain server credentials, MongoDB credentials, API keys, or signing passwords. Release signing material stays outside Git. Possession of the APK does not grant access: the DizyChat server remains the account and authorization authority.

## CI Android APKs

The repository workflow `.github/workflows/android-slice1-ci.yml` runs the deterministic test suite, synchronizes Capacitor, builds the existing debug package, and also builds a release package signed with the permanent DizyChat release identity.

Firebase configuration is reconstructed from `DIZYCHAT_GOOGLE_SERVICES_JSON_B64`. Release signing requires all four signing secrets and fails closed if any is missing:

```text
DIZYCHAT_RELEASE_KEYSTORE_B64
DIZYCHAT_KEY_ALIAS
DIZYCHAT_KEYSTORE_PASSWORD
DIZYCHAT_KEY_PASSWORD
```

The workflow reconstructs `google-services.json` and `dizychat-release.jks` only on the ephemeral GitHub Actions runner. The signing keystore and passwords are not committed to Git. The release APK is verified with Android `apksigner` before it is uploaded as the `dizychat-android-release-apk` Actions artifact. Producing this artifact does not publish the application to Google Play.

The existing `dizychat-android-debug-apk` artifact remains available for reproducible debug/build diagnostics; the debug build step does not receive the release signing passwords.

## Create a private release signing key

Create the release keystore once on a trusted operator machine. Keep it outside the repository, back it up securely, and do not send it to testers.

```bash
mkdir -p "$HOME/.dizychat"
keytool -genkeypair -v -keystore "$HOME/.dizychat/dizychat-release.jks" -alias dizychat -keyalg RSA -keysize 3072 -validity 10000
```

`keytool` prompts for the keystore/key passwords. Do not put those passwords in this document, source control, shell history, issue comments, build logs, or the APK. Supply them interactively or through the operator's secret store.

For CI, keep the original keystore backed up outside Git and store only its Base64 representation plus the alias/password values as encrypted GitHub Actions repository secrets. Losing the permanent private key would prevent future APKs signed with a different key from updating an installed release in place.

## Build a signed release APK locally

Export only the signing boundary expected by `android/app/build.gradle`:

```bash
export DIZYCHAT_KEYSTORE_PATH="$HOME/.dizychat/dizychat-release.jks"
export DIZYCHAT_KEY_ALIAS="dizychat"
export DIZYCHAT_KEYSTORE_PASSWORD
export DIZYCHAT_KEY_PASSWORD
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon)
```

Before distributing a local build, confirm all four variables are present in the build environment. The original release keystore and its passwords remain outside Git.

Expected signed APK:

```text
android/app/build/outputs/apk/release/app-release.apk
```

## Install or update a tester device

Enable Android's permission to install apps from the chosen sideload source, or use ADB from a trusted development machine:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

A device currently running a debug-signed `com.chat.dizychat` APK cannot normally update directly to the permanent release-signed APK because Android requires matching signing identities. For that one-time transition, uninstall the debug build, install the signed release APK, then sign in again. Future releases signed with the same permanent DizyChat key can update the release installation normally.

For CI testing, download `dizychat-android-release-apk` and extract `app-release.apk`. Do not treat a successful build or install as device acceptance by itself.

## Session and backend expectations

The production backend is exactly `https://dizychat.com`. A normal tester-facing server selector is not provided. The native session token is persisted through the Android Keystore-backed `SecureSession` boundary; the normal website keeps its existing tab-scoped `sessionStorage` behaviour.

Temporary DNS, server, or network failure must not erase the saved Android login. Explicit logout or a server-declared invalid/revoked session must clear the native stored session. Uploads continue to use the production `/upload` route and therefore remain behind the local ClamAV quarantine and scan gate.

## Real-device acceptance gate

Slice 1 is not complete until a real Android device proves all 14 checks against the self-hosted production backend:

1. Install the private APK.
2. Launch it and log in to an approved DizyChat account.
3. Join a room and exchange chat messages over `https://dizychat.com`.
4. Close/swipe away the app and reopen it without being forced to log in again.
5. Reboot the device, or otherwise confirm durable device-session restoration where practical.
6. Temporarily lose network connectivity and reconnect without losing login.
7. Select and upload a normal file.
8. Select and upload an image from the gallery.
9. Invoke camera/file-picker behaviour as supported by the device.
10. Confirm uploads reach the production `/upload` route and survive the ClamAV clean verdict.
11. Verify a rejected/malware upload remains rejected by the server gate and is not published.
12. Exercise Android Back through transient UI, chat view, and root state in that priority order.
13. Confirm genuinely external links leave the app through the Android browser while DizyChat-owned navigation remains in-app.
14. Explicitly log out, close/reopen the app, and confirm the cleared session is not restored.

Only after the deterministic suite, Android build gate, and these real-device checks pass should Slice 1 be treated as the tester APK baseline.

## Slice 2

Push notification delivery, notification tap routing, inline notification Reply, and Mark as read are intentionally deferred to Slice 2. Slice 1 provides the durable authenticated device-session foundation those actions will use; notification actions must still be authorized by the DizyChat server.
