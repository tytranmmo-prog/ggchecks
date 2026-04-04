/**
 * closePayments.ts — Close Google Payments profile (Pro5)
 * Usage: bun closePayments.ts '{"email":"..","password":"..","totpSecret":".."}'
 *    or: ACCOUNT_JSON='{"email":"..","password":"..","totpSecret":".."}' bun closePayments.ts
 *
 * Flow:
 *   1. Navigate to https://payments.google.com/gp/w/home/settings
 *   2. Handle "Verify it's you" — enter password and 2FA TOTP
 *   3. Scroll to bottom → click "Close payments profile"
 *   4. Enter password in confirmation dialog
 *   5. Select "I don't want to give a reason"
 *   6. Click final "Close payments profile" confirm button
 *
 * Outputs JSON to stdout:
 *   { success: true,  account, closedAt }
 *   { success: false, account, error }
 */

import type { Page } from 'playwright';
import {
  sleep,
  log,
  generateTOTP,
  createBrowser,
  createBrowserCDP,
  ensureLoggedIn,
} from './google-auth';

const PAYMENTS_SETTINGS_URL = 'https://payments.google.com/gp/w/home/settings';
const TIMEOUT = 60_000;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface ClosePaymentsResult {
  success: true;
  account: string;
  closedAt: string;
}

interface ClosePaymentsError {
  success: false;
  account: string;
  error: string;
}

// ──────────────────────────────────────────────
// STEP 1: Navigate to payments settings
// Handles the "Verify it's you" overlay
// ──────────────────────────────────────────────

