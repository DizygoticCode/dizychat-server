const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

test('server builds Auth v2 account service from legacy migration inputs', () => {
  assert.match(serverSource, /require\('\.\/src\/models\/user'\)/);
  assert.match(serverSource, /require\('\.\/src\/auth\/account-service'\)/);
  assert.match(serverSource, /require\('\.\/src\/auth\/legacy-admin-credentials'\)/);
  assert.match(serverSource, /readLegacyAdminCredentials\(process\.env\)/);
  assert.match(serverSource, /createAccountService\(\{\s*UserModel:\s*User,\s*legacyCredentials:\s*adminCredentials\s*\}\)/s);
});

test('Mongo connection bootstraps protected accounts before reporting ready', () => {
  const connectAt = serverSource.indexOf('await mongoose.connect(mongoUri');
  const bootstrapAt = serverSource.indexOf('await accountService.bootstrapProtectedAccounts()');
  const connectedLogAt = serverSource.indexOf('console.log("[Mongo] Connected")');

  assert.notEqual(connectAt, -1);
  assert.notEqual(bootstrapAt, -1);
  assert.notEqual(connectedLogAt, -1);
  assert.ok(connectAt < bootstrapAt, 'Mongo must connect before account bootstrap');
  assert.ok(bootstrapAt < connectedLogAt, 'protected accounts must bootstrap before Mongo is reported ready');
});
