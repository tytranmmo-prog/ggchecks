'use strict';

/**
 * checkOne.js — Single account checker
 * Usage: node checkOne.js '{"email":"..","password":"..","totpSecret":".."}'
 * Outputs: JSON result to stdout
 */

const { chromium } = require('playwright');
const { generate: generateOTP } = require('otplib');

const ACTIVITY_URL = 'https://one.google.com/ai/activity?pli=1&g1_landing_page=0';
const TIMEOUT = 60_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`); }
async function generateTOTP(secret) { return await generateOTP({ secret }); }

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
    log('TOTP prompt detected...');
    const code = await generateTOTP(totpSecret);
    const codeInputSelectors = [
      'input[name="totpPin"]', 'input[aria-label*="code" i]',
      'input[type="tel"]', 'input[id*="totp" i]', '#totpPin',
    ];
    let filled = false;
    for (const sel of codeInputSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) { await el.fill(code); filled = true; break; }
    }
    if (!filled) await page.keyboard.type(code, { delay: 80 });
    await page.keyboard.press('Enter');
    await sleep(3000);
  }

  const finalUrl = page.url();
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error(`Login did not complete — still on: ${finalUrl}`);
  }
  log('Login successful.');
}

async function scrapeActivityPage(page) {
  log('Scraping activity page...');
  await page.waitForFunction(
    () => document.body.innerText.includes('AI credits activity'),
    { timeout: TIMEOUT }
  ).catch(() => {});
  await sleep(1500);

  return await page.evaluate(() => {
    const result = { monthlyCredits: null, additionalCredits: null, additionalCreditsExpiry: null, ownActivity: [], memberActivities: [] };
    const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    function isCreditAmount(s) { return /^[+-]?\d[\d,]*$/.test(s); }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/monthly ai credits|daily ai credits/i.test(line)) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (/^\d[\d,]+$/.test(lines[j])) { result.monthlyCredits = lines[j]; break; }
        }
      }
      if (/additional ai credits/i.test(line)) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (/^\d[\d,]+$/.test(lines[j])) result.additionalCredits = lines[j];
          if (/expire/i.test(lines[j])) result.additionalCreditsExpiry = lines[j].replace(/^expire[sd]?\s*/i, '').trim();
        }
      }
    }

    const familyHeaderIdx = lines.findIndex(l => /recent family group members? activity/i.test(l));
    if (familyHeaderIdx !== -1) {
      let i = familyHeaderIdx + 1;
      while (i < lines.length) {
        const line = lines[i];
        if (/^view family group$/i.test(line) || /^certain ai benefits/i.test(line)) break;
        if (!line || isCreditAmount(line)) { i++; continue; }
        const name = line;
        let credit = null;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (isCreditAmount(lines[j])) { credit = parseInt(lines[j].replace(/,/g, ''), 10); i = j + 1; break; }
        }
        if (credit !== null) result.memberActivities.push({ name, credit });
        else i++;
      }
    }
    return result;
  });
}

async function main() {
  // Accept account JSON from env var (set by Next.js API route) or directly as argv[2]
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error('Usage: node checkOne.js \'{"email":"...","password":"...","totpSecret":"..."}\' ');
    process.exit(1);
  }

  const account = JSON.parse(accountArg);
  const { email, password, totpSecret } = account;

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
    await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1500);

    if (page.url().includes('accounts.google.com')) {
      await googleLogin(page, email, password, totpSecret);
      await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(2000);
    }

    const activityData = await scrapeActivityPage(page);
    const checkAt = new Date().toISOString();

    const result = {
      success: true,
      account: email,
      checkAt,
      monthlyCredits: activityData.monthlyCredits,
      additionalCredits: activityData.additionalCredits,
      additionalCreditsExpiry: activityData.additionalCreditsExpiry,
      memberActivities: activityData.memberActivities.map(m => ({ name: m.name, credit: m.credit, checkAt })),
    };

    process.stdout.write(JSON.stringify(result) + '\n');
    log(`Done. Monthly: ${result.monthlyCredits}`);
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
