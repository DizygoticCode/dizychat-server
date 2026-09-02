// ==============================
// ui-test.cjs — Playwright & Puppeteer UI test (CommonJS)
// ==============================

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ✅ Config
const BASE_URL = process.env.DEPLOY_URL
  ? String(process.env.DEPLOY_URL).replace(/\/$/, "")
  : "http://127.0.0.1:10000";
const SITE = `${BASE_URL}/login.html`;
const ARTIFACT_DIR = path.join(process.cwd(), 'ui-test-artifacts');
const VIDEO_DIR = path.join(ARTIFACT_DIR, 'playwright_videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
const TIMESTAMP = process.env.TIMESTAMP || Date.now();

// ✅ Helper: safe delay
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ==============================
// Main Playwright UI Test
// ==============================
async function runPlaywrightTest() {
  console.log(`🌐 Launching Playwright browser to test ${SITE}`);

  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();

  try {
    console.log("⏳ Waiting briefly for the configured DizyChat service...");
    await delay(1000);

    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('✅ Page loaded');

    await page.waitForSelector('#join-btn', { timeout: 30000 });
    await page.fill('#username-input', 'TesterBot');
    await page.fill('#room-input', 'AutoTestRoom');
    await page.click('#join-btn');
    console.log('➡️ Join button clicked');

    const maxRetries = 10;
    const retryDelay = 3000;

    // Chat container
    let chatVisible = false;
    for (let i = 0; i < maxRetries; i++) {
      chatVisible = await page.evaluate(() => !!document.querySelector('#chat-container'));
      if (chatVisible) {
        console.log(`✅ #chat-container found on attempt ${i + 1}`);
        break;
      }
      console.warn(`⚠️ #chat-container not visible, retry ${i + 1}/${maxRetries}`);
      console.log('🧩 Partial HTML snapshot:', (await page.content()).slice(0, 150));
      await delay(retryDelay);
    }
    if (!chatVisible) throw new Error("❌ #chat-container never became visible");

    // Toggle-theme
    let toggleFound = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const el = await page.waitForSelector('#toggle-theme', { timeout: 2000 });
        if (el) {
          await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), el);
          toggleFound = true;
          console.log(`✅ #toggle-theme visible (attempt ${i + 1})`);
          break;
        }
      } catch {}
      await delay(500);
    }
    if (!toggleFound) throw new Error("❌ #toggle-theme never became visible");
    await page.click('#toggle-theme');

    // Emoji button
    let emojiFound = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const el = await page.waitForSelector('#emoji-btn', { timeout: 2000 });
        if (el) {
          await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), el);
          emojiFound = true;
          console.log(`✅ #emoji-btn visible (attempt ${i + 1})`);
          break;
        }
      } catch {}
      await delay(500);
    }
    if (!emojiFound) throw new Error("❌ #emoji-btn never became visible");

    await page.click('#emoji-btn');
    await page.waitForSelector('#emoji-picker.show', { timeout: 10000 });

    // Send message
    await page.fill('#input', 'Test message from automated check 🤖');
    await page.click('#form button[type=submit]');
    await delay(2000);

    const messageCount = await page.locator('#messages .message.self').count();
    if (messageCount === 0) throw new Error("❌ Sent message not found in chat");

    await verifyUiFeatures(page);

    const screenshotPath = path.join(ARTIFACT_DIR, `playwright-room-${TIMESTAMP}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Playwright screenshot saved at ${screenshotPath}`);
  } catch (err) {
    console.error("❌ Playwright UI Test failed:", err.message);
    const errorScreenshot = path.join(ARTIFACT_DIR, `playwright-error-${TIMESTAMP}.png`);
    await page.screenshot({ path: errorScreenshot, fullPage: true });
    console.log(`📸 Error screenshot saved at ${errorScreenshot}`);
    throw err;
  } finally {
    await context.close();
    await browser.close();

    // Rename Playwright video
    try {
      const videos = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));
      if (videos.length > 0) {
        const oldPath = path.join(VIDEO_DIR, videos[0]);
        const newPath = path.join(VIDEO_DIR, `playwright-video-${TIMESTAMP}.webm`);
        fs.renameSync(oldPath, newPath);
        console.log(`🎥 Video renamed: ${newPath}`);
      } else {
        console.warn("⚠️ No Playwright video found to rename");
      }
    } catch (e) {
      console.error("⚠️ Could not rename video file:", e.message);
    }
  }
}

