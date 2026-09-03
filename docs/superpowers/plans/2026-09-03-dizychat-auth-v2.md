# DizyChat Auth v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy username-plus-admin-password model with persistent DizyChat accounts, server-resolved roles, safe guest compatibility, and room passwords that never enter URLs.

**Architecture:** Keep the existing Express/Socket.IO/Mongoose application, but move identity, password, session, and account-policy logic into focused `src/auth/` modules. Socket connections resolve an optional session token into a server-side principal; authenticated room joins ignore client-supplied identity, while guest joins remain allowed only for names not reserved by registered accounts. Legacy admin env credentials are migration inputs only.

**Tech Stack:** Node.js 22, Express 4, Socket.IO 4.8, Mongoose 7.8, Node `crypto.scrypt`, Node test runner, Playwright/Chromium smoke.

**Spec:** `docs/superpowers/specs/2026-09-03-dizychat-auth-v2-design.md`

## Global Constraints

- `Dizygotic` is always the protected `owner` identity.
- `Psybin` is always preserved as `admin`; without a safe migrated credential the account stays `unclaimed`.
- Ordinary registered accounts default to `user`.
- ShittyChat/ordinary guests remain usable during migration.
- Guests may never impersonate any registered username, case-insensitively.
- Account role comes only from the authenticated server-side principal.
- Room passwords are room-access credentials only and must never appear in URLs/history/copied links.
- Plaintext account passwords are never persisted.
- The existing local/self-hosted MongoDB dependency remains.
- Project contact for new DizyChat-facing copy is `dizychat@proton.me`.
- Mobile layout, ClamAV, self-hosted LiveKit, soundboard redesign, Android refresh, and iOS remain separate follow-on slices.

---

### Task 1: Password and identity primitives

**Files:**
- Create: `src/auth/passwords.js`
- Create: `src/auth/identity.js`
- Create: `tests/auth-v2/passwords.test.js`
- Create: `tests/auth-v2/identity.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `canonicalizeUsername(value) -> string`
- Produces: `PROTECTED_ACCOUNTS` with exact `Dizygotic/owner` and `Psybin/admin` records
- Produces: `hashPassword(password) -> scrypt encoded string`
- Produces: `verifyPassword(password, encodedHash) -> boolean`
- Produces: `isScryptHash(value) -> boolean`

- [ ] **Step 1: Write failing primitive tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeUsername, PROTECTED_ACCOUNTS } = require('../../src/auth/identity');
const { hashPassword, verifyPassword, isScryptHash } = require('../../src/auth/passwords');

test('canonical usernames are trimmed and case-insensitive', () => {
  assert.equal(canonicalizeUsername('  DiZyGoTiC  '), 'dizygotic');
});

test('protected identities preserve owner/admin history', () => {
  assert.deepEqual(PROTECTED_ACCOUNTS.map(({ username, role }) => ({ username, role })), [
    { username: 'Dizygotic', role: 'owner' },
    { username: 'Psybin', role: 'admin' },
  ]);
});

test('scrypt hashing never stores the plaintext password', () => {
  const encoded = hashPassword('correct horse battery staple');
  assert.equal(isScryptHash(encoded), true);
  assert.equal(encoded.includes('correct horse battery staple'), false);
  assert.equal(verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(verifyPassword('wrong', encoded), false);
});
```

- [ ] **Step 2: Run tests and prove RED**

Run: `node --test tests/auth-v2/passwords.test.js tests/auth-v2/identity.test.js`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the primitives**

`src/auth/identity.js` exports the canonicalizer, role constants, account-state constants, and frozen protected account definitions. `src/auth/passwords.js` moves the current scrypt format/verification out of `index.js` and adds hashing with `crypto.randomBytes(16)` plus `crypto.scryptSync` using the current `N=16384`, `r=8`, `p=1`, `keyLength=64` format.

