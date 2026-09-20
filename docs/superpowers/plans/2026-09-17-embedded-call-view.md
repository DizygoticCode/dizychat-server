# Embedded Call View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating LiveKit call popup with an embedded DizyChat call stage that supports Focus mode, uncropped camera/screen-share video, transient chat overlays, and desktop browser screen sharing while preserving the existing call/token/music-mode plumbing.

**Architecture:** Add a focused `embedded-call-view.js` presentation/controller loaded after the existing `chat.js`. It adopts the existing `.voice-call-panel` into `#chat-main`, captures the LiveKit Room non-invasively at `Room.connect`, adds screen-share/focus/chat controls, and leaves the current call security and audio plumbing unchanged. A separate stylesheet overrides the old fixed-panel geometry and provides desktop/mobile/focus layouts.

**Tech Stack:** Vanilla browser JavaScript, LiveKit browser SDK already used by DizyChat, CSS, Node `node:test` deterministic tests.

**Spec:** `docs/superpowers/specs/2026-09-17-embedded-call-view-design.md`

## Global Constraints

- Reuse existing LiveKit token, room, microphone, camera, peer-audio, and Music mode behavior.
- Do not alter authentication, call-token security, room permissions, deployment flags, or LiveKit provider configuration.
- Desktop/browser screen sharing only in this slice; packaged Android must hide the control cleanly.
- Screen-share and camera video must preserve the full frame with `object-fit: contain`.
- Android minimized/background notification repair remains a separate follow-up.
- Existing `chat.js` call implementation remains the source of connection/audio truth; the new module is a presentation/media extension.

---

### Task 1: Deterministic embedded-call contract

**Files:**
- Create: `tests/embedded-call-view.test.js`
- Create later: `public/embedded-call-view.js`
- Create later: `public/embedded-call-view.css`

**Interfaces:**
- Consumes: static public asset files and pure exports from `public/embedded-call-view.js`.
- Produces: regression coverage for source classification, focus state, screen-share priority, uncropped media CSS, responsive layout, and bootstrap wiring.

- [ ] **Step 1: Write the failing test**

Create tests that require `public/embedded-call-view.js` and assert the new pure state helpers plus CSS/bootstrap contracts.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/embedded-call-view.test.js`
Expected: FAIL because `public/embedded-call-view.js` does not exist yet.

- [ ] **Step 3: Commit the red test**

Commit message: `test: define embedded call view contract`

### Task 2: Embedded stage and Focus/chat presentation

**Files:**
- Create: `public/embedded-call-view.js`
- Create: `public/embedded-call-view.css`

**Interfaces:**
- Consumes: existing `.voice-call-panel`, `#chat-main`, `#chat-content`, `#messages`, and `.call-video-grid` created by `chat.js`.
- Produces: `window.dizyEmbeddedCallView`, `classifyTrackSource(publication, track)`, `derivePresentationState(input)`, embedded stage DOM, Focus toggle, chat drawer toggle, and transient focused-message overlays.

- [ ] **Step 1: Implement pure presentation helpers**

`classifyTrackSource()` returns `screen_share` or `camera`; `derivePresentationState()` makes screen share primary, cameras secondary, and audio-only compact when no visual source exists.

- [ ] **Step 2: Adopt the existing call panel into the chat layout**

Create `.dizy-call-stage`, move `.voice-call-panel` into it, mirror panel hidden state onto stage visibility, and add Focus/Chat controls without changing call connection handlers.

- [ ] **Step 3: Add Focus-mode chat overlays/drawer**

Observe only newly-added message nodes while focused, show at most three short-lived presentation copies, and use the existing `#chat-content` as the drawer so message history is never duplicated.

- [ ] **Step 4: Add responsive CSS**

Override fixed panel positioning, give desktop an embedded split stage, stack stage above chat on narrow screens, use app-level Focus mode below the DizyChat header, and force call video elements to `object-fit: contain`.

- [ ] **Step 5: Run focused test**

Run: `node --test tests/embedded-call-view.test.js`
Expected: PASS.

### Task 3: LiveKit screen sharing

**Files:**
- Modify: `public/embedded-call-view.js`

**Interfaces:**
- Consumes: LiveKit `Room.prototype.connect`, `room.localParticipant.setScreenShareEnabled`, `Track.Source.ScreenShare`, room track events.
- Produces: Share Screen toggle, local screen-share tile, remote screen-share primary classification, and self-correcting stop-sharing state.

- [ ] **Step 1: Capture the existing LiveKit Room without replacing call plumbing**

Patch the SDK `Room.prototype.connect` after the lazy SDK loads, retaining the original method and storing the connected room only for presentation/screen-share control.

- [ ] **Step 2: Implement desktop/browser Share Screen**

Use `setScreenShareEnabled(true/false)` on the existing local participant. Hide the control for native Capacitor and browsers without display-capture support.

- [ ] **Step 3: Render local share and classify remote shares**

Attach the local screen track into the existing video grid, mark screen-share tiles as primary, and classify remote subscribed tracks after the existing call renderer attaches them.

- [ ] **Step 4: Handle native/browser stop-sharing**

Listen for local unpublish/track-ended events and remove the local screen tile/update control state without disconnecting the room.

- [ ] **Step 5: Re-run focused test**

Run: `node --test tests/embedded-call-view.test.js`
Expected: PASS.

### Task 4: Bootstrap integration and full gate

**Files:**
- Modify: `public/mobile-bootstrap.js`

**Interfaces:**
- Consumes: existing sequential asset loader.
- Produces: `/embedded-call-view.js` loaded immediately after `/chat.js`; the module loads its own stylesheet once.

- [ ] **Step 1: Wire the embedded call module after chat.js**

Add `await loadScript('/embedded-call-view.js');` immediately after the existing chat script load, before auth UI finalization.

- [ ] **Step 2: Run deterministic suite**

Run: `npm test`
Expected: all deterministic tests PASS.

- [ ] **Step 3: Verify branch diff is scoped**

Confirm only spec/plan, embedded-call assets/test, and bootstrap wiring changed; no auth/security/server/deployment behavior changed.

- [ ] **Step 4: Commit implementation**

Commit message: `feat: embed LiveKit call view with screen sharing`

### Task 5: Self-hosted manual validation and docs follow-up

**Files:**
- Update only after successful manual validation: `README.md` and/or `ROADMAP.md` if present/relevant.

**Interfaces:**
- Consumes: green feature-branch revision deployed manually to `dizyserver`.
- Produces: validated shipped behavior and accurate project documentation.

- [ ] **Step 1: Provide exact server fetch/checkout/restart commands**

User runs the commands over SSH; ChatGPT does not claim direct server access.

- [ ] **Step 2: Manually validate**

Check embedded desktop call, Focus mode, Rocksmith/VLC window sharing without cropping, message overlays/drawer, audio-only, Music mode, mobile layout, and native Stop Sharing behavior.

- [ ] **Step 3: Update docs only after validation**

Document only the behavior confirmed working on the self-hosted deployment.
