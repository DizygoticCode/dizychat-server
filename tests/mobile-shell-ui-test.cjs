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

    // Real phone flow: the stacked login view is scrolled before the Join control is used.
    // Entering chat must discard that landing-page scroll position rather than carrying it
    // into the fixed-height chat shell.
    const landingScroll = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return {
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });
    assert.ok(
      landingScroll.scrollY > 0,
      `mobile landing page must be scrollable for this regression: ${JSON.stringify(landingScroll)}`,
    );

    await page.evaluate(() => document.querySelector('#guest-join-btn').click());

    await page.waitForFunction(() => {
      const chat = document.querySelector('#chat-container');
      return chat && getComputedStyle(chat).display !== 'none';
    }, { timeout: 30000 });

    await page.waitForSelector('#chat-container > header', { state: 'visible' });
    await page.waitForSelector('#form', { state: 'visible' });
    await page.waitForSelector('#user-sidebar .sidebar-header', { state: 'visible' });

    // Exercise the authenticated-toolbar footprint without needing protected CI credentials.
    await page.evaluate(() => {
      const identity = document.querySelector('#account-identity');
      const logout = document.querySelector('#account-logout-btn');
      identity.hidden = false;
      identity.textContent = 'Dizygotic · OWNER';
      logout.hidden = false;
    });

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

      const sidebar = document.querySelector('#user-sidebar');
      const userList = document.querySelector('#user-list');
      const userListEmpty = document.querySelector('#user-list-empty');
      const toggle = document.querySelector('#user-sidebar-toggle');

      return {
        viewportHeight: window.innerHeight,
        windowScrollY: window.scrollY,
        chatMainOverflowY: getComputedStyle(document.querySelector('#chat-main')).overflowY,
        messagesOverflowY: getComputedStyle(document.querySelector('#messages')).overflowY,
        sidebarExpanded: sidebar.classList.contains('is-expanded'),
        toggleExpanded: toggle.getAttribute('aria-expanded'),
        userListDisplay: getComputedStyle(userList).display,
        userListEmptyDisplay: getComputedStyle(userListEmpty).display,
        header: rect('#chat-container > header'),
        messages: rect('#messages'),
        composer: rect('#form'),
        userStrip: rect('#user-sidebar .sidebar-header'),
      };
    });

    assert.ok(
      state.windowScrollY <= 1,
      `entering mobile chat must reset the landing-page scroll position: ${JSON.stringify(state)}`,
    );
    assert.equal(state.messagesOverflowY, 'auto', 'messages remain the mobile scroll surface');

    assert.equal(state.sidebarExpanded, false, 'online users panel should start collapsed on mobile');
    assert.equal(state.toggleExpanded, 'false', 'mobile Users toggle should report collapsed state');
    assert.equal(state.userListDisplay, 'none', 'collapsed mobile users panel should hide the user list');
    assert.equal(state.userListEmptyDisplay, 'none', 'collapsed mobile users panel should hide its empty state');

    withinViewport(state.header, state.viewportHeight, 'top toolbar');
    withinViewport(state.composer, state.viewportHeight, 'message composer');
    withinViewport(state.userStrip, state.viewportHeight, 'online users strip');

    assert.ok(
      state.messages.bottom <= state.composer.top + 1,
      `messages must end above the composer: ${JSON.stringify(state)}`,
    );
    assert.ok(
      state.composer.bottom <= state.userStrip.top + 1,
      `collapsed online users strip must remain below the composer: ${JSON.stringify(state)}`,
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
