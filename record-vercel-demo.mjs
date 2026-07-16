#!/usr/bin/env node
/**
 * Playwright script to record the OKX_Preferences web app demo
 * Records: Landing → Form submit → Hermes preview → Results → Unlock panel
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, 'demo-recordings');
const VIDEO_PATH = path.join(OUTPUT_DIR, 'okx-preferences-vercel-demo.webm');
const URL = 'https://okx-preferences.vercel.app';

// Demo pitch to use
const DEMO_PITCH = 'AI scheduling concierge for small clinics that handles missed calls, patient reminders, and booking follow-ups as a paid validation service.';

async function main() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('🎬 Starting Playwright recording...');
  console.log(`📍 Target URL: ${URL}`);
  console.log(`💾 Output: ${VIDEO_PATH}`);

  // Launch browser with video recording
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });

  const context = await browser.newContext({
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1280, height: 720 }
    },
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error') {
      console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`[Browser Error] ${error.message}`);
  });

  try {
    // Navigate to the web app
    console.log('🌐 Navigating to Vercel deployment...');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000); // Let hero animations play

    // Wait for form to be ready
    await page.waitForSelector('#validate-form', { state: 'visible', timeout: 15000 });
    console.log('✅ Page loaded, form visible');

    // Find the textarea and type the pitch
    const textarea = await page.waitForSelector('#pitch', { state: 'visible' });
    console.log('✍️ Typing demo pitch...');
    
    // Click and type with realistic delay
    await textarea.click();
    await page.keyboard.type(DEMO_PITCH, { delay: 50 });
    await page.waitForTimeout(500);

    // Find and click submit button
    const submitBtn = await page.waitForSelector('#submit-button', { state: 'visible' });
    console.log('🚀 Submitting form...');
    await submitBtn.click();

    // Wait for status card to appear
    await page.waitForSelector('#status-card:not(.hidden)', { state: 'visible', timeout: 10000 });
    console.log('⏳ Status card appeared, waiting for preview generation...');

    // Wait for result to appear (this can take 1-3 minutes per the UI)
    console.log('⏳ Waiting for Hermes preview and results (up to 3 minutes)...');
    
    try {
      await page.waitForSelector('#result:not(.hidden)', { state: 'visible', timeout: 180000 });
      console.log('✅ Results appeared!');
    } catch (e) {
      console.log('⚠️ Results did not appear within 3 minutes, continuing anyway...');
    }

    // Wait a bit to show the full result grid
    await page.waitForTimeout(5000);

    // Scroll to show the unlock panel
    await page.evaluate(() => {
      const unlockPanel = document.querySelector('.unlock-panel');
      if (unlockPanel) unlockPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await page.waitForTimeout(3000);

    // If checkout link is available, hover it
    const checkoutLink = await page.$('#checkout-link:not(.disabled)');
    if (checkoutLink) {
      console.log('💳 Checkout link available, hovering...');
      await checkoutLink.hover();
      await page.waitForTimeout(2000);
    }

    // Check for crypto payment panel
    const cryptoPanel = await page.$('#crypto-pay:not(.hidden)');
    if (cryptoPanel) {
      console.log('₿ Crypto payment panel visible');
      await cryptoPanel.hover();
      await page.waitForTimeout(2000);
    }

    // Final pause to show end state
    await page.waitForTimeout(3000);

    console.log('🏁 Demo complete, closing browser...');

  } catch (error) {
    console.error('❌ Error during recording:', error.message);
  } finally {
    await context.close();
    await browser.close();

    // Find the recorded video file
    const files = fs.readdirSync(OUTPUT_DIR);
    const videoFile = files.find(f => f.endsWith('.webm'));
    
    if (videoFile) {
      const recordedPath = path.join(OUTPUT_DIR, videoFile);
      // Rename to our desired name
      if (recordedPath !== VIDEO_PATH) {
        fs.renameSync(recordedPath, VIDEO_PATH);
      }
      const stats = fs.statSync(VIDEO_PATH);
      console.log(`✅ Video saved: ${VIDEO_PATH}`);
      console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.log('⚠️ No video file found in output directory');
    }
  }
}

main().catch(console.error);