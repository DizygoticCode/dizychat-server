'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = String(process.env.DEPLOY_URL || 'http://127.0.0.1:10000').replace(/[/]$/, '');
const cases = [
  { name: 'phone portrait', width: 360, height: 740, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
];

function assertContained(box, viewport, label) {
  assert.ok(box && box.width > 0 && box.height > 0, label + ' must be visible');
  assert.ok(box.left >= -1, label + ' starts outside viewport: ' + JSON.stringify(box));
  assert.ok(box.right <= viewport.width + 1, label + ' overflows horizontally: ' + JSON.stringify(box));
  assert.ok(box.top >= -1, label + ' starts above viewport: ' + JSON.stringify(box));
  assert.ok(box.bottom <= viewport.height + 1, label + ' ends below viewport: ' + JSON.stringify(box));
}

async function geometry(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
  });
}

async function assertNoPageOverflow(page, label) {
  const state = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(state.documentWidth <= state.viewport + 1,
    label + ': document overflow ' + JSON.stringify(state));
  assert.ok(state.bodyWidth <= state.viewport + 1,
    label + ': body overflow ' + JSON.stringify(state));
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
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(String(error.message)));

        await page.route('**/giphy-search?**', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: [{
                id: 'fixture-gif',
                title: 'Fixture animated reaction with a deliberately long descriptive title',
                mediaType: 'gif',
                preview: 'https://media.invalid/fixture.gif',
                gif: 'https://media.invalid/fixture.gif',
                mp4: '',
                hasSound: false,
              }],
              pagination: { count: 1, offset: 0, total_count: 1 },
            }),
          });
        });

        await page.route('**/soundboard-clips**', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              hits: [{
                title: 'Extremely Long Fixture Soundboard Clip Title That Must Stay Inside The Picker',
                tags: 'fixture,responsive,audio',
                boardTitle: 'Responsive Acceptance Board',
                duration: 12,
                audioUrl: 'https://media.invalid/fixture.mp3',
              }],
            }),
          });
        });

        const pixelPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        );
        await page.route('https://media.invalid/**', async (route) => {
          const url = route.request().url();
          if (/\.png(?:$|\?)/i.test(url)) {
            await route.fulfill({ status: 200, contentType: 'image/png', body: pixelPng });
            return;
          }
          if (/\.gif(?:$|\?)/i.test(url)) {
            await route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') });
            return;
          }
          await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(8) });
        });

        await page.goto(base + '/login.html', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForFunction(() => window.socket?.connected, null, { timeout: 15000 });
        await page.fill('#guest-username', 'MediaAudit' + viewport.width);
        await page.click('#guest-continue-btn');
        await page.waitForFunction(() => !document.querySelector('#room-input').disabled);

        const dizyChoice = page.locator('.public-room-item[data-room="DIZY"]');
        await dizyChoice.waitFor({ state: 'visible', timeout: 15000 });
        await dizyChoice.click();
        await page.locator('#chat-container').waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForFunction(() => window.currentRoom === 'DIZY');

        const longText = 'LONG-LAYOUT-' + 'X'.repeat(180);
        await page.fill('#input', longText);
        await page.click('#form button[type=submit]');
        await page.waitForFunction((text) => {
          return Array.from(document.querySelectorAll('#messages .message.self'))
            .some((node) => node.textContent?.includes(text));
        }, longText);
        await assertNoPageOverflow(page, viewport.name + ' long message');

        await page.click('#emoji-btn');
        const emoji = page.locator('#emoji-picker.show');
        await emoji.waitFor({ state: 'visible', timeout: 10000 });
        assertContained(await geometry(page, '#emoji-picker'), viewport, viewport.name + ' emoji picker');
        await page.click('#emoji-btn');

        await page.click('#gif-btn');
        const gif = page.locator('#gif-picker');
        await gif.waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('#gif-grid .gif-tile').first().waitFor({ state: 'visible', timeout: 10000 });
        assertContained(await geometry(page, '#gif-picker'), viewport, viewport.name + ' GIF picker');
        await assertNoPageOverflow(page, viewport.name + ' GIF picker');

        await page.click('#soundboard-btn');
        const soundboard = page.locator('#soundboard-picker');
        await soundboard.waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('#soundboard-results .soundboard-item').first().waitFor({ state: 'visible', timeout: 10000 });
        assertContained(await geometry(page, '#soundboard-picker'), viewport, viewport.name + ' soundboard picker');
        const soundTitle = page.locator('#soundboard-results .soundboard-item-title').first();
        const titleGeometry = await soundTitle.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const parent = node.closest('.soundboard-item')?.getBoundingClientRect();
          return { right: box.right, parentRight: parent?.right || 0 };
        });
        assert.ok(titleGeometry.right <= titleGeometry.parentRight + 1,
          viewport.name + ': long soundboard title escapes its row');
        await assertNoPageOverflow(page, viewport.name + ' soundboard picker');

        await page.click('#soundboard-btn');

        const mediaUrl = 'https://media.invalid/responsive-fixture.png';
        await page.fill('#input', mediaUrl);
        await page.click('#form button[type=submit]');
        const preview = page.locator('#messages .message.self .inline-preview.inline-image').last();
        await preview.waitFor({ state: 'visible', timeout: 15000 });
        await preview.locator('.preview-media').click();

        const lightbox = page.locator('#media-lightbox.show');
        await lightbox.waitFor({ state: 'visible', timeout: 10000 });
        assert.equal(await lightbox.getAttribute('aria-hidden'), 'false');
        assertContained(await geometry(page, '#media-lightbox .media-frame'), viewport, viewport.name + ' media lightbox');
        await page.keyboard.press('Escape');
        await page.locator('#media-lightbox').waitFor({ state: 'hidden', timeout: 10000 });

        await assertNoPageOverflow(page, viewport.name + ' final');
        assert.deepEqual(pageErrors, [], viewport.name + ': uncaught page exceptions');
        console.log('Media/picker UI accepted: ' + viewport.name);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
