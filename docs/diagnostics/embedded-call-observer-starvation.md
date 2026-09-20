# Embedded call observer starvation investigation

Compared baseline `61d9ac7e880acc7bdbd342a9361e8dd123af3996` and deployed
`71d5983b2c1d72dbe7bb2d389c65ef165c08fd0e` before changing production code.

## Evidence and limits

Only `public/embedded-call-view.js` and `tests/embedded-call-view.test.js`
changed between these commits. `public/chat.js` has blob
`1bb67655654a453fe9b762f00ef08a4ff807e4db` at both revisions and remains unchanged
by this fix. All production differences between the historical revisions are
inside screen-share start/publication code. Bootstrap, presentation synchronization,
MutationObservers, bridge installation, and disconnect cleanup are identical.
None of the changed screen-share functions executes on a fresh join before a
Share Screen action.

A deterministic reproduction, executed before the fix, gave the same results for
both historical versions:

| Input | 61d9ac7 | 71d5983 |
| --- | --- | --- |
| Audio-only panel | Observer queue settles | Observer queue settles |
| Camera tile before connected-room bridge | Still looping at 30 callback rounds | Still looping at 30 callback rounds |
| Screen-share tile before connected-room bridge | Still looping at 30 callback rounds | Still looping at 30 callback rounds |

This proves a shared defect. It does **not** establish a newly introduced
pre-share join regression in 71d5983. The reported change in live behavior needs
session evidence: incoming video publications/tile creation, any prior share or
reconnection, and the exact JavaScript assets loaded by that browser. No live
Chrome trace or affected-session DOM was available in this investigation.

## Proven loop

1. `adoptPanel()` observes `.call-video-grid` with `childList`, `subtree`, and
   `class` attribute observation enabled.
2. Adding any `.call-video-tile` invokes `syncPresentation()`.
3. That callback unconditionally calls `classList.add('dizy-primary-media')`
   on screen tiles or `classList.remove('dizy-primary-media')` on camera tiles.
4. DOMTokenList add/remove update the existing class attribute even when its
   token membership is unchanged. The update queues another observed mutation.
5. Every observer delivery creates another delivery. The browser cannot finish
   its microtask checkpoint to service painting, input, timers, or network tasks.

A plain reentrancy boolean would not fix this: observer delivery is asynchronous,
so the flag would already be reset when the next delivery runs. A timeout around
publishing cannot fire while this loop starves the event loop.

## Why the last painted status can be Connecting to LiveKit

`chat.js` registers `TrackSubscribed` before `await room.connect(...)`, with
`autoSubscribe: true`. Its handler attaches remote video tiles immediately.
The explicit embedded room bridge is published only after connect resolves.

In LiveKit client SDK v2.22.2, `Room.onTrackAdded()` defers tracks seen while
connecting until `RoomEvent.Connected`; `attemptConnection()` sets the connected
state and emits that event before returning. An incoming video track can
therefore create a tile around connection completion, before the embedded
room bridge or before the browser repaints the next status. The grid observer
already exists and does not need `state.room` to start the loop.

A remote camera/share at that boundary is a sufficient explanation for a
pre-share freeze. An audio-only join followed by local screen preview gives the
later freeze reported for 61d9ac7. Which condition occurred in the user's live
session remains unverified. If no video tile existed, this loop alone cannot
explain that session's hang.

SDK source inspected:
https://github.com/livekit/client-sdk-js/blob/v2.22.2/src/room/Room.ts
DOMTokenList algorithms:
https://dom.spec.whatwg.org/#interface-domtokenlist

## Other paths inspected

- The body observer disconnects after adopting the panel. The toolbar is outside
  the video grid; its text writes are not observed by the grid observer.
- The panel observer watches only its own hidden/class attributes, not subtree
  presentation writes. The messages observer watches only message children.
- `syncRoomBridge()` installs handlers once per room and does not publish another
  bridge event or call `connect()`/`disconnect()`.
- The embedded disconnect handler clears screen state and presentation. It does
  not disconnect the room, and screen unpublishing only runs when a published
  local screen track exists. These paths are unchanged in the comparison.
- `chat.js` calls `leaveCall()` on Disconnected. SDK v2.22.2 sets Disconnected
  before emitting that event and makes subsequent disconnect calls return when
  already disconnected. No new synchronous recursion was found in this path.

## Targeted fix and verification

Replace the two unconditional class add/remove calls with forced
`classList.toggle(name, true/false)`. Forced toggle does not update the attribute
when membership already matches. A screen tile may require one extra delivery
to apply its primary class, then the observer queue settles.

No production timers, SDK patches, join changes, capture redesign, or audio
routing changes were added. Browser capture remains video-only. Rocksmith's
Windows WDM/WASAPI -> LONTIUM HDMI -> TV route is untouched.

`npm test` includes five behavioral regressions exercising the real embedded
module against a bounded DOM/observer model. Four failed before the production
fix and all five passed afterward. The full local suite passed 368 tests after
installing dependencies.

The existing Self-Host CI additionally runs `tests/embedded-call-browser-test.cjs`
in real Chromium. It characterizes both historical revisions, verifies the
fixed observer settles with audio/camera/screen tiles, and exercises connected
bridge -> Share Screen -> Stop Screen -> disconnect -> rejoin. Its observer
cutoff is test-only instrumentation to report loops without hanging CI.
LiveKit signaling and capture devices are stubbed in this fixture; it is not an
end-to-end live server or Rocksmith test. Android Slice 1 CI runs unchanged on
the PR. Refer to the PR checks for their actual results.

Production acceptance still requires joining the affected room (with any remote
camera/share present), then starting/stopping video-only Rocksmith sharing and
confirming the page stays responsive and TV playback continues.
