'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first === -1) throw new Error(`${label}: expected source block not found`);
  if (text.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label}: source block matched more than once`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

let server = read('server-core.js');
let client = read('public/chat.js');
let css = read('public/chat.css');

server = replaceOnce(
  server,
  `const MUSIC_MODE_AUDIO_BITRATE = 320000;\nconst MUSIC_MODE_AUDIO_SETTINGS = Object.freeze({\n  channelCount: 2,\n  echoCancellation: false,\n  noiseSuppression: false,\n  autoGainControl: false,\n  audioBitrate: MUSIC_MODE_AUDIO_BITRATE,\n  dtx: false,\n  red: false,\n  forceStereo: true,\n});`,
  `const MUSIC_MODE_AUDIO_BITRATE = 510000;\nconst MUSIC_MODE_AUDIO_SETTINGS = Object.freeze({\n  channelCount: 2,\n  sampleRate: 48000,\n  echoCancellation: false,\n  noiseSuppression: false,\n  autoGainControl: false,\n  audioBitrate: MUSIC_MODE_AUDIO_BITRATE,\n  dtx: false,\n  red: false,\n  forceStereo: true,\n});`,
  'server Music Mode settings',
);

client = replaceOnce(
  client,
  `  const MUSIC_MODE_AUDIO_BITRATE = 320000;\n  const MUSIC_MODE_FALLBACK_AUDIO_SETTINGS = Object.freeze({\n    channelCount: 2,\n    echoCancellation: false,\n    noiseSuppression: false,\n    autoGainControl: false,\n    audioBitrate: MUSIC_MODE_AUDIO_BITRATE,\n    dtx: false,\n    red: false,\n    forceStereo: true,\n  });`,
  `  const MUSIC_MODE_AUDIO_BITRATE = 510000;\n  const MUSIC_MODE_FALLBACK_AUDIO_SETTINGS = Object.freeze({\n    channelCount: 2,\n    sampleRate: 48000,\n    echoCancellation: false,\n    noiseSuppression: false,\n    autoGainControl: false,\n    audioBitrate: MUSIC_MODE_AUDIO_BITRATE,\n    dtx: false,\n    red: false,\n    forceStereo: true,\n  });`,
  'client Music Mode settings',
);

client = replaceOnce(
  client,
  `    sdkLoaded: false,\n    room: null,\n    localTrack: null,`,
  `    sdkLoaded: false,\n    room: null,\n    joining: false,\n    localTrack: null,`,
  'call joining state',
);

client = replaceOnce(
  client,
  `  const updateMusicModeUi = (inCall = Boolean(callState.room)) => {\n    const hasChoice = callState.musicModeEnabled !== null;\n    musicModePanel?.classList.toggle("music-mode-selected", hasChoice);\n    musicModePanel?.classList.toggle("music-mode-locked", inCall);\n    musicModeOffControl?.classList.toggle("active", callState.musicModeEnabled === false);\n    musicModeOnControl?.classList.toggle("active", callState.musicModeEnabled === true);\n    musicModeOffControl?.setAttribute("aria-pressed", String(callState.musicModeEnabled === false));\n    musicModeOnControl?.setAttribute("aria-pressed", String(callState.musicModeEnabled === true));\n    if (musicModeOffControl) musicModeOffControl.disabled = inCall;\n    if (musicModeOnControl) musicModeOnControl.disabled = inCall;\n    if (joinControl) joinControl.title = hasChoice ? "Join live call" : "Choose Music mode Off or On before joining.";\n  };`,
  `  const updateMusicModeUi = (inCall = Boolean(callState.room)) => {\n    const hasChoice = callState.musicModeEnabled !== null;\n    const locked = inCall || callState.joining;\n    musicModePanel?.classList.toggle("music-mode-selected", hasChoice);\n    musicModePanel?.classList.toggle("music-mode-locked", locked);\n    musicModeOffControl?.classList.toggle("active", callState.musicModeEnabled === false);\n    musicModeOnControl?.classList.toggle("active", callState.musicModeEnabled === true);\n    musicModeOffControl?.setAttribute("aria-pressed", String(callState.musicModeEnabled === false));\n    musicModeOnControl?.setAttribute("aria-pressed", String(callState.musicModeEnabled === true));\n    if (musicModeOffControl) musicModeOffControl.disabled = locked;\n    if (musicModeOnControl) musicModeOnControl.disabled = locked;\n    if (joinControl) joinControl.title = hasChoice ? "Join live call" : "Choose Music mode Off or On before joining.";\n  };`,
  'Music Mode UI locking',
);

client = replaceOnce(
  client,
  `  const chooseMusicMode = (enabled) => {\n    if (callState.room) {\n      showToast("Disconnect and join again to change Music mode.", "warn");\n      return;\n    }\n    callState.musicModeEnabled = Boolean(enabled);\n    updateMusicModeUi(false);\n    setCallUiState({ inCall: false, muted: false, cameraEnabled: false });\n  };`,
  `  const chooseMusicMode = (enabled) => {\n    if (callState.room || callState.joining) {\n      showToast("Disconnect and join again to change Music mode.", "warn");\n      return;\n    }\n    callState.musicModeEnabled = Boolean(enabled);\n    updateMusicModeUi(false);\n    setCallUiState({ inCall: false, muted: false, cameraEnabled: false });\n  };`,
  'Music Mode choice locking',
);

client = replaceOnce(
  client,
  `  const getMusicModeAudioSettings = (tokenPayload = {}) => {\n    if (!callState.musicModeEnabled) return null;`,
  `  const getMusicModeAudioSettings = (tokenPayload = {}, musicMode = callState.musicModeEnabled === true) => {\n    if (!musicMode) return null;`,
  'Music Mode settings selector',
);

client = replaceOnce(
  client,
  `  const getMicrophoneSettings = (tokenPayload = {}) => {\n    const musicSettings = getMusicModeAudioSettings(tokenPayload);\n    if (musicSettings) {\n      return {\n        channelCount: musicSettings.channelCount,\n        echoCancellation: musicSettings.echoCancellation,\n        noiseSuppression: musicSettings.noiseSuppression,\n        autoGainControl: musicSettings.autoGainControl,\n      };\n    }\n    return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };\n  };\n\n  const getAudioPublishOptions = (LK, tokenPayload = {}) => {\n    const options = { source: LK.Track?.Source?.Microphone };\n    const musicSettings = getMusicModeAudioSettings(tokenPayload);\n    if (!musicSettings) return options;\n    options.audioBitrate = musicSettings.audioBitrate;\n    options.dtx = Boolean(musicSettings.dtx);\n    options.red = Boolean(musicSettings.red);\n    options.forceStereo = musicSettings.forceStereo !== false;\n    options.audioPreset = { maxBitrate: musicSettings.audioBitrate };\n    return options;\n  };`,
  `  const getMicrophoneSettings = (tokenPayload = {}, musicMode = callState.musicModeEnabled === true) => {\n    const musicSettings = getMusicModeAudioSettings(tokenPayload, musicMode);\n    if (musicSettings) {\n      return {\n        channelCount: { ideal: musicSettings.channelCount || 2 },\n        sampleRate: { ideal: musicSettings.sampleRate || 48000 },\n        echoCancellation: { exact: false },\n        noiseSuppression: { exact: false },\n        autoGainControl: { exact: false },\n      };\n    }\n    return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };\n  };\n\n  const getAudioPublishOptions = (LK, tokenPayload = {}, musicMode = callState.musicModeEnabled === true) => {\n    const options = { source: LK.Track?.Source?.Microphone };\n    const musicSettings = getMusicModeAudioSettings(tokenPayload, musicMode);\n    if (!musicSettings) return options;\n    options.audioBitrate = musicSettings.audioBitrate || MUSIC_MODE_AUDIO_BITRATE;\n    options.dtx = false;\n    options.red = false;\n    options.forceStereo = true;\n    options.audioPreset = { maxBitrate: musicSettings.audioBitrate || MUSIC_MODE_AUDIO_BITRATE };\n    return options;\n  };\n\n  const enforceMusicModeCapture = async (track, microphoneSettings) => {\n    const mediaTrack = track?.mediaStreamTrack;\n    if (!mediaTrack) {\n      throw new Error("Music mode could not inspect the captured audio track.");\n    }\n\n    try {\n      if ("contentHint" in mediaTrack) mediaTrack.contentHint = "music";\n    } catch {\n      /* contentHint is advisory; capture processing checks below are authoritative. */\n    }\n\n    const processingKeys = ["echoCancellation", "noiseSuppression", "autoGainControl"];\n    const hasVoiceProcessing = (settings) => processingKeys.some((key) => settings?.[key] === true);\n    let settings = mediaTrack.getSettings?.() || {};\n\n    if (hasVoiceProcessing(settings) && typeof mediaTrack.applyConstraints === "function") {\n      await mediaTrack.applyConstraints(microphoneSettings);\n      settings = mediaTrack.getSettings?.() || {};\n    }\n\n    if (hasVoiceProcessing(settings)) {\n      track.stop?.();\n      throw new Error("Music mode refused to publish because browser voice processing is still enabled.");\n    }\n\n    console.info("[LiveCall] Music mode capture verified", {\n      channelCount: settings.channelCount,\n      sampleRate: settings.sampleRate,\n      echoCancellation: settings.echoCancellation,\n      noiseSuppression: settings.noiseSuppression,\n      autoGainControl: settings.autoGainControl,\n      bitrate: MUSIC_MODE_AUDIO_BITRATE,\n      dtx: false,\n      red: false,\n      forceStereo: true,\n    });\n  };`,
  'Music Mode capture and publish contract',
);

client = replaceOnce(
  client,
  `    const sdkSources = [\n      "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js",\n      "https://unpkg.com/livekit-client/dist/livekit-client.umd.min.js",\n    ];`,
  `    const sdkSources = [\n      "https://cdn.jsdelivr.net/npm/livekit-client@2.22.2/dist/livekit-client.umd.min.js",\n      "https://unpkg.com/livekit-client@2.22.2/dist/livekit-client.umd.min.js",\n    ];`,
  'LiveKit SDK pin',
);

client = replaceOnce(
  client,
  `  const fetchToken = async () => {\n    const res = await fetch("/api/calls/token", {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({\n        room: window.currentRoom,\n        username: window.currentUser,\n        musicMode: callState.musicModeEnabled === true,\n      }),\n    });`,
  `  const fetchToken = async (musicMode) => {\n    const res = await fetch("/api/calls/token", {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({\n        room: window.currentRoom,\n        username: window.currentUser,\n        musicMode: musicMode === true,\n      }),\n    });`,
  'call token Music Mode snapshot',
);

client = replaceOnce(
  client,
  `  const setCallUiState = ({ inCall = false, muted = false, cameraEnabled = callState.cameraEnabled } = {}) => {\n    const hasMusicModeChoice = callState.musicModeEnabled !== null;\n    voiceCallBtn.classList.toggle("call-active", inCall);\n    voiceCallBtn.classList.toggle("call-muted", inCall && muted);\n    voiceCallBtn.classList.toggle("call-video-active", inCall && cameraEnabled);\n    voiceCallBtn.textContent = inCall ? (cameraEnabled ? "🎥" : (muted ? "🔇" : "📞")) : "📞";\n    muteControl.disabled = !inCall;\n    cameraControl.disabled = !inCall;\n    leaveControl.disabled = !inCall;\n    joinControl.disabled = inCall || !hasMusicModeChoice;\n    muteControl.textContent = muted ? "Unmute" : "Mute";\n    cameraControl.textContent = cameraEnabled ? "Stop video" : "Add video";\n    updateMusicModeUi(inCall);\n  };`,
  `  const setCallUiState = ({ inCall = false, muted = false, cameraEnabled = callState.cameraEnabled } = {}) => {\n    const hasMusicModeChoice = callState.musicModeEnabled !== null;\n    voiceCallBtn.classList.toggle("call-active", inCall);\n    voiceCallBtn.classList.toggle("call-muted", inCall && muted);\n    voiceCallBtn.classList.toggle("call-video-active", inCall && cameraEnabled);\n    voiceCallBtn.textContent = inCall ? (cameraEnabled ? "🎥" : (muted ? "🔇" : "📞")) : "📞";\n    muteControl.disabled = !inCall;\n    cameraControl.disabled = !inCall;\n    leaveControl.disabled = !inCall;\n    joinControl.disabled = inCall || callState.joining || !hasMusicModeChoice;\n    muteControl.textContent = muted ? "Unmute" : "Mute";\n    cameraControl.textContent = cameraEnabled ? "Stop video" : "Add video";\n    updateMusicModeUi(inCall);\n  };\n\n  const resetMusicModeChoice = () => {\n    if (callState.room || callState.joining) return;\n    callState.musicModeEnabled = null;\n    setCallUiState({ inCall: false, muted: false, cameraEnabled: false });\n  };`,
  'call UI state and Music Mode reset',
);

client = replaceOnce(
  client,
  `      callState.localTrack = null;\n      callState.room = null;\n      callState.muted = false;\n      callState.cameraEnabled = false;\n      callState.participants.clear();\n      callState.localLevel = 0;\n      clearRemoteAudioTracks();\n      clearRemoteVideoTracks();\n      renderPeers();\n      setCallUiState({ inCall: false, muted: false, cameraEnabled: false });\n      setStatus("Not connected.");`,
  `      callState.localTrack = null;\n      callState.room = null;\n      callState.joining = false;\n      callState.muted = false;\n      callState.cameraEnabled = false;\n      callState.participants.clear();\n      callState.localLevel = 0;\n      clearRemoteAudioTracks();\n      clearRemoteVideoTracks();\n      renderPeers();\n      resetMusicModeChoice();\n      setStatus("Not connected.");`,
  'disconnect reset',
);

client = replaceOnce(
  client,
  `  const joinCall = async () => {\n    if (callState.musicModeEnabled === null) {\n      showToast("Please choose Music mode Off or On before starting the call.", "warn");\n      return;\n    }\n    if (!window.currentRoom || !window.currentUser) {`,
  `  const joinCall = async () => {\n    if (callState.musicModeEnabled === null) {\n      showToast("Please choose Music mode Off or On before starting the call.", "warn");\n      return;\n    }\n    const requestedMusicMode = callState.musicModeEnabled === true;\n    callState.joining = true;\n    setCallUiState({ inCall: false, muted: false, cameraEnabled: false });\n    if (!window.currentRoom || !window.currentUser) {`,
  'join Music Mode snapshot',
);

client = replaceOnce(
  client,
  `    const tokenPayload = await fetchToken();\n    if (!tokenPayload?.token || !tokenPayload?.url) throw new Error("Missing LiveKit token or URL from server.");\n    callState.cameraBlocked = Boolean(tokenPayload.cameraDisabled);`,
  `    const tokenPayload = await fetchToken(requestedMusicMode);\n    if (!tokenPayload?.token || !tokenPayload?.url) throw new Error("Missing LiveKit token or URL from server.");\n    if (tokenPayload.musicMode !== requestedMusicMode) {\n      throw new Error("LiveKit Music mode selection did not match the server token response.");\n    }\n    if (requestedMusicMode && !tokenPayload.audioSettings) {\n      throw new Error("Music mode was requested but the server returned no audio settings.");\n    }\n    callState.cameraBlocked = Boolean(tokenPayload.cameraDisabled);`,
  'server token Music Mode confirmation',
);

client = replaceOnce(
  client,
  `    setStatus(callState.musicModeEnabled ? "Requesting microphone for Music mode…" : "Requesting microphone…");\n    const track = await LK.createLocalAudioTrack(getMicrophoneSettings(tokenPayload));\n    setStatus("Publishing microphone…");\n    await room.localParticipant.publishTrack(track, getAudioPublishOptions(LK, tokenPayload));\n    callState.localTrack = track;\n    callState.muted = false;`,
  `    setStatus(requestedMusicMode ? "Requesting raw stereo microphone for Music mode…" : "Requesting microphone…");\n    const microphoneSettings = getMicrophoneSettings(tokenPayload, requestedMusicMode);\n    const track = await LK.createLocalAudioTrack(microphoneSettings);\n    if (requestedMusicMode) {\n      await enforceMusicModeCapture(track, microphoneSettings);\n      setStatus("Publishing Music mode — Opus stereo 510 kb/s…");\n    } else {\n      setStatus("Publishing microphone…");\n    }\n    await room.localParticipant.publishTrack(track, getAudioPublishOptions(LK, tokenPayload, requestedMusicMode));\n    callState.localTrack = track;\n    callState.joining = false;\n    callState.muted = false;`,
  'raw Music Mode publication',
);

client = replaceOnce(
  client,
  `  voiceCallBtn.addEventListener("click", () => {\n    panel.hidden = !panel.hidden;\n  });`,
  `  voiceCallBtn.addEventListener("click", () => {\n    if (!callState.room && panel.hidden) resetMusicModeChoice();\n    panel.hidden = !panel.hidden;\n  });`,
  'panel-open explicit Music Mode choice',
);

css = replaceOnce(
  css,
  `#voice-call-btn.call-active {\n  background: #1f9d55;\n  border-color: #43d17a;\n  color: #fff;\n}\n\n#voice-call-btn.call-muted {\n  background: #8a2d2d;\n  border-color: #d65b5b;\n}\n\n#voice-call-btn.call-video-active {\n  background: #2563eb;\n  border-color: #60a5fa;\n  color: #fff;\n}`,
  `#voice-call-btn:not(.call-active) {\n  background: #8a2d2d;\n  border-color: #d65b5b;\n  color: #fff;\n}\n\n#voice-call-btn.call-active {\n  background: #1f9d55;\n  border-color: #43d17a;\n  color: #fff;\n}\n\n#voice-call-btn.call-muted {\n  border-color: #43d17a;\n}\n\n#voice-call-btn.call-video-active {\n  border-color: #43d17a;\n  color: #fff;\n}`,
  'Live Call connected-state colour',
);

write('server-core.js', server);
write('public/chat.js', client);
write('public/chat.css', css);

console.log('Applied LiveKit Music Mode max-quality patch.');
