# Public Registration and Password Reset Design

## Goal

Make DizyChat understandable and usable for first-time public users before the v1.0.0 APK release by adding self-service account registration, optional recovery email, password reset email delivery, and clearer room/login guidance without changing existing owner/admin authority or guest-room behavior.

## Existing behavior to preserve

- Existing protected owner/admin accounts keep their current roles and credentials.
- Existing registered-account login/session behavior remains the authentication path after registration.
- Guest users can still join without an account, but registered usernames remain protected from guest impersonation.
- Entering a room name continues to join an existing room or create that room when it does not yet exist; an optional room password continues to protect that room.
- Android and normal browser flows use the same public landing/auth experience.

## Registration flow

The registered-account card gains a clear `Create account` path alongside `Sign in`.

Registration fields:

- username: required
- password: required
- recovery email: optional

There is no email-verification step. A valid unused username is registered immediately as an active `user` account. Protected usernames, existing usernames, empty usernames, and invalid passwords are rejected. Recovery email is trimmed and normalized to lowercase when supplied, but it is not unique and is never exposed in sanitized account/session payloads.

After successful registration, the client immediately signs in using the existing registered-login/session flow. If automatic sign-in cannot complete, the account remains created and the UI tells the user to sign in normally.

## Password policy

Public self-registration and password reset require passwords between 8 and 256 characters. Existing already-configured owner/admin/legacy accounts are not migrated or invalidated by this rule.

## Account persistence

Extend the existing `User` model with private fields:

- `recoveryEmail`: string, default empty, lowercase/trimmed
- `passwordResetTokenHash`: string, default empty
- `passwordResetExpiresAt`: date, default null

Add `self-registered` to the existing `credentialSource` enum. `sanitizeAccount()` must continue returning only identity/role/state data and must never return recovery email or reset-token fields.

## Password reset request

The landing page exposes `Forgot password?` for registered accounts.

The user submits the account username. The public response is always generic, whether the username is unknown, has no recovery email, is disabled, or successfully receives a reset email. This prevents account/recovery-email enumeration.

For an active account with a recovery email:

1. Generate 32 random bytes and encode them as base64url for the one-time public token.
2. Store only the SHA-256 hash of that token on the user record.
3. Set the expiry to 30 minutes from issuance.
4. Send a reset URL of the form `${DIZYCHAT_PUBLIC_BASE_URL}/reset-password.html?token=<token>`.
5. Never log the raw token or recovery email.

Issuing a newer reset request replaces any older outstanding reset token for that account.

## Password reset completion

The reset page accepts the token plus a new password and confirmation.

The server hashes the supplied token, finds an active account with the matching hash and a non-expired reset timestamp, then:

- replaces the password hash using the existing scrypt password helper;
- clears `passwordResetTokenHash` and `passwordResetExpiresAt` before returning success;
- marks the credential source as `self-registered` for normal user accounts without changing the account role/state;
- revokes all current browser account sessions for that username;
- revokes all durable mobile sessions for that username so a stolen logged-in device cannot remain authenticated after recovery.

Tokens are therefore single-use and expire after 30 minutes.

## Public HTTP API

Use small JSON endpoints rather than adding new socket authentication semantics:

- `POST /api/auth/register`
  - body: `{ username, password, recoveryEmail? }`
  - success: `201 { ok: true }`
  - duplicate/protected/validation failures return stable non-secret error codes for the registration UI.

- `POST /api/auth/password-reset/request`
  - body: `{ username }`
  - always returns `200 { ok: true }` for syntactically valid requests, regardless of whether mail is sent.

- `POST /api/auth/password-reset/confirm`
  - body: `{ token, password }`
  - success: `200 { ok: true }`
  - invalid/expired/used token: `400 { ok: false, code: 'PASSWORD_RESET_INVALID' }`

The existing trusted native HTTP-origin CORS middleware already permits POST/Content-Type requests from the Capacitor origin, so these routes work in both browser and Android builds.

## Mail delivery

Do not run Proton Bridge and do not add an application mailbox.

Password-reset messages are sent through the Resend HTTP API using the already-available server-side fetch capability. No new Resend SDK is required.

Environment contract:

