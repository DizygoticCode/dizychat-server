# DizyChat Android Slice 1 — Durable Session Amendment

## Status

Approved in chat on 2026-09-04 after implementation-plan review exposed a mismatch between the original mobile persistence goal and the current server session contract.

This amendment is part of `2026-09-04-dizychat-android-slice1-design.md` and overrides any assumption that Android Keystore persistence alone is sufficient.

## Problem discovered before implementation

The current Auth v2 session store is process-local and short-lived. It keeps tokens in an in-memory `Map`, uses a finite TTL, and loses all sessions when the Node process restarts. Persisting one of those tokens in Android Keystore would therefore preserve only a dead token after expiry or a `dizychat.service` restart.

That does not satisfy the approved mobile behaviour: the Android user should stay signed in across app close, swipe-away, reboot, temporary network loss, and DizyChat server restart until explicit logout or server-side revocation.

## Corrected architecture

### Browser sessions remain unchanged

The normal web client continues to use the existing Auth v2 browser session path and `sessionStorage`. Its current short-lived/process-local semantics are not widened by this slice.

### Android receives a distinct durable device session

A successful login from the trusted Capacitor client may request a mobile device session. The server authenticates the username/password through the existing account service, then issues a cryptographically random mobile token.

The raw token is returned once to the Android client and stored only through the Android Keystore-backed secure-session plugin. The server never stores the raw token.

### MongoDB is the durable authority

The server stores a SHA-256 hash of the mobile token in MongoDB together with the canonical account identity and revocation metadata. The record has no automatic short TTL in Slice 1: it remains valid until explicit logout, account invalidation, or revocation.

A mobile token is valid only when all of the following are true:

- the token has the expected DizyChat mobile-token format
- its SHA-256 hash matches an unrevoked MongoDB device-session record
- the referenced account still exists
- the account is still `active`

Role and username are resolved from the current account record rather than trusted from stale session metadata. Disabling/removing an account therefore makes old mobile tokens unusable.

### Token format and storage

Use a versioned opaque token such as `dcm1.<random-base64url-secret>` with at least 256 bits of randomness. MongoDB stores only `sha256(rawToken)` plus non-secret metadata. Logs, analytics, source code, tests, and error responses must never contain production raw mobile tokens.

### Socket.IO integration

The Socket.IO authentication boundary accepts either:

1. an existing short-lived browser Auth v2 session; or
2. a durable mobile device token resolved asynchronously from MongoDB.

Both resolve to the same account-principal shape so downstream room/moderation authorization remains unchanged.

The mobile client requests the durable session only when running under the trusted native runtime. The website continues to request the normal browser session. This distinction is a product/session-lifetime boundary, not an authorization bypass: valid account credentials are still required and all permissions remain server-side.

### Logout and revocation

Android logout must revoke the matching MongoDB mobile session before clearing the Keystore copy. If the server has already revoked it, local secure storage is still cleared.

A server-declared invalid/revoked mobile token clears the Android secure copy and returns the user to login. Network/DNS/server outages retain the secure token and reconnect later.

Slice 1 needs token-level revocation. Account-wide/device-management UI can be added later without changing the token model.

## Security properties

- APK possession alone grants no server access.
- Raw durable tokens are never stored in MongoDB.
- Android durable tokens are never persisted in `localStorage` or another plaintext browser store.
- Browser Auth v2 lifetime is unchanged.
- Server restart does not invalidate mobile sessions.
- Disabled accounts cannot continue using old mobile sessions.
- A durable mobile session carries no authority beyond the current server-side account role.

## Testing additions

Before production code, deterministic tests must define and observe failure for:

- mobile token issuance stores only a SHA-256 hash
- resolution survives service-object recreation when the same Mongo-backed model is used
- unknown/revoked/malformed tokens resolve to null
- disabled accounts invalidate an otherwise matching token
- token revocation is idempotent
- browser session-store behaviour remains unchanged
- Socket.IO startup authentication and `account session` accept durable mobile tokens
- normal web login still issues the existing browser session
- native mobile login issues a durable session
- logout revokes the correct session kind

The Android Keystore, transport, navigation, upload, APK build, and real-device gates from the parent Slice 1 design remain unchanged.