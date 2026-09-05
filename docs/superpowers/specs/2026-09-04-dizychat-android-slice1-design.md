# DizyChat Android Slice 1 Design

## Status

Approved in chat on 2026-09-04.

This spec covers the first Android delivery slice only: a private, sideloaded DizyChat APK that reuses the existing Capacitor/web client and connects directly to the self-hosted production service at `https://dizychat.com`.

Push notifications, inline notification reply, and mark-as-read notification actions are explicitly deferred to Slice 2.

## Goals

Slice 1 must produce a signed Android APK that selected testers can install directly without Google Play. The app must behave like a durable messaging client rather than a temporary browser tab:

- production backend is `https://dizychat.com`
- login remains valid across app close/reopen and device reboot until explicit logout or server-side revocation
- Socket.IO chat, rooms, messages, uploads, camera/gallery/file selection, and media continue to use the existing DizyChat backend contracts
- uploads continue through `/upload` and therefore through the local ClamAV quarantine/scan gate already deployed on `dizyserver`
- Android back navigation behaves predictably and does not accidentally exit the app while the user is inside chat UI
- external links open safely outside the app when appropriate
- temporary network loss reconnects without clearing the authenticated device session
- the existing normal website keeps its current browser-session behaviour

## Non-goals

Slice 1 does not add:

- Google Play distribution
- public mobile registration or any bypass around the server-side account model
- push notification delivery
- notification tap routing, inline reply, or mark-as-read actions
- iOS native packaging
- a Kotlin rewrite of the chat client
- a second backend or any Render dependency

The iPhone path remains a private home-screen/PWA route for now because there is no paid Apple Developer account.

## Existing foundation

The repository already contains a Capacitor Android application with app ID `com.chat.dizychat`, app name `DizyChat`, and `webDir` set to `public`. The Android `MainActivity` is a standard Capacitor `BridgeActivity`.

The web client already has native-origin Socket.IO handling. `public/app-config.js` provides `https://dizychat.com` as the default native Socket.IO URL and supports a local-storage override key for development builds.

The current account token storage is browser-tab scoped through `sessionStorage`. That is correct for the website but is not sufficient for a mobile app that must remain logged in after the WebView process is closed.

## Chosen architecture

### Shared Capacitor client

The Android app will keep using the existing `public/` DizyChat HTML/CSS/JavaScript client bundled into the APK. The application will not load the live website as its primary UI and will not duplicate chat logic in Kotlin.

Capacitor is the native shell. The web client remains the source of truth for chat UX, while a small native/mobile bridge handles the device-specific concerns that a browser tab cannot provide cleanly.

### Production backend resolution

When the client runs from a native origin such as `capacitor://localhost`, all live backend traffic must resolve to the self-hosted DizyChat origin:

`https://dizychat.com`

This includes:

- Socket.IO
- account login/session validation/logout requests
- room and message HTTP requests
- file uploads
- any other relative API calls that currently assume a normal HTTP page origin

The web build continues to use same-origin relative requests.

A debug-only override may point a developer build at a local server such as `https://dizyserver.lan`. The production default remains fixed to `https://dizychat.com`, and no normal tester-facing server selector is added.

The server remains the access authority. Possession or forwarding of the APK does not grant a DizyChat account or extra permissions.

## Mobile transport boundary

A small shared client helper will provide a canonical API-base resolver.

Conceptually:

- normal browser origin -> empty base / same-origin requests
- Capacitor or file-like origin -> `https://dizychat.com`
- explicit developer override, when enabled -> validated HTTPS/HTTP development origin

Socket.IO and ordinary HTTP/upload calls must use the same resolved backend decision so the native app cannot accidentally connect chat sockets to one server while sending uploads or account requests to another.

Invalid overrides are ignored rather than passed through blindly.

## Persistent Android session

### Requirement

A successful account login on Android must survive:

- app backgrounding
- process death
- app swipe-away
- device reboot

The user remains signed in until one of these events occurs:

- explicit logout
- the server revokes or invalidates the session
- the account is otherwise no longer authorized

Loss of connectivity must not itself clear the stored session.

### Storage boundary

The normal website will keep its existing `sessionStorage` token semantics.

Under Capacitor Android, the account token will be persisted through an Android Keystore-backed secure-storage boundary rather than plain long-lived browser storage. The web client will read and write the session through an adapter with two implementations:

- browser adapter -> existing `sessionStorage`
- Android adapter -> secure native storage backed by Android Keystore

The chat/auth code should depend on the adapter contract rather than knowing which storage backend is in use.

The adapter must support:

- `readToken()`
- `writeToken(token)`
- `clearToken()`

Native token restoration happens before authenticated reconnect/login restoration is considered complete.

### Session validation

On app startup with a stored token, the client should attempt normal server-side session validation/identity restoration. A valid token restores the signed-in state and Socket.IO auth. A server-declared invalid/revoked token clears the secure stored token and returns the user to the login state.

A transport failure or temporary server outage is different from invalid authentication: retain the stored token and present disconnected/reconnecting behaviour.

## Socket.IO behaviour

The existing Socket.IO connection remains the live chat transport.

On Android:

- use the canonical native backend origin
- attach the restored account session token to Socket.IO auth when available
- after login, update `socket.auth` and reconnect/authenticate using the new token as required by the existing client contract
- after logout/revocation, remove the token from Socket.IO auth
- network transitions should allow normal Socket.IO reconnection without forcing login

