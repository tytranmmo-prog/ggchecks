'use strict';

/**
 * change2fa.js — Single account 2FA secret changer
 * Usage: node change2fa.js '{"email":"..","password":"..","totpSecret":".."}'
 *
 * Flow:
 *   1. Log in (email → password → verify old TOTP)
 *   2. Navigate to /two-step-verification/authenticator
 *   3. Re-verify identity (TOTP challenge for sensitive action)
 *   4. Click "Change authenticator app"
 *   5. On QR screen, click "Can't scan it?" to get the manual key
 *   6. Scrape the new TOTP secret from the page
 *   7. Click Next → enter 6-digit code derived from the new secret → Verify
 *
 * Outputs JSON to stdout:
 *   { success: true,  account, newTotpSecret, changedAt }
 *   { success: false, account, error }
 */

const { chromium } = require('playwright');
const { generateSync: generateOTP } = require('otplib');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');

const AUTHENTICATOR_URL = 'https://myaccount.google.com/two-step-verification/authenticator';
const TIMEOUT = 60_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`); }

function generateTOTP(secret) {
  const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
  return generateOTP({ secret: cleanSecret });
}

// ──────────────────────────────────────────────
// TOTP input helper — waits for input, fills it, submits
// Retries with a fresh code if the page stays on the challenge URL
// ──────────────────────────────────────────────
async function fillAndSubmitTOTP(page, secret, contextLabel = '') {
  const codeInputSelectors = [
    'input[name="totpPin"]',
    'input[aria-label*="code" i]',
    'input[type="tel"]',
    'input[id*="totp" i]',
    '#totpPin',
  ];

  // Wait until at least one input is visible
  let inputEl = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const sel of codeInputSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) {
        inputEl = el;
        break;
      }
    }
    if (inputEl) break;
    await sleep(500);
  }

  if (!inputEl) {
    throw new Error(`TOTP input not found (${contextLabel})`);
  }

  // Generate a fresh code right before filling
  const code = generateTOTP(secret);
  log(`TOTP [${contextLabel}]: ${code}`);

  await inputEl.click();
  await inputEl.fill('');
  await inputEl.fill(code);
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(3000);
}

// ──────────────────────────────────────────────
// GOOGLE LOGIN
// ──────────────────────────────────────────────
async function googleLogin(page, email, password, totpSecret) {
  log(`Logging in as ${email}...`);
  await page.waitForSelector('input[type="email"]', { timeout: TIMEOUT });
  await page.fill('input[type="email"]', email);
  await page.keyboard.press('Enter');

  await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: TIMEOUT });
  await sleep(500);
  await page.fill('input[type="password"]', password);
  await page.keyboard.press('Enter');
  await sleep(2500);

  const url = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const isTotpPrompt =
    url.includes('signin/challenge') ||
    bodyText.includes('2-Step Verification') ||
    bodyText.includes('authenticator') ||
    bodyText.includes('Enter the code') ||
    (await page.$('input[aria-label*="code" i]').catch(() => null)) ||
    (await page.$('input[name="totpPin"]').catch(() => null));

  if (isTotpPrompt) {
    log('TOTP prompt detected (login)...');
    await fillAndSubmitTOTP(page, totpSecret, 'login');
  }

  const finalUrl = page.url();
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error(`Login did not complete — still on: ${finalUrl}`);
  }
  log('Login successful.');
}

// ──────────────────────────────────────────────
// NAVIGATE TO AUTHENTICATOR SETTINGS
// Handles Google's sensitive-action re-auth challenge
// ──────────────────────────────────────────────
async function navigateToAuthenticatorPage(page, email, password, totpSecret) {
  log('Navigating to authenticator settings...');
  await page.goto(AUTHENTICATOR_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await sleep(2000);

  // Google may ask us to re-verify for this sensitive page
  if (page.url().includes('accounts.google.com')) {
    log('Sensitive action re-verification required...');

    // Full re-login: Google may start from the email identifier step
    const emailField = await page.$('input[type="email"]').catch(() => null);
    if (emailField && await emailField.isVisible().catch(() => false)) {
      log('Email re-entry required for sensitive action...');
      await page.fill('input[type="email"]', email);
      await page.keyboard.press('Enter');
      await sleep(2000);
    }

    // Password re-entry
    const passwordField = await page.$('input[type="password"]').catch(() => null);
    if (passwordField && await passwordField.isVisible().catch(() => false)) {
      log('Password re-entry required for sensitive action...');
      await sleep(500);
      await page.fill('input[type="password"]', password);
      await page.keyboard.press('Enter');
      await sleep(2000);
    }

    // TOTP re-verification
    const url2 = page.url();
    const body2 = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (url2.includes('signin/challenge') || body2.includes('2-Step') || body2.includes('Enter the code')) {
      log('TOTP challenge for sensitive action...');
      await fillAndSubmitTOTP(page, totpSecret, 'sensitive-action');
    }

    await sleep(2000);

    // Navigate back to authenticator page if needed
    if (!page.url().includes('myaccount.google.com')) {
      log(`Still on auth page after re-verification: ${page.url()}`);
      log('Trying to navigate to authenticator page again...');
      await page.goto(AUTHENTICATOR_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(2000);
    }
  }

  const finalUrl = page.url();
  log(`On page: ${finalUrl}`);

  if (finalUrl.includes('accounts.google.com')) {
    throw new Error(`Could not reach authenticator settings page — still on: ${finalUrl}`);
  }

  await page.waitForFunction(
    () => /authenticator/i.test(document.body.innerText),
    { timeout: TIMEOUT }
  ).catch(() => log('Warning: authenticator page content not confirmed'));
}


// ──────────────────────────────────────────────
// CLICK "Change authenticator app"
// ──────────────────────────────────────────────
async function clickChangeAuthenticator(page) {
  log('Looking for "Change authenticator app" button...');

  const changeSelectors = [
    'button:has-text("Change authenticator app")',
    'a:has-text("Change authenticator app")',
    'span:has-text("Change authenticator app")',
  ];

  for (const sel of changeSelectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        await el.click();
        log(`Clicked change button via: ${sel}`);
        await sleep(2000);
        return;
      }
    } catch (_) { /* try next */ }
  }

  // JS fallback
  const clicked = await page.evaluate(() => {
    const allEls = [...document.querySelectorAll('button, a, [role="button"], span')];
    for (const el of allEls) {
      if (/change authenticator/i.test(el.innerText || el.textContent || '')) {
        el.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) throw new Error('Could not find "Change authenticator app" button');
  log('Clicked "Change authenticator app" via JS evaluate.');
  await sleep(2000);
}

// ──────────────────────────────────────────────
// GET MANUAL KEY FROM MODAL
// Strategy:
//   1. Wait for QR code screen to load
//   2. Try to click "Can't scan it?" / "Enter a setup key"
//   3. If click succeeds, parse the key text from the page
//   4. If click fails, decode the QR code image directly
// ──────────────────────────────────────────────
async function getManualKeyFromModal(page) {
  log('=== getManualKeyFromModal START ===');
  log(`Current URL: ${page.url()}`);

  // ── Wait for the QR code screen to fully load ──
  log('Waiting for QR code screen...');
  await page.waitForFunction(
    () => /Change authenticator app/i.test(document.body.innerText),
    { timeout: TIMEOUT }
  ).catch(() => log('Warning: "Change authenticator app" text not detected'));

  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return /can\u2019?'?t scan/i.test(text) ||
             text.includes('Scan a QR code') ||
             text.includes('QR code') ||
             !!document.querySelector('canvas, img[src*="qr"], img[alt*="QR" i], img[alt*="authenticator" i]');
    },
    { timeout: 20000 }
  ).catch(() => log('Warning: QR screen signals not found, continuing anyway...'));

  await sleep(2000);

  // ── Debug: dump clickable elements ──
  const clickables = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, [role="button"]')]
      .map(el => (el.innerText || el.textContent || '').trim().slice(0, 80))
      .filter(Boolean)
  ).catch(() => []);
  log(`[DEBUG] Clickable elements: ${JSON.stringify(clickables)}`);

  // ── STRATEGY 1: Click "Can't scan it?" / "Enter a setup key" ──
  const cantScanVariants = [
    "can't scan it?",
    "can't scan it",
    "can\u2019t scan it?",   // Unicode right-single-quote (Google's actual char)
    "can\u2019t scan it",
    "can't scan",
    "can\u2019t scan",
    "enter a setup key",
    "setup key",
    "can't scan the qr code",
  ];

  let clicked = false;

  // Pass 1a: Playwright text locators
  for (const variant of cantScanVariants) {
    if (clicked) break;
    try {
      const loc = page.locator(`text=/${variant}/i`).first();
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
        await loc.click();
        log(`Clicked "Can't scan it?" via Playwright locator: "${variant}"`);
        clicked = true;
      }
    } catch (_) { /* try next */ }
  }

  // Pass 1b: JS DOM walk (handles shadow DOM edge cases)
  if (!clicked) {
    clicked = await page.evaluate((variants) => {
      const all = [...document.querySelectorAll('*')];
      for (const el of all) {
        const raw = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (raw.length > 0 && raw.length < 60 && variants.some(v => raw.includes(v))) {
          const clickable = el.closest('button, a, [role="button"]') || el;
          clickable.click();
          return true;
        }
      }
      return false;
    }, cantScanVariants).catch(() => false);
    if (clicked) log('Clicked "Can\'t scan it?" via JS DOM walk.');
  }

  if (clicked) {
    // Give the page time to reveal the manual key text
    await sleep(2000);
    const postClickText = await page.evaluate(() => document.body.innerText).catch(() => '');
    log(`[DEBUG] Page after clicking "Can't scan it?" (first 600 chars):\n${postClickText.slice(0, 600)}`);

    const key = extractKeyFromText(postClickText);
    if (key) {
      log(`✅ Manual key extracted after "Can't scan it?" click: ${key}`);
      return key;
    }

    // Also check specific DOM elements (input fields / pre / code blocks)
    const domKey = await extractKeyFromDOM(page);
    if (domKey) {
      log(`✅ Manual key extracted from DOM element: ${domKey}`);
      return domKey;
    }

    log('Warning: Clicked "Can\'t scan it?" but still could not find key text — falling back to QR decode...');
  } else {
    log('"Can\'t scan it?" link not found — falling back to QR code decode...');
  }

  // ── STRATEGY 2: Decode the QR code image ──
  const qrKey = await decodeQRCodeFromPage(page);
  if (qrKey) {
    log(`✅ TOTP secret extracted from QR code: ${qrKey}`);
    return qrKey;
  }

  // Last resort: dump full page text for debugging
  const fullText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[DEBUG] FULL page text at total failure:\n${fullText}`);
  throw new Error('Could not extract TOTP key via manual link or QR decoding');
}

