import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SITE = "https://dizychat-server.onrender.com";

// Generate a unique timestamp for this run
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

// Ensure the video folder exists
const VIDEO_DIR = path.join(process.cwd(), 'playwright_videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

async function runUITest() {
  console.log(`🌐 Launching headless browser to test ${SITE}`);
  
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  try {
    // 1️⃣ Go to landing page
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    console.log("✅ Page loaded");

    // 2️⃣ Check for join button
    await page.waitForSelector('#join-btn');
    console.log("✅ Join button found");

    // 3️⃣ Fill username + room
    await page.fill('#username-input', 'TesterBot');
    await page.fill('#room-input', 'AutoTestRoom');
    console.log("✅ Username and room filled");

    // 4️⃣ Click Join
    await Promise.all([
      page.click('#join-btn'),
      page.waitForSelector('#chat-container', { timeout: 10000 }),
    ]);
    console.log("✅ Joined chat successfully");

    // 5️⃣ Toggle dark/light mode
    await page.click('#toggle-theme');
    const darkMode = await page.evaluate(() => document.body.classList.contains('dark'));
    console.log(`✅ Dark mode toggle ${darkMode ? 'enabled' : 'disabled'}`);

    // 6️⃣ Open emoji picker
    await page.click('#emoji-btn');
    await page.waitForSelector('#emoji-picker.show');
    console.log("✅ Emoji picker opens");

    // 7️⃣ Send a message
    await page.fill('#input', 'Test message from automated check 🤖');
    await page.click('#form button[type=submit]');
    await page.waitForTimeout(2000);
    console.log("✅ Message sent");

    // 8️⃣ Check if message appears
    const messageVisible = await page.locator('#messages .message.self').count();
    if (messageVisible > 0) console.log("✅ Message appeared in chat");
    else throw new Error("❌ Message not visible in chat");

    // 9️⃣ Screenshot
    const screenshotPath = path.join(process.cwd(), `render_test_screenshot-${TIMESTAMP}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved at ${screenshotPath}`);

  } catch (err) {
    console.error("❌ UI Test failed:", err.message);
    const errorScreenshot = path.join(process.cwd(), `render_test_error-${TIMESTAMP}.png`);
    await page.screenshot({ path: errorScreenshot, fullPage: true });
    console.log(`📸 Error screenshot saved at ${errorScreenshot}`);
    throw err;
  } finally {
    await context.close();
    await browser.close();
    console.log(`🎥 Video saved in ${VIDEO_DIR} (each run unique via timestamp)`);
  }
}

runUITest();
