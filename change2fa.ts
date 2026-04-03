/**
 * change2fa.ts — Single account 2FA secret changer
 * Usage: bun change2fa.ts '{"email":"..","password":"..","totpSecret":".."}'
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

import { Jimp } from 'jimp';
import jsQR from 'jsqr';
import type { Page } from 'playwright';
import { sleep, log, generateTOTP, createBrowser, createBrowserCDP, googleLogin, ensureLoggedIn, reVerifyForSensitivePage } from './google-auth';

const AUTHENTICATOR_URL = 'https://myaccount.google.com/two-step-verification/authenticator';
const TIMEOUT = 60_000;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface Change2FAResult {
  success: true;
  account: string;
  newTotpSecret: string;
  changedAt: string;
}

interface Change2FAError {
  success: false;
  account: string;
  error: string;
}

// ──────────────────────────────────────────────
// NAVIGATE TO AUTHENTICATOR SETTINGS
// ──────────────────────────────────────────────

async function navigateToAuthenticatorPage(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  log('Navigating to authenticator settings...');
  await page.goto(AUTHENTICATOR_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await sleep(2000);

  await reVerifyForSensitivePage(page, email, password, totpSecret, AUTHENTICATOR_URL);

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

async function clickChangeAuthenticator(page: Page): Promise<void> {
  log('Looking for "Change authenticator app" button...');

  const changeSelectors = [
    'button:has-text("Change authenticator app")',
    'a:has-text("Change authenticator app")',
    'span:has-text("Change authenticator app")',
  ] as const;

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

  const clicked = await page.evaluate(() => {
    const allEls = [...document.querySelectorAll<HTMLElement>('button, a, [role="button"], span')];
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

async function getManualKeyFromModal(page: Page): Promise<string> {
  log('=== getManualKeyFromModal START ===');
  log(`Current URL: ${page.url()}`);

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

  const clickables = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a, [role="button"]')]
      .map(el => (el.innerText || el.textContent || '').trim().slice(0, 80))
      .filter(Boolean)
  ).catch(() => [] as string[]);
  log(`[DEBUG] Clickable elements: ${JSON.stringify(clickables)}`);

  const cantScanVariants = [
    "can't scan it?",
    "can't scan it",
    "can\u2019t scan it?",
    "can\u2019t scan it",
    "can't scan",
    "can\u2019t scan",
    "enter a setup key",
    "setup key",
    "can't scan the qr code",
  ] as const;

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

  // Pass 1b: JS DOM walk
  if (!clicked) {
    clicked = await page.evaluate((variants: readonly string[]) => {
      const all = [...document.querySelectorAll<HTMLElement>('*')];
      for (const el of all) {
        const raw = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (raw.length > 0 && raw.length < 60 && variants.some(v => raw.includes(v))) {
          const clickable = el.closest<HTMLElement>('button, a, [role="button"]') || el;
          clickable.click();
          return true;
        }
      }
      return false;
    }, cantScanVariants).catch(() => false);
    if (clicked) log("Clicked \"Can't scan it?\" via JS DOM walk.");
  }

  if (clicked) {
    await sleep(2000);
    const postClickText = await page.evaluate(() => document.body.innerText).catch(() => '');
    log(`[DEBUG] Page after clicking "Can't scan it?" (first 600 chars):\n${postClickText.slice(0, 600)}`);

    const key = extractKeyFromText(postClickText);
    if (key) { log(`✅ Manual key extracted after "Can't scan it?" click: ${key}`); return key; }

    const domKey = await extractKeyFromDOM(page);
    if (domKey) { log(`✅ Manual key extracted from DOM element: ${domKey}`); return domKey; }

    log("Warning: Clicked \"Can't scan it?\" but still could not find key text — falling back to QR decode...");
  } else {
    log('"Can\'t scan it?" link not found — falling back to QR code decode...');
  }

  const qrKey = await decodeQRCodeFromPage(page);
  if (qrKey) { log(`✅ TOTP secret extracted from QR code: ${qrKey}`); return qrKey; }

  const fullText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[DEBUG] FULL page text at total failure:\n${fullText}`);
  throw new Error('Could not extract TOTP key via manual link or QR decoding');
}

// ──────────────────────────────────────────────
// Key extraction helpers
// ──────────────────────────────────────────────

function extractKeyFromText(text: string): string | null {
  if (!text) return null;

  const ota = text.match(/otpauth:\/\/totp\/[^?]+\?[^&]*secret=([A-Z2-7]+)/i);
  if (ota) return ota[1].toUpperCase();

  const p2 = text.match(/\b([a-z2-7]{4}(?:[\s\u00a0]+[a-z2-7]{4}){7})\b/i);
  if (p2) return p2[1].replace(/\s+/g, '').toUpperCase();

  const p3 = text.match(/\b([a-z2-7]{4}(?:[\s\u00a0]+[a-z2-7]{4}){5,6})\b/i);
  if (p3) return p3[1].replace(/\s+/g, '').toUpperCase();

  const p4 = text.match(/\b([A-Z2-7]{32})\b/);
  if (p4) return p4[1];

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

async function extractKeyFromDOM(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const selectors = [
      'input[type="text"]', 'input[readonly]', 'textarea',
      'pre', 'code', '[class*="key" i]', '[class*="secret" i]', '[data-key]',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll<HTMLInputElement | HTMLElement>(sel)) {
        const val = (('value' in el ? el.value : '') || el.innerText || el.textContent || '').trim();
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
// QR code decoding
// ──────────────────────────────────────────────

async function decodeQRCodeFromPage(page: Page): Promise<string | null> {
  log('Attempting QR code decode...');

  try {
    const canvasData = await page.evaluate(() => {
      for (const c of document.querySelectorAll<HTMLCanvasElement>('canvas')) {
        if (c.width > 50 && c.height > 50) {
          return { type: 'canvas', data: c.toDataURL('image/png') };
        }
      }
      for (const img of document.querySelectorAll<HTMLImageElement>('img')) {
        if (img.naturalWidth > 50 && img.naturalHeight > 50 && img.src) {
          return { type: 'img', data: img.src };
        }
      }
      return null;
    });

    if (canvasData) {
      log(`[DEBUG] Found QR image source (type=${canvasData.type})`);
      const secret = await decodeBase64QR(canvasData.data);
      if (secret) return secret;
    }
  } catch (e) {
    log(`[DEBUG] Canvas/img QR extraction error: ${(e as Error).message}`);
  }

  log('Falling back to full-viewport screenshot for QR decode...');
  try {
    const screenshotBuf = await page.screenshot({ type: 'png' });
    const secret = await decodeBufferQR(screenshotBuf);
    if (secret) return secret;
  } catch (e) {
    log(`[DEBUG] Viewport screenshot QR decode error: ${(e as Error).message}`);
  }

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
      } catch (_) { /* try next */ }
    }
  } catch (e) {
    log(`[DEBUG] Per-element screenshot error: ${(e as Error).message}`);
  }

  log('QR code decode failed — no secret found.');
  return null;
}

