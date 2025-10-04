import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SITE = "https://dizychat-server.onrender.com";

// Ensure artifact folders exist
const ARTIFACT_DIR = path.join(process.cwd(), 'ui-test-artifacts');
const VIDEO_DIR = path.join(ARTIFACT_DIR, 'playwright_videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

// Use the same timestamp as the workflow if available
const TIMESTAMP = process.env.TIMESTAMP || Date.now();

// ✅ Main Playwright UI test with robust element handling
async function runPlaywrightTest() {
  console.log(`🌐 Launching Playwright browser to test ${SITE}`);

  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const context = await browser.newContext({
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(SITE, { waitUntil: 'networkidle' });
    console.log('✅ Page loaded');

    await page.waitForSelector('#join-btn', { timeout: 30000 });
    await page.fill('#username-input', 'TesterBot');
    await page.fill('#room-input', 'AutoTestRoom');
    await page.click('#join-btn');
    console.log('➡️ Join button clicked');

    // 🔁 Robust polling for #chat-container
    const maxRetries = 10;
    const retryDelay = 3000; // 3s
    let chatVisible = false;

    for (let i = 0; i < maxRetries; i++) {
      chatVisible = await page.evaluate(() => !!document.querySelector('#chat-container'));
      if (chatVisible) {
        console.log(`✅ #chat-container found on attempt ${i + 1}`);
        break;
      } else {
        console.warn(`⚠️ #chat-container not visible yet, retry ${i + 1}/${maxRetries}`);
        console.log('ℹ️ Current body HTML snapshot (first 200 chars):', (await page.content()).slice(0, 200));
        await page.waitForTimeout(retryDelay);
      }
    }
    if (!chatVisible) throw new Error("❌ #chat-container never became visible");

    // 🔁 Robust handling for #toggle-theme
    let toggleVisible = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const toggle = await page.waitForSelector('#toggle-theme', { timeout: 2000 });
        if (toggle) {
          await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), toggle);
          toggleVisible = true;
          console.log(`✅ #toggle-theme visible on attempt ${i + 1}`);
          break;
        }
      } catch {
        console.warn(`⚠️ #toggle-theme not visible yet, retry ${i + 1}/${maxRetries}`);
        await page.waitForTimeout(500);
      }
    }
    if (!toggleVisible) throw new Error("❌ #toggle-theme never became visible");
    await page.click('#toggle-theme');

    // 🔁 Robust handling for #emoji-btn
    let emojiVisible = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const emojiBtn = await page.waitForSelector('#emoji-btn', { timeout: 2000 });
        if (emojiBtn) {
          await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), emojiBtn);
          emojiVisible = true;
          console.log(`✅ #emoji-btn visible on attempt ${i + 1}`);
          break;
        }
      } catch {
        console.warn(`⚠️ #emoji-btn not visible yet, retry ${i + 1}/${maxRetries}`);
        await page.waitForTimeout(500);
      }
    }
    if (!emojiVisible) throw new Error("❌ #emoji-btn never became visible");
    await page.click('#emoji-btn');
    await page.waitForSelector('#emoji-picker.show', { timeout: 10000 });

    await page.fill('#input', 'Test message from automated check 🤖');
    await page.click('#form button[type=submit]');
    await page.waitForTimeout(2000);

    const messageVisible = await page.locator('#messages .message.self').count();
    if (messageVisible === 0) throw new Error("❌ Message not visible in chat");

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

    // Rename the generated video file to include the timestamp
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
    } catch (err) {
      console.error("⚠️ Could not rename video file:", err.message);
    }

    console.log(`🎥 Playwright video saved in ${VIDEO_DIR}`);
  }
}

// ✅ Optional Puppeteer screenshot function
export async function runPuppeteerScreenshot() {
  const puppeteer = await import('puppeteer');
  const ts = TIMESTAMP;
  const screenshotPath = path.join(ARTIFACT_DIR, `puppeteer-room-${ts}.png`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'], headless: true });
  const page = await browser.newPage();
  await page.goto(`${SITE}/?room=TEST`, { waitUntil: 'networkidle2', timeout: 10000 });
  await page.waitForSelector('#messages', { timeout: 10000 });
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Puppeteer screenshot saved at ${screenshotPath}`);
  await browser.close();
}

// ✅ Generate index.html to view all artifacts
function generateArtifactIndex() {
  const puppeteerScreenshot = `puppeteer-room-${TIMESTAMP}.png`;
  const playwrightScreenshot = `playwright-room-${TIMESTAMP}.png`;
  const playwrightVideo = `playwright_videos/playwright-video-${TIMESTAMP}.webm`;

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>DizyChat UI Test Artifacts - ${TIMESTAMP}</title>
    <style>
      body { font-family: sans-serif; padding: 20px; }
      h1 { font-size: 1.5rem; }
      img, video { max-width: 100%; border: 1px solid #ccc; margin-bottom: 20px; }
      section { margin-bottom: 40px; }
    </style>
  </head>
  <body>
    <h1>DizyChat UI Test Artifacts</h1>
    <p>Run timestamp: ${TIMESTAMP}</p>

    <section>
      <h2>📸 Puppeteer Screenshot</h2>
      <img src="${puppeteerScreenshot}" alt="Puppeteer Screenshot">
    </section>

    <section>
      <h2>📸 Playwright Screenshot</h2>
      <img src="${playwrightScreenshot}" alt="Playwright Screenshot">
    </section>

    <section>
      <h2>🎥 Playwright Video</h2>
      <video controls>
        <source src="${playwrightVideo}" type="video/webm">
        Your browser does not support the video tag.
      </video>
    </section>
  </body>
  </html>
  `;

  fs.writeFileSync(path.join(ARTIFACT_DIR, 'index.html'), htmlContent);
  console.log('🗂️ index.html created with links to screenshots and video');
}

// ✅ Run tests with retries and generate index
(async () => {
  const maxWorkflowRetries = 2;
  let attempt = 0;
  while (attempt < maxWorkflowRetries) {
    try {
      if (process.argv.includes('--puppeteer')) {
        await runPuppeteerScreenshot();
      }
      await runPlaywrightTest();
      break; // success
    } catch (err) {
      attempt++;
      console.warn(`⚠️ Attempt ${attempt}/${maxWorkflowRetries} failed: ${err.message}`);
      if (attempt >= maxWorkflowRetries) throw err;
      console.log('⏱️ Retrying Playwright test...');
    }
  }

  generateArtifactIndex();
})();
