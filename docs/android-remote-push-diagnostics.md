# Android remote FCM investigation

Status: the remote-delivery root cause is **not yet proven**. This change instruments the missing identity/delivery boundary; it does not claim a successful device delivery.

## Evidence

The signed release APK from head `8d2ea19305584d85f02dae8f64538b3bb820e8e0`, Android run `35464734941`, artifact `10591185029`, contains:

| Resource | Value |
| --- | --- |
| Package | `com.chat.dizychat` |
| `project_id` | `dizychat` |
| `gcm_defaultSenderId` | `682852424815` |
| `google_app_id` | `1:682852424815:android:3cc9ecb23d8ea455d5c19a` |

These values were read from the APK resource table, not inferred from project/package checks. CI now checks the full source identity and generated release resources and uploads only these public identifiers.

The server baseline `4bdfb77aba9626a0e3041bdd63229bff9c9157f9` and working head have identical `src/push` and `public/mobile-push-runtime.js` content. Commit `0f1f00321387df0d40cc911f67a6e088d40d766d` logs the incoming registration fingerprint, but its deployment has not been established. This branch logs the persisted registration token and the exact transport token plus Firebase's returned message ID.

The Android plugin obtains tokens from the default Firebase app, passes them to the native JS bridge, and posts to `/api/mobile/push/register`. Server normalization trims tokens. Registration disables prior uses of the same token and upserts by session/device. Cleared app data creates a new device/session identity; the previous token can remain eligible until retired. Two successful sends therefore do not establish either target is the current phone.

Normal messages currently contain notification + data with proxy allowed. In the background, Firebase can display these without calling the custom service callback. This also bypasses the app's custom action renderer. This is a known payload limitation, **not proof of the reported total delivery failure**, since earlier data-only tests also failed. Normal payloads, rendering, channels, actions, and token refresh behavior are unchanged in this diagnostic change.

Reference: https://firebase.google.com/docs/cloud-messaging/android/receive-messages

## Device capture (PowerShell)

