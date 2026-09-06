# Android Slice 2 PR B Design

## Goal

Complete the Android/client half of DizyChat Slice 2 on top of PR A without duplicating server authority or changing browser notification behaviour.

Base: `36ae44767bc66d3b09eef2855d980f27f8b166ba`.

## Scope

PR B owns native Android push registration, room-presence wiring, notification rendering, tap routing, inline Reply, Mark as read, token rotation handling, and deterministic regressions. It does not replace the shared DizyChat web UI, add a second chat persistence model, or commit Firebase/server credentials.

## Architecture

### Web runtime

Add a focused `public/mobile-push-runtime.js` loaded by the normal chat page. It is inert in browsers and activates only when Capacitor reports a native platform.

The runtime:

- obtains a stable per-install `deviceId` from the native plugin;
- obtains the current FCM token and registers `{ deviceId, token, platform: "android" }` against `/api/mobile/push/register` using the existing mobile bearer session;
- asks for Android notification permission only after the first successful room admission;
- supplies `deviceId` on native room joins so PR A can create the exact session/device/room subscription;
- renews `/api/mobile/push/presence` only while the app is foreground and the screen is on, and clears the lease otherwise;
- consumes native notification routes and tells the existing chat client to open the originating room/message;
- re-registers when the native layer reports FCM token rotation;
- clears native push state on explicit account logout/revocation.

Browser mode must remain unchanged and must never create a device registration or suppression lease.

### Native Android boundary

Add one Capacitor `DizyPush` plugin plus small supporting Android classes. The native boundary is responsible only for device-specific work:

- stable installation UUID in private SharedPreferences;
- current FCM token lookup and token-rotation event delivery;
- persisted backend origin supplied by the web runtime from existing DizyChat configuration;
- POST_NOTIFICATIONS permission state/request;
- screen-on state;
- data-only FCM message rendering;
- one updating notification per room;
- notification tap route storage/event delivery;
- inline Reply via Android RemoteInput;
- Mark as read action;
- authenticated background HTTP actions using the existing AndroidKeyStore-protected mobile bearer token.

The existing `SecureSessionPlugin` storage is factored through a package-private secure-session store so both the plugin and background action worker read the same encrypted token. No token is written in plaintext.

### Notification payload

PR A already sends data-only keys: `room`, `messageId`, `sender`, `preview`, `notificationKey`, and `timestamp`. PR B must render from those keys only. The native layer must not trust notification data for account identity or authorization.

### Background actions

Mark as read POSTs the notification room/message to the existing authenticated `/api/read-state/mark` endpoint, then cancels that room notification only after a successful response.

Reply POSTs to one narrow authenticated mobile action endpoint added in PR B. The endpoint requires a mobile bearer session and persists through the same canonical message validation/persistence/broadcast/push path used by ordinary chat messages. It accepts only room, text, and optional reply target message id; username/account identity always comes from the authenticated mobile session.

### Tap routing

A notification tap launches/reuses `MainActivity` and publishes `{ room, messageId }` through `DizyPush`. Cold-start routes are retained until consumed. The web client performs the actual room navigation and exact-message focus using existing registered-account admission/UI functions.

### Credentials/configuration

`google-services.json` remains external to Git. Firebase Admin credentials remain server-only. Native background HTTP uses an origin supplied at runtime from the same DizyChat app/backend configuration already used by the Capacitor shell; no second production URL is hard-coded into Java.

## Error handling

- Missing/invalid mobile bearer: do not register, reply, or mark read; keep the notification for user recovery.
- Failed device registration/token refresh: retry on the next foreground/session/room transition; never weaken auth.
- Failed background reply/read request: keep the room notification and surface no false success.
- Permanent FCM token invalidation remains server-authoritative through PR A.
- Browser runtime errors cannot activate native-only behaviour.

## Testing

Deterministic Node tests must prove:

1. browser mode is inert;
2. native registration uses the exact mobile bearer and stable device id;
3. notification permission is requested only after successful room admission;
4. foreground + screen-on renews only the device-local suppression lease; background/screen-off clears it;
5. token rotation re-registers the same device;
6. explicit leave preserves PR A exact-device unsubscribe semantics and disconnect does not unsubscribe;
7. native source declares one-per-room notification identity, tap route, RemoteInput Reply, and Mark as read actions;
8. background actions use the encrypted secure-session token and configured backend origin;
9. mobile reply endpoint derives account identity from auth and feeds the canonical chat persistence/broadcast/push path;
10. no Firebase/server credentials or hard-coded duplicate production backend are introduced.

Full gate: deterministic suite, Android asset prepare, `cap sync android`, unsigned debug APK build, and Self-Host/browser regressions. PR remains draft and unmerged until exact-head green.
