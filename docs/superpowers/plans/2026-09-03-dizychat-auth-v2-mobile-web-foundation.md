# DizyChat Auth v2 + Mobile-Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace arbitrary nickname/admin-password identity with persistent account/session authority, preserve ShittyChat guests, remove room-password URL leakage, and make the shared web client reliably usable on narrow mobile viewports before rebuilding private apps.

**Architecture:** Add a small SQLite-backed auth/session module using Node 22 built-ins and DizyTrades-compatible versioned scrypt hashes. Express owns login/logout/viewer endpoints and Socket.IO derives identity from the server-validated session cookie; only ShittyChat retains a guest bridge. Room passwords remain server-owned and never enter navigation state. Mobile layout uses one viewport-height variable updated from `visualViewport` and explicit narrow-width overflow contracts.

**Tech Stack:** Node 22, Express 4, Socket.IO 4, `node:sqlite`, `node:crypto`, MongoDB/Mongoose for existing messages, plain browser JS/CSS.

**Spec:** `docs/superpowers/specs/2026-09-03-dizychat-auth-v2-mobile-web-foundation-design.md`

## Global Constraints

- Branch: `feat/auth-v2-private-mobile-foundation`, based on `d808e8da218489a92057f6ca771d8379ca3c545a`.
- Do not change Android/iOS native code in this phase.
- Preserve ShittyChat guest access.
- Protect `Dizygotic` as owner and `Psybin` as admin/reserved.
- No passwords/session tokens in URLs or copied join links.
- No public signup.
- Do not rewrite historical MongoDB messages.
- Keep runtime auth data outside Git and outside Express static roots.
- Follow TDD: failing contract first, then minimal implementation.

---

### Task 1: Auth credential and persistence authority