// ──────────────────────────────────────────────
// Extract a base32 TOTP key from plain text
// ──────────────────────────────────────────────
function extractKeyFromText(text) {
  if (!text) return null;

  // Pattern 1: otpauth URI (most authoritative — from QR decode)
  const ota = text.match(/otpauth:\/\/totp\/[^?]+\?[^&]*secret=([A-Z2-7]+)/i);
  if (ota) return ota[1].toUpperCase();

  // Pattern 2: 8 groups of 4 base32 chars (Google's standard display)
  // e.g. "srjc glbx 2t4k m3ou qbih gld4 vygb 3acy"
  const p2 = text.match(/\b([a-z2-7]{4}(?:[\s\u00a0]+[a-z2-7]{4}){7})\b/i);
  if (p2) return p2[1].replace(/\s+/g, '').toUpperCase();

  // Pattern 3: 6 or 7 groups of 4 (shorter keys)
  const p3 = text.match(/\b([a-z2-7]{4}(?:[\s\u00a0]+[a-z2-7]{4}){5,6})\b/i);
  if (p3) return p3[1].replace(/\s+/g, '').toUpperCase();

  // Pattern 4: exactly 32-char no-space base32
  const p4 = text.match(/\b([A-Z2-7]{32})\b/);
  if (p4) return p4[1];

  // Pattern 5: line that is purely base32 chars + spaces (16–60 chars raw)
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (/^[a-z2-7]([a-z2-7 \t]{14,58})[a-z2-7]$/i.test(line)) {
      const stripped = line.replace(/\s+/g, '');
      if (stripped.length >= 16 && stripped.length <= 64 && /^[A-Z2-7]+$/i.test(stripped)) {
        return stripped.toUpperCase();
      }
    }
  }

  return null;
}

