'use strict';

(function initEmbeddedCallModule(factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (typeof window !== 'undefined' && window.document) {
    window.dizyEmbeddedCallView = api;
    api.bootstrap(window);
  }
})(function createEmbeddedCallModule() {
  const SCREEN_SHARE_TRACK_NAME = 'dizy-screen-share';
  const SCREEN_SHARE_AUDIO_TRACK_NAME = 'dizy-screen-share-audio';
  const MAX_MESSAGE_OVERLAYS = 3;
  const MESSAGE_OVERLAY_TTL_MS = 4600;

  const normalizeSource = (value) => String(value || '').trim().toLowerCase();

  const classifyTrackSource = (publication = {}, track = {}) => {
    const values = [
      publication.source,
      publication.trackName,
      publication.name,
      publication.track?.source,
      publication.track?.name,
      track.source,
      track.name,
    ].map(normalizeSource);

    if (values.some((value) =>
      value === 'screen_share' ||
      value === 'screen_share_audio' ||
      value === SCREEN_SHARE_TRACK_NAME ||
      value.includes('screenshare') ||
      value.includes('screen-share')
    )) {
      return 'screen_share';
    }

    return 'camera';
  };

  const derivePresentationState = ({
    connected = false,
    focus = false,
    cameraCount = 0,
    screenShareCount = 0,
  } = {}) => {
    const screens = Math.max(0, Number(screenShareCount) || 0);
    const cameras = Math.max(0, Number(cameraCount) || 0);
    const hasVisuals = screens > 0 || cameras > 0;
    let mode = 'audio';
    let primary = null;

    if (screens > 0) {
      mode = 'screen-share';
      primary = 'screen_share';
    } else if (cameras > 0) {
      mode = 'camera-grid';
      primary = 'camera';
    }

    return {
      connected: Boolean(connected),
      focus: Boolean(focus),
      mode,
      primary,
      hasVisuals,
    };
  };

  const canShareScreen = ({ native = false, hasDisplayCapture = false } = {}) =>
    !native && Boolean(hasDisplayCapture);

  // Publish audio for the user-selected display surface when Chrome supplies it.
  // The capture request asks Chromium to exclude this tab's own playback where supported,
  // while windowAudio prefers the selected application's audio over a whole-system mix.
  const shouldPublishDisplayAudio = (videoMediaTrack) => {
    const surface = String(videoMediaTrack?.getSettings?.().displaySurface || '').toLowerCase();
    return surface === 'window' || surface === 'browser' || surface === 'tab' || surface === 'monitor' || surface === 'screen';
  };

  const isNativeRuntime = (hostWindow) => {
    try {
      if (hostWindow?.Capacitor?.isNativePlatform?.()) return true;
    } catch (_error) {
      // Browser path remains available when Capacitor is absent or incomplete.
    }

    const protocol = String(hostWindow?.location?.protocol || '').toLowerCase();
    return protocol === 'capacitor:' || protocol === 'file:';
  };

  const bootstrap = (hostWindow) => {
    const doc = hostWindow?.document;
    if (!doc || hostWindow.__dizyEmbeddedCallBootstrapped) return;
    hostWindow.__dizyEmbeddedCallBootstrapped = true;

    const state = {
      room: null,
      sdk: null,
      stage: null,
      panel: null,
      videoGrid: null,
      toolbar: null,
      screenButton: null,
      focusButton: null,
      chatButton: null,
      overlays: null,
      panelObserver: null,
      bodyObserver: null,
      messagesObserver: null,
      focus: false,
      chatDrawerOpen: false,
      localScreenStream: null,
      localScreenMediaTrack: null,
      localScreenTrack: null,
      localScreenAudioTrack: null,
      localScreenPublication: null,
      roomHandlersInstalled: false,
      screenBusy: false,
    };

    const loadStylesheet = () => {
      if (doc.querySelector('link[data-dizy-embedded-call-style]')) return;
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/embedded-call-view.css';
      link.dataset.dizyEmbeddedCallStyle = 'true';
      doc.head.appendChild(link);
    };

    const getChatMain = () => doc.getElementById('chat-main');
    const getChatContent = () => doc.getElementById('chat-content');
    const getMessages = () => doc.getElementById('messages');

    const syncPresentation = () => {
      const stage = state.stage;
      if (!stage) return;

      const tiles = [...stage.querySelectorAll('.call-video-tile')];
      const screenTiles = tiles.filter((tile) => tile.classList.contains('dizy-screen-share-tile'));
      const cameraTiles = tiles.filter((tile) => !tile.classList.contains('dizy-screen-share-tile'));
      const presentation = derivePresentationState({
        connected: Boolean(state.room),
        focus: state.focus,
        cameraCount: cameraTiles.length,
        screenShareCount: screenTiles.length,
      });

      const chatMain = getChatMain();
      chatMain?.classList.toggle('dizy-call-audio-only', !presentation.hasVisuals);
      chatMain?.classList.toggle('dizy-call-has-visuals', presentation.hasVisuals);

      stage.dataset.presentation = presentation.mode;
      stage.classList.toggle('has-visuals', presentation.hasVisuals);
      stage.classList.toggle('has-screen-share', presentation.mode === 'screen-share');
      stage.classList.toggle('audio-only', presentation.mode === 'audio');

      // The grid observer watches these classes. add/remove enqueue an attribute
      // mutation even if unchanged, endlessly retriggering this observer callback.
      // Forced toggle is a no-op when the requested membership already matches.
      for (const tile of screenTiles) tile.classList.toggle('dizy-primary-media', true);
      for (const tile of cameraTiles) tile.classList.toggle('dizy-primary-media', false);

      if (state.screenButton) {
        const supported = canShareScreen({
          native: isNativeRuntime(hostWindow),
          hasDisplayCapture: Boolean(hostWindow.navigator?.mediaDevices?.getDisplayMedia),
        });
        state.screenButton.hidden = !supported;
        state.screenButton.disabled = !state.room || state.screenBusy;
        const active = Boolean(state.localScreenMediaTrack);
        state.screenButton.classList.toggle('is-active', active);
        state.screenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
        state.screenButton.textContent = active ? 'Stop Screen' : 'Share Screen';
      }

      if (state.focusButton) {
        state.focusButton.hidden = !presentation.hasVisuals;
        state.focusButton.setAttribute('aria-pressed', state.focus ? 'true' : 'false');
        state.focusButton.textContent = state.focus ? 'Exit Focus' : 'Focus';
      }

      if (state.chatButton) {
        state.chatButton.hidden = !presentation.hasVisuals;
        state.chatButton.setAttribute('aria-pressed', state.chatDrawerOpen ? 'true' : 'false');
      }
    };

    const setStageVisible = (visible) => {
      if (!state.stage) return;
      state.stage.hidden = !visible;
      const chatMain = getChatMain();
      chatMain?.classList.toggle('dizy-call-layout', Boolean(visible));
      if (!visible && state.focus) setFocus(false);
    };

    const syncPanelVisibility = () => {
      if (!state.panel) return;
      setStageVisible(!state.panel.hidden);
      syncPresentation();
    };

    const setChatDrawer = (open) => {
      state.chatDrawerOpen = Boolean(open) && state.focus;
      const chatContent = getChatContent();
      chatContent?.classList.toggle('dizy-call-chat-drawer-open', state.chatDrawerOpen);
      doc.body.classList.toggle('dizy-call-chat-open', state.chatDrawerOpen);
      syncPresentation();
    };

    function setFocus(enabled) {
      state.focus = Boolean(enabled);
      if (!state.stage) return;
      state.stage.classList.toggle('is-focus', state.focus);
      doc.body.classList.toggle('dizy-call-focus-active', state.focus);
      if (!state.focus) setChatDrawer(false);
      syncPresentation();
    }

    const addMessageOverlay = (messageNode) => {
      if (!state.focus || !state.overlays || state.chatDrawerOpen) return;
      const raw = String(messageNode?.innerText || messageNode?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) return;
      const text = raw.length > 180 ? `${raw.slice(0, 177)}…` : raw;

      const item = doc.createElement('div');
      item.className = 'dizy-call-message-overlay';
      item.textContent = text;
      state.overlays.appendChild(item);

      while (state.overlays.childElementCount > MAX_MESSAGE_OVERLAYS) {
        state.overlays.firstElementChild?.remove();
      }

      hostWindow.setTimeout(() => item.remove(), MESSAGE_OVERLAY_TTL_MS);
    };

    const observeMessages = () => {
      state.messagesObserver?.disconnect();
      const messages = getMessages();
      if (!messages || typeof hostWindow.MutationObserver !== 'function') return;

      state.messagesObserver = new hostWindow.MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) {
            if (node?.nodeType === 1) addMessageOverlay(node);
          }
        }
      });
      state.messagesObserver.observe(messages, { childList: true });
    };

    const createToolbar = () => {
      const toolbar = doc.createElement('div');
      toolbar.className = 'dizy-call-stage-toolbar';
      toolbar.setAttribute('aria-label', 'Call view controls');
      toolbar.innerHTML = `
        <button type="button" data-dizy-call-action="screen" aria-pressed="false">Share Screen</button>
        <button type="button" data-dizy-call-action="focus" aria-pressed="false">Focus</button>
        <button type="button" data-dizy-call-action="chat" aria-pressed="false">Chat</button>
      `;

      state.screenButton = toolbar.querySelector('[data-dizy-call-action="screen"]');
      state.focusButton = toolbar.querySelector('[data-dizy-call-action="focus"]');
      state.chatButton = toolbar.querySelector('[data-dizy-call-action="chat"]');

      state.screenButton?.addEventListener('click', () => {
        void toggleScreenShare();
      });
      state.focusButton?.addEventListener('click', () => setFocus(!state.focus));
      state.chatButton?.addEventListener('click', () => {
        if (!state.focus) setFocus(true);
        setChatDrawer(!state.chatDrawerOpen);
      });

      return toolbar;
    };

    const adoptPanel = (panel) => {
      if (!panel || state.panel === panel) return;
      const chatMain = getChatMain();
      if (!chatMain) return;

      state.panel = panel;
      state.videoGrid = panel.querySelector('.call-video-grid');

      const stage = doc.createElement('section');
      stage.className = 'dizy-call-stage';
      stage.hidden = panel.hidden;
      stage.setAttribute('aria-label', 'DizyChat live call');

      const toolbar = createToolbar();
      const overlays = doc.createElement('div');
      overlays.className = 'dizy-call-message-overlays';
      overlays.setAttribute('aria-live', 'polite');
      overlays.setAttribute('aria-atomic', 'false');

      const callHeader = panel.querySelector('.voice-call-header');
      if (callHeader) callHeader.appendChild(toolbar);
      else stage.appendChild(toolbar);
      stage.append(panel, overlays);
      chatMain.insertBefore(stage, chatMain.firstChild);
      state.stage = stage;
      state.toolbar = toolbar;
      state.overlays = overlays;

      // The old panel was draggable because it floated over the app. Embedded calls must not move.
      const dragHandle = panel.querySelector('[data-role="drag-handle"]');
      dragHandle?.addEventListener('pointerdown', (event) => event.stopImmediatePropagation(), true);
      dragHandle?.addEventListener('mousedown', (event) => event.stopImmediatePropagation(), true);
      dragHandle?.addEventListener('touchstart', (event) => event.stopImmediatePropagation(), true);

      if (typeof hostWindow.MutationObserver === 'function') {
        state.panelObserver = new hostWindow.MutationObserver(syncPanelVisibility);
        state.panelObserver.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'] });

        if (state.videoGrid) {
          const gridObserver = new hostWindow.MutationObserver(syncPresentation);
          gridObserver.observe(state.videoGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }
      }

      observeMessages();
      syncPanelVisibility();
    };

    const findAndAdoptPanel = () => {
      const panel = doc.querySelector('.voice-call-panel');
      if (panel) {
        adoptPanel(panel);
        return true;
      }
      return false;
    };

    const publicationName = (publication = {}) =>
      String(publication.trackName || publication.name || publication.track?.name || '').trim();

    const tagRemoteTile = (track, publication, participant) => {
      if (classifyTrackSource(publication, track) !== 'screen_share' || !state.videoGrid) return;
      const participantSid = String(participant?.sid || publication?.participantSid || '').trim();
      const trackSid = String(publication?.trackSid || track?.sid || '').trim();
      const expectedKey = participantSid && trackSid ? `${participantSid}:${trackSid}` : '';

      const apply = () => {
        let tile = expectedKey
          ? state.videoGrid.querySelector(`.call-video-tile[data-video-key="${hostWindow.CSS?.escape ? hostWindow.CSS.escape(expectedKey) : expectedKey}"]`)
          : null;
        if (!tile && track?.attachedElements?.length) {
          const attached = track.attachedElements[0];
          tile = attached?.closest?.('.call-video-tile') || null;
        }
        if (!tile) return false;
        tile.classList.add('dizy-screen-share-tile');
        tile.dataset.dizyTrackSource = 'screen_share';
        const label = tile.querySelector('.call-video-label');
        if (label && !/screen/i.test(label.textContent || '')) {
          label.textContent = `${label.textContent || participant?.identity || 'Participant'} · Screen`;
        }
        syncPresentation();
        return true;
      };

      if (!apply()) hostWindow.requestAnimationFrame?.(apply);
    };

    const removeLocalScreenTile = () => {
      state.videoGrid?.querySelector('[data-video-key="dizy-local-screen-share"]')?.remove();
      syncPresentation();
    };

    const renderLocalScreenTile = (stream) => {
      if (!state.videoGrid || !stream) return;
      removeLocalScreenTile();

      const tile = doc.createElement('div');
      tile.className = 'call-video-tile call-video-tile-local dizy-screen-share-tile dizy-primary-media';
      tile.dataset.videoKey = 'dizy-local-screen-share';
      tile.dataset.dizyTrackSource = 'screen_share';

      const video = doc.createElement('video');
      video.className = 'call-video-element';
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;

      const label = doc.createElement('span');
      label.className = 'call-video-label';
      label.textContent = 'You · Screen';

      tile.append(video, label);
      state.videoGrid.appendChild(tile);
      state.videoGrid.hidden = false;
      void video.play?.().catch?.(() => {});
      syncPresentation();
    };

    const stopScreenShare = async ({ fromTrackEnded = false } = {}) => {
      if (state.screenBusy && !fromTrackEnded) return;
      state.screenBusy = true;
      syncPresentation();

      const room = state.room;
      const participant = room?.localParticipant;
      const publishedTrack = state.localScreenTrack;
      const publishedAudioTrack = state.localScreenAudioTrack;
      const stream = state.localScreenStream;

      state.localScreenPublication = null;
      state.localScreenTrack = null;
      state.localScreenAudioTrack = null;
      state.localScreenMediaTrack = null;
      state.localScreenStream = null;

      try {
        if (participant && typeof participant.unpublishTrack === 'function') {
          if (publishedTrack) await participant.unpublishTrack(publishedTrack, true);
          if (publishedAudioTrack) await participant.unpublishTrack(publishedAudioTrack, true);
        }
      } catch (error) {
        console.warn('[DizyChat Call] screen unpublish failed', error);
      }

      for (const mediaTrack of stream?.getTracks?.() || []) {
        try { mediaTrack.stop(); } catch (_error) { /* already stopped */ }
      }

      removeLocalScreenTile();
      state.screenBusy = false;
      syncPresentation();
    };

    const publishTrackWithTimeout = async (participant, mediaTrack, options, timeoutMs = 10000) => {
      if (!participant?.publishTrack || !mediaTrack) throw new Error('Screen track publishing is unavailable.');
      let timedOut = false;
      let timer = null;
      const publishPromise = Promise.resolve().then(() => participant.publishTrack(mediaTrack, options));

      // If LiveKit completes only after our UI timeout, immediately remove the late publication
      // so it cannot become a ghost track after the user has already recovered or stopped sharing.
      publishPromise.then(async (publication) => {
        if (!timedOut) return;
        try { await participant.unpublishTrack?.(publication?.track || mediaTrack, true); } catch (_error) { /* best effort */ }
      }).catch(() => {});

      try {
        return await Promise.race([
          publishPromise,
          new Promise((_, reject) => {
            timer = hostWindow.setTimeout(() => {
              timedOut = true;
              reject(new Error('Screen track publication timed out.'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== null) hostWindow.clearTimeout(timer);
      }
    };

    const publishScreenAudio = async ({ participant, LK, stream, audioMediaTrack }) => {
      if (!audioMediaTrack || !LK?.Track?.Source?.ScreenShareAudio) return;
      try {
        const publication = await publishTrackWithTimeout(participant, audioMediaTrack, {
          source: LK.Track.Source.ScreenShareAudio,
          name: SCREEN_SHARE_AUDIO_TRACK_NAME,
          dtx: false,
          red: false,
          forceStereo: true,
        }, 8000);

        if (state.localScreenStream !== stream || !state.localScreenMediaTrack) {
          try { await participant.unpublishTrack?.(publication?.track || audioMediaTrack, true); } catch (_error) { /* stopped meanwhile */ }
          return;
        }
        state.localScreenAudioTrack = publication?.track || audioMediaTrack;
      } catch (error) {
        if (state.localScreenStream !== stream || !state.localScreenMediaTrack) return;
        console.warn('[DizyChat Call] screen audio publish failed', error);
      }
    };

    const publishScreenVideo = async ({ participant, LK, stream, videoMediaTrack }) => {
      try {
        const publication = await publishTrackWithTimeout(participant, videoMediaTrack, {
          source: LK.Track.Source.ScreenShare,
          name: SCREEN_SHARE_TRACK_NAME,
          // A game/window capture at native refresh with simulcast can saturate the browser encoder.
          // Keep one bounded screen-share encoding for predictable desktop performance.
          simulcast: false,
        }, 8000);

        if (state.localScreenStream !== stream || state.localScreenMediaTrack !== videoMediaTrack) {
          try { await participant.unpublishTrack?.(publication?.track || videoMediaTrack, true); } catch (_error) { /* stopped meanwhile */ }
          return;
        }
        state.localScreenPublication = publication;
        state.localScreenTrack = publication?.track || videoMediaTrack;
      } catch (error) {
        if (state.localScreenStream !== stream || state.localScreenMediaTrack !== videoMediaTrack) return;
        console.warn('[DizyChat Call] screen video publish failed', error);
        // Do not leave a misleading local-only preview if LiveKit cannot publish it.
        void stopScreenShare({ fromTrackEnded: true });
      }
    };

    const startScreenShare = async () => {
      const native = isNativeRuntime(hostWindow);
      const getDisplayMedia = hostWindow.navigator?.mediaDevices?.getDisplayMedia;
      if (!canShareScreen({ native, hasDisplayCapture: Boolean(getDisplayMedia) })) return;
      if (!state.room?.localParticipant || state.screenBusy) return;

      // Busy only while Chrome's picker is open. Once capture succeeds the UI must become
      // responsive immediately; LiveKit publication happens independently in the background.
      state.screenBusy = true;
      syncPresentation();

      let stream = null;
      try {
        const LK = state.sdk || hostWindow.LivekitClient || hostWindow.LiveKitClient;
        const participant = state.room?.localParticipant;
        if (!LK?.Track?.Source?.ScreenShare || !participant?.publishTrack) {
          throw new Error('LiveKit screen sharing is unavailable.');
        }

        // Ask Chromium for the selected application's audio first, with system audio available
        // when the user shares a full display. Keep local playback enabled for Rocksmith/LONTIUM,
        // and request filtering of this DizyChat tab's own output to reduce feedback risk.
        // Bound video resolution and frame rate so sharing a 60/120/144 Hz game window cannot
        // overload Chrome's encoder and freeze the DizyChat page.
        stream = await getDisplayMedia.call(hostWindow.navigator.mediaDevices, {
          video: {
            displaySurface: 'window',
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: {
            suppressLocalAudioPlayback: false,
            restrictOwnAudio: true,
          },
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: 'include',
          windowAudio: 'window',
        });

        const videoMediaTrack = stream.getVideoTracks()[0] || null;
        const audioMediaTrack = stream.getAudioTracks?.()[0] || null;
        if (!videoMediaTrack) throw new Error('No display video track was selected.');
        if ('contentHint' in videoMediaTrack) videoMediaTrack.contentHint = 'detail';

        state.localScreenStream = stream;
        state.localScreenMediaTrack = videoMediaTrack;
        state.localScreenPublication = null;
        state.localScreenTrack = null;
        state.localScreenAudioTrack = null;
        videoMediaTrack.addEventListener?.('ended', () => {
          void stopScreenShare({ fromTrackEnded: true });
        }, { once: true });

        renderLocalScreenTile(stream);
        state.screenBusy = false;
        syncPresentation();

        // Never await LiveKit publication from the UI action. The local preview and Stop Screen
        // control remain usable even if WebRTC negotiation is temporarily slow.
        void publishScreenVideo({ participant, LK, stream, videoMediaTrack });
        if (audioMediaTrack && shouldPublishDisplayAudio(videoMediaTrack)) {
          void publishScreenAudio({ participant, LK, stream, audioMediaTrack });
        }
        return;
      } catch (error) {
        for (const mediaTrack of stream?.getTracks?.() || []) {
          try { mediaTrack.stop(); } catch (_error) { /* ignore */ }
        }
        if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') {
          console.warn('[DizyChat Call] screen share failed', error);
        }
      } finally {
        if (state.screenBusy) {
          state.screenBusy = false;
          syncPresentation();
        }
      }
    };

    async function toggleScreenShare() {
      if (state.localScreenMediaTrack) await stopScreenShare();
      else await startScreenShare();
    }

    const installRoomHandlers = (room, LK) => {
      if (!room || !LK || room.__dizyEmbeddedCallHandlers) return;
      room.__dizyEmbeddedCallHandlers = true;
      state.room = room;
      state.sdk = LK;

      const onTrackSubscribed = (track, publication, participant) => {
        if (track?.kind === LK.Track?.Kind?.Video) tagRemoteTile(track, publication, participant);
      };
      const onTrackUnsubscribed = () => hostWindow.requestAnimationFrame?.(syncPresentation);
      const onDisconnected = () => {
        void stopScreenShare({ fromTrackEnded: true });
        state.room = null;
        state.roomHandlersInstalled = false;
        setFocus(false);
        syncPresentation();
      };

      room.on?.(LK.RoomEvent?.TrackSubscribed, onTrackSubscribed);
      room.on?.(LK.RoomEvent?.TrackUnsubscribed, onTrackUnsubscribed);
      room.on?.(LK.RoomEvent?.Disconnected, onDisconnected);
      state.roomHandlersInstalled = true;
      // TrackSubscribed may have fired while room.connect() was resolving. Walk
      // current publications so late joiners classify an existing share too.
      room.remoteParticipants?.forEach?.((participant) => {
        const publications = participant.trackPublications || participant.videoTrackPublications;
        publications?.forEach?.((publication) => {
          const track = publication.track;
          if (track?.kind === LK.Track?.Kind?.Video) tagRemoteTile(track, publication, participant);
        });
      });
      syncPresentation();
    };

    const syncRoomBridge = (bridge = hostWindow.dizyCallBridge) => {
      if (bridge?.room && bridge?.sdk) installRoomHandlers(bridge.room, bridge.sdk);
      else if (state.room) {
        state.room = null;
        setFocus(false);
        syncPresentation();
      }
    };

    loadStylesheet();
    hostWindow.addEventListener('dizychat:call-room', (event) => syncRoomBridge(event.detail));
    syncRoomBridge();

    if (!findAndAdoptPanel() && typeof hostWindow.MutationObserver === 'function') {
      state.bodyObserver = new hostWindow.MutationObserver(() => {
        if (findAndAdoptPanel()) {
          state.bodyObserver?.disconnect();
          state.bodyObserver = null;
        }
      });
      state.bodyObserver.observe(doc.body, { childList: true, subtree: true });
    }

    return {
      state,
      setFocus,
      setChatDrawer,
      startScreenShare,
      stopScreenShare,
    };
  };

  return {
    SCREEN_SHARE_TRACK_NAME,
    bootstrap,
    canShareScreen,
    classifyTrackSource,
    derivePresentationState,
    shouldPublishDisplayAudio,
  };
});