```js
const PROTECTED_ACCOUNTS = Object.freeze([
  Object.freeze({ username: 'Dizygotic', canonicalUsername: 'dizygotic', role: 'owner' }),
  Object.freeze({ username: 'Psybin', canonicalUsername: 'psybin', role: 'admin' }),
]);
```

- [ ] **Step 4: Make `npm test` discover Node test files**

Change the package test script to `node --test` so the existing contract test and new Auth v2 tests run together.

- [ ] **Step 5: Run tests GREEN and commit**

Run: `npm test`
Expected: all discovered tests pass.

Commit: `feat: add Auth v2 identity primitives`

---

### Task 2: Persistent User model and protected-account migration

**Files:**
- Create: `src/models/user.js`
- Create: `src/auth/legacy-admin-credentials.js`
- Create: `src/auth/account-service.js`
- Create: `tests/auth-v2/account-service.test.js`
- Modify: `index.js` admin credential setup only

**Interfaces:**
- `User`: unique indexed `canonicalUsername`, `username`, `passwordHash`, `role`, `state`, `credentialSource`, timestamps
- `readLegacyAdminCredentials(env) -> Map<canonicalUsername, { username, kind, credential }>`
- `createAccountService({ UserModel, legacyCredentials })`
- service methods: `bootstrapProtectedAccounts()`, `authenticate(username,password)`, `isRegisteredUsername(username)`, `createManagedUser(actor,input)`

- [ ] **Step 1: Write failing account-service tests using an in-memory fake model**

Cover these exact cases: `Dizygotic` bootstraps as owner; `Psybin` bootstraps as admin; no Psybin credential means `unclaimed`; an unambiguous legacy scrypt/plaintext credential is converted to a persisted scrypt hash; repeated bootstrap is idempotent; an existing protected role cannot be demoted; disabled/unclaimed accounts cannot authenticate; owner-created ordinary accounts default to `user`; non-owner creation is rejected.

```js
const service = createAccountService({ UserModel: fakeUsers, legacyCredentials });
await service.bootstrapProtectedAccounts();
assert.equal((await fakeUsers.findByCanonical('dizygotic')).role, 'owner');
assert.equal((await fakeUsers.findByCanonical('psybin')).state, 'unclaimed');
```

- [ ] **Step 2: Run the account tests RED**

Run: `node --test tests/auth-v2/account-service.test.js`
Expected: FAIL because `User`/service modules do not exist.

- [ ] **Step 3: Implement `User` schema and account service**

Use a unique index on `canonicalUsername`. `bootstrapProtectedAccounts()` performs idempotent upserts but never overwrites an existing protected role with a lower role. Legacy plaintext is accepted only as a migration input and immediately hashed before persistence; `credentialSource` records `legacy-plaintext`, `legacy-scrypt`, `managed`, or `unclaimed` without storing the old secret.

- [ ] **Step 4: Replace duplicated legacy parsing in `index.js` with `readLegacyAdminCredentials(process.env)`**

Do not remove the legacy env names yet; they are the controlled migration source for the first Auth v2 deployment.

- [ ] **Step 5: Run `npm test` GREEN and commit**

Commit: `feat: persist protected DizyChat accounts`

---

### Task 3: Session store and account login

**Files:**
- Create: `src/auth/session-store.js`
- Create: `tests/auth-v2/session-store.test.js`
- Modify: `index.js`

**Interfaces:**
- `createSessionStore({ ttlMs })`
- `issue(principal) -> { token, expiresAt, principal }`
- `resolve(token) -> session | null`
- `revoke(token)` and `revokeUser(canonicalUsername)`
- Socket principal shape: `{ kind: 'account', username, canonicalUsername, role, userId }` or `{ kind: 'guest', username, canonicalUsername, role: 'guest' }`

- [ ] **Step 1: Write failing session tests**

Test issuance, expiry, token revocation, and `revokeUser` invalidating every session for one account while leaving other users untouched.