async function navigateToPaymentsSettings(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  log('Navigating to Google Payments settings...');
  await page.goto(PAYMENTS_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await sleep(2000);

  // Handle Google login if redirected to accounts.google.com
  await ensureLoggedIn(page, email, password, totpSecret);
  await sleep(2000);

  // After login we may be back at the settings page
  // but now facing the "Verify it's you" overlay on payments.google.com
  await handlePaymentsVerification(page, email, password, totpSecret);

  log(`Payments settings page reached. URL: ${page.url()}`);
}

// ──────────────────────────────────────────────
// Payments "Verify it's you" handler
// The payments page shows its own re-auth wall
// that requires password + TOTP
// ──────────────────────────────────────────────

async function handlePaymentsVerification(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const url = page.url();
  log(`[verify-check] URL: ${url}`);
  log(`[verify-check] Page text (first 300): ${bodyText.slice(0, 300)}`);

  const needsVerification =
    bodyText.includes("Verify it's you") ||
    bodyText.includes('Verify to see payments') ||
    url.includes('reauthprompt') ||
    url.includes('accounts.google.com');

  if (!needsVerification) {
    log('No payments verification needed — already past the wall.');
    return;
  }

  log('Payments verification wall detected — clicking "Verify it\'s you"...');

  // Click the "Verify it's you" button
  const verifyClicked = await clickByText(page, ["Verify it's you", 'Verify']);
  if (verifyClicked) {
    await sleep(3000);
  }

  // Now handle the re-auth flow: may show password prompt, TOTP, or both
  await handleReAuthFlow(page, email, password, totpSecret);
}

async function handleReAuthFlow(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  const url = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[reauth] URL: ${url}`);
  log(`[reauth] Text (first 300): ${bodyText.slice(0, 300)}`);

  // Email field (if Google asks to confirm which account)
  const emailField = await page.$('input[type="email"]').catch(() => null);
  if (emailField && await emailField.isVisible().catch(() => false)) {
    log('Email re-entry required...');
    await page.fill('input[type="email"]', email);
    await page.keyboard.press('Enter');
    await sleep(2000);
  }

  // Password field
  const passwordField = await page.$('input[type="password"]').catch(() => null);
  if (passwordField && await passwordField.isVisible().catch(() => false)) {
    log('Password entry required...');
    await sleep(500);
    await page.fill('input[type="password"]', password);
    await page.keyboard.press('Enter');
    await sleep(3000);
  }

  // TOTP challenge
  const url2 = page.url();
  const body2 = await page.evaluate(() => document.body.innerText).catch(() => '');
  const needsTotp =
    url2.includes('signin/challenge') ||
    body2.includes('2-Step Verification') ||
    body2.includes('authenticator') ||
    body2.includes('Enter the code') ||
    !!(await page.$('input[name="totpPin"]').catch(() => null)) ||
    !!(await page.$('input[aria-label*="code" i]').catch(() => null));

  if (needsTotp) {
    log('TOTP challenge detected during payments re-auth...');

    // Handle interstitial "Choose how you want to sign in"
    const interstitialSelectors = [
      'div[role="link"]:has-text("Google Authenticator")',
      'div[data-challengerole="TOPT"]',
      'text="Get a verification code from the Google Authenticator app"',
      'text="Google Authenticator"',
    ];

    for (const sel of interstitialSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
        log('Selecting Google Authenticator option from interstitial...');
        await loc.click().catch(() => {});
        await sleep(1500);
        break;
      }
    }

    // Find TOTP input
    const totpInputSelectors = [
      'input[name="totpPin"]',
      'input[aria-label*="code" i]',
      'input[type="tel"]',
      'input[id*="totp" i]',
      '#totpPin',
    ] as const;

    let inputEl = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const sel of totpInputSelectors) {
        const el = await page.$(sel).catch(() => null);
        if (el && await el.isVisible().catch(() => false)) {
          inputEl = el;
          break;
        }
      }
      if (inputEl) break;
      await sleep(1000);
    }

    if (!inputEl) throw new Error('TOTP input not found during payments verification');

    // IMPORTANT: Google rejects TOTP codes that were already used in this session,
    // even if the 30-second window hasn't expired. We must wait for a brand new
    // window (different 6-digit code) before submitting.
    await waitForBrandNewTOTPWindow();
    const code = generateTOTP(totpSecret);
    log(`Submitting fresh TOTP code: ${code}`);
    await inputEl.click();
    await inputEl.fill('');
    await inputEl.fill(code);
    await sleep(300);
    await page.keyboard.press('Enter');

    // Wait for redirect away from Google auth
    await page
      .waitForURL(url => !url.href.includes('accounts.google.com'), { timeout: 15_000 })
      .catch(() => sleep(3000));

    await sleep(2000);
  }

  // If we got redirected back, navigate to settings now
  if (!page.url().includes('payments.google.com')) {
    log('Re-navigating to payments settings after re-auth...');
    await page.goto(PAYMENTS_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(3000);
  }
}

// ──────────────────────────────────────────────
// STEP 2: Scroll to bottom and click
// "Close payments profile"
// ──────────────────────────────────────────────

async function clickClosePaymentsProfile(page: Page): Promise<void> {
  log('Scrolling to bottom of payments settings page...');

  // Scroll to the very bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1500);

  // Try again in case of lazy-loaded content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1500);

  log('Looking for "Close payments profile" button...');

  const closeVariants = [
    'Close payments profile',
    'Close Google Pay',
    'Close payments account',
  ];

  // Attempt to locate and scroll to the element specifically before clicking
  try {
    const loc = page.locator(`text=/Close payments profile/i`).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
  } catch (e) {}

  const clicked = await clickByText(page, closeVariants);
  if (!clicked) {
    // Debug: dump all buttons
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, a, [role="button"]')]
        .map(el => (el.innerText || el.textContent || '').trim())
        .filter(Boolean)
    ).catch(() => [] as string[]);
    log(`[debug] All clickable elements: ${JSON.stringify(buttons)}`);
    throw new Error('Could not find "Close payments profile" button');
  }

  log('Clicked "Close payments profile". Waiting for confirmation dialog...');
  await sleep(3000);
}

// ──────────────────────────────────────────────
// STEP 3: Handle "Verify it's you" modal + enter password
// After clicking "Close payments profile", Google shows
// a "Verify it's you" modal with a "Next" button that
// may open a popup or redirect to a password challenge
// ──────────────────────────────────────────────

async function enterPasswordInClosureDialog(
  page: Page,
  password: string,
  totpSecret: string,
  email: string,
): Promise<Page> {
  log('Looking for "Verify it\'s you" modal after closing payments...');

  // Step 3a: Detect and handle the intermediate "Verify it's you" modal
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const hasVerifyModal =
    bodyText.includes("Verify it's you") ||
    bodyText.includes('verify it');

  if (hasVerifyModal) {
    log('Found "Verify it\'s you" modal — clicking "Next"...');
    const nextClicked = await clickByText(page, ['Next']);
    if (nextClicked) {
      log('Clicked "Next" in verify modal.');
      await sleep(3000);
    }
  }

  // Step 3b: There may now be a popup window — switch to it if it exists
  await sleep(2000);
  const allPages = page.context().pages();
  log(`[verify-modal] Total open pages: ${allPages.length}`);

  // Find the popup (new page that appeared) or stay on current
  let activePage = page;
  if (allPages.length > 1) {
    // Use the last opened page (the popup)
    activePage = allPages[allPages.length - 1];
    log(`Switched to popup page. URL: ${activePage.url()}`);
    await sleep(2000);
  }

  // Step 3c: Handle any email/password/TOTP prompts on the active page
  await handleReAuthOnPage(activePage, email, password, totpSecret);

  // Step 3d: After re-auth, the popup may close and we're back on the main page
  // Or the popup itself might redirect to the survey
  await sleep(3000);
  const finalUrl = activePage.isClosed() ? 'closed' : activePage.url();
  log(`Active page URL after re-auth (activePage could be popup): ${finalUrl}`);

  return activePage;
}

async function handleReAuthOnPage(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  const url = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[reauth-on-page] URL: ${url}`);
  log(`[reauth-on-page] Text (first 400): ${bodyText.slice(0, 400)}`);

  // Email field
  const emailField = await page.$('input[type="email"]').catch(() => null);
  if (emailField && await emailField.isVisible().catch(() => false)) {
    log('Email entry required...');
    await page.fill('input[type="email"]', email);
    await page.keyboard.press('Enter');
    await sleep(2000);
  }

  // Password field
  const passwordSelectors = [
    'input[type="password"]',
    'input[aria-label*="password" i]',
    'input[placeholder*="password" i]',
  ] as const;

  let passwordInput = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    for (const sel of passwordSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) {
        passwordInput = el;
        log(`Found password input via: ${sel} (attempt ${attempt + 1})`);
        break;
      }
    }
    if (passwordInput) break;

    // Log page state every 5 attempts for debugging
    if (attempt % 5 === 0) {
      const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
      log(`[debug] attempt ${attempt} — URL: ${page.url()}`);
      log(`[debug] attempt ${attempt} — page: ${txt.slice(0, 200)}`);
    }
    await sleep(1000);
  }

  if (passwordInput) {
    log('Entering password in closure auth dialog...');
    await passwordInput.click();
    await passwordInput.fill('');
    await passwordInput.fill(password);
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(3000);
  } else {
    log('Warning: No password input found — may already be past this step.');
  }

  // TOTP challenge (if it still asks after password)
  const url2 = page.url();
  const body2 = await page.evaluate(() => document.body.innerText).catch(() => '');
  const needsTotp =
    url2.includes('signin/challenge') ||
    body2.includes('2-Step Verification') ||
    body2.includes('authenticator') ||
    body2.includes('Enter the code') ||
    !!(await page.$('input[name="totpPin"]').catch(() => null)) ||
    !!(await page.$('input[aria-label*="code" i]').catch(() => null));

  if (needsTotp) {
    log('TOTP challenge during closure re-auth...');
    await waitForFreshTOTPWindow();
    const code = generateTOTP(totpSecret);
    log(`Submitting TOTP code: ${code}`);

    const totpInputSelectors = [
      'input[name="totpPin"]',
      'input[aria-label*="code" i]',
      'input[type="tel"]',
      '#totpPin',
    ] as const;

    let inputEl = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const sel of totpInputSelectors) {
        const el = await page.$(sel).catch(() => null);
        if (el && await el.isVisible().catch(() => false)) { inputEl = el; break; }
      }
      if (inputEl) break;
      await sleep(1000);
    }

    if (inputEl) {
      await inputEl.click();
      await inputEl.fill('');
      await inputEl.fill(code);
      await sleep(300);
      await page.keyboard.press('Enter');
      await sleep(3000);
    }
  }
}


