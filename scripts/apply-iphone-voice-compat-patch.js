'use strict';

const fs = require('fs');

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: expected source block is not unique`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
};

let chat = fs.readFileSync('public/chat.js', 'utf8');

chat = replaceOnce(
  chat,
  `      const candidates = [\n        "audio/webm;codecs=opus",\n        "audio/ogg;codecs=opus",\n        "audio/webm",\n        "audio/ogg",\n      ];`,
  `      const candidates = [\n        "audio/mp4;codecs=mp4a.40.2",\n        "audio/mp4",\n        "audio/webm;codecs=opus",\n        "audio/ogg;codecs=opus",\n        "audio/webm",\n        "audio/ogg",\n      ];`,
  'voice recorder MIME preference'
);

chat = replaceOnce(
  chat,
  `      if (type.includes("wav")) return "wav";\n      if (type.includes("m4a")) return "m4a";`,
  `      if (type.includes("wav")) return "wav";\n      if (type.includes("mp4") || type.includes("m4a")) return "m4a";`,
  'voice filename extension'
);

chat = replaceOnce(
  chat,
  `  const { fileName: overrideName, displayName, mimeType } = options;`,
  `  const { fileName: overrideName, displayName, mimeType, voiceMessage = false } = options;`,
  'upload voice marker option'
);

chat = replaceOnce(
  chat,
  `  if (appendName) {\n    formData.append("file", fileOrBlob, uploadName);\n  } else {\n    formData.append("file", fileOrBlob);\n  }\n\n  const fakeTimer = setInterval(() => {`,
  `  if (appendName) {\n    formData.append("file", fileOrBlob, uploadName);\n  } else {\n    formData.append("file", fileOrBlob);\n  }\n  if (voiceMessage) {\n    formData.append("voiceMessage", "1");\n  }\n\n  const fakeTimer = setInterval(() => {`,
  'multipart voice marker'
);

chat = replaceOnce(
  chat,
  `          fileName: filename,\n          displayName: filename,\n          mimeType,\n        });`,
  `          fileName: filename,\n          displayName: filename,\n          mimeType,\n          voiceMessage: true,\n        });`,
  'recorded voice upload marker'
);

fs.writeFileSync('public/chat.js', chat);

let server = fs.readFileSync('index.js', 'utf8');

server = replaceOnce(
  server,
  `const { scanFileWithClamAv } = require('./src/uploads/clamav-scanner');`,
  `const { scanFileWithClamAv } = require('./src/uploads/clamav-scanner');\nconst { normalizeVoiceMessageUpload } = require('./src/uploads/voice-message-normalizer');`,
  'voice normalizer import'
);

server = replaceOnce(
  server,
  `    await scanFileWithClamAv(quarantinePath);\n    await fsPromises.rename(quarantinePath, finalPath);`,
  `    await scanFileWithClamAv(quarantinePath);\n\n    const voiceMessage = String(req.body?.voiceMessage || '').trim() === '1';\n    if (voiceMessage) {\n      const publishedVoice = await normalizeVoiceMessageUpload({\n        sourcePath: quarantinePath,\n        storedFilename: req.file.filename,\n        originalName: req.file.originalname,\n        mimeType: req.file.mimetype,\n        uploadDir,\n      });\n      return res.json({\n        url: \`/uploads/\${publishedVoice.filename}\`,\n        name: publishedVoice.originalName,\n        type: publishedVoice.mimeType,\n        size: publishedVoice.size,\n      });\n    }\n\n    await fsPromises.rename(quarantinePath, finalPath);`,
  'post-scan voice normalization'
);

fs.writeFileSync('index.js', server);
console.log('Applied exact iPhone voice-message compatibility patch.');
