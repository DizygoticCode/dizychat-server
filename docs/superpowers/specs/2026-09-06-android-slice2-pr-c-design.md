# Android Slice 2 PR C Design

## Goal

Complete the residual Android Slice 2 notification correctness work on top of merged PR B without reimplementing the client/native features PR B already owns.

Base: exact `main` `0806a77b36268a8850747ff1abe5ec3f56984f17`.

PR C is the final Slice 2 completion/reconciliation PR. It closes the remaining master-design gaps around read-control propagation, cross-device/browser notification reconciliation, durable per-room notification state, messaging-style unread presentation, stable notification identity, and end-to-end deterministic coverage.

## Existing PR B functionality that must be preserved

PR B already provides:

- native push registration and FCM token rotation;
- stable Android install/device identity;
- notification permission after successful room admission;
- foreground + screen-interactive suppression lease wiring;
- one Android notification per room using stable server-provided `notificationKey`;
- notification tap routing to room/message;
- inline Reply through authenticated DizyChat semantics;
- Mark as read through the authoritative read-state endpoint;
- encrypted background mobile bearer access;
- canonical shared chat-message persistence;
- permanent invalid-token retirement for ordinary message sends;
- browser-mode inertness.

PR C must reuse those paths and must not add a second reply, auth, persistence, or room-authority model.

## Residual scope

### 1. Authoritative read-control propagation

Replace the current `pushCoordinator.sendRoomClear()` no-op with real account+room read-control delivery.

Whenever the authoritative account+room read cursor advances, the server sends an idempotent control intent to every active Android push registration for that account. The control identifies the room and authoritative cursor tuple sufficiently for the device to decide whether its local notification is stale.

Control delivery is best-effort and asynchronous. A failure must never roll back the read cursor or fail the original chat/read operation.

Permanent FCM token errors retire only the affected token registration. Temporary transport failures preserve all device, subscription, session, and read state.

### 2. FCM transport contract

Extend the existing allowlisted data-only transport so it can send exactly two intent kinds:

- ordinary room message;
- read-control reconciliation.

No auth/session/server secret may appear in either payload.

The read-control payload must include an explicit type discriminator and the minimum room/cursor fields needed by Android. Older/out-of-order controls must be harmless.

### 3. Read-cursor advancement integration

Every supported read path must converge on the same `readStateService.advanceCursor()` authority and trigger read-control propagation only after a real advancement.

This includes:

- browser/in-app read-state mark;
- Android chat view using the same HTTP/socket read authority;
- notification `Mark as read`.

An equal or older cursor must not emit a misleading newer clear event.

### 4. Android durable per-room notification state

Add a focused local notification-state store under the Android native boundary.

For each room notification retain only the minimum non-secret state required for deterministic reconciliation, including:

- stable notification identity;
- latest represented message id and server timestamp;
- bounded recent unread display entries required for MessagingStyle;
- latest known authoritative read cursor for that room.

State remains private to the app and contains no bearer token or server credential.

### 5. MessagingStyle room notifications

Upgrade room notification presentation from latest-only BigTextStyle to Android MessagingStyle with a bounded recent unread history.

Requirements:

- multiple unread messages in one room update one notification;
- recent sender/preview entries are retained in order;
- latest message remains the action/tap target;
- safe attachment previews from the server are displayed as human labels;
- if historical state is unavailable or unusable, latest-preview fallback remains correct;
- another room uses a separate notification.

### 6. Stable notification-id collision handling

Do not rely solely on Java `String.hashCode()` for persistent room notification identity.

Use the server-provided stable `notificationKey` as the logical identity and maintain a private persisted mapping to Android integer notification IDs. Mapping must remain stable across process restarts and must resolve collisions deterministically without clearing or overwriting another room's notification.

### 7. Android read-control handling

The custom Firebase service distinguishes ordinary message intents from read-control intents.

For a read-control intent:

- compare the authoritative cursor with the latest message represented by that room's stored notification state;
- clear the room notification only when all represented unread content is at or behind the cursor;
- otherwise update retained state without discarding newer unread messages;
- never clear unrelated room notifications;
- never fabricate or advance server read state locally;
- ignore stale/out-of-order older control cursors.

### 8. Startup/reconnect reconciliation

On native app startup and authenticated reconnect/room readiness, reconcile persisted room notification state with authoritative server read cursors.

The web/native runtime fetches current read state for rooms represented in local notification state using the existing authenticated backend origin and mobile bearer. Android applies the returned cursor(s) using the same local reconciliation logic as FCM read-control messages.

