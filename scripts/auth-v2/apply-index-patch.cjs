'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../../index.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, needle, replacement) {
  const first = source.indexOf(needle);
  if (first === -1) throw new Error(`${label}: expected seam not found`);
  if (source.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`${label}: seam is not unique`);
  }
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  'Auth v2 imports',
  "const Message = require('./src/models/message');\nconst soundboardStore = require('./src/utils/soundboard');",
  "const Message = require('./src/models/message');\nconst User = require('./src/models/user');\nconst { createAccountService } = require('./src/auth/account-service');\nconst { readLegacyAdminCredentials } = require('./src/auth/legacy-admin-credentials');\nconst soundboardStore = require('./src/utils/soundboard');"
);

replaceOnce(
  'legacy migration account service',
  'const adminCredentials = buildAdminCredentials();',
  "const adminCredentials = readLegacyAdminCredentials(process.env);\nconst accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });"
);

replaceOnce(
  'Mongo protected-account bootstrap',
  '    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });\n    console.log("[Mongo] Connected");',
  '    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });\n    await accountService.bootstrapProtectedAccounts();\n    console.log("[Mongo] Connected");\n    console.log("[Auth v2] Protected accounts bootstrapped");'
);

replaceOnce(
  'Mongo bootstrap retry safety',
  '  } catch (err) {\n    console.error("[Mongo] Initial connect failed, retrying:", err?.message || err);\n    scheduleMongoReconnect();\n  } finally {',
  '  } catch (err) {\n    if (mongoose.connection.readyState === 1) {\n      try {\n        await mongoose.disconnect();\n      } catch (disconnectError) {\n        console.error("[Mongo] Disconnect after bootstrap failure failed:", disconnectError?.message || disconnectError);\n      }\n    }\n    console.error("[Mongo] Initial connect/Auth v2 bootstrap failed, retrying:", err?.message || err);\n    scheduleMongoReconnect();\n  } finally {'
);

fs.writeFileSync(target, source);
console.log('Applied guarded Auth v2 index.js patch.');
