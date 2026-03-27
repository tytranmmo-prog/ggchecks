/**
 * Google Family Group AI Credit Activity Checker
 *
 * Automates login to Google accounts and scrapes AI credit activity
 * (including family group member credits) from one.google.com/ai/activity
 *
 * Usage:
 *   node checker.js [accounts.json]
 *
 * accounts.json format:
 *   [{ "email": "...", "password": "...", "totpSecret": "..." }]
 */

'use strict';

const { chromium } = require('playwright');
const { generate: generateOTP } = require('otplib');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const ACTIVITY_URL = 'https://one.google.com/ai/activity?pli=1&g1_landing_page=0';

// Proxy config (Oxylabs ISP)
const PROXY = {
  server: 'http://isp.oxylabs.io:8001',
  username: 'proxyvip_VV7Fk',
  password: 'Lungtung1_23',
};

// How long to wait (ms) for navigation / elements
const TIMEOUT = 60_000;

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

/**
 * Generate current TOTP code from a base32 secret.
 */
async function generateTOTP(secret) {
  return await generateOTP({ secret });
}

/**
 * Pick a random proxy port between 8001 and 8099.
 */
function randomProxyPort() {
  return Math.floor(Math.random() * 99) + 8001;
}

/**
 * Sleep utility.
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Log a message with timestamp.
 */
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ──────────────────────────────────────────────
// GOOGLE LOGIN FLOW
// ──────────────────────────────────────────────

/**
 * Perform Google login on the given page.
 * Handles: email → password → TOTP (if prompted).
 */
async function googleLogin(page, email, password, totpSecret) {
  log(`  Logging in as ${email} …`);

  // ── Email step ──
  await page.waitForSelector('input[type="email"]', { timeout: TIMEOUT });
  await page.fill('input[type="email"]', email);
  await page.keyboard.press('Enter');

  // ── Password step ──
  await page.waitForSelector('input[type="password"]', {
    state: 'visible',
    timeout: TIMEOUT,
  });
  await sleep(500);
  await page.fill('input[type="password"]', password);
  await page.keyboard.press('Enter');

  // ── Post-password: might be TOTP, might be straight redirect ──
  log('  Waiting for post-password page …');
  await sleep(2500);

  // Check if TOTP is required
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
    log('  TOTP prompt detected — generating code …');
    const code = await generateTOTP(totpSecret);
    log(`  Using TOTP code: ${code}`);

    // Try common selectors for the TOTP input
    const codeInputSelectors = [
      'input[name="totpPin"]',
      'input[aria-label*="code" i]',
      'input[type="tel"]',
      'input[id*="totp" i]',
      '#totpPin',
    ];

    let filled = false;
    for (const sel of codeInputSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await el.fill(code);
        filled = true;
        break;
      }
    }

    if (!filled) {
      // Fallback: type into the focused element
      await page.keyboard.type(code, { delay: 80 });
    }

    await page.keyboard.press('Enter');
    await sleep(3000);
  }

  // Wait until we're on a non-accounts page (i.e. logged in)
  const finalUrl = page.url();
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error(`Login did not complete — still on: ${finalUrl}`);
  }

  log('  Login successful.');
}

// ──────────────────────────────────────────────
// ACTIVITY PAGE SCRAPER
// ──────────────────────────────────────────────

/**
 * Scrape the AI activity page and return a structured result.
 *
 * @returns {{
 *   monthlyCredits: string,
 *   additionalCredits: string,
 *   additionalCreditsExpiry: string,
 *   ownActivity: Array<{description: string, amount: string}>,
 *   memberActivities: Array<{name: string, credit: number}>
 * }}
 */
async function scrapeActivityPage(page) {
  log('  Scraping activity page …');
  // Wait for JS-rendered content to appear
  await page.waitForFunction(
    () => document.body.innerText.includes('AI credits activity'),
    { timeout: TIMEOUT }
  ).catch(() => {});
  await sleep(1500);

  const data = await page.evaluate(() => {
    const result = {
      monthlyCredits: null,
      additionalCredits: null,
      additionalCreditsExpiry: null,
      ownActivity: [],
      memberActivities: [],
    };

    // ── Get all lines from the page ──
    // The page renders name and credit on SEPARATE lines:
    //   "Recent family group members activity"
    //   "anti9 g9"
    //   "-9,865"
    //   "Sara Awad"
    //   "-266"
    //   "View family group"
    const lines = document.body.innerText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Helper: is a string a credit amount? e.g. "-9,865" or "-266" or "100"
    function isCreditAmount(s) {
      return /^[+-]?\d[\d,]*$/.test(s);
    }

    // ── Parse credit cards ──
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/monthly ai credits|daily ai credits/i.test(line)) {
        // The big number is a few lines ahead
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (/^\d[\d,]+$/.test(lines[j])) {
            result.monthlyCredits = lines[j];
            break;
          }
        }
      }
      if (/additional ai credits/i.test(line)) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (/^\d[\d,]+$/.test(lines[j])) {
            result.additionalCredits = lines[j];
          }
          if (/expire/i.test(lines[j])) {
            result.additionalCreditsExpiry = lines[j].replace(/^expire[sd]?\s*/i, '').trim();
          }
        }
      }
    }

    // ── Parse family member activities ──
    // Find the section header then read pairs of (name, credit) lines
    const familyHeaderIdx = lines.findIndex((l) =>
      /recent family group members? activity/i.test(l)
    );
    if (familyHeaderIdx !== -1) {
      let i = familyHeaderIdx + 1;
      while (i < lines.length) {
        const line = lines[i];
        // Stop at the end of the section
        if (/^view family group$/i.test(line) || /^certain ai benefits/i.test(line)) break;
        // Skip avatar/icon lines and empty
        if (!line || isCreditAmount(line)) { i++; continue; }
        // This line is a name — next credit line is the amount
        const name = line;
        let credit = null;
        // Look ahead for the credit (skipping any non-credit lines)
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (isCreditAmount(lines[j])) {
            credit = parseInt(lines[j].replace(/,/g, ''), 10);
            i = j + 1; // advance past the credit line
            break;
          }
        }
        if (credit !== null) {
          result.memberActivities.push({ name, credit });
        } else {
          i++;
        }
      }
    }

    // ── Parse own recent activity ──
    const ownHeaderIdx = lines.findIndex((l) => /^your recent activity$/i.test(l));
    if (ownHeaderIdx !== -1) {
      let i = ownHeaderIdx + 1;
      while (i < lines.length) {
        const line = lines[i];
        if (/^recent family group/i.test(line) || /^no recent activity$/i.test(line)) break;
        if (!line) { i++; continue; }
        const description = line;
        let amount = null;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (isCreditAmount(lines[j])) {
            amount = lines[j];
            i = j + 1;
            break;
          }
        }
        if (amount !== null) {
          result.ownActivity.push({ description, amount });
        } else {
          i++;
        }
      }
    }

    return result;
  });

  return data;
}

// ──────────────────────────────────────────────
// MAIN: CHECK ONE ACCOUNT
// ──────────────────────────────────────────────

async function checkAccount(account) {
  const { email, password, totpSecret } = account;
  const port = randomProxyPort();

  log(`\n${'═'.repeat(60)}`);
  log(`Account: ${email} | Proxy port: ${port}`);
  log(`${'═'.repeat(60)}`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    // proxy: {
    //   server: `http://isp.oxylabs.io:${port}`,
    //   username: PROXY.username,
    //   password: PROXY.password,
    // },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    // Navigate to the activity page (will redirect to login)
    await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1500);

    // Check if login is required
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      await googleLogin(page, email, password, totpSecret);
      // After login, navigate back to activity page
      await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(2000);
    }

    const activityData = await scrapeActivityPage(page);
    const checkAt = new Date().toISOString();

    const result = {
      account: email,
      checkAt,
      monthlyCredits: activityData.monthlyCredits,
      additionalCredits: activityData.additionalCredits,
      additionalCreditsExpiry: activityData.additionalCreditsExpiry,
      ownActivity: activityData.ownActivity,
      memberActivities: activityData.memberActivities.map((m) => ({
        name: m.name,
        credit: m.credit,
        checkAt,
      })),
    };

    log(`  ✓ Monthly credits : ${result.monthlyCredits}`);
    log(`  ✓ Additional creds: ${result.additionalCredits} (expires ${result.additionalCreditsExpiry})`);
    log(`  ✓ Member activities (${result.memberActivities.length}):`);
    result.memberActivities.forEach((m) =>
      log(`      ${m.name}  →  ${m.credit}`)
    );

    return { success: true, data: result };
  } catch (err) {
    log(`  ✗ Error: ${err.message}`);

    // Take a screenshot on error for debugging
    const screenshotPath = path.join(__dirname, `error_${email.split('@')[0]}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    log(`  Screenshot saved: ${screenshotPath}`);

    return { success: false, account: email, error: err.message };
  } finally {
    await context.close();
    await browser.close();
  }
}

// ──────────────────────────────────────────────
// ENTRY POINT
// ──────────────────────────────────────────────

async function main() {
  const accountsFile = process.argv[2] || path.join(__dirname, 'accounts.json');

  if (!fs.existsSync(accountsFile)) {
    console.error(`❌  Accounts file not found: ${accountsFile}`);
    console.error(`    Create an accounts.json with format:`);
    console.error(
      `    [{ "email": "...", "password": "...", "totpSecret": "..." }]`
    );
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
  log(`Loaded ${accounts.length} account(s) from ${accountsFile}`);

  const results = [];

  // Process accounts sequentially to avoid IP bans
  for (const account of accounts) {
    const res = await checkAccount(account);
    results.push(res.data || { account: account.email, error: res.error });
  }

  // ── Output ──
  console.log('\n' + '═'.repeat(60));
  console.log('FINAL RESULTS');
  console.log('═'.repeat(60));
  console.log(JSON.stringify(results, null, 2));

  // Save to results.json
  const outPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  log(`\nResults saved to: ${outPath}`);

  return results;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
