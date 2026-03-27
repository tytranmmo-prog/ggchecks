/**
 * google-auth.ts — Shared Google browser automation helpers
 *
 * Exports:
 *   sleep(ms)
 *   log(msg)
 *   generateTOTP(secret)
 *   createBrowser()                                        → { browser, context, page }
 *   fillAndSubmitTOTP(page, secret, label?)
 *   googleLogin(page, email, password, totpSecret)
 *   reVerifyForSensitivePage(page, email, password, totpSecret, targetUrl?)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { generateSync as generateOTP } from 'otplib';

// ──────────────────────────────────────────────
// Primitives
// ──────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function log(msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

export function generateTOTP(secret: string): string {
  const clean = secret.replace(/\s+/g, '').toUpperCase();
  return generateOTP({ secret: clean });
}

// ──────────────────────────────────────────────
// Browser factory — standard anti-bot config
// ──────────────────────────────────────────────

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createBrowser(): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  return { browser, context, page };
}

// ──────────────────────────────────────────────
// TOTP input helper
// Finds the code input, fills it, and submits
// ──────────────────────────────────────────────

const CODE_INPUT_SELECTORS = [
  'input[name="totpPin"]',
  'input[aria-label*="code" i]',
  'input[type="tel"]',
  'input[id*="totp" i]',
  '#totpPin',
] as const;

export async function fillAndSubmitTOTP(
  page: Page,
  secret: string,
  contextLabel = '',
): Promise<void> {
  let inputEl = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const sel of CODE_INPUT_SELECTORS) {
      const el = await page.$(sel).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) {
        inputEl = el;
        break;
      }
    }
    if (inputEl) break;
    await sleep(500);
  }

  if (!inputEl) throw new Error(`TOTP input not found (${contextLabel})`);

  const code = generateTOTP(secret);
  log(`TOTP [${contextLabel}]: ${code}`);

  await inputEl.click();
  await inputEl.fill('');
  await inputEl.fill(code);
  await sleep(300);
  await page.keyboard.press('Enter');

  // Wait for Google to redirect away from the challenge page (up to 15s)
  // A hard sleep isn't reliable — slow connections need more time
  await page
    .waitForURL(url => !url.href.includes('accounts.google.com'), { timeout: 15_000 })
    .catch(() => sleep(3000)); // fall back to 3s sleep if no redirect detected
}

// ──────────────────────────────────────────────
// Google Login
// Handles email → password → optional TOTP
// ──────────────────────────────────────────────

const TIMEOUT = 60_000;

export async function googleLogin(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
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
    !!(await page.$('input[aria-label*="code" i]').catch(() => null)) ||
    !!(await page.$('input[name="totpPin"]').catch(() => null));

  if (isTotpPrompt) {
    log('TOTP prompt detected (login)...');
    await fillAndSubmitTOTP(page, totpSecret, 'login');
    // fillAndSubmitTOTP already waits for the redirect;
    // give an extra moment for any post-redirect animations
    await sleep(1000);
  } else {
    // No TOTP — but password submission might still be redirecting
    await page
      .waitForURL(url => !url.href.includes('accounts.google.com'), { timeout: 10_000 })
      .catch(() => {}); // ignore timeout — URL check below will catch failures
  }

  const finalUrl = page.url();
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error(`Login did not complete — still on: ${finalUrl}`);
  }
  log('Login successful.');
}

// ──────────────────────────────────────────────
// Re-verify for sensitive pages
// Google challenges identity when navigating to
// security settings after login. This handles the
// full email → password → TOTP re-auth flow.
// ──────────────────────────────────────────────

export async function reVerifyForSensitivePage(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
  targetUrl?: string,
): Promise<void> {
  if (!page.url().includes('accounts.google.com')) return;

  log('Sensitive action re-verification required...');

  // Email re-entry
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

  // Navigate back to target if still stuck on auth page
  if (targetUrl && !page.url().includes('myaccount.google.com')) {
    log(`Still on auth page — navigating back to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(2000);
  }
}