- [ ] **Step 2: Run RED**

Run: `node --test tests/auth-v2/session-store.test.js`

- [ ] **Step 3: Implement the session store and Socket.IO handshake resolution**

Create one store at process scope. In `io.use`, read `socket.handshake.auth?.sessionToken`; resolve it; if valid attach `socket.principal` before `connection`. Invalid/missing tokens do not reject the socket because guests are still supported.

- [ ] **Step 4: Add `account login`, `account logout`, and `account session` socket events**

`account login` uses the account service, reuses the current auth failure window/lock strategy, issues a session, attaches the principal immediately, and returns only token/session/identity metadata—never the password hash. `account logout` revokes the token and clears the principal.

- [ ] **Step 5: Run tests GREEN and commit**

Commit: `feat: add Auth v2 account sessions`

---

### Task 4: Server-authoritative room identity and guest compatibility

**Files:**
- Create: `tests/auth-v2/room-identity.test.js`
- Modify: `index.js` `join room`, reconnect/admin-token handling, and user state setup

**Interfaces:**
- Authenticated join uses `socket.principal.username` and ignores payload `username`.
- Guest join canonicalizes payload `username` and calls `accountService.isRegisteredUsername()` before joining.

- [ ] **Step 1: Write failing policy tests**

Cover: guest `Dizygotic`, `dIzYgOtIc`, `Psybin`, and any registered user are rejected; an ordinary unregistered guest such as `ShittyChat` is accepted; authenticated `Dizygotic` cannot be renamed by sending `{ username: 'NotDizy' }`; room password remains independent from account role.

- [ ] **Step 2: Run RED**

Run: `node --test tests/auth-v2/room-identity.test.js`

- [ ] **Step 3: Update `join room`**

Resolve the effective identity before any room membership mutation. Set `socket.username`, `socket.canonicalUsername`, `socket.identityKind`, and `socket.role` from the resolved principal/guest identity. Remove `adminToken` as an identity escalation mechanism.

- [ ] **Step 4: Preserve ShittyChat/guest behavior**

Do not require registration, email, or account password for guest joins. Existing public room discovery and room-password checks remain intact.

- [ ] **Step 5: Run tests GREEN and commit**

Commit: `feat: protect registered names from guest impersonation`

---

### Task 5: Replace admin-password authority with account roles

**Files:**
- Create: `src/auth/authorization.js`
- Create: `tests/auth-v2/authorization.test.js`
- Modify: `index.js` all privileged/moderation handlers

**Interfaces:**
- `hasRole(principal, ...roles) -> boolean`
- `requireModerator(socket) -> principal | null` accepts `owner` or `admin`
- `requireOwner(socket) -> principal | null` accepts only `owner`

- [ ] **Step 1: Write failing authorization tests**

Test owner and admin moderation access, user/guest rejection, and owner-only account-management access.

- [ ] **Step 2: Run RED**

Run: `node --test tests/auth-v2/authorization.test.js`

- [ ] **Step 3: Convert every privileged handler**

Search `index.js` for `socket.isAdmin`, `adminToken`, `resolveAdminSession`, `issueAdminSession`, and `admin auth`. Replace authorization decisions with the server-side principal helpers. Remove the post-join `admin auth` event once no handler depends on it.

- [ ] **Step 4: Add owner-controlled managed-user event**

Add `account manage user` requiring `requireOwner(socket)`. Accept `{ username, password, role }`, allow only `user|admin`, never allow creating/replacing `owner`, hash the supplied password immediately, and return sanitized account metadata. This is the first safe owner-controlled account creation/activation path; UI for bulk account administration is out of scope.

- [ ] **Step 5: Extend tests to prove client-supplied role/admin flags do nothing, run GREEN, commit**

Commit: `feat: derive moderation authority from accounts`

---

### Task 6: Browser Auth v2 flow and room-password URL removal

