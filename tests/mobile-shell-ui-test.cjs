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

async function readShellState(page) {
  return page.evaluate(() => {
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
    const chat = document.querySelector('#chat-container');

    return {
      viewportHeight: window.innerHeight,
      windowScrollY: window.scrollY,
      chatPosition: getComputedStyle(chat).position,
      chatMainOverflowY: getComputedStyle(document.querySelector('#chat-main')).overflowY,
      messagesOverflowY: getComputedStyle(document.querySelector('#messages')).overflowY,
      sidebarExpanded: sidebar.classList.contains('is-expanded'),
      toggleExpanded: toggle.getAttribute('aria-expanded'),
      userListDisplay: getComputedStyle(userList).display,
      userListEmptyDisplay: getComputedStyle(userListEmpty).display,
      chat: rect('#chat-container'),
      header: rect('#chat-container > header'),
      messages: rect('#messages'),
      composer: rect('#form'),
      sidebar: rect('#user-sidebar'),
      userStrip: rect('#user-sidebar .sidebar-header'),
    };
  });
}

function assertShellOrder(state, label) {
  withinViewport(state.chat, state.viewportHeight, `${label} chat shell`);
  withinViewport(state.header, state.viewportHeight, `${label} top toolbar`);
  withinViewport(state.composer, state.viewportHeight, `${label} message composer`);
  withinViewport(state.sidebar, state.viewportHeight, `${label} online users panel`);
  withinViewport(state.userStrip, state.viewportHeight, `${label} online users strip`);

  assert.ok(
    Math.abs(state.chat.top) <= 1,
    `${label} chat shell must stay anchored to the visible viewport: ${JSON.stringify(state)}`,
  );
  assert.ok(
    state.messages.bottom <= state.composer.top + 1,
    `${label} messages must end above the composer: ${JSON.stringify(state)}`,
  );
  assert.ok(
    state.composer.bottom <= state.userStrip.top + 1,
    `${label} online users strip must remain below the composer: ${JSON.stringify(state)}`,
  );
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

    // Reproduce the Android flow where the stacked landing view has already
    // scrolled before entering chat. The fixed chat shell must still start at
    // the visible viewport top even if the old document scroll offset survives.
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

    const collapsed = await readShellState(page);

    assert.equal(collapsed.chatPosition, 'fixed', 'mobile chat shell is viewport anchored');
    assert.equal(
      collapsed.chatMainOverflowY,
      'hidden',
      'the whole mobile chat column must not become a second vertical scroll surface',
    );
    assert.equal(collapsed.messagesOverflowY, 'auto', 'messages remain the mobile scroll surface');
    assert.equal(collapsed.sidebarExpanded, false, 'online users panel should start collapsed on mobile');
    assert.equal(collapsed.toggleExpanded, 'false', 'mobile Users toggle should report collapsed state');
    assert.equal(collapsed.userListDisplay, 'none', 'collapsed mobile users panel should hide the user list');
    assert.equal(collapsed.userListEmptyDisplay, 'none', 'collapsed mobile users panel should hide its empty state');
    assertShellOrder(collapsed, 'collapsed');

    // Expanding Users is allowed to consume message height, but it must not
    // reorder the composer/strip or make either end of the app disappear.
    await page.click('#user-sidebar-toggle');
    const expanded = await readShellState(page);
    assert.equal(expanded.sidebarExpanded, true, 'Users button expands the mobile users panel');
    assert.equal(expanded.toggleExpanded, 'true', 'Users toggle exposes expanded state');
    assert.equal(expanded.userListDisplay, 'flex', 'expanded mobile users panel shows its user list');
    assertShellOrder(expanded, 'expanded');

    await page.click('#user-sidebar-toggle');
    const recollapsed = await readShellState(page);
    assert.equal(recollapsed.sidebarExpanded, false, 'Users button collapses the panel again');
    assert.equal(recollapsed.userListDisplay, 'none', 'recollapsing hides the full user list again');
    assert.equal(recollapsed.userListEmptyDisplay, 'none', 'recollapsing hides the empty-state row again');
    assertShellOrder(recollapsed, 'recollapsed');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