// ──────────────────────────────────────────────
// Extract key from specific DOM elements (inputs, textareas, code, pre)
// ──────────────────────────────────────────────
async function extractKeyFromDOM(page) {
  return page.evaluate(() => {
    const selectors = [
      'input[type="text"]',
      'input[readonly]',
      'textarea',
      'pre',
      'code',
      '[class*="key" i]',
      '[class*="secret" i]',
      '[data-key]',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const val = (el.value || el.innerText || el.textContent || '').trim();
        const stripped = val.replace(/\s+/g, '');
        if (stripped.length >= 16 && stripped.length <= 64 && /^[A-Z2-7]+$/i.test(stripped)) {
          return stripped.toUpperCase();
        }
      }
    }
    return null;
  }).catch(() => null);
}

// ──────────────────────────────────────────────
// DECODE QR CODE FROM PAGE
// Finds the QR code image, screenshots it, and decodes using jsQR
// ──────────────────────────────────────────────
async function decodeQRCodeFromPage(page) {
  log('Attempting QR code decode...');

  // Try to find QR code via canvas or img element
  const qrSelector = 'canvas, img[src*="qr" i], img[alt*="QR" i], img[alt*="authenticator" i], img[alt*="barcode" i]';

  // First try canvas element (Google often renders QR to canvas)
  try {
    const canvasData = await page.evaluate((sel) => {
      // Try canvas first
      const canvases = [...document.querySelectorAll('canvas')];
      for (const c of canvases) {
        if (c.width > 50 && c.height > 50) {
          return { type: 'canvas', data: c.toDataURL('image/png') };
        }
      }
      // Try img elements
      const imgs = [...document.querySelectorAll('img')];
      for (const img of imgs) {
        if (img.naturalWidth > 50 && img.naturalHeight > 50 && img.src) {
          return { type: 'img', data: img.src, w: img.naturalWidth, h: img.naturalHeight };
        }
      }
      return null;
    }, qrSelector);

    if (canvasData) {
      log(`[DEBUG] Found QR image source (type=${canvasData.type}, data preview=${canvasData.data.slice(0, 80)})`);
      const secret = await decodeBase64QR(canvasData.data);
      if (secret) return secret;
    }
  } catch (e) {
    log(`[DEBUG] Canvas/img QR extraction error: ${e.message}`);
  }

  // Fallback: screenshot the entire viewport and scan for QR
  log('Falling back to full-viewport screenshot for QR decode...');
  try {
    const screenshotBuf = await page.screenshot({ type: 'png' });
    const secret = await decodeBufferQR(screenshotBuf);
    if (secret) return secret;
  } catch (e) {
    log(`[DEBUG] Viewport screenshot QR decode error: ${e.message}`);
  }

  // Final fallback: screenshot each img element separately
  log('Trying per-element screenshot for QR decode...');
  try {
    const imgElements = await page.$$('img, canvas');
    for (const el of imgElements) {
      try {
        const box = await el.boundingBox();
        if (!box || box.width < 50 || box.height < 50) continue;
        const buf = await el.screenshot({ type: 'png' });
        const secret = await decodeBufferQR(buf);
        if (secret) return secret;
      } catch (_) { /* try next element */ }
    }
  } catch (e) {
    log(`[DEBUG] Per-element screenshot error: ${e.message}`);
  }

  log('QR code decode failed — no secret found in any QR source.');
  return null;
}

