# Public Registration and Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public DizyChat account registration, optional recovery email, Resend-backed password recovery, and explicit first-run room/account guidance before v1.0.0.

**Architecture:** Keep existing socket account-login/session semantics unchanged. Add public account creation and password recovery as focused HTTP JSON services mounted by `index.js`; keep reset-token generation/storage and Resend delivery behind small testable modules. Add first-run UI as a separate browser script so the existing large chat client does not need to absorb account-creation logic, and add a standalone reset page that resolves the native backend from the existing app configuration.

**Tech Stack:** Node.js 22, Express 4, Mongoose 7, existing scrypt helpers, node-fetch 3, vanilla browser JS/HTML/CSS, Node test runner, Capacitor Android packaging.

**Spec:** `docs/superpowers/specs/2026-09-06-public-registration-password-reset-design.md`

## Global Constraints

- Public registration creates role `user` only and never changes owner/admin boundaries.
- Registration/reset passwords are 8–256 characters; existing legacy credentials are not migrated by this rule.
- Recovery email is optional, private, normalized to lowercase, and non-unique.
- Password-reset request responses are generic and never reveal account/recovery-email existence.
- Reset tokens are 32 random bytes, base64url externally, SHA-256 only at rest, single-use, and valid for 30 minutes.
- Reset success revokes browser and durable mobile sessions.
- Resend key is server-only; default sender is `DizyChat <no-reply@dizychat.com>` and default Reply-To is `dizychat@proton.me`.
- `DIZYCHAT_PUBLIC_BASE_URL` is the public reset-link origin; production is `https://dizychat.com`.
- Registration limit: 10/IP/10m. Reset request and confirm: 10/IP/15m.
- No email verification, social login, CAPTCHA, mailbox provisioning, self-delete, or recovery-email editing in v1.
- Public `v1.0.0` release stays unpublished until merged-main CI, Resend configuration, a real delivered reset, and a fresh verified signed APK all pass.

---

### Task 1: Public account persistence and registration

**Files:**
- Modify: `src/models/user.js`
- Modify: `src/auth/account-service.js`
- Modify: `tests/auth-v2/account-service.test.js`

**Interfaces:**
- Produces: `validatePublicPassword(password) -> boolean`
- Produces: `accountService.registerPublicUser({ username, password, recoveryEmail }) -> sanitized account`
- Errors: `ACCOUNT_USERNAME_REQUIRED`, `ACCOUNT_USERNAME_PROTECTED`, `ACCOUNT_USERNAME_TAKEN`, `ACCOUNT_PASSWORD_INVALID`, `ACCOUNT_RECOVERY_EMAIL_INVALID`

- [ ] **Step 1: Write failing registration tests** proving active user creation, scrypt hashing, optional/normalized private recovery email, sanitized privacy, duplicate/protected rejection, 8/256 password boundaries, and successful existing `authenticate()` after registration.
- [ ] **Step 2: Run deterministic account-service tests and verify RED** because `registerPublicUser` and model fields do not exist.
- [ ] **Step 3: Extend the User schema** with `recoveryEmail`, `passwordResetTokenHash`, `passwordResetExpiresAt`, and `self-registered` credential source.
- [ ] **Step 4: Implement minimal public registration** using canonical username checks, protected-name rejection, scrypt hashing, active/user role, duplicate-race handling for Mongo `E11000`, and sanitized return values only.
- [ ] **Step 5: Run account-service tests and verify GREEN.**

### Task 2: Resend password-reset transport

**Files:**
- Create: `src/auth/resend-password-reset-mailer.js`
- Create: `tests/auth-v2/resend-password-reset-mailer.test.js`

**Interfaces:**
- Produces: `createResendPasswordResetMailer({ fetchImpl, apiKey, from, replyTo, publicBaseUrl })`
- Produces: `mailer.sendPasswordReset({ to, username, token }) -> Promise<void>`

- [ ] **Step 1: Write failing transport tests** asserting `POST https://api.resend.com/emails`, bearer API key, configured/default From and Proton Reply-To, encoded `${base}/reset-password.html?token=...`, text+HTML content, and failure on missing config/non-2xx response.
- [ ] **Step 2: Run the focused test and verify RED** because the module does not exist.
- [ ] **Step 3: Implement the minimal injected-fetch mailer** without any SDK or mailbox password and without logging recipient/token data.
- [ ] **Step 4: Run transport tests and verify GREEN.**

### Task 3: Password-reset domain service

**Files:**
- Create: `src/auth/password-reset-service.js`
- Create: `tests/auth-v2/password-reset-service.test.js`

**Interfaces:**
- Consumes: `UserModel`, `mailer`, `sessionStore.revokeUser`, `mobileSessionService.revokeUser`
- Produces: `requestReset(username) -> Promise<{ ok: true }>`
- Produces: `confirmReset({ token, password }) -> Promise<{ ok: true }>` or error code `PASSWORD_RESET_INVALID` / `ACCOUNT_PASSWORD_INVALID`

- [ ] **Step 1: Write failing reset-service tests** for generic unknown/no-email/disabled responses, 32-byte public token with SHA-256-only storage, 30-minute expiry, replacement of older tokens, mail failure privacy, valid reset, single use, expiry/invalid-token rejection, password policy, and both session revokers.
- [ ] **Step 2: Run focused reset-service tests and verify RED.**
- [ ] **Step 3: Implement `createPasswordResetService`** with injected clock/token factory/hash helper where deterministic tests require them, query active accounts only, clear reset fields on success, hash password with existing helper, preserve role/state, and revoke both session authorities.
- [ ] **Step 4: Run reset-service tests and verify GREEN.**

