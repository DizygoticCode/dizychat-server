# Registered-user Recent Rooms (28 September 2026)

This feature is an account-only convenience, **not remembered room membership**.

- After a server-confirmed room join passes the existing password and ban checks, the server records the room name and join timestamp under the authenticated account's database user ID. The dedicated MongoDB collection stores a maximum of eight most-recent distinct rooms per user; no message history, room password, login token, or exchange credential is stored there.
- Only a valid account session may retrieve or clear its own history, via Socket.IO acknowledgements. The server disregards any caller-provided username/account ID. Guests receive no room history. Browser/Android/Home Screen clients fetch the same server-held history after session restoration.
- The landing page displays the selector only while that exact registered identity is active. Public entries can be selected directly; passworded entries only prefill the room name and explicitly ask for the room password. Every return visit goes through the original server-side access and admission logic, including bans and throttling. No history entry grants access.
- Sign-out hides the list and clears previously entered room names and passwords from the lobby. Stale asynchronous replies are ignored when an account changes or signs out. A user can clear their own list from the landing page.
- An unavailable/deleted room is excluded when history is loaded. Recent-room storage failures are nonfatal for an otherwise authorized join, and retrieval failure leaves the existing manual room selection usable.

Safety and rollout: the server model/service, lobby markup, existing signed-bundle assets, and tests must be reviewed and tested together. The 19-file native web bundle manifest's **file set remains unchanged**; the deployed bundle digest will change, so Android/iOS restart and in-place bundle validation must be checked separately after an approved server release. This PR does not distribute an APK or deploy to production.

Known limitation: the small, bounded timestamp/order update is metadata only; near-simultaneous joins from several devices could overwrite ordering, but cannot grant access or reveal another account's history. Cross-device history depends on the same registered account and a functioning server. The old in-memory per-room password remains session-only and is never entered into the recent-room store.

Tracked by [DizyChat #484](https://github.com/DizygoticCode/dizychat-server/issues/484) and mobile/UI acceptance [#485](https://github.com/DizygoticCode/dizychat-server/issues/485).