/** Decode a base64 PNG data URL (e.g. canvas.toDataURL()) into TOTP secret */
async function decodeBase64QR(dataUrl) {
  try {
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    return decodeBufferQR(buf);
  } catch (e) {
    log(`[DEBUG] decodeBase64QR error: ${e.message}`);
    return null;
  }
}

/** Decode a PNG buffer into a TOTP secret by parsing the QR code */
async function decodeBufferQR(buf) {
  try {
    // Jimp v1: use Jimp.fromBuffer() for raw buffers
    const image = await Jimp.fromBuffer(buf);
    const { data, width, height } = image.bitmap;
    // jsQR expects a flat Uint8ClampedArray of RGBA pixels
    const pixels = new Uint8ClampedArray(data);
    const result = jsQR(pixels, width, height, { inversionAttempts: 'dontInvert' });
    if (!result) {
      // Try with inversion
      const result2 = jsQR(pixels, width, height, { inversionAttempts: 'onlyInvert' });
      if (!result2) return null;
      log(`[DEBUG] QR decoded (inverted): ${result2.data}`);
      return extractKeyFromText(result2.data);
    }
    log(`[DEBUG] QR decoded: ${result.data}`);
    return extractKeyFromText(result.data);
  } catch (e) {
    log(`[DEBUG] decodeBufferQR error: ${e.message}`);
    return null;
  }
}


