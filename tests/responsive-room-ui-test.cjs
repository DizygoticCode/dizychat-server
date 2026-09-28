'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Runs only against the isolated, empty-room CI server. Never collect
// screenshots of registered accounts or live private conversations.
const base = String(process.env.DEPLOY_URL || 'http://127.0.0.1:10000').replace(/[/]$/, '');
const cases = [
  { name: 'phone portrait', width: 360, height: 740, mobile: true },
  { name: 'phone landscape', width: 740, height: 360, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
];

function assertWithin(box, width, label) {
  assert.ok(box && box.width > 0 && box.height > 0, label + ' must be visible');
  assert.ok(box.left >= -1 && box.right <= width + 1,
    label + ' clips horizontally: ' + JSON.stringify(box));
}

(async () => {
  assert.equal(new URL(base).hostname, '127.0.0.1', 'UI test must not target a public host');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of cases) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (err) => errors.push(String(err.message)));
        await page.goto(base + '/login.html', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForFunction(() => window.socket?.connected, null, { timeout: 15000 });
        const landing = await page.evaluate(() => ({
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          recentVisible: !!document.querySelector('#recent-rooms-panel')?.offsetParent,
        }));
        assert.ok(landing.scrollWidth <= landing.viewport + 1,
          viewport.name + ': landing overflow ' + JSON.stringify(landing));
        assert.equal(landing.recentVisible, false,
          viewport.name + ': guest landing must not expose account history');

        await page.fill('#guest-username', 'ResponsiveAudit' + viewport.width);
        await page.locator('#guest-continue-btn').click();
        await page.waitForFunction(() => !document.querySelector('#room-input').disabled);
        const publicDizy = page.locator('.public-room-item[data-room="DIZY"]');
        await publicDizy.waitFor({ state: 'visible', timeout: 15000 });
        await publicDizy.click();
        await page.locator('#chat-container').waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForFunction(() => window.currentRoom === 'DIZY');

        const layout = await page.evaluate(() => {
          const rect = (selector) => {
            const el = document.querySelector(selector);
            const b = el.getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, left: b.left,
              right: b.right, width: b.width, height: b.height };
          };
          return {
            viewport: window.innerWidth, height: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            chat: rect('#chat-container'), header: rect('#chat-container > header'),
            messages: rect('#messages'), composer: rect('#form'),
          };
        });
        assert.ok(layout.scrollWidth <= layout.viewport + 1,
          viewport.name + ': chat page overflow ' + JSON.stringify(layout));
        for (const key of ['chat', 'header', 'messages', 'composer']) {
          assertWithin(layout[key], layout.viewport, viewport.name + ' ' + key);
        }
        assert.ok(layout.messages.bottom <= layout.composer.top + 2,
          viewport.name + ': messages overlap composer ' + JSON.stringify(layout));
        if (viewport.mobile) {
          assert.ok(layout.header.top >= -1, viewport.name + ': toolbar above viewport');
          assert.ok(layout.composer.bottom <= layout.height + 1,
            viewport.name + ': composer below viewport ' + JSON.stringify(layout));
        }

        await page.locator('#input').fill('Responsive UI test');
        await page.locator('#file-attach').waitFor({ state: 'visible' });
        await page.locator('#leave-btn').click();
        await page.locator('#guest-join-btn').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#recent-rooms-panel').isVisible(), false,
          viewport.name + ': guest must not see registered recent rooms');
        assert.deepEqual(errors, [], viewport.name + ': uncaught page exceptions');
        console.log('Responsive room UI accepted: ' + viewport.name);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