- `DIZYCHAT_RESEND_API_KEY` — secret API key, server only
- `DIZYCHAT_MAIL_FROM` — default `DizyChat <no-reply@dizychat.com>`
- `DIZYCHAT_MAIL_REPLY_TO` — default `dizychat@proton.me`
- `DIZYCHAT_PUBLIC_BASE_URL` — production public origin, expected `https://dizychat.com`

The mail transport is isolated behind a small module that accepts an injected fetch implementation for deterministic tests. It POSTs to `https://api.resend.com/emails` with the API key in the Authorization header and sends both text and HTML reset content. Mail transport failures are logged without recipient/token details and do not change the generic public reset-request response.

`dizychat@proton.me` remains the human support/reply inbox; `no-reply@dizychat.com` is only the authenticated automated sender.

## Abuse controls

Add route-local in-memory limits consistent with the current single self-hosted process:

- registration: maximum 10 attempts per source IP per 10 minutes
- password-reset request: maximum 10 attempts per source IP per 15 minutes
- password-reset confirm: maximum 10 attempts per source IP per 15 minutes

Rate-limit responses use `429` without exposing account existence. These controls are intentionally process-local for v1 and reset on service restart.

## Landing-page UX

Keep one compact landing screen but make the flows explicit.

Room section copy:

- heading: `Choose or create a room`
- explanation: entering an existing room name joins it; entering a new room name creates it; an optional password makes the room private; users should remember/share the same room name and password to return/invite others.
- room placeholder: `Room name — join existing or create new`

Registered-account section:

- explain that registered names are protected;
- provide separate `Sign in` and `Create account` actions;
- registration reveals username, password, confirm-password, and optional recovery-email controls;
- `Forgot password?` reveals username-based reset request controls;
- recovery copy states that email is optional and used only for password recovery; there is no verification requirement.

Guest section:

- retain guest username + join behavior;
- explain that no account is required and guest names are not permanently protected.

Add `public/reset-password.html` for the token/new-password completion screen, using the same DizyChat branding and native-aware backend configuration as the existing client.

## Security and privacy

- Never commit or expose the Resend API key.
- Never return recovery email in account/session responses.
- Never store raw reset tokens.
- Never log reset tokens or recovery addresses.
- Use the same generic reset-request response regardless of account existence/recovery configuration.
- Password reset invalidates browser and durable mobile sessions.
- Existing owner/admin role-management boundaries are unchanged.
- Public registration can only create role `user`.

## Deterministic regression coverage

Add tests proving:

1. self-registration creates an active `user` with a scrypt password hash;
2. recovery email is optional, normalized when present, and absent from sanitized output;
3. duplicate and protected usernames cannot self-register;
4. short/oversized passwords are rejected for registration/reset;
5. a newly registered account authenticates through the existing account service;
6. reset request responses do not disclose whether an account/recovery email exists;
7. reset tokens are random-public/hashed-at-rest, expire after 30 minutes, and newer requests replace older tokens;
8. Resend transport uses the configured sender, Proton Reply-To, public reset URL, and never requires a mailbox password;
9. valid reset replaces the password, clears the token, makes the token single-use, and revokes browser/mobile sessions;
10. expired/invalid tokens fail without changing the password;
11. the landing page contains the explicit room join/create guidance and the separate sign-in/create/reset controls;
12. the reset page submits through the configured DizyChat backend in both browser and native packaging contracts.

The normal complete gate remains required: deterministic tests, self-host UI/Chromium coverage, Android asset packaging/build, signed-release verification, and exact-head CI.

## Deployment and release boundary

The public `v1.0.0` GitHub Release remains unpublished until:

1. registration/reset implementation is merged to `main`;
2. Resend domain DNS and server API key are configured;
3. a real password-reset email from `no-reply@dizychat.com` is delivered with Reply-To `dizychat@proton.me` and a reset succeeds;
4. the fresh `main` Android workflow produces and verifies the signed `dizychat-v1.apk`.

## Out of scope for v1

- mandatory email verification
- social/Google login
- a hosted mailbox for `no-reply@dizychat.com`
- changing an account recovery email after signup
- multiple recovery emails per account
- self-service account deletion
- CAPTCHA; rate limiting is the v1 anti-abuse boundary