// ──────────────────────────────────────────────
// VERIFY NEW SECRET
// Clicks Next → enters TOTP from new secret → clicks Verify
// ──────────────────────────────────────────────
async function verifyNewSecret(page, newTotpSecret) {
  log('=== verifyNewSecret START ===');

  // Dump state on entry so we know which panel we're on
  const entryText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[DEBUG] Page entering verifyNewSecret (first 400 chars):\n${entryText.slice(0, 400)}`);
  const entryBtns = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, [role="button"]')]
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean)
  ).catch(() => []);
  log(`[DEBUG] Buttons available: ${JSON.stringify(entryBtns)}`);

  // ── Click the visible "Next" button ──
  log('Clicking "Next"...');
  let nextClicked = false;

  // Playwright first — clicks only a visible, enabled button
  try {
    const nextBtn = page.locator('button', { hasText: /^\s*next\s*$/i }).filter({ visible: true }).first();
    await nextBtn.click({ timeout: 5000 });
    log('Clicked Next via Playwright locator.');
    nextClicked = true;
  } catch (_) {}

  // JS DOM walk fallback
  if (!nextClicked) {
    nextClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (t === 'next') { el.click(); return true; }
      }
      return false;
    }).catch(() => false);
    if (nextClicked) log('Clicked Next via JS DOM walk.');
  }

  if (!nextClicked) log('Warning: No "Next" button found — continuing anyway...');
  await sleep(2500);

  // Dump after Next click
  const afterNextText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[DEBUG] Page after Next click (first 400 chars):\n${afterNextText.slice(0, 400)}`);

  // ── Wait for the code input ──
  log('Waiting for verification code input...');
  const verifyInputSelectors = [
    'input#c0',
    'input[placeholder*="Enter Code" i]',
    'input[placeholder*="code" i]',
    'input[aria-label*="code" i]',
    'input[type="tel"]',
    'input[maxlength="6"]',
    'input[type="number"]',
    'input:not([type="hidden"])',   // last resort: any visible input
  ];

  let verifyInput = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const sel of verifyInputSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) {
        verifyInput = el;
        log(`Found verification input via: ${sel}`);
        break;
      }
    }
    if (verifyInput) break;

    if (attempt % 4 === 0) {
      const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
      const inputs = await page.evaluate(() =>
        [...document.querySelectorAll('input')].map(i => ({
          type: i.type, id: i.id, name: i.name, placeholder: i.placeholder,
          visible: i.offsetWidth > 0, maxlen: i.maxLength,
        }))
      ).catch(() => []);
      log(`[DEBUG] attempt ${attempt} — page: ${txt.slice(0, 150)}`);
      log(`[DEBUG] input elements: ${JSON.stringify(inputs)}`);
    }

    await sleep(500);
  }

  if (!verifyInput) {
    const fullText = await page.evaluate(() => document.body.innerText).catch(() => '');
    log(`[DEBUG] FULL page at input-not-found:\n${fullText}`);
    throw new Error('Could not find verification code input field');
  }

  // ── Wait for a fresh TOTP time window before generating code ──
  await waitForFreshTOTPWindow();

  // ── Retry loop: submit TOTP code, retry if Google rejects ──
  for (let attempt = 0; attempt < 3; attempt++) {
    // Re-find the input in case DOM changed
    let input = verifyInput;
    for (const sel of verifyInputSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) { input = el; break; }
    }

    const newCode = generateTOTP(newTotpSecret);
    log(`Attempt ${attempt + 1}: submitting TOTP code ${newCode}`);
    await input.click();
    await input.fill('');
    await input.fill(newCode);
    await sleep(300);

    // Click Verify
    let verifyClicked = false;
    try {
      const verifyBtn = page.locator('button', { hasText: /^\s*verify\s*$/i }).filter({ visible: true }).first();
      await verifyBtn.click({ timeout: 5000 });
      log('Clicked Verify via Playwright locator.');
      verifyClicked = true;
    } catch (_) {}

    if (!verifyClicked) {
      verifyClicked = await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, [role="button"]')) {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (t === 'verify') { el.click(); return true; }
        }
        return false;
      }).catch(() => false);
      if (verifyClicked) log('Clicked Verify via JS DOM walk.');
    }

    if (!verifyClicked) {
      log('Verify button not found — pressing Enter');
      await page.keyboard.press('Enter');
    }

    await sleep(3000);

    // Check if Google rejected the code
    const resultText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const rejected = /wrong|incorrect|invalid|that code/i.test(resultText.slice(0, 1000));
    if (!rejected) {
      log('Verification accepted.');
      return; // success
    }

    log(`Attempt ${attempt + 1} rejected by Google. Waiting for next TOTP window...`);
    // Wait for next full window before retrying
    if (attempt < 2) await waitForFreshTOTPWindow();
  }

  // All attempts failed — let confirmSuccess detect the error
}

