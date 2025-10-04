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

// ✅ Main Playwright UI test with retry for #chat-container
async function runPlaywrightTest() {
  console.log(`🌐 Launching Playwright headless browser to test ${SITE}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#join-btn', { timeout: 30000 });
    await page.fill('#username-input', 'TesterBot');
    await page.fill('#room-input', 'AutoTestRoom');
    await page.click('#join-btn');

    // 🔁 Retry loop for chat container visibility
    const maxRetries = 5;
    const retryDelay = 3000; // 3s
    let chatVisible = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.waitForSelector('#chat-container', { visible: true, timeout: 5000 });
        chatVisible = true;
        break;
      } catch {
        console.warn(`⚠️ #chat-container not visible yet, retry ${i + 1}/${maxRetries}`);
        await page.waitForTimeout(retryDelay);
      }
    }
    if (!chatVisible) throw new Error("❌ #chat-container never became visible");

    await page.click('#toggle-theme');
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

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
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