No separate mobile messaging protocol is introduced.

## Uploads and device file selection

The existing DizyChat upload contract remains unchanged.

Android camera, gallery, and file selections ultimately POST to the same production `/upload` route on `https://dizychat.com`.

That preserves the already-deployed security flow:

1. file arrives in private upload quarantine on `dizyserver`
2. local ClamAV scans it
3. clean file is promoted to the persistent upload store
4. malware is rejected and never published

Slice 1 must not reintroduce the old strict MIME/signature matrix that previously broke legitimate mobile uploads. ClamAV remains the malware verdict authority while the server-generated stored filename/path safety remains in place.

Android permissions should be requested only when required by the selected camera/media/file interaction, following the platform picker behaviour where possible rather than demanding broad storage access at startup.

## Android navigation and lifecycle

Back-button handling should consume the most local UI state first.

Priority order:

1. close an open modal/menu/emoji panel/sidebar or equivalent transient layer
2. if viewing a chat, return to the DizyChat landing/join state
3. at the root/landing state, allow the app to background/exit according to normal Android behaviour

The implementation must avoid closing the app from a single back press while the user is editing or interacting with chat UI.

App pause/resume must not clear account state. Returning to the foreground should allow Socket.IO to reconnect and resume the current authenticated state.

## External links and media

DizyChat-owned navigation and media should stay inside the app when that is the intended application flow.

Genuinely external web destinations should open through the Android browser rather than replacing the bundled application UI with an arbitrary site inside the primary WebView.

The implementation should use an explicit allowlist/host decision rather than treating every `http(s)` URL identically.

## Branding and packaging

The application keeps:

- app ID: `com.chat.dizychat`
- app name: `DizyChat`

Slice 1 should ensure the existing DizyChat icon/splash/native assets are coherent for the sideloaded tester build.

Distribution is a signed APK delivered directly to selected testers. There is no Play Store listing or public discovery mechanism.

The signing key is operationally sensitive and must not be committed to the repository. Build configuration may reference a locally supplied keystore/signing environment, but secrets remain outside source control.

## Error handling

### Authentication

- explicit invalid/revoked session -> clear native secure token, clear Socket.IO auth, show login
- incorrect login -> show existing login error, do not persist a token
- logout -> invalidate according to the existing server contract, then clear native secure token locally

### Connectivity

- DNS/server/network unavailable -> retain stored session, show disconnected/reconnecting state, retry through normal connection behaviour
- request timeout -> surface a recoverable error; do not reinterpret it as logout

### Uploads

- ClamAV malware verdict -> show the server rejection and do not publish the file
- scan service unavailable/fail-closed response -> show upload failure; do not bypass scanning
- ordinary upload/network failure -> allow the user to retry

### Native bridge failure

Secure-storage failure must fail safely. The application may continue to the login state, but it must not silently downgrade a session token into insecure long-lived plain-text storage.

## Testing strategy

Implementation follows TDD where practical.

Deterministic tests should cover at least:

- native-vs-web backend origin resolution
- developer override validation and fallback
- HTTP/upload URL construction using the same native origin as Socket.IO
- browser session adapter keeps current `sessionStorage` semantics
- Android session adapter contract and secure-storage error behaviour through an injected/mock native bridge
- valid restored token hydrates account/socket auth
- revoked/invalid restored token clears native storage
- transient network failure does not clear stored login
- logout clears native stored token
- external-vs-internal URL routing decision
- Android back-button priority logic as an isolated decision function where feasible

Existing server and web deterministic tests must remain green.

An Android build gate must run the applicable Capacitor sync/build checks and produce a debug/test APK during CI or an equivalent reproducible validation path without committing signing secrets.

## Real-device acceptance gate

Slice 1 is not complete until a real Android device proves all of the following against the self-hosted production backend:

1. install the private APK
2. launch and log in to an approved DizyChat account
3. join a room and exchange chat messages over `https://dizychat.com`
4. close/swipe away the app and reopen it without being forced to log in again
5. reboot or otherwise confirm durable device-session restoration where practical
6. temporarily lose network connectivity and reconnect without losing login
7. select/upload a normal file
8. select/upload an image from gallery
9. invoke camera/file picker behaviour as supported by the device
10. confirm uploads reach the production `/upload` route and survive the ClamAV clean verdict
11. verify a rejected/malware upload remains rejected by the server gate
12. exercise Android back behaviour through transient UI, chat view, and root state
13. confirm external links leave the app through the browser where expected
14. explicitly log out and confirm reopening the app does not restore the cleared session

Only after the deterministic suite, Android build gate, and real-device acceptance checks pass should Slice 1 be merged/released as the tester APK baseline.

## Slice 2 dependency

Slice 1 deliberately creates the durable authentication/session foundation required for Android notification actions.

Slice 2 will add push delivery and notification UX, including:

- push permission/registration lifecycle
- notification tap routing to the originating DizyChat room/message where feasible
- inline notification Reply without opening the app UI
- Mark as read from the notification
- background authenticated action handling using the durable device session
- foreground/background notification behaviour and polish

Those actions must continue to be authorized by the server; a notification or installed APK never becomes an authentication bypass.
