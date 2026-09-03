# DizyChat Auth v2 Design

Date: 2026-09-03
Status: approved design, implementation pending
Project contact: dizychat@proton.me

## Goal

Replace DizyChat's legacy username-plus-admin-password socket trust model with durable authenticated accounts while preserving the existing room and guest experience during migration.

## Locked identity rules

- `Dizygotic` is the protected owner account and has role `owner`.
- `Psybin` is preserved as an admin account because it is part of DizyChat's original history. If a safe existing credential can be migrated, it will be; otherwise the account remains disabled/unclaimed until explicitly activated or reset.
- New registered accounts default to role `user` unless deliberately promoted.
- Registered usernames are reserved case-insensitively and cannot be impersonated by guests.
- The ShittyChat guest bridge remains available during migration so existing visitors can continue joining without immediately creating accounts.
- A later flow may let a guest claim/create a proper account, but guest claiming is not required for the first Auth v2 release.

## Current seam being replaced

The existing server builds admin credentials from environment variables and issues in-memory admin sessions. The browser reveals an admin-password field for `Dizygotic` and `Psybin`, joins the room as an ordinary username, and then sends a separate `admin auth` socket event. Auth v2 removes that split identity model: role and moderation authority come only from the authenticated account/session.

## Account model

Add a persistent `User` model in MongoDB with at least:

- canonical username
- display username
- password hash
- role: `owner | admin | user`
- account state: `active | disabled | unclaimed`
- created/updated timestamps
- credential migration metadata sufficient to retire legacy env credentials safely

Passwords are stored only as salted password hashes using the existing scrypt-compatible password machinery or a single clearly versioned replacement. Plaintext passwords are never persisted.

`Dizygotic` and `Psybin` bootstrap/migration records are created deterministically and idempotently. Startup must never silently demote, overwrite, or duplicate either protected identity.

## Sessions and socket trust

Authentication becomes account-first.

- Successful login creates a server-issued session token with expiry.
- The browser/native client reuses that session for reconnects instead of resending account passwords.
- Socket.IO resolves the session to one authenticated principal and attaches identity/role server-side.
- Privileged socket handlers consult the resolved principal/role only.
- Clients cannot grant themselves a username or role by sending `username`, `isAdmin`, `role`, or a legacy admin password.
- Logout and credential reset revoke relevant sessions.

The current admin-auth rate limiting can be adapted into account-login throttling rather than deleted.

## Guest compatibility

Guests remain supported during the transition.

- Guest join still accepts an unregistered display name and room credentials.
- A guest may not use any canonical username reserved by a registered account, including `Dizygotic` and `Psybin`.
- Guest identity is explicitly marked as guest in server-side socket state.
- Guest users never receive account roles or privileged capabilities.
- ShittyChat remains a supported guest compatibility path until deliberately retired in a later change.

## Room passwords

Room passwords remain room-access credentials only.

- Room passwords are not account passwords and confer no role.
- They are sent only in the join/rejoin exchange when required.
- They must not be written to `window.location`, browser history, copied join links, logs, analytics, or other URLs.
- Existing `?password=` parsing and query-writing behavior is removed.
- Reconnect may keep a room credential only in ephemeral client memory for the active session; long-lived persistence is out of scope for this release.

## Client flow

The landing screen becomes explicit about the two identity modes:

1. Registered user sign-in: username + account password.
2. Continue as guest: guest display name + room + optional room password.

The legacy conditional `Admin Password` field is removed. Once signed in, the client displays the server-resolved account identity/role and uses the account session automatically when joining rooms or reconnecting.

The first Auth v2 release does not require public self-service registration if that would widen the change unnecessarily. It must, however, provide a safe owner-controlled path to create/activate selected user accounts so the model is usable immediately.

## Owner/admin migration

Migration is intentionally conservative:

- `Dizygotic` is created/reserved as `owner`.
- `Psybin` is created/reserved as `admin`.
- Existing hashed legacy credentials may be imported only when they can be associated unambiguously with the protected account.
- Plaintext admin env credentials remain accepted only during the migration window needed to establish the real account, with explicit warnings.
- Once the corresponding real account is confirmed, the legacy credential path for that identity is retired.
- There is no automatic deletion of `Psybin` because the user is inactive.

## Security properties

Auth v2 must guarantee:

- no guest impersonation of registered names
- no role escalation from client-supplied fields
- no room password in URLs/history
- no plaintext account password storage
- explicit session expiry and revocation
- rate limiting for login attempts
- protected owner role cannot be removed by ordinary admin actions
- disabled/unclaimed accounts cannot authenticate
- client reconnect does not require resending an account password

## API/socket boundaries

Exact event names may follow the existing code style, but responsibilities are separated:

- account login/logout/session resolution
- guest room join
- authenticated room join
- owner-controlled account activation/creation
- moderation authorization from server-side principal

Existing room/message/media behavior should remain unchanged except where it currently depends on the legacy admin-password model.

## Testing

Implementation is test-driven. Coverage must include:

- protected bootstrap identities and roles
- idempotent startup migration
- login success/failure/rate-limit behavior
- disabled/unclaimed rejection
- session expiry/revocation/reconnect
- guest join compatibility
- registered-name guest impersonation rejection, case-insensitive
- owner/admin/user authorization boundaries
- legacy admin-password path retirement
- room-password URL regression test proving neither initial joins nor copied links contain the password
- browser UI smoke for registered login and guest join
- existing deterministic/server tests and Chromium smoke remain green

## Rollout

Auth v2 ships as its own feature branch/PR and does not mix in mobile-layout, ClamAV, LiveKit self-hosting, or soundboard-import work. Those follow as separate slices after identity is stable.

No production identity is considered migrated until the exact final PR head passes the repository's full gate.

## Follow-on roadmap

After Auth v2:

1. Mobile layout hardening, including Huawei P30/Chrome narrow-screen clipping and safe-area behavior.
2. Self-hosted upload scanning using local ClamAV instead of the disabled OPSWAT API integration.
3. Self-hosted LiveKit for DizyChat audio/video calls instead of relying on hosted LiveKit credentials.
4. Soundboard 101 import redesign: deterministic local ingest/transcode/normalization, clip preview/validation, and removal of malformed leading tones/beeps where those are artifacts rather than intended audio.
5. Android private APK refreshed from the canonical web assets after the web/auth/mobile surfaces are stable.
6. iOS private app afterward.
7. A proper DizyTrades app can be considered separately later.