/** Wait until we're at least 5s into a fresh 30s TOTP period */
async function waitForFreshTOTPWindow() {
  const secondsInWindow = Math.floor(Date.now() / 1000) % 30;
  const remaining = 30 - secondsInWindow;
  if (remaining < 8) {
    // Too close to window end — wait it out
    log(`Waiting ${remaining + 1}s for fresh TOTP window...`);
    await sleep((remaining + 1) * 1000);
  } else {
    log(`TOTP window has ${remaining}s remaining — proceeding.`);
  }
}

// ──────────────────────────────────────────────
// CONFIRM SUCCESS
// ──────────────────────────────────────────────
async function confirmSuccess(page) {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const url = page.url();

  log(`[DEBUG] confirmSuccess — URL: ${url}`);
  log(`[DEBUG] confirmSuccess — page (first 400): ${bodyText.slice(0, 400)}`);

  const hasError = /wrong|incorrect|invalid code|that code|error/i.test(bodyText.slice(0, 1000));
  if (hasError) throw new Error('Verification failed — Google reported an error');

  const modalStillOpen = bodyText.includes('Enter the 6-digit') || bodyText.includes('Enter Code');
  if (modalStillOpen) throw new Error('Modal still asking for code — verification may not have completed');

  log(`Success confirmed. URL: ${url}`);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error("Usage: node change2fa.js '{\"email\":\"...\",\"password\":\"...\",\"totpSecret\":\"...\"}'");
    process.exit(1);
  }

  const account = JSON.parse(accountArg);
  const { email, password, totpSecret } = account;
  if (!email || !password || !totpSecret) {
    throw new Error('account JSON must include email, password, totpSecret');
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    // Step 1: Log in using the same approach as checkOne.js
    // Navigate to a normal Google page first — this triggers the standard login flow
    // (direct ServiceLogin to sensitive URLs can cause stricter auth challenges)
    const SECURITY_URL = 'https://myaccount.google.com/security';
    await page.goto(SECURITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1500);

    if (page.url().includes('accounts.google.com')) {
      await googleLogin(page, email, password, totpSecret);
    }

    // Step 2: Navigate to authenticator settings (handles sensitive-action re-verification)
    await navigateToAuthenticatorPage(page, email, password, totpSecret);

    // Step 3: Click "Change authenticator app"
    await clickChangeAuthenticator(page);

    // Step 4: Get new TOTP secret from manual key view
    const newTotpSecret = await getManualKeyFromModal(page);

    // Step 5: Verify with the new secret's TOTP code
    await verifyNewSecret(page, newTotpSecret);

    // Step 6: Confirm success
    await confirmSuccess(page);

    const result = {
      success: true,
      account: email,
      newTotpSecret,
      changedAt: new Date().toISOString(),
    };

    process.stdout.write(JSON.stringify(result) + '\n');
    log(`Done. New TOTP secret: ${newTotpSecret}`);

  } catch (err) {
    log(`Error: ${err.message}`);
    process.stdout.write(JSON.stringify({ success: false, account: email, error: err.message }) + '\n');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
