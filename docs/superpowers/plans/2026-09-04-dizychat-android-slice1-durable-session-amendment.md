# DizyChat Android Slice 1 Durable Session Amendment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MongoDB-backed, revocable Android device-session contract so the private DizyChat APK remains signed in across app/device/server restarts without changing normal website session lifetime.

**Architecture:** Keep existing process-local Auth v2 sessions for browsers. Add a separate durable mobile-session model/service that stores only SHA-256 token hashes, resolves the current account on every authentication, and plugs into the existing Socket.IO principal boundary. Android receives the raw opaque token once and later stores it only in the Keystore-backed client adapter defined by the parent Slice 1 plan.

**Tech Stack:** Node.js 22, Mongoose 7.8, Socket.IO 4.8, Node `crypto`, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-dizychat-android-slice1-durable-session-amendment.md`

## Global Constraints

- Existing browser Auth v2 session issuance/lifetime stays unchanged.
- Mobile token format is versioned and opaque: `dcm1.<secret>`.
- Mobile token secret contains at least 256 bits of randomness.
- MongoDB stores only SHA-256 token hashes, never raw mobile tokens.
- Durable mobile sessions have no automatic TTL in Slice 1 and remain valid until logout/revocation/account invalidation.
- Disabled/non-active accounts cannot resolve a durable mobile token.
- Downstream authorization continues using the existing account-principal shape and current server-side role.
- No APK secret or client-side shared secret is treated as an authorization boundary.

---

### Task A1: Durable mobile-session service

**Files:**
- Create: `src/models/mobile-session.js`
- Create: `src/auth/mobile-session-service.js`
- Test: `tests/mobile-device-session.test.js`

**Interfaces:**
- `createMobileSessionService({ MobileSessionModel, UserModel, tokenFactory?, now? })`
- `issue(principal, metadata?) -> Promise<{ token, principal, kind: 'mobile' }>`
- `resolve(token) -> Promise<{ token, principal, kind: 'mobile' } | null>`
- `revoke(token) -> Promise<boolean>`
- `revokeUser(username) -> Promise<number>`

- [ ] **Step 1: Write failing service tests**

Cover issuance hash-only persistence, malformed/unknown token rejection, resolution against an active current account, disabled-account rejection, idempotent revocation, and service recreation against the same backing model.

- [ ] **Step 2: Run RED**

Run: `node --test tests/mobile-device-session.test.js`

Expected: FAIL because `src/auth/mobile-session-service.js` does not exist.

- [ ] **Step 3: Implement minimal model/service**

`src/models/mobile-session.js` fields:

```js
{
  tokenHash: { type: String, required: true, unique: true, index: true },
  canonicalUsername: { type: String, required: true, index: true, lowercase: true, trim: true },
  userId: { type: String, default: '' },
  deviceLabel: { type: String, default: 'Android', maxlength: 120 },
  revokedAt: { type: Date, default: null, index: true }
}
```

Use timestamps and no TTL index.

`mobile-session-service.js` must generate `dcm1.` + `crypto.randomBytes(32).toString('base64url')` by default and hash the complete raw token with SHA-256 hex. `resolve()` looks up an unrevoked hash, then loads the current account by canonical username and accepts only `state === 'active'`; build the same `{ kind:'account', username, canonicalUsername, role, userId }` principal shape used by Auth v2.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/mobile-device-session.test.js`

Expected: PASS.

- [ ] **Step 5: Run full deterministic suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add durable mobile device sessions`

---

### Task A2: Socket.IO mobile-session integration

**Files:**
- Modify: `index.js`
- Test: `tests/mobile-device-session-wiring.test.js`

**Interfaces:**
- `resolveAccountSessionToken(token)` asynchronously resolves browser first, then durable mobile.
- `revokeAccountSessionToken(token)` revokes whichever session kind owns the token.
- Existing `socket.principal` and `socket.accountSessionToken` shape remains downstream-compatible.
- `account login` accepts `payload.sessionKind === 'mobile'` only from a trusted native origin; otherwise browser issuance remains unchanged.

- [ ] **Step 1: Write failing wiring tests**

Assert source/wiring contract for model/service construction, async Socket.IO authentication, mobile issuance only for trusted native origin, `account session` durable resolution, and logout revocation by token kind.

- [ ] **Step 2: Run RED**

Run: `node --test tests/mobile-device-session-wiring.test.js`

Expected: FAIL against current `index.js`.

- [ ] **Step 3: Implement exact integration**

Import `MobileSession`, construct the service beside `accountSessions`, and create helpers that keep browser resolution synchronous internally but expose one async resolution boundary. Convert `io.use` and `account session` to async-safe handling. In `account login`, keep existing credential checks/rate limits unchanged; after successful authentication issue either the existing browser session or a durable mobile session when `sessionKind === 'mobile'` and the socket Origin is in the trusted native-origin set. On logout revoke the matching token kind.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/mobile-device-session.test.js tests/mobile-device-session-wiring.test.js`

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: wire durable mobile sessions into auth`

---

### Task A3: Continue parent Android Slice 1 plan

After A1/A2 are green, resume `docs/superpowers/plans/2026-09-04-dizychat-android-slice1.md` with these corrections:

- the native login call must send `sessionKind: 'mobile'`
- native startup restores the Keystore token before Socket.IO connects
- `account session` validation may now survive server restarts through MongoDB
- explicit Android logout revokes the durable server session before local secure clearing
- temporary connectivity failures still retain the Keystore token
- the real-device gate must include a `dizychat.service` restart while the phone is signed in, followed by successful reconnect without login

All other parent-plan tasks remain in force.