If auth is missing/revoked or network is unavailable, retain notifications rather than falsely clearing them and retry on a later authenticated foreground/reconnect transition.

### 9. Cross-device and browser-read correctness

The final system must prove:

- browser merely open does not suppress Android push;
- browser actually reading/marking a room read advances the account cursor and reconciles Android notifications;
- one Android device marking read reconciles the same room notification on another device for that account;
- per-device room subscription and foreground suppression remain independent;
- one room's read-control never clears another room.

## Security invariants

- DizyChat server remains authoritative for auth, room membership, reply authorization, read state, and message persistence.
- FCM payloads are display/routing/reconciliation hints only.
- No mobile bearer, browser token, room password, Mongo/Firebase credential, signing secret, or server secret enters FCM payloads or notification-state storage.
- Read-control delivery cannot mutate chat or read state on the device.
- Notification actions continue to use the AndroidKeyStore-protected mobile bearer and existing PR B authenticated endpoints.
- Browser behaviour remains unchanged.
- Push disabled/unconfigured must leave ordinary DizyChat chat/read flows functional.

## Error handling

### Permanent FCM token error

Retire only the affected push registration. Do not revoke the mobile session or delete account/room read state.

### Temporary FCM/network error

Keep all state. Chat persistence and read advancement stay successful. Reconciliation retries on future server events or client reconnect.

### Missing/revoked mobile session during startup reconciliation

Do not clear local notifications based on unauthenticated assumptions. Route normal app auth flow and retry after a valid mobile session exists.

### Corrupt local notification state

Drop only the corrupt room entry and preserve other room mappings. A later push can recreate that room state.

### Out-of-order read controls

Ignore any control cursor older than or equal to the latest authoritative cursor already applied locally.

## Deterministic regression requirements

PR C adds focused deterministic tests proving at minimum:

1. `sendRoomClear()` targets all active devices for the canonical account and correct room;
2. read-control payloads are allowlisted, data-only, and contain no credentials;
3. permanent read-control FCM failure retires only that token;
4. temporary read-control FCM failure preserves state and read advancement;
5. a cursor advancement emits read-control only after real monotonic advancement;
6. equal/older cursor attempts do not emit a newer clear control;
7. Android distinguishes message vs read-control intents;
8. multiple unread messages in one room retain one notification identity;
9. MessagingStyle retains bounded recent unread sender/preview history;
10. latest unread message remains the action/tap target;
11. separate rooms remain separate notifications;
12. safe attachment labels remain human-readable and raw upload URLs are not required for display;
13. stable notification-id mapping survives restart and resolves collisions without cross-room overwrite;
14. newer unread content survives an older read-control;
15. a read-control through the latest represented message clears only that room;
16. out-of-order read-control cannot roll local state backwards;
17. startup/reconnect reconciliation clears notifications already read elsewhere;
18. reconciliation failure due to missing auth/network retains notifications;
19. browser read and Android Mark-as-read converge on the same account+room cursor and control path;
20. disabled/unconfigured push transport leaves ordinary DizyChat message/read flows unchanged;
21. deterministic CI uses no live Firebase credential.

Existing Slice 1, PR A, and PR B deterministic contracts must remain green.

## Exact-head CI gate

The final PR C head is accepted only when the same exact SHA passes:

1. full deterministic test suite;
2. focused Slice 2/PR C tests;
3. Android packaged-asset preparation;
4. `cap sync android`;
5. real Gradle unsigned debug APK build;
6. debug APK artifact upload;
7. Self-Host configuration and LiveKit smoke;
8. local browser/UI smoke;
9. mobile shell regression;
10. registered-account navigation regression.

No earlier green SHA counts after a later patch.

## Real-device acceptance after merge

After PR C is integrated, the resulting Android build is the first Slice 2 feature-complete DizyChat app candidate. Real Android hardware must then prove the master design acceptance matrix, including foreground suppression, locked/background/swiped-away delivery, same-room notification updating, separate-room notifications, exact tap routing, Reply, Mark as read, browser-read clearing, multi-device reconciliation, logout/revocation, and restart reconciliation.

Live push additionally requires deployment of the external Firebase Android config and server credentials. Those remain outside Git.

## Non-goals

PR C does not:

- reimplement PR B Reply/tap/Mark-as-read endpoints;
- add iOS push;
- change browser relative-media behaviour;
- move identity, rooms, messaging, or read authority into Firebase;
- use FCM topics;
- add Google Play distribution;
- solve unrelated Safari/iPhone media compatibility;
- refactor unrelated chat code.
