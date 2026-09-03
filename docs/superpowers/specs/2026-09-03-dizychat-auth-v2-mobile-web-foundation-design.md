# DizyChat Auth v2 + Mobile-Web Foundation Design

## Goal

Modernise DizyChat identity and room access before rebuilding the private mobile clients, while preserving existing ShittyChat guest access and the historical `Dizygotic` / `Psybin` admin identities.

This phase deliberately stops before Android/iOS push implementation. It produces a safer, account-aware, mobile-safe web/server foundation that the private apps can wrap without inheriting the current nickname/password weaknesses.

## Current state being replaced

- Browser clients choose an arbitrary username and room name.
- Room passwords are passed to the socket join event and are also copied into the browser URL by `updateQueryParams()`.
- A room without an existing in-memory password can currently acquire the first password supplied by a joining client.
- Admin authentication is a second, post-join password flow backed by environment credentials and process-memory sessions.
- Current production logs show legacy plaintext admin credentials are still configured.
- Messages persist a display-name string but have no stable account identity.
- The existing Android Capacitor bundle is stale relative to the live `public/` client.
- Mobile CSS already uses fixed viewport heights, a sticky composer, large toolbars and fixed/resizable modals; older/narrow Android Chrome can therefore lose controls or content when browser chrome or the software keyboard changes the visual viewport.

## Scope

### Included in this phase

1. Persistent account identity for owner/admin/user roles.
2. One-way migration of the legacy `Dizygotic` and `Psybin` admin identities.
3. `Dizygotic` becomes the protected `owner` identity.
4. `Psybin` remains a protected `admin` identity; if no usable legacy credential exists, the identity remains reserved/disabled rather than being deleted or claimable.
5. Opaque persisted login sessions usable by web clients and later native WebViews.
6. Registered usernames/login identifiers cannot be impersonated by guests.
7. Guest access remains available for `ShittyChat` only during migration.
8. Guest identities are explicitly marked as guests and never receive account/admin authority.
9. Room passwords remain a separate room-access concept, but passwords never appear in URLs, copied room links, browser history or client navigation state.
10. Room password authority becomes server-owned/configured; joining clients cannot create or silently redefine a room password.
11. New messages record stable authenticated identity metadata while retaining the existing display-name fields for backward-compatible history rendering.
12. Mobile-responsive web fixes for narrow Android Chrome, dynamic browser chrome, software keyboard, safe areas, toolbar/composer overflow, sidebar, GIF/emoji surfaces and fixed modals.
13. Regression tests for auth boundaries, guest compatibility, password URL leakage and responsive layout contracts.
14. Security/runbook documentation updated to describe the account/session model and retirement path for plaintext admin credentials.
15. A login identifier may be a conventional username or a mobile-number-shaped identifier. A separate screen/display name is always required and is the only identity shown publicly in chat.
16. Optional mobile-number aliases may be normalised and used for login, but they are not considered verified and are never used as SMS recovery credentials unless a future explicit verification feature is introduced.
17. No SMS provider, SMS verification, or paid per-code authentication dependency is introduced.

### Explicitly deferred

- Android APK rebuild / signing.
- Android push notifications, badges and notification quick reply.
- iOS project generation, APNs and private distribution.
- Public account signup.
- Password reset email / email verification implementation.
- TOTP enrollment UI / enforcement implementation.
- DizyTrades mobile app.
- Replacing MongoDB message persistence in this phase.
- ClamAV upload scanning and self-hosted LiveKit are follow-on infrastructure phases after this branch is green.

## Account and session model

### Runtime database

Use Node 22's built-in SQLite support for the small auth/session authority. Keep it separate from MongoDB message history.

The database lives under a runtime-only data directory (`DATA_DIR` when supplied, otherwise a local `.data/` directory). `.data/` must be Git-ignored. Database files are never served by Express.

### Users

Persist at least:

- `id` — stable opaque identifier.
- `username` and canonical lowercase `username_normalized`; this is the primary login identifier and may be a conventional username or a mobile-number-shaped identifier.
- `display_name` — required screen name shown publicly in chat; login identifiers are never substituted into public message/presence rendering.
- optional `mobile_number` and canonical `mobile_normalized` alias for login; unique when present, not considered verified merely because it was entered.
- optional `recovery_email` for the later email-recovery phase.
- `role` — `owner`, `admin`, or `user`.
- `password_hash` — nullable only for a deliberately disabled/reserved identity.
- `state` — `active` or `disabled`.
- timestamps.

Usernames/login identifiers are unique case-insensitively. Mobile aliases are unique after normalisation. Registered names and reserved privileged names cannot be used by guests.

Authentication accepts either the primary `username` identifier or a configured mobile alias. Phone-number-looking identifiers are treated only as login identifiers; they do not imply ownership verification and never trigger SMS.

### Passwords

New account hashes use the DizyTrades-style versioned scrypt format and timing-safe verification. Plaintext passwords are never persisted.

The legacy DizyChat scrypt format may be verified only for migration compatibility. A successful one-way migration stores a new versioned hash in SQLite; the old environment credential is no longer authoritative after migration completion.

### Recovery and MFA direction

DizyChat Auth v2 must not depend on SMS. The intended free recovery/MFA path is:

