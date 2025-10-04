import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SITE = "https://dizychat-server.onrender.com";
const ARTIFACTS_DIR = './artifacts';

// Ensure artifacts directory exists
if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function runUITest() {
  console.log(`🌐 Launching headless browser to test ${SITE}`);

  const browser = await chromium.launch({
    headless: true, // Set false if you want to see the browser
  });

  const context = await browser.newContext({
    recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1280, height: 720 } }
  });

  const page = await context.newPage();

  try {
    // 1️⃣ Go to landing page
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    console.log("✅ Page loaded");

    // 2️⃣ Check for logo & join button
    await page.waitForSelector('#join-btn');
    console.log("✅ Join button found");

    // 3️⃣ Type username + room name
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

    // 7️⃣ Type a message and submit
    await page.fill('#input', 'Test message from automated check 🤖');
    await page.click('#form button[type=submit]');
    await page.waitForTimeout(2000);
    console.log("✅ Message sent");

    // 8️⃣ Check if message appears
    const messageVisible = await page.locator('#messages .message.self').count();
    if (messageVisible > 0) console.log("✅ Message appeared in chat");
    else throw new Error("❌ Message not visible in chat");

    // 9️⃣ Screenshot for record
    const screenshotPath = path.join(ARTIFACTS_DIR, 'render_test_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved at: ${screenshotPath}`);

  } catch (err) {
    console.error("❌ UI Test failed:", err.message);

    // Save error screenshot
    const errorScreenshotPath = path.join(ARTIFACTS_DIR, 'render_test_error.png');
    await page.screenshot({ path: errorScreenshotPath, fullPage: true });
    console.log(`📸 Error screenshot saved at: ${errorScreenshotPath}`);

    throw err;
  } finally {
    // Save video and close browser
    await context.close();
    await browser.close();
  }
}

// Run the test
runUITest()
  .then(() => console.log("✅ UI test completed successfully"))
  .catch(() => process.exit(1));