**Files:**
- Modify: `public/login.html`
- Modify: `public/chat.js`
- Modify: `public/chat.css`
- Create: `tests/auth-v2/client-contract.test.js`

**Interfaces:**
- Session storage key: `dizychat-account-session-v2`
- Client account state: `{ token, expiresAt, username, canonicalUsername, role }`
- URL contains only non-secret room navigation state.

- [ ] **Step 1: Write failing source-level regression tests**

Assert the client no longer defines/uses `admin-password`, no longer emits `admin auth`, no longer reads `urlParams.get('password')`, and `updateQueryParams` never writes a password. Assert the registered-login controls and guest-mode controls exist.

- [ ] **Step 2: Run RED**

Run: `node --test tests/auth-v2/client-contract.test.js`

- [ ] **Step 3: Replace the landing UI with explicit Registered / Guest modes**

Registered mode contains account username/password plus room/optional room password and a `Sign in & join` action. Guest mode contains guest display name plus room/optional room password and `Continue as guest`. Remove the special Dizygotic/Psybin admin-password reveal script entirely.

- [ ] **Step 4: Implement session reuse**

Store the server-issued session token in `sessionStorage`, set `socket.auth.sessionToken` before reconnect, restore account metadata on reload when the session is still valid, and clear it on logout/auth rejection. Never store the account password.

- [ ] **Step 5: Remove room-password URL handling**

Delete `prefillPassword = urlParams.get('password')`; change `updateQueryParams(room, password)` to `updateQueryParams(room)`; if an old URL arrives with `password`, strip that key with `history.replaceState` without reading it into room state. Copied join links continue to contain the room only.

- [ ] **Step 6: Add responsive CSS only for the new auth controls**

Keep the larger Huawei P30/mobile clipping repair for the dedicated follow-on mobile slice.

- [ ] **Step 7: Run `npm test` GREEN and commit**

Commit: `feat: add registered and guest Auth v2 client flow`

---

### Task 7: CI/browser proof, migration documentation, and project email

**Files:**
- Modify: `tests/ui-test.cjs`
- Modify: `.github/workflows/self-host-ui-test.yml`
- Modify: `README.md`
- Modify: `docs/security-runbook.md`

**Interfaces:**
- CI migration credential uses existing legacy env input only in the isolated test process.
- New project contact: `dizychat@proton.me`.

- [ ] **Step 1: Extend the UI smoke for both identity modes**

Guest path: join as a unique unregistered guest and assert chat renders. Registered path: use the CI-migrated `Dizygotic` account, sign in, assert returned/displayed role is owner, join the room, then attempt a second guest join using case-variant `dIzYgOtIc` and assert rejection.

- [ ] **Step 2: Add the room-password history regression to Playwright**

Join a protected test room with a password and assert `new URL(page.url()).searchParams.has('password') === false` before and after joining, reconnecting, and copying the join link.

- [ ] **Step 3: Give isolated CI a migration-only owner credential**

In the server-start step set `ADMIN_USERNAME=Dizygotic` and an isolated `ADMIN_PASSWORD` test value. The runtime must migrate it to the account hash and must never expose it to the browser/log output.

- [ ] **Step 4: Update docs**

Document Auth v2 roles, migration order, removal of admin passwords after account confirmation, guest compatibility, room-password URL prohibition, and `dizychat@proton.me` as the project contact where a DizyChat contact address is appropriate.

- [ ] **Step 5: Run the full local-equivalent gate**

Run: `npm ci && npm test`
Run server with MongoDB and the isolated migration env, then: `node tests/ui-test.cjs`
Expected: deterministic tests and Chromium smoke all pass.

- [ ] **Step 6: Open a draft PR and require exact-head CI**

PR remains draft/unmerged until the exact final head passes `DizyChat Self-Host CI` plus the existing extension/userscript workflows that trigger for the branch.

- [ ] **Step 7: Commit**

Commit: `test: gate DizyChat Auth v2 migration`