- recovery email through a dedicated DizyChat Gmail/SMTP mailbox or another SMTP sender;
- short-lived, single-use password-reset tokens stored only as digests;
- optional TOTP (Google Authenticator-compatible) for owner/admin and later selected users.

A mobile number may be a login identifier or alias but is not a recovery authority unless a future explicit verification mechanism is added.

### Sessions

- Generate a cryptographically random opaque token.
- Store only a SHA-256 digest of the token in SQLite.
- Deliver the token to the browser as an `HttpOnly`, `Secure` cookie in production with `SameSite=Lax` and a bounded expiry.
- Logout revokes the persisted session.
- Session lookup rejects expired/revoked sessions.
- Socket.IO derives authenticated identity from the server-validated session; the client cannot elevate itself by sending a username or role.

## Legacy privileged migration

Migration is one-way and idempotent.

1. Read the currently configured legacy admin entries only during migration/bootstrap.
2. Locate `Dizygotic` case-insensitively. A valid credential is re-hashed into the new account database and assigned `owner`.
3. Locate `Psybin` case-insensitively. A valid credential is re-hashed and assigned `admin`.
4. If `Psybin` is not currently configured, reserve a disabled `Psybin` admin identity so the name cannot be claimed by a guest or ordinary account.
5. Migration records a durable completion marker. After completion, database identity/role state is authoritative and legacy environment values must not overwrite it.
6. Deployment validation must confirm the new owner login before the old plaintext admin environment values are removed.

## Guest compatibility

Guest mode exists only as a migration bridge for `ShittyChat`.

- An unauthenticated client may join `ShittyChat` with a chosen display name.
- The display name is normalised and checked against registered/reserved usernames and display names. Collisions with protected identities are rejected.
- Guest presence and new guest messages carry `identityType: "guest"` and no account ID.
- Guests cannot authenticate as admin, access privileged account APIs, or use owner/admin-only moderation operations.
- Other rooms require a valid account session.
- Guest access can be removed in a later migration without rewriting the account/session model.

## Room access and URL safety

Room navigation may contain only non-secret routing state, for example `?room=ShittyChat`.

The following are forbidden in URLs or copied join links:

- room passwords;
- account passwords;
- session tokens;
- admin credentials.

`updateQueryParams()` is replaced so it never accepts or serialises a password. Leaving/rejoining a room must not repopulate the address bar with secret state.

Room passwords are server-owned. A joining client may prove knowledge of a configured password, but a missing room password is not created from that proof. Existing protected-room configuration must be represented by trusted server configuration/runtime state, not by first-client-wins behaviour.

## Socket identity boundary

After Auth v2:

- Server-owned socket identity is populated only from a valid persisted session or the explicit ShittyChat guest bridge.
- For authenticated users, `socket.username` is derived from the account display name, not from the join payload or login identifier.
- For ShittyChat guests, the join payload may supply a guest display name after collision checks.
- Message creation always overwrites client-supplied identity fields with server-owned identity data.
- Privileged authorization checks use server-owned account role/session state.

## Message compatibility

Do not rewrite historical MongoDB messages in this phase.

Extend new message records with optional stable identity metadata:

- `userId` for authenticated users;
- `identityType` = `account` or `guest`;
- existing `user` display-name string remains for rendering/backward compatibility.

Existing records with only `user` remain valid.

## Web login / migration UX

The landing/chat entry surface becomes account-aware:

- Existing active account session: show signed-in screen name and normal room picker.
- No session: offer account login using username or configured mobile alias.
- Account creation/enrollment requires a separate screen name even when the login identifier is a mobile number.
- ShittyChat additionally offers a clearly labelled guest path so the existing visitor can continue entering without an account.
- Public self-signup is not introduced in this phase.
- A later private enrollment flow can create selected user accounts without changing the session model.

## Mobile web layout contract

The shared web client must be usable before it is wrapped by Capacitor.

- Use the visual viewport when available so the software keyboard cannot hide the composer.
- Avoid conflicting `100vh` / `100svh` precedence; prefer a single runtime viewport CSS variable with `100dvh` fallback.
- Header controls must wrap/collapse without horizontal clipping at widths down to 320 CSS px.
- The composer must keep the text input and send action reachable at narrow widths; secondary controls may wrap onto a compact secondary row.
- Online-user sidebar becomes an overlay/collapsible panel on mobile and must not steal chat width while closed.
- GIF/emoji/search panels and fixed stream/watch-party modals clamp to the visual viewport and safe-area insets.
- No horizontal page scrolling in chat mode.
- CSS contains explicit narrow-width contracts suitable for a Huawei P30-class Chrome viewport and modern iPhones.

## Follow-on self-hosted infrastructure

After this foundation is green:

1. Local ClamAV upload gate using `clamd`, fail-closed or quarantined according to an explicit upload policy, replacing the retired OPSWAT cloud dependency.
2. Self-hosted LiveKit Server for DizyChat audio/video calls with trusted TLS, public DNS, static public IP/firewall rules and the required WebRTC UDP/TCP ports.
3. Repair the 101Soundboards importer so canonical slug/direct original assets are authoritative and processed/preview variants with extra audio are rejected or flagged before local caching.
4. Repair Android Capacitor shell against the current web assets and account/session model.
5. Add Android push/badge/notification reply.
6. Port the proven private client to iOS and add APNs handling.