// ──────────────────────────────────────────────
// STEP 4: Select reason and confirm closure
// ──────────────────────────────────────────────

async function selectReasonAndConfirm(page: Page): Promise<void> {
  log('Looking for reason selection (closure survey)...');

  // Debug: dump page text
  let bodyText = '';
  for (const frame of page.frames()) {
    bodyText += await frame.evaluate(() => document.body.innerText).catch(() => '') + '\n';
  }
  log(`[reason] Page text (first 600): ${bodyText.slice(0, 600)}`);

  // Screenshot for debugging
  try {
    await page.screenshot({ path: 'public/screenshots/before-reason-select.png', fullPage: false });
    log('📸 Screenshot saved: before-reason-select.png');
  } catch (e) {}

  // ──────────────────────────────────────────────────────────────
  // The closure dialog lives in an <iframe> at:
  //   payments.google.com/payments/u/0/wipeout?...
  //
  // Strategy:
  //   1. Find the wipeout iframe via page.frames() + page.frameLocator()
  //   2. Scroll iframe to bottom so the dropdown + button are visible
  //   3. Click the JFK goog-flat-menu-button to open the dropdown
  //   4. Scroll the floating goog-menu to the bottom
  //   5. Pick the 2nd-from-last menuitem ("I don't want to give a reason")
  //   6. Click "Close payments profile" inside the same iframe
  // ──────────────────────────────────────────────────────────────

  // Step 0: Find the wipeout iframe
  let wipeoutFrameUrl = '';
  let dialogFrame: import('playwright').Frame | null = null;

  for (let w = 0; w < 5; w++) {
    for (const frame of page.frames()) {
      if (frame.url().includes('wipeout')) {
        dialogFrame = frame;
        wipeoutFrameUrl = frame.url();
        log(`Found wipeout iframe: ${wipeoutFrameUrl.slice(0, 100)}`);
        break;
      }
      // Also detect by content
      const text = await frame.evaluate(() => document.body.innerText).catch(() => '');
      if (text.includes('Closing your payments profile') || text.includes('Why are you closing')) {
        dialogFrame = frame;
        wipeoutFrameUrl = frame.url();
        log(`Found closure dialog frame by content: ${wipeoutFrameUrl.slice(0, 100)}`);
        break;
      }
    }
    if (dialogFrame) break;
    log(`Waiting for wipeout iframe (attempt ${w + 1}/5)...`);
    await sleep(2000);
  }

  if (!dialogFrame) {
    log('Warning: Could not find wipeout iframe — falling back to main frame');
    dialogFrame = page.mainFrame();
  }

  // Use frameLocator for Playwright-native iframe interaction
  const iframeSelector = wipeoutFrameUrl.includes('wipeout')
    ? 'iframe[src*="wipeout"]'
    : 'iframe';
  const fl = page.frameLocator(iframeSelector);

  // Scroll to the bottom of the iframe so dropdown + button are in view
  await dialogFrame.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(600);

  // Step 1: Click the goog-flat-menu-button trigger to open the floating menu
  log('Clicking dropdown trigger to open reason menu...');
  let dropdownOpened = false;
  try {
    const trigger = fl.locator('.goog-flat-menu-button, .jfk-select, [role="listbox"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    await trigger.click();
    dropdownOpened = true;
    log('Clicked dropdown trigger via frameLocator.');
  } catch (e) {
    log(`frameLocator trigger failed: ${(e as Error).message} — using frame.evaluate fallback`);
    dropdownOpened = await dialogFrame.evaluate(() => {
      const t = document.querySelector<HTMLElement>('.goog-flat-menu-button, .jfk-select, [role="listbox"]');
      if (t) { t.click(); return true; }
      return false;
    }).catch(() => false);
    if (dropdownOpened) log('Clicked dropdown trigger via frame.evaluate.');
  }

  if (!dropdownOpened) log('Warning: Could not open the reason dropdown.');

  // Wait for the floating goog-menu to appear
  await sleep(1200);

  // Step 2: Scroll menu to bottom, pick 2nd-from-last option
  log('Selecting 2nd-from-last reason option...');
  
  const chosenHandle = await dialogFrame.evaluateHandle(() => {
    const menuItems = [
      ...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
      ...document.querySelectorAll<HTMLElement>('.goog-menu .goog-menuitem'),
    ];
    const visible = menuItems.filter(el => {
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length < 2) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
    if (visible.length === 0) return null;

    // Scroll the menu container to the bottom so all items render
    const menuEl = visible[0].closest<HTMLElement>('[role="menu"], .goog-menu');
    if (menuEl) menuEl.scrollTop = menuEl.scrollHeight;

    // 2nd from last: e.g. with 5 items [0..4], index 3 = "I don't want to give a reason"
    const idx = Math.max(0, visible.length - 2);
    return visible[idx];
  }).catch(() => null);

  const isElement = chosenHandle && await chosenHandle.evaluate(el => el !== null).catch(() => false);

  if (isElement) {
    const element = chosenHandle!.asElement();
    if (element) {
      const selectedText = await element.evaluate((el: HTMLElement) => (el.innerText || el.textContent || '').trim().slice(0, 100));
      log(`✅ Found reason: "${selectedText}". Clicking using Playwright coordinates...`);
      
      // Playwright native click computes exact coordinates and sends real mousedown/mouseup events
      await element.click({ force: true });
      await sleep(900);
      
      // Dismiss the floating menu so it doesn't block the confirm button click
      await dialogFrame.evaluate(() => {
        const escEvt = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
        document.body.dispatchEvent(escEvt);
      }).catch(() => {});
    }
  } else {
    log('Menu items not found — using keyboard ArrowDown×4 + Enter fallback...');
    for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await sleep(200); }
    await page.keyboard.press('Enter');
    await sleep(900);
    log('Selected reason via keyboard fallback.');
  }

  if (chosenHandle) await chosenHandle.dispose().catch(() => {});

  // Step 3: Click the "Close payments profile" confirm button inside the iframe
  await sleep(800);
  log('Clicking "Close payments profile" confirmation button...');

  // Debug: show all buttons across frames
  const allButtons: string[] = [];
  for (const frame of page.frames()) {
    const btns = await frame.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, [role="button"]')]
        .map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean)
    ).catch(() => [] as string[]);
    allButtons.push(...btns);
  }
  log(`[confirm] Buttons across all frames: ${JSON.stringify(allButtons)}`);

  // Primary: frameLocator (Playwright-native)
  let confirmed = false;
  try {
    const confirmBtn = fl.locator('button, [role="button"]').filter({ hasText: /close payments profile/i }).first();
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmBtn.click();
    confirmed = true;
    log('✅ Clicked confirm button via frameLocator.');
  } catch (e) {
    log(`frameLocator confirm failed (menu may still be open) — using frame.evaluate`);
  }

  // Fallback: evaluate inside the wipeout iframe
  if (!confirmed && !dialogFrame.isDetached()) {
    confirmed = await dialogFrame.evaluate(() => {
      const btns = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')];
      for (const btn of btns) {
        const t = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (t.includes('close payments profile') || t.includes('close account')) {
          btn.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (confirmed) log('✅ Clicked confirm button via frame.evaluate.');
  }

  // Final fallback: all frames
  if (!confirmed) {
    confirmed = await clickByText(page, ['Close payments profile', 'Close account', 'Confirm'], true);
  }

  if (!confirmed) throw new Error('Could not find the "Close payments profile" confirmation button');

  log('Clicked final confirmation. Waiting for page to settle...');
  await sleep(5000);
}


// ──────────────────────────────────────────────
// Confirm closure succeeded
// ──────────────────────────────────────────────

async function confirmClosure(page: Page): Promise<void> {
  // After clicking close, wait for the page to settle
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) {}
  await sleep(2000);

  const url = page.url();
  log(`[confirm-closure] URL: ${url}`);

  // Check all frames for success or error signals
  let allText = '';
  for (const frame of page.frames()) {
    allText += await frame.evaluate(() => document.body.innerText).catch(() => '') + '\n';
  }
  log(`[confirm-closure] Page (first 600): ${allText.slice(0, 600)}`);

  const failed =
    /something went wrong|an error occurred|couldn't close|failed/i.test(allText.slice(0, 2000));
  if (failed) throw new Error('Google reported an error during payments profile closure');

  // Success patterns:
  // - "closed" / "successfully closed" text appearing on any frame
  // - The "Close payments profile" link is GONE (means profile is already closed!)
  // - URL redirected to a success/closed page
  const successText =
    /closed|account has been closed|successfully closed|profile has been closed/i.test(allText) ||
    url.includes('closed') ||
    url.includes('success');

  // The absence of "Close payments profile" from the settings page means it worked
  const noCloseLink = !allText.includes('Close payments profile');

  if (successText || noCloseLink) {
    log('✅ Payments profile closure confirmed!');
    if (noCloseLink && !successText) {
      log('   (Confirmed by absence of "Close payments profile" link — profile is closed)');
    }
  } else {
    log('Warning: Could not explicitly confirm closure — check the page manually.');
    log(`Final URL: ${url}`);
  }
}

// ──────────────────────────────────────────────
// Generic text-click helper
// ──────────────────────────────────────────────

async function clickByText(
  page: Page,
  variants: string[],
  requireVisible = true,
): Promise<boolean> {
  // Pass 1: Playwright text locators across all frames
  for (const frame of page.frames()) {
    for (const variant of variants) {
      try {
        const loc = frame.locator(`text=/${escapeRegex(variant)}/i`).first();
        const isVis = await loc.isVisible({ timeout: 1500 }).catch(() => false);
        if (!requireVisible || isVis) {
          await loc.click({ timeout: 3000 });
          log(`Clicked "${variant}" via Playwright locator in a frame.`);
          return true;
        }
      } catch (_) { /* try next */ }
    }
  }

  // Pass 2: JS DOM walk across all frames
  for (const frame of page.frames()) {
    const clicked = await frame.evaluate((vars: string[]) => {
      // Restrict to genuinely actionable elements to prevent clicking static text spans
      const all = [...document.querySelectorAll<HTMLElement>('button, a, [role="button"], label, input[type="radio"], li')];
      for (const el of all) {
        const raw = (el.innerText || el.textContent || '').trim();
        if (raw.length > 0 && raw.length < 120 && vars.some(v => raw.toLowerCase().includes(v.toLowerCase()))) {
          const clickable = el.closest<HTMLElement>('button, a, [role="button"], label, input') || el;
          clickable.click();
          return true;
        }
      }
      return false;
    }, variants).catch(() => false);

    if (clicked) {
      log(`Clicked via JS DOM walk: one of ${JSON.stringify(variants)}`);
      return true;
    }
  }

  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ──────────────────────────────────────────────
// TOTP window timing guard
// Ensures we never reuse a TOTP code within the
// same 30-second window (Google rejects duplicates)
// ──────────────────────────────────────────────

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

/**
 * Always wait until the next TOTP 30-second boundary.
 * Use this when Google has already accepted a code in this session —
 * it will reject the same code even if technically still valid.
 */
async function waitForBrandNewTOTPWindow(): Promise<void> {
  const secondsInWindow = Math.floor(Date.now() / 1000) % 30;
  const remaining = 30 - secondsInWindow;
  // Always wait for the next boundary (a completely different 6-digit code)
  log(`Waiting ${remaining + 2}s for a brand-new TOTP code (previous was already used)...`);
  await sleep((remaining + 2) * 1000);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error(
      'Usage: bun closePayments.ts \'{"email":"..","password":"..","totpSecret":".."}\'',
    );
    process.exit(1);
  }

  const account = JSON.parse(accountArg) as {
    email: string;
    password: string;
    totpSecret: string;
    debugPort?: number;
  };
  const { email, password, totpSecret, debugPort } = account;

  if (!email || !password || !totpSecret) {
    throw new Error('account JSON must include email, password, totpSecret');
  }

  const useCdp = typeof debugPort === 'number' && debugPort > 0;
  log(`Mode: ${useCdp ? `CDP (port ${debugPort})` : 'standalone'}`);

  const { browser, context, page } = useCdp
    ? await createBrowserCDP(debugPort!)
    : await createBrowser();

  try {
    // Step 1: Navigate to payments settings & pass verification
    await navigateToPaymentsSettings(page, email, password, totpSecret);

    // Steps 2-4: Click close, handle re-auth, and ensure we get to the survey.
    let surveyReached = false;
    let surveyPage = page;
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`--- Closure Flow Round ${attempt} ---`);

      // Ensure we are on the settings page and stable
      if (!page.url().includes('/home/settings') && !page.url().includes('/rl')) {
        await page.goto(PAYMENTS_SETTINGS_URL, { waitUntil: 'networkidle' });
      }
      
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) {}
      await sleep(2000);

      // Explicitly wait for the "Close payments profile" link to appear to prevent stale/hidden DOM clicks
      const closeLocator = page.locator('text="Close payments profile"').first();
      try {
        await closeLocator.waitFor({ state: 'visible', timeout: 8000 });
      } catch (e) {
        log('Warning: Close payments profile link not strictly visible yet, will try fallback click attempts.');
      }

      // Step 2: Scroll down and click "Close payments profile"
      await clickClosePaymentsProfile(page).catch(e => {
        log(`Click close failed (maybe already in modal): ${e.message}`);
      });

      // Give it a moment to show either the password modal or the reason survey
      await sleep(2000);

      // Step 3: Handle "Verify it's you" modal and enter password if present
      surveyPage = await enterPasswordInClosureDialog(page, password, totpSecret, email);
      
      // If the popup closed, fallback to the main page
      if (surveyPage.isClosed()) {
        surveyPage = page;
      }

      // After the auth popup closes, Google redirects the MAIN page to /rl (the closure form).
      // Wait for that navigation to complete before checking for the survey.
      await sleep(2000);
      try {
        // The continue URL after re-auth is /rl?ruls=true — wait for it
        await surveyPage.waitForURL(u => u.toString().includes('/rl') || u.toString().includes('/home/settings'), { timeout: 8000 });
      } catch (e) {}
      try { await surveyPage.waitForLoadState('networkidle', { timeout: 6000 }); } catch (e) {}
      await sleep(1000);
      
      const activeUrl = surveyPage.isClosed() ? '' : surveyPage.url();
      log(`[survey-check] URL after re-auth popup: ${activeUrl}`);

      // If we landed on /rl, the closure dialog form is now the page itself
      if (activeUrl.includes('/rl')) {
        log('Landed on /rl closure page. Proceeding to reason selection.');
        surveyReached = true;
        await selectReasonAndConfirm(surveyPage);
        break;
      }

      // Otherwise check if the dialog is still open on the settings page
      let bodyText = '';
      if (!surveyPage.isClosed()) {
        const frames = surveyPage.frames();
        for (const frame of frames) {
          const text = await frame.evaluate(() => document.body.innerText).catch(() => '');
          bodyText += text + '\n';
        }
      }
      
      if (
        bodyText.includes('Why are you closing') ||
        bodyText.includes('Closing your payments profile') ||
        bodyText.includes('Close account')
      ) {
        log('Closure survey/confirm detected on settings page. Proceeding to reason selection.');
        surveyReached = true;
        await selectReasonAndConfirm(surveyPage);
        break;
      } else {
        log(`Warning: Reason selection not found. URL: ${activeUrl}. Will retry.`);
      }
    }

    if (!surveyReached) {
      throw new Error('Failed to reach the closure survey page after 3 attempts. Google keeps redirecting to settings.');
    }

    // Confirm success
    await confirmClosure(surveyPage);

    const result: ClosePaymentsResult = {
      success: true,
      account: email,
      closedAt: new Date().toISOString(),
    };

    process.stdout.write(JSON.stringify(result) + '\n');
    log(`Done. Payments profile closed for ${email}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`Error: ${error}`);

    // Screenshot for debugging
    try {
      const screenshotPath = `public/screenshots/close-payments-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`Screenshot saved: ${screenshotPath}`);
    } catch (_) {}

    const result: ClosePaymentsError = { success: false, account: email, error };
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    if (useCdp) {
      await browser.close(); // disconnect only — GPMLogin owns the process
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
