'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { chromium } = require('playwright');
const mongoose = require('mongoose');
const User = require('../src/models/user');
const { hashPassword } = require('../src/auth/passwords');

const base = process.env.DEPLOY_URL || 'http://127.0.0.1:10000';
const database = 'mongodb://127.0.0.1:27017/dizychat_ci';
const sessionKey = 'dizychat-account-session-v2';

(async () => {
  assert.equal(process.env.NODE_ENV, 'test', 'account fixture is only for isolated CI');
  assert.equal(new URL(base).origin, 'http://127.0.0.1:10000', 'never create fixtures against production');
  await mongoose.connect(database);
  const username = `AccountUI${crypto.randomBytes(5).toString('hex')}`;
  const password = crypto.randomBytes(24).toString('hex');
  const account = await User.create({ username, canonicalUsername: username.toLowerCase(),
    passwordHash: hashPassword(password), role: 'user', state: 'active', credentialSource: 'managed' });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const route of ['/login', '/login.html']) {
      for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        try {
          const page = await context.newPage();
          const pageErrors = [];
          page.on('pageerror', (error) => pageErrors.push(error.message));
          await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
          await page.waitForFunction(() => window.socket?.connected);
          await page.fill('#account-username', username);
          await page.fill('#account-password', password);
          await page.press('#account-password', 'Enter');
          await page.waitForFunction(() => document.querySelector('#account-login-status').textContent.startsWith('Signed in as '));
          assert.equal(await page.evaluate(() => window.currentRoom), null, 'login is independent of room membership');
          await page.locator('#lobby-account-logout-btn').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#guest-login').isVisible(), false);
          const token = await page.evaluate((key) => sessionStorage.getItem(key), sessionKey);
          assert.ok(token);

          // Fresh navigation in the same tab must restore account state on either alias.
          await page.goto(`${base}${route === '/login' ? '/login.html' : '/login'}`, { waitUntil: 'networkidle' });
          await page.locator('#lobby-account-logout-btn').waitFor({ state: 'visible' });
          assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey), token);

          await page.fill('#room-input', `AccountRoom${width}`);
          await page.press('#room-input', 'Enter');
          await page.locator('#chat-container').waitFor({ state: 'visible' });
          await page.waitForFunction((name) => document.querySelector('#user-list').textContent.includes(name), username);
          assert.equal(await page.evaluate(() => window.currentUser), username);
          await page.click('#leave-btn');
          await page.locator('#lobby-account-logout-btn').waitFor({ state: 'visible' });
          assert.equal(await page.evaluate(() => window.currentRoom), null);
          assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey), token);

          await page.locator('.public-room-item[data-room="General Chat"]').click();
          await page.locator('#chat-container').waitFor({ state: 'visible' });
          await page.waitForFunction((name) => document.querySelector('#user-list').textContent.includes(name), username);
          assert.equal(await page.evaluate(() => window.currentUser), username);
          await page.click('#leave-btn');

          const box = await page.locator('#lobby-account-logout-btn').boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'global logout fits the viewport');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'landing has no horizontal overflow');
          fs.mkdirSync('ui-test-artifacts', { recursive: true });
          await page.screenshot({ path: `ui-test-artifacts/account-lobby-${route.slice(1)}-${width}.png`, fullPage: true });
          await page.click('#lobby-account-logout-btn');
          await page.waitForFunction((key) => !sessionStorage.getItem(key), sessionKey);
          await page.locator('#guest-login').waitFor({ state: 'visible' });

          // A second socket presenting the old token must be rejected by server authority.
          const restored = await page.evaluate((oldToken) => new Promise((resolve, reject) => {
            const probe = io({ forceNew: true, auth: { sessionToken: oldToken } });
            const timer = setTimeout(() => { probe.disconnect(); reject(new Error('logout probe timed out')); }, 10000);
            probe.on('connect', () => probe.emit('account session', {}, (ack) => {
              clearTimeout(timer); probe.disconnect(); resolve(ack);
            }));
          }), token);
          assert.equal(restored.ok, true);
          assert.equal(restored.session, null, 'logout revokes the current server browser session');
          await page.reload({ waitUntil: 'networkidle' });
          assert.equal(await page.locator('#lobby-account-logout-btn').isVisible(), false);
          assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey), null);
          assert.deepEqual(pageErrors, [], 'account navigation must not throw browser errors');
          console.log(`Account navigation passed: ${route}, ${width}px`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser?.close();
    await User.deleteOne({ _id: account._id });
    await mongoose.disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
