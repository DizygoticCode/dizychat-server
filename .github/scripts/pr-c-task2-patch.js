'use strict';

const fs = require('fs');

const file = 'index.js';
let source = fs.readFileSync(file, 'utf8');

const replaceOnce = (label, before, after) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: expected source is not unique`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
};

replaceOnce(
  'read-state coordinator import',
  "const { createPushCoordinator } = require('./src/push/push-coordinator');\n",
  "const { createPushCoordinator } = require('./src/push/push-coordinator');\nconst { createReadStateCoordinator } = require('./src/push/read-state-coordinator');\n",
);

replaceOnce(
  'read-state coordinator construction',
  `const pushCoordinator = createPushCoordinator({\n  pushDeviceService,\n  readStateService,\n  transport: pushTransport,\n});\nconst chatMessageService = createChatMessageService({ io, pushCoordinator });`,
  `const pushCoordinator = createPushCoordinator({\n  pushDeviceService,\n  readStateService,\n  transport: pushTransport,\n});\nconst readStateCoordinator = createReadStateCoordinator({\n  readStateService,\n  pushCoordinator,\n  logger: console,\n});\nconst chatMessageService = createChatMessageService({ io, pushCoordinator });`,
);

replaceOnce(
  'read-state HTTP routes',
  `    const messageTimestamp = persistedMessage.timestamp;\n    const result = await readStateService.advanceCursor({\n      canonicalUsername: req.accountPrincipal.canonicalUsername,\n      room,\n      messageId: String(persistedMessage._id),\n      messageTimestamp,\n    });\n    return res.json({ ok: true, advanced: result.advanced, cursor: readCursorJson(result.cursor) });`,
  `    const messageTimestamp = persistedMessage.timestamp;\n    const result = await readStateCoordinator.advance({\n      canonicalUsername: req.accountPrincipal.canonicalUsername,\n      room,\n      messageId: String(persistedMessage._id),\n      messageTimestamp,\n    });\n    return res.json({ ok: true, advanced: result.advanced, cursor: readCursorJson(result.cursor) });`,
);

replaceOnce(
  'read-state GET route',
  `    const cursor = await readStateService.getCursor({\n      canonicalUsername: req.accountPrincipal.canonicalUsername,\n      room,\n    });`,
  `    const cursor = await readStateCoordinator.getCursor({\n      canonicalUsername: req.accountPrincipal.canonicalUsername,\n      room,\n    });`,
);

replaceOnce(
  'socket message-read bridge',
  `      if (msg.room !== targetRoom) return;\n      if (msg.deleted) return;\n      const reader = socket.username || '';\n      if (msg.user === reader) return;\n      if (msg.status === 'read') return;\n      msg.status = 'read';\n      await msg.save();\n      io.to(targetRoom).emit('message status', { id: msg._id, status: 'read' });`,
  `      if (msg.room !== targetRoom) return;\n      if (msg.deleted) return;\n      if (socket.principal?.kind === 'account') {\n        try {\n          await readStateCoordinator.advance({\n            canonicalUsername: socket.principal.canonicalUsername,\n            room: targetRoom,\n            messageId: String(msg._id),\n            messageTimestamp: msg.timestamp,\n          });\n        } catch (error) {\n          console.warn('[Push] socket read cursor advance failed', {\n            code: String(error?.code || 'unexpected'),\n          });\n        }\n      }\n      const reader = socket.username || '';\n      if (msg.user === reader) return;\n      if (msg.status === 'read') return;\n      msg.status = 'read';\n      await msg.save();\n      io.to(targetRoom).emit('message status', { id: msg._id, status: 'read' });`,
);

fs.writeFileSync(file, source);
fs.unlinkSync('.github/scripts/pr-c-task2-patch.js');
fs.unlinkSync('.github/workflows/pr-c-task2-patch.yml');