**Files:**
- Create: `src/auth/passwords.js`
- Create: `src/auth/store.js`
- Create: `tests/auth-v2.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- `hashPassword(password) -> Promise<string>`
- `verifyPassword(password, encoded) -> Promise<boolean>`
- `createAuthStore({ dataDir, sessionTtlMs? })`
- Store methods: `createUser`, `findUserByUsername`, `authenticate`, `createSession`, `resolveSession`, `revokeSession`, `reservePrivilegedIdentity`, `guestNameAvailable`.

- [ ] Write failing tests for versioned scrypt hashes, case-insensitive unique usernames, disabled/reserved identities, opaque session digest storage/expiry, and guest collision rejection.
- [ ] Run `npm test` and confirm the new tests fail because the auth modules are absent.
- [ ] Implement `passwords.js` using async `crypto.scrypt`, fixed approved parameters, timing-safe verification and a 128-character password ceiling.
- [ ] Implement `store.js` using `DatabaseSync`, WAL mode, restrictive file permissions, migrations, user/session tables and SHA-256 session-token digests.
- [ ] Add `.data/` to `.gitignore`.
- [ ] Update `npm test` to run all `tests/*.test.js` through Node's test runner.
- [ ] Run `npm test` and confirm Task 1 tests pass.

### Task 2: Legacy privileged migration

**Files:**
- Create: `src/auth/legacy-admin-migration.js`
- Extend: `tests/auth-v2.test.js`

**Interfaces:**
- `migrateLegacyAdmins({ store, credentials }) -> Promise<{status:string}>`
- Input credentials are already-parsed `{ username, kind, credential }` records from the existing server configuration.

- [ ] Add failing tests proving `Dizygotic` becomes owner, `Psybin` becomes admin, absent Psybin is reserved disabled, migration is idempotent, and completed migration never lets environment credentials overwrite database roles/state.
- [ ] Run `npm test` and verify RED.
- [ ] Implement one-way migration with a durable migration marker and re-hash usable legacy credentials into the new versioned format.
- [ ] Run `npm test` and verify GREEN.

### Task 3: HTTP sessions and socket identity boundary

**Files:**
- Create: `src/auth/http.js`
- Create: `src/auth/socket-identity.js`
- Modify: `index.js`
- Extend: `tests/auth-v2.test.js`

**Interfaces:**
- `installAuthRoutes(app, store)` exposes `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/viewer`.
- `resolveSocketIdentity(socket, store)` resolves the session cookie and returns an account identity or null.

- [ ] Add failing tests for cookie parsing, secure cookie attributes in production, invalid/expired sessions, account identity overriding client-supplied usernames, and guest mode allowed only for ShittyChat.
- [ ] Run `npm test` and verify RED.
- [ ] Implement JSON body parsing only for the auth API, rate-limit login attempts with bounded in-memory buckets, issue `HttpOnly; SameSite=Lax` session cookies and use `Secure` in production.
- [ ] Wire Socket.IO connection/join so account identity is server-derived; ShittyChat unauthenticated joins use an explicitly marked guest identity after collision checks.
- [ ] Make owner/admin privilege derive from account role. Keep legacy admin auth only as a temporary migration/bootstrap seam until deployment confirms migrated accounts.
- [ ] Run `npm test` and verify GREEN.

### Task 4: Secret-safe room access

**Files:**
- Modify: `index.js`
- Modify: `public/chat.js`
- Extend: `tests/auth-v2.test.js`
- Extend: `tests/self-host-config.test.js`

**Interfaces:**
- `updateQueryParams(room)` never receives a password.
- Trusted room-password configuration is loaded server-side; joining clients can prove a password but cannot create/change one.

- [ ] Add failing source/behavior contracts proving `password` is never set in `URLSearchParams`, copied join links contain only the room, and `join room` does not populate `roomPasswords` from a client-provided password.
- [ ] Run `npm test` and verify RED.
- [ ] Replace client URL update/landing behavior so room passwords remain memory-only for the current page lifecycle and are never serialized to navigation.
- [ ] Replace first-client-wins room-password behavior with trusted server configuration parsing and constant-time password comparison.
- [ ] Run `npm test` and verify GREEN.

### Task 5: Message identity compatibility

**Files:**
- Modify: `src/models/message.js`
- Modify: `index.js`
- Extend: `tests/auth-v2.test.js`

**Interfaces:**
- New messages optionally carry `userId` and `identityType` while retaining `user`.

- [ ] Add failing tests/source contracts proving client-supplied identity metadata is overwritten and historical records remain valid without the new fields.
- [ ] Run `npm test` and verify RED.
- [ ] Add optional schema fields and populate them only from socket-owned identity state.
- [ ] Run `npm test` and verify GREEN.

### Task 6: Account-aware landing UI

**Files:**
- Modify: `public/login.html`
- Modify: `public/chat.js`
- Modify: `public/chat.css`
- Extend: `tests/auth-v2.test.js`

**Interfaces:**
- `GET /api/auth/viewer` drives signed-in state.
- Login form posts to `/api/auth/login`.
- ShittyChat exposes a guest entry path when unauthenticated.

- [ ] Add failing DOM/source contracts for login fields, signed-in identity display, logout, and ShittyChat-only guest affordance.
- [ ] Run `npm test` and verify RED.
- [ ] Implement account login/logout/viewer bootstrap while preserving the existing room picker and current visual design.
- [ ] Hide arbitrary username entry for authenticated accounts; show guest display-name input only when choosing the ShittyChat guest path.
- [ ] Run `npm test` and verify GREEN.

### Task 7: Mobile viewport/layout repair

**Files:**
- Modify: `public/login.html`
- Modify: `public/chat.js`
- Modify: `public/chat.css`
- Extend: `tests/auth-v2.test.js`

**Interfaces:**
- Root CSS variable `--app-height` reflects `window.visualViewport.height` when available and falls back to `100dvh`.

- [ ] Add failing source contracts for `visualViewport`, `--app-height`, narrow-width toolbar/composer rules, max-inline sizing for panels/modals and no horizontal overflow.
- [ ] Run `npm test` and verify RED.
- [ ] Add viewport-height synchronisation on load/resize/visualViewport resize.
- [ ] Replace competing fixed viewport-height rules with the shared variable.
- [ ] Add explicit `max-width: 480px` and `max-width: 360px` rules so toolbar/search/composer controls wrap without clipping, sidebar overlays when collapsed, and fixed pickers/modals clamp to viewport/safe areas.
- [ ] Run `npm test` and verify GREEN.

### Task 8: Documentation and final gate

**Files:**
- Modify: `README.md`
- Modify: `docs/security-runbook.md`
- Extend: `tests/self-host-config.test.js`

- [ ] Update docs for Auth v2, ShittyChat guest migration, runtime auth DB, plaintext-admin retirement, no-secret URLs, and the deferred ClamAV/LiveKit self-hosted roadmap.
- [ ] Run `npm test`.
- [ ] Run the existing UI smoke test command documented by the repo if its prerequisites are available in CI; otherwise keep it as the next deployment/manual browser gate and state that explicitly.
- [ ] Open a draft PR from `feat/auth-v2-private-mobile-foundation` to `main`.
- [ ] Do not merge until exact final head passes the repository gate and the live self-hosted deployment migration has been deliberately approved.