Use the signed APK from the new branch CI run, not the GitHub release APK. Install over the existing app; do not clear data or uninstall. Set `$apk` to the extracted downloaded APK path.

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = "XPH5T19426002781"
$apk = "$env:USERPROFILE\Downloads\dizychat-v1.apk"
& $adb -s $phone install -r $apk
& $adb -s $phone shell setprop log.tag.FirebaseMessaging VERBOSE
& $adb -s $phone shell setprop log.tag.FirebaseInstallations VERBOSE
& $adb -s $phone logcat -v threadtime 'DizyPushTrace:I' 'FirebaseMessaging:V' 'FirebaseInstallations:V' 'FirebaseMessagingReceiver:V' 'FcmBroadcastProcessor:V' 'AndroidRuntime:E' '*:S' | Tee-Object -FilePath "$env:USERPROFILE\Desktop\dizychat-push-trace.txt"
```

Keep capture running. Open DizyChat, sign in if needed, and join ShittyChat. Record the most recent `getToken-success tokenFingerprint=...` and `firebase-identity` lines. If `onNewToken` later reports a different fingerprint, use the new value. Only share the filtered capture; no raw token/credentials are needed.

## Server probe without deploying this branch

The probe uses the existing Firebase Admin factory and existing registration/session/account models. It opens no listener, disables Mongoose automatic collection/index creation, and does not write the DB or rotate tokens. Without `--send` it only reads configuration/registrations and requests public project metadata. `--send` explicitly sends one diagnostic message to the single matching active token; it bypasses chat subscription/read/presence policy to isolate remote delivery.

Run in the same working directory, service account/container, environment, and mounted credentials as the running DizyChat process. Running an arbitrary login shell may have different environment variables; that would not prove the live server's identity. Do not print environment variables or credential files.

From the current server repository, fetch the fix branch and create a separate worktree (record the exact tested commit before running):

```bash
git fetch origin fix/android-notification-channel-bootstrap
git worktree add --detach ../dizychat-push-probe origin/fix/android-notification-channel-bootstrap
ln -s "$PWD/node_modules" ../dizychat-push-probe/node_modules
node ../dizychat-push-probe/scripts/diagnose-android-push.js --account Dizygotic
```

Remain in the live server's working directory so `.env` and relative credential paths resolve as they do for the service. If the service uses a different env-file path, supply `DOTENV_CONFIG_PATH` with that path. The isolated worktree must use the same installed dependency versions as the live process. None of these commands change the running checkout or restart/deploy the server.

Compare `registered-db.tokenFingerprint` to the phone. The old and fresh registrations are reported separately, without raw tokens. `credential-identity` prints only credential type, project ID and a hash of the principal. `admin-identity` prints the actual resolved target project. `project-number` should return `dizychat` / `682852424815`; a permission error here is inconclusive, not proof of a mismatch. Cross-project service accounts can legitimately send when authorized.

With the app **foregrounded** and device capture active, replace the example fingerprint with the phone's latest 12-character value:

```bash
node ../dizychat-push-probe/scripts/diagnose-android-push.js --account Dizygotic --fingerprint PHONE_FINGERPRINT --send
```

Repeat once after pressing Home (do not force-stop). Each probe uses a distinct valid message ID and 60-second TTL, data only, high priority, and an explicit package restriction. Expect the existing full native notification headed “DizyChat FCM test”. Dismiss the synthetic diagnostic notification; it is not a stored chat message, so do not test Reply/tap against it.

The acceptance ID is `projects/<project>/messages/<FCM-ID>`. Compare its final FCM-ID with the phone's `onMessageReceived id=...`. The safe `messageId` also identifies each probe attempt in server output.

| Result | Conclusion / next boundary |
| --- | --- |
| Phone fingerprint absent from active DB registrations | Registration/lifecycle mismatch proven; do not investigate rendering. |
| Sender/project identity differs | Firebase configuration mismatch; correct only the identified configuration. |
| Send rejected | Exact Firebase error code identifies send/auth/token failure. |
| Matching token + accepted ID + no foreground callback | Failure is before custom message handling, in FCM/Play-services delivery to this installation. Current notification rendering and chat suppression cannot explain this probe. |
| Foreground arrives; background does not | Background delivery boundary isolated; retain SDK logs for that exact accepted ID. |
| Both probes arrive, normal message does not | Compare normal dispatch token fingerprints/policy and its notification payload behavior. |
| Callback arrives and logs a drop reason | Required data or native post-receive validation is the failing boundary. |

## Deployment and remaining gate

No server deployment is required for the isolated probe. Normal-message `[PushTrace] registered/send-attempt/send-accepted` logs require the server changes from this branch to be deployed separately, **after review/authorization**; no deployment is performed here. Do not deploy the whole branch merely to run the probe. The older `0f1f003` diagnostic alone does not log actual send IDs.

Only after remote probes reach the phone should ordinary ShittyChat messages be checked with the recipient backgrounded and another account sending (wait at least 90 seconds for any presence lease to expire). Validate real notification actions using real stored messages. A green build establishes compilation/tests/signing, not real FCM delivery.

## Exact changed files

- `.github/workflows/android-slice1-ci.yml`
- `android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java`
- `android/app/src/main/java/com/chat/dizychat/DizyPushFingerprint.java`
- `android/app/src/main/java/com/chat/dizychat/DizyPushPlugin.java`
- `android/app/src/main/java/com/chat/dizychat/DizyPushTrace.java`
- `android/app/src/test/java/com/chat/dizychat/DizyPushFingerprintTest.java`
- `src/push/fcm-config.js`
- `src/push/fcm-diagnostics.js`
- `src/push/push-device-service.js`
- `src/push/transports/fcm-transport.js`
- `scripts/diagnose-android-push.js`
- `scripts/verify-firebase-identity.js`
- `tests/push/fcm-diagnostics.test.js`
- `tests/push/fcm-probe.test.js`
- `tests/push/firebase-build-identity.test.js`
- `tests/push/push-device-service.test.js`
- `docs/android-remote-push-diagnostics.md`
