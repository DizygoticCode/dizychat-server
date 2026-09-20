# Embedded Call View Design

## Goal

Replace the current floating LiveKit voice/video panel with a DizyChat-native call surface that is part of the chat layout, supports camera and screen sharing, preserves the full video frame instead of cropping it, and can expand into a full-focus meeting view without leaving the room conversation.

This slice covers the call UI and LiveKit media presentation only. Android background/minimized notifications are a separate follow-up slice because they use native Capacitor notification behavior rather than the browser notification path.

## Current State

DizyChat already has working LiveKit room/token plumbing, microphone mute, optional camera publishing, peer audio controls, and a Music mode selected before joining. The current client creates a fixed `.voice-call-panel` on `document.body`; its video grid is constrained inside that floating panel. The existing call panel exposes Join, Mute, Add video, Leave, master volume, peers, and Music mode selection.

The chat application lives in `public/login.html`, with behavior in `public/chat.js` and layout in `public/chat.css`.

## User Experience

### Embedded call mode

Starting or opening a call must reveal a call stage inside the normal DizyChat chat area rather than showing a floating modal/popup.

On desktop, the default active-call layout is a split view:

- media stage on the left;
- normal chat/messages on the right;
- the existing online-user sidebar remains available when space allows;
- an audio-only call may use a compact stage so chat is not unnecessarily squeezed.

On narrow/mobile screens, the stage appears above the conversation instead of beside it. The media area must use viewport-aware sizing and must not create the current oversized floating popup problem.

### Focus mode

The call stage includes a Focus control.

Focus mode uses the available DizyChat viewport for call media while remaining inside the DizyChat application. It is not a browser-level fullscreen requirement.

- With multiple camera tracks and no screen share, participants are shown in a responsive grid.
- When any participant is screen sharing, the screen share becomes the primary stage and camera participants become secondary thumbnails where available.
- The user can leave Focus mode and return to split chat mode without disconnecting or republishing tracks.

### Chat while focused

While Focus mode is active, new room messages appear as small transient overlays over the call view.

- Show only a small recent stack, not the whole conversation.
- Overlays disappear automatically after a short interval.
- A Chat control opens/closes a conversation drawer over Focus mode.
- On desktop the drawer enters from the right; on mobile it may use the available screen as an overlay sheet.
- Messages remain in the normal conversation history exactly once; overlays are presentation only.

## Media Sources

### Microphone / voice

The existing microphone path remains available. Mute/unmute remains a normal call control.

### Music / Jam mode

The existing Music mode selection remains supported and must remain clearly visible in the new call surface. The selected mode continues to be fixed for the connected LiveKit session if that is the existing server contract.

The UI must clearly indicate when Music mode is active so the user knows the call is using the music-oriented audio settings rather than the normal voice path.

### Camera

Camera remains optional. Enabling it publishes a LiveKit camera track using the current camera path.

Camera tiles must show the complete camera frame by default. Do not use crop-heavy `object-fit: cover` as the default. A future Fill option may be added later, but it is not part of this slice.

### Screen share

Add a Share Screen control for browsers/platforms where the LiveKit/browser screen-capture path is supported.

- The control invokes the normal browser/OS source picker.
- The user may choose a window, tab, or screen according to browser support.
- A Rocksmith window is a normal supported use case.
- Screen share video is published as a LiveKit screen-share track and rendered separately from camera tracks.
- Screen-share video always preserves the complete source frame with `object-fit: contain`; black/neutral bars are preferable to cropping UI or gameplay.
- Ending sharing from DizyChat or from the browser's native "Stop sharing" affordance must remove the screen-share track and update the stage state.

For the current expected Rocksmith use case, screen share alone is valid: camera may remain off.

## Future Picture-in-Picture Compatibility

The stage architecture must not assume screen share and camera are mutually exclusive. A later slice may display the sharer's camera as a movable picture-in-picture over the shared screen.

This slice does not need draggable PiP or automatic OBS-style composition, but its track/state model must keep camera and screen-share identities separate so that future feature does not require another redesign.

## Call Controls

The embedded control strip must provide, at minimum:

- Join / connection state when not connected;
- microphone mute/unmute;
- camera on/off;
- screen share on/off where supported;
- clear Music mode state;
- Chat drawer toggle in Focus mode;
- Split/Focus layout toggle;
- call output/master volume;
- Leave/End.

Less frequently used peer/device controls may remain secondary rather than permanently consuming stage space.

## Track Presentation Rules

Track rendering uses source type rather than only participant identity.

- Screen share is the highest-priority primary stage source.
- Without screen share, active camera tracks form the main grid.
- Without visual tracks, show a compact audio-call state rather than an empty large video rectangle.
- Camera and screen-share elements must use `object-fit: contain` by default.
- Remote audio attachment behavior and existing per-peer audio controls must remain functional.

## Responsive Behavior

Desktop target:

- embedded stage and chat can coexist;
- Focus mode uses the call viewport with optional chat drawer;
- media controls remain reachable without covering the important center of the stage.

Mobile target:

- no fixed-width floating call panel;
- call stage remains within the app viewport and respects safe-area insets;
- media appears above chat in normal mode;
- Focus mode uses the available mobile viewport;
- control strip may wrap/scroll or collapse secondary controls rather than shrinking media to unusable dimensions;
- screen share remains uncropped.

## Compatibility and Scope Boundaries

- Reuse the existing LiveKit token, room, microphone, camera, peer audio, and Music mode plumbing.
- Do not change authentication, room permissions, call-token security, server live/write flags, or deployment configuration as part of this UI slice unless a minimal LiveKit permission change is strictly required for screen-share publishing.
- Do not replace LiveKit.
- Do not add OBS, SonoBus, JackTrip, or external meeting links.
- Do not implement native Android screen capture in this slice. Browser/desktop screen sharing is the initial target; unsupported platforms must simply hide or disable the control cleanly.
- Do not bundle the Android minimized-notification repair into this slice.

## Error Handling

- Permission-denied errors for microphone, camera, or screen capture produce source-specific user messages.
- If screen sharing is unsupported, the call remains usable for audio/camera and the Share Screen control is disabled or hidden.
- If a shared track ends externally, UI state must self-correct without requiring a reconnect.
- Layout mode changes never disconnect the LiveKit room.

## Testing

Add deterministic tests around layout/media state that do not require a real webcam or OS screen-picker dialog.

At minimum verify:

1. inactive call does not occupy embedded stage space;
2. connected audio-only call renders compact embedded state;
3. camera track renders in embedded stage and uses contain-style presentation;
4. screen-share track becomes the primary stage source and uses contain-style presentation;
5. screen-share-ended state removes the stage source cleanly;
6. Focus mode can be entered/exited without changing room connection state;
7. focused incoming messages produce transient overlay items without duplicating normal message history;
8. mobile/narrow layout no longer relies on the fixed `.voice-call-panel` geometry;
9. existing Music mode selection and room join behavior remain covered by regression tests.

## Deployment Validation

After automated tests pass on the feature branch, deploy that branch/revision to the self-hosted DizyChat server for manual layout validation before merging.

Manual checks:

- desktop split call + chat;
- desktop Focus camera grid;
- Rocksmith/window screen share filling the stage without cropping;
- Focus-mode chat overlays and chat drawer;
- mobile embedded stage and Focus mode;
- audio-only call;
- Music mode call;
- camera permission denial;
- stopping screen share using the browser's native stop-sharing control.