### Task 4: Public auth HTTP routes and abuse controls

**Files:**
- Create: `src/auth/public-auth-router.js`
- Create: `tests/auth-v2/public-auth-router.test.js`
- Modify: `index.js`

**Interfaces:**
- Produces Express router endpoints:
  - `POST /register`
  - `POST /password-reset/request`
  - `POST /password-reset/confirm`
- Mounted at `/api/auth`

- [ ] **Step 1: Write failing router tests** using a small Express app and injected services; prove 201 registration, stable registration error codes, generic reset-request 200, reset-confirm validation mapping, JSON limits, and 429 rate-limit behavior without account disclosure.
- [ ] **Step 2: Run router tests and verify RED.**
- [ ] **Step 3: Implement a small in-memory source-IP limiter** inside the router module using independent registration/reset windows and injectable clock for tests.
- [ ] **Step 4: Implement the three HTTP handlers** with syntactic validation and error-to-status mapping.
- [ ] **Step 5: Wire `index.js`** to construct the Resend mailer, password-reset service, public-auth router, and mount `/api/auth` while reusing existing `fetch`, `User`, `sessionStore`, and `mobileSessionService` objects.
- [ ] **Step 6: Add/update wiring assertions** proving the production server mounts the router with the approved env variables and never contains a Resend API key literal.
- [ ] **Step 7: Run deterministic auth tests and verify GREEN.**

### Task 5: First-run login/room UX and self-registration controls

**Files:**
- Modify: `public/login.html`
- Modify: `public/app-config.js`
- Create: `public/account-registration.js`
- Create: `tests/auth-v2/public-registration-ui.test.js`

**Interfaces:**
- Produces: `window.dizychatResolveBackendUrl(path)` that remains same-origin in browser and prefixes the configured backend in Capacitor/native mode.
- Registration script calls `/api/auth/register` and `/api/auth/password-reset/request` through that resolver.

- [ ] **Step 1: Write failing UI contract tests** for `Choose or create a room`, join-existing/create-new explanation, room-password memory/share guidance, new placeholder, separate Sign in/Create account/Forgot password actions, optional recovery email copy, protected-name guest explanation, and inclusion of `account-registration.js`.
- [ ] **Step 2: Write failing resolver/script tests** proving browser same-origin paths and native configured-backend paths plus register/reset request payload behavior.
- [ ] **Step 3: Run focused UI tests and verify RED.**
- [ ] **Step 4: Add the shared backend resolver** to `app-config.js` without changing existing socket/media configuration.
- [ ] **Step 5: Update `login.html`** with compact explicit room guidance and hidden create/reset panels; do not alter existing guest or registered sign-in element IDs/contracts.
- [ ] **Step 6: Implement `account-registration.js`** to toggle panels, validate password confirmation, POST registration, trigger the existing registered sign-in button after successful creation, make reset-request status generic, and hide auxiliary controls while a registered session is active.
- [ ] **Step 7: Run UI tests and verify GREEN.**

### Task 6: Standalone password-reset page

**Files:**
- Create: `public/reset-password.html`
- Create: `public/reset-password.js`
- Create: `tests/auth-v2/reset-password-ui.test.js`

**Interfaces:**
- Consumes `window.dizychatResolveBackendUrl('/api/auth/password-reset/confirm')`
- Query input: `token`

- [ ] **Step 1: Write failing reset-page tests** proving token read from query string, matching password confirmation, 8–256 local validation, configured backend POST, generic invalid/expired handling, success state, and app-config inclusion before reset script.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement branded reset page and script** with no token logging/storage beyond the URL lifetime and with a link back to `/login.html`.
- [ ] **Step 4: Run reset-page tests and verify GREEN.**

### Task 7: Full verification and deployment boundary

**Files:**
- Modify: `docs/android-private-apk.md` only if needed for the new pre-release acceptance note
- Modify PR #376 description/status, not production behavior

- [ ] **Step 1: Run `npm test`** and repair only proven regressions.
- [ ] **Step 2: Review the PR diff** for secrets, accidental role changes, recovery-email/token exposure, unrelated edits, and Android/browser backend regressions.
- [ ] **Step 3: Push exact-head CI** and require DizyChat Self-Host CI plus Android Slice 1 CI success on the exact PR head.
- [ ] **Step 4: Keep PR #376 draft/unmerged** until exact-head checks are green and the user explicitly authorizes merge.
- [ ] **Step 5: After merge authorization and merge, configure server env** with `DIZYCHAT_RESEND_API_KEY`, `DIZYCHAT_MAIL_FROM`, `DIZYCHAT_MAIL_REPLY_TO`, and `DIZYCHAT_PUBLIC_BASE_URL`; never paste the secret into chat/GitHub.
- [ ] **Step 6: Perform real acceptance**: create/reset a test account with recovery email, receive mail from `no-reply@dizychat.com` with Proton Reply-To, complete reset, confirm old session invalidation.
- [ ] **Step 7: Require fresh main Android signed build** and verify `dizychat-v1.apk` before publishing the public `v1.0.0` GitHub Release.