async function decodeBase64QR(dataUrl: string): Promise<string | null> {
  try {
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    return decodeBufferQR(buf);
  } catch (e) {
    log(`[DEBUG] decodeBase64QR error: ${(e as Error).message}`);
    return null;
  }
}

async function decodeBufferQR(buf: Buffer): Promise<string | null> {
  try {
    const image = await Jimp.fromBuffer(buf);
    const { data, width, height } = image.bitmap;
    const pixels = new Uint8ClampedArray(data);

    const result = jsQR(pixels, width, height, { inversionAttempts: 'dontInvert' });
    if (result) {
      log(`[DEBUG] QR decoded: ${result.data}`);
      return extractKeyFromText(result.data);
    }

    const result2 = jsQR(pixels, width, height, { inversionAttempts: 'onlyInvert' });
    if (result2) {
      log(`[DEBUG] QR decoded (inverted): ${result2.data}`);
      return extractKeyFromText(result2.data);
    }

    return null;
  } catch (e) {
    log(`[DEBUG] decodeBufferQR error: ${(e as Error).message}`);
    return null;
  }
}

// ──────────────────────────────────────────────
// VERIFY NEW SECRET
// ──────────────────────────────────────────────

async function verifyNewSecret(page: Page, newTotpSecret: string): Promise<void> {
  log('=== verifyNewSecret START ===');

  const entryText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[DEBUG] Page entering verifyNewSecret (first 400 chars):\n${entryText.slice(0, 400)}`);
  const entryBtns = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a, [role="button"]')]
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean)
  ).catch(() => [] as string[]);
  log(`[DEBUG] Buttons available: ${JSON.stringify(entryBtns)}`);

  // Click "Next"
  log('Clicking "Next"...');
  let nextClicked = false;
  try {
    const nextBtn = page.locator('button', { hasText: /^\s*next\s*$/i }).filter({ visible: true }).first();
    await nextBtn.click({ timeout: 5000 });
    log('Clicked Next via Playwright locator.');
    nextClicked = true;
  } catch (_) {}

  if (!nextClicked) {
    nextClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
        if ((el.innerText || el.textContent || '').trim().toLowerCase() === 'next') {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);
    if (nextClicked) log('Clicked Next via JS DOM walk.');
  }

  if (!nextClicked) log('Warning: No "Next" button found — continuing anyway...');
  await sleep(2500);

  const afterNextText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[DEBUG] Page after Next click (first 400 chars):\n${afterNextText.slice(0, 400)}`);

  // Wait for the 6-digit code input
  log('Waiting for verification code input...');
  const verifyInputSelectors = [
    'input#c0',
    'input[placeholder*="Enter Code" i]',
    'input[placeholder*="code" i]',
    'input[aria-label*="code" i]',
    'input[type="tel"]',
    'input[maxlength="6"]',
    'input[type="number"]',
    'input:not([type="hidden"])',
  ] as const;

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
        [...document.querySelectorAll<HTMLInputElement>('input')].map(i => ({
          type: i.type, id: i.id, name: i.name, placeholder: i.placeholder,
          visible: i.offsetWidth > 0, maxlen: i.maxLength,
        }))
      ).catch(() => [] as object[]);
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

  await waitForFreshTOTPWindow();

  for (let attempt = 0; attempt < 3; attempt++) {
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

    let verifyClicked = false;
    try {
      const verifyBtn = page.locator('button', { hasText: /^\s*verify\s*$/i }).filter({ visible: true }).first();
      await verifyBtn.click({ timeout: 5000 });
      log('Clicked Verify via Playwright locator.');
      verifyClicked = true;
    } catch (_) {}

    if (!verifyClicked) {
      verifyClicked = await page.evaluate(() => {
        for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
          if ((el.innerText || el.textContent || '').trim().toLowerCase() === 'verify') {
            el.click(); return true;
          }
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

    const resultText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const rejected = /wrong|incorrect|invalid|that code/i.test(resultText.slice(0, 1000));
    if (!rejected) { log('Verification accepted.'); return; }

    log(`Attempt ${attempt + 1} rejected by Google. Waiting for next TOTP window...`);
    if (attempt < 2) await waitForFreshTOTPWindow();
  }

  throw new Error('TOTP verification rejected by Google after 3 attempts');
}

async function waitForFreshTOTPWindow(): Promise<void> {
  const secondsInWindow = Math.floor(Date.now() / 1000) % 30;
  const remaining = 30 - secondsInWindow;
  // Keep a 12-second buffer so the code can't expire mid-round-trip
  if (remaining < 12) {
    log(`Waiting ${remaining + 1}s for fresh TOTP window...`);
    await sleep((remaining + 1) * 1000);
  } else {
    log(`TOTP window has ${remaining}s remaining — proceeding.`);
  }
}

// ──────────────────────────────────────────────
// CONFIRM SUCCESS
// ──────────────────────────────────────────────

async function confirmSuccess(page: Page): Promise<void> {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const url = page.url();

  log(`[DEBUG] confirmSuccess — URL: ${url}`);
  log(`[DEBUG] confirmSuccess — page (first 400): ${bodyText.slice(0, 400)}`);

  // Match only explicit Google error phrases — avoid matching 'error' in JS/HTML source
  const hasError = /wrong code|incorrect code|invalid code|that code didn't work|something went wrong|an error occurred|couldn't verify/i.test(bodyText.slice(0, 1000));
  if (hasError) throw new Error('Verification failed — Google reported an error');

  const modalStillOpen = bodyText.includes('Enter the 6-digit') || bodyText.includes('Enter Code');
  if (modalStillOpen) throw new Error('Modal still asking for code — verification may not have completed');

  log(`Success confirmed. URL: ${url}`);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error("Usage: bun change2fa.ts '{\"email\":\"...\",\"password\":\"...\",\"totpSecret\":\"...\"}'");
    process.exit(1);
  }

  const account = JSON.parse(accountArg) as {
    email:      string;
    password:   string;
    totpSecret: string;
    debugPort?: number;
  };
  const { email, password, totpSecret, debugPort } = account;
  if (!email || !password || !totpSecret) {
    throw new Error('account JSON must include email, password, totpSecret');
  }

  // If a debugPort is provided the caller (API route) has already acquired a
  // GPMLogin browser handle for us. We just attach via CDP and let GPMLogin
  // own the process lifecycle — so on exit we only disconnect, not kill.
  const useCdp = typeof debugPort === 'number' && debugPort > 0;
  log(`Mode: ${useCdp ? `CDP (port ${debugPort})` : 'standalone'}`);

  const { browser, context, page } = useCdp
    ? await createBrowserCDP(debugPort!)
    : await createBrowser();

  try {
    const SECURITY_URL = 'https://myaccount.google.com/security';
    await page.goto(SECURITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1500);
    await ensureLoggedIn(page, email, password, totpSecret);

    await navigateToAuthenticatorPage(page, email, password, totpSecret);
    await clickChangeAuthenticator(page);
    const newTotpSecret = await getManualKeyFromModal(page);
    await verifyNewSecret(page, newTotpSecret);
    await confirmSuccess(page);

    const result: Change2FAResult = {
      success: true,
      account: email,
      newTotpSecret,
      changedAt: new Date().toISOString(),
    };

    process.stdout.write(JSON.stringify(result) + '\n');
    log(`Done. New TOTP secret: ${newTotpSecret}`);

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`Error: ${error}`);
    const result: Change2FAError = { success: false, account: email, error };
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    if (useCdp) {
      // Disconnect Playwright only — GPMLogin stops the actual browser process
      // when the API route calls handle.release().
      await browser.close();
    } else {
      await context.close();
      await browser.close();
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
