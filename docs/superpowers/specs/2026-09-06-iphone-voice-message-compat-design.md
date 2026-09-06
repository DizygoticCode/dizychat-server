# iPhone voice-message compatibility design

Date: 2026-09-06
Base: `b6ffac47b1b0e99ff69f45ce929ac1b642b052bf`
Branch: `fix/iphone-voice-message-compat`

## Problem

DizyChat voice recording currently prefers WebM/Opus and Ogg/Opus. Older iPhones that cannot run an iOS release with full WebM playback support can therefore receive voice messages that render correctly as `<audio>` controls but cannot be decoded by the browser. The observed asymmetry is consistent with an older iPhone recording a Safari-supported format that Chrome/Android can play while failing to play Chrome-originated WebM/Opus clips.

## Approved bounded change

1. Prefer `audio/mp4;codecs=mp4a.40.2` / `audio/mp4` in `MediaRecorder` when the recording browser supports it, while retaining the existing WebM/Ogg fallbacks.
2. Mark only DizyChat-recorded voice uploads with multipart field `voiceMessage=1`; ordinary attachments remain unchanged.
3. After the existing ClamAV scan succeeds, normalize marked WebM/Ogg voice recordings to AAC audio in an M4A/MP4 container using FFmpeg. Compatible voice inputs remain unmodified.
4. Use a fixed FFmpeg argv list (`spawn`, never a shell command) with AAC 96 kbps and `+faststart`.
5. Return the normalized URL, filename, MIME type `audio/mp4`, and actual output size. If normalization fails, do not publish the incompatible clip.
6. Keep the change independent of Android Firebase/notification setup.

## Runtime dependency

The self-hosted DizyChat server needs an `ffmpeg` executable available in `PATH`, or `FFMPEG_PATH` set to its executable path, only when a marked incompatible voice clip requires conversion. Compatible uploads and ordinary attachments do not invoke FFmpeg.

## Validation

Deterministic tests must prove MP4 preference, explicit voice marking, ordinary attachment invariance, WebM/Ogg normalization decisions, safe FFmpeg arguments, antivirus-before-transcode ordering, and the final upload response contract. The normal Self-Host/browser and Android CI gates must remain green.