// ==============================
// Feature checks after joining
// ==============================
async function verifyUiFeatures(page) {
  console.log('🔎 Verifying chat feature surface...');

  // Search and filter controls
  await page.waitForSelector('#message-search', { timeout: 15000 });
  await page.waitForSelector('#message-search-filter', { timeout: 15000 });
  const filterOptions = await page.$$eval('#message-search-filter option', (opts) => opts.map((o) => o.value));
  if (!filterOptions.includes('pinned') || !filterOptions.includes('starred')) {
    throw new Error('❌ Missing search filter options for pinned/starred messages');
  }

  // Layout density toggle
  const compactBefore = await page.evaluate(() => document.body.classList.contains('compact-mode'));
  await page.click('#toggle-density');
  const compactAfter = await page.evaluate(() => document.body.classList.contains('compact-mode'));
  if (compactBefore === compactAfter) {
    throw new Error('❌ Compact mode did not toggle');
  }
  await page.click('#toggle-density');

  // Sound notification toggle
  const soundBefore = await page.getAttribute('#toggle-sounds', 'aria-pressed');
  await page.click('#toggle-sounds');
  const soundAfter = await page.getAttribute('#toggle-sounds', 'aria-pressed');
  if (soundBefore === soundAfter) {
    throw new Error('❌ Sound toggle did not update state');
  }
  await page.click('#toggle-sounds');

  // Quick access controls and media widgets
  await page.waitForSelector('#copy-join-link', { timeout: 10000 });
  await page.waitForSelector('#scroll-to-latest', { state: 'attached', timeout: 10000 });
  await page.waitForSelector('#gif-btn', { timeout: 10000 });
  await page.waitForSelector('#file-attach', { timeout: 10000 });
  await page.waitForSelector('#quick-emoji-panel', { state: 'attached', timeout: 10000 });
  await page.waitForSelector('#psybin-player', { state: 'attached', timeout: 10000 });

  console.log('✅ Verified search, layout, audio, and utility controls');
}

// ==============================
// Puppeteer fallback screenshot
// ==============================
async function runPuppeteerScreenshot() {
  const puppeteer = require('puppeteer');
  const ts = TIMESTAMP;
  const screenshotPath = path.join(ARTIFACT_DIR, `puppeteer-room-${ts}.png`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'], headless: true });
  const page = await browser.newPage();

  console.log("🌐 Launching Puppeteer quick check...");
  await page.goto(`${SITE}/?room=TEST`, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#messages', { timeout: 10000 });
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Puppeteer screenshot saved at ${screenshotPath}`);

  await browser.close();
}

// ==============================
// Generate index.html for CI artifacts
// ==============================
function generateArtifactIndex() {
  const puppeteerScreenshot = `puppeteer-room-${TIMESTAMP}.png`;
  const playwrightScreenshot = `playwright-room-${TIMESTAMP}.png`;
  const playwrightVideo = `playwright_videos/playwright-video-${TIMESTAMP}.webm`;

  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>DizyChat UI Test Artifacts - ${TIMESTAMP}</title>
    <style>
      body { font-family: sans-serif; padding: 20px; line-height: 1.6; }
      h1 { font-size: 1.5rem; }
      img, video { max-width: 100%; border: 1px solid #ccc; margin: 20px 0; border-radius: 8px; }
    </style>
  </head>
  <body>
    <h1>DizyChat UI Test Artifacts</h1>
    <p>Run timestamp: ${TIMESTAMP}</p>
    <section>
      <h2>📸 Puppeteer Screenshot</h2>
      <img src="${puppeteerScreenshot}" alt="Puppeteer Screenshot" />
    </section>
    <section>
      <h2>📸 Playwright Screenshot</h2>
      <img src="${playwrightScreenshot}" alt="Playwright Screenshot" />
    </section>
    <section>
      <h2>🎥 Playwright Video</h2>
      <video controls>
        <source src="${playwrightVideo}" type="video/webm" />
        Your browser does not support video playback.
      </video>
    </section>
  </body>
  </html>
  `;
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'index.html'), html);
  console.log('🗂️ index.html created successfully');
}

// ==============================
// Execute with retry & artifact index
// ==============================
(async () => {
  const maxWorkflowRetries = 2;
  let attempt = 0;

  while (attempt < maxWorkflowRetries) {
    try {
      if (process.argv.includes('--puppeteer')) {
        await runPuppeteerScreenshot();
      }
      await runPlaywrightTest();
      break;
    } catch (err) {
      attempt++;
      console.warn(`⚠️ Attempt ${attempt}/${maxWorkflowRetries} failed: ${err.message}`);
      if (attempt >= maxWorkflowRetries) {
        console.error("❌ Max retries reached. Exiting...");
        throw err;
      }
      console.log('⏱️ Retrying Playwright test in 10s...');
      await delay(10000);
    }
  }

  generateArtifactIndex();
})();

module.exports = {
  runPlaywrightTest,
  runPuppeteerScreenshot,
};
