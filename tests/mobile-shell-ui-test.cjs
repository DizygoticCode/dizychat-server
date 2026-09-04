'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.DEPLOY_URL
  ? String(process.env.DEPLOY_URL).replace(/\/$/, '')
  : 'http://127.0.0.1:10000';

function withinViewport(rect, viewportHeight, label) {
  assert.ok(rect.top >= -1, `${label} starts above the mobile viewport: ${JSON.stringify(rect)}`);
  assert.ok(rect.bottom <= viewportHeight + 1, `${label} ends below the mobile viewport: ${JSON.stringify(rect)}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.fill('#guest-username', 'MobileShellBot');
    await page.fill('#room-input', 'MobileShellRoom');
    await page.click('#guest-join-btn');

    await page.waitForFunction(() => {
      const chat = document.querySelector('#chat-container');
      return chat && getComputedStyle(chat).display !== 'none';
    }, { timeout: 30000 });

    await page.waitForSelector('#chat-container > header', { state: 'visible' });
    await page.waitForSelector('#form', { state: 'visible' });
    await page.waitForSelector('#user-sidebar .sidebar-header', { state: 'visible' });

    const state = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        const box = node.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
        };
      };

      return {
        viewportHeight: window.innerHeight,
        documentScrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        chatMainOverflowY: getComputedStyle(document.querySelector('#chat-main')).overflowY,
        messagesOverflowY: getComputedStyle(document.querySelector('#messages')).overflowY,
        header: rect('#chat-container > header'),
        composer: rect('#form'),
        userStrip: rect('#user-sidebar .sidebar-header'),
      };
    });

    assert.equal(
      state.chatMainOverflowY,
      'hidden',
      `mobile shell must not independently scroll #chat-main: ${JSON.stringify(state)}`,
    );
    assert.equal(state.messagesOverflowY, 'auto', 'messages remain the mobile scroll surface');
    assert.ok(
      state.documentScrollHeight <= state.viewportHeight + 1,
      `document must not vertically scroll in mobile chat view: ${JSON.stringify(state)}`,
    );
    assert.ok(
      state.bodyScrollHeight <= state.viewportHeight + 1,
      `body must stay within the mobile viewport: ${JSON.stringify(state)}`,
    );

    withinViewport(state.header, state.viewportHeight, 'top toolbar');
    withinViewport(state.composer, state.viewportHeight, 'message composer');
    withinViewport(state.userStrip, state.viewportHeight, 'online users strip');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
