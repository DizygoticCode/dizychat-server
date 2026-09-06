'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'index.js');
let source = fs.readFileSync(target, 'utf8');

const replaceOnce = (needle, replacement, label) => {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`PR B patch marker missing: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`PR B patch marker is not unique: ${label}`);
  }
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
};

replaceOnce(
  "const { createPushCoordinator } = require('./src/push/push-coordinator');\n",
  "const { createPushCoordinator } = require('./src/push/push-coordinator');\nconst { createChatMessageService } = require('./src/messages/chat-message-service');\n",
  'chat message service import',
);

replaceOnce(
  "const pushCoordinator = createPushCoordinator({\n  pushDeviceService,\n  readStateService,\n  transport: pushTransport,\n});\n",
  "const pushCoordinator = createPushCoordinator({\n  pushDeviceService,\n  readStateService,\n  transport: pushTransport,\n});\nconst chatMessageService = createChatMessageService({ io, pushCoordinator });\n",
  'chat message service initialization',
);

const readRouteMarker = "app.post('/api/read-state/mark', pushApiJson, requireHttpAccount, async (req, res) => {\n";
const mobileReplyRoute = `app.post('/api/mobile/push/reply', pushApiJson, requireHttpMobileAccount, async (req, res) => {
  const room = normaliseRoomName(req.body?.room);
  const text = String(req.body?.text || '').trim();
  const replyToMessageId = String(req.body?.replyToMessageId || '').trim();
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!room || !text || text.length > 1000 || !deviceId) {
    return res.status(400).json({ ok: false, code: 'MOBILE_REPLY_INVALID' });
  }
  if (replyToMessageId && !PUSH_OBJECT_ID_PATTERN.test(replyToMessageId)) {
    return res.status(400).json({ ok: false, code: 'MOBILE_REPLY_TARGET_INVALID' });
  }

  try {
    const subscription = await pushDeviceService.findActiveSubscription({
      sessionId: req.accountSession.sessionId,
      deviceId,
      room,
    });
    if (!subscription) {
      return res.status(403).json({ ok: false, code: 'ROOM_SUBSCRIPTION_REQUIRED' });
    }

    const username = String(req.accountPrincipal.username || '').trim();
    if (!username) return res.status(403).json({ ok: false, code: 'ACCOUNT_IDENTITY_REQUIRED' });
    if (isUserBlocked(room, username)) {
      return res.status(403).json({ ok: false, code: 'ROOM_BLOCKED' });
    }
    const muteUntil = getMuteExpiry(room, username);
    if (muteUntil) {
      return res.status(403).json({ ok: false, code: 'ROOM_MUTED', until: muteUntil });
    }
    if (!canSendMessage(\`mobile:\${req.accountSession.sessionId}\`)) {
      return res.status(429).json({ ok: false, code: 'MESSAGE_RATE_LIMITED' });
    }

    const persistedMessage = await chatMessageService.persistChatMessage({
      room,
      username,
      senderCanonicalUsername: req.accountPrincipal.canonicalUsername,
      message: {
        text,
        replyTo: replyToMessageId || undefined,
      },
    });
    return res.status(201).json({ ok: true, messageId: String(persistedMessage._id) });
  } catch (error) {
    console.warn('[Push] mobile notification reply failed', { code: String(error?.code || 'unexpected') });
    return res.status(500).json({ ok: false, code: 'MOBILE_REPLY_UNAVAILABLE' });
  }
});

`;
replaceOnce(readRouteMarker, mobileReplyRoute + readRouteMarker, 'mobile reply route insertion');

const socketStart = "    const msgData = { ...msgDataRaw, room: roomName, user: socket.username };\n    try {\n";
const socketEnd = "    } catch(err){ console.error(\"[Message] Error:\", err); }\n";
const startIndex = source.indexOf(socketStart);
if (startIndex < 0) throw new Error('PR B patch marker missing: socket persistence start');
const endIndex = source.indexOf(socketEnd, startIndex);
if (endIndex < 0) throw new Error('PR B patch marker missing: socket persistence end');
const afterEnd = endIndex + socketEnd.length;
const socketReplacement = `    const senderCanonicalUsername = socket.principal?.kind === 'account'
      ? String(socket.principal.canonicalUsername || '')
      : '';
    try {
      await chatMessageService.persistChatMessage({
        room: roomName,
        username: socket.username,
        senderCanonicalUsername,
        message: msgDataRaw,
      });
    } catch (err) {
      console.error('[Message] Error:', err);
    }
`;
source = source.slice(0, startIndex) + socketReplacement + source.slice(afterEnd);

fs.writeFileSync(target, source);
console.log('Android Slice 2 PR B index patch applied.');
