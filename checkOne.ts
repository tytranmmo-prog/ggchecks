/**
 * checkOne.ts — Single account credit checker
 * Usage: bun checkOne.ts '{"email":"..","password":"..","totpSecret":".."}'
 * Outputs: JSON result to stdout
 *
 * Flow:
 *   1. Login (via Playwright or CDP)
 *   2. Call getFamilyMembers(page) — builds name→email map (Playwright still connected)
 *   3. Navigate to activity page and scrape credits
 *   4. Merge email into each memberActivity
 *   5. Output enriched JSON
 *
 * CDP pool mode (when debugPort is provided):
 *   Phase 1 — Playwright connects for login + family member fetch.
 *             Playwright is disconnected afterwards so navigator.webdriver
 *             is no longer asserted on subsequent pages.
 *   Phase 2 — Navigation + scraping done via raw CDP WebSocket with no
 *             Playwright fingerprint on the page.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { sleep, log, createBrowser, createBrowserCDP, ensureLoggedIn, fillAndSubmitTOTP } from './google-auth';
import { getFamilyMembers } from './checkFamily';
import type { FamilyMember } from './checkFamily';

const ACTIVITY_URL   = 'https://one.google.com/ai/activity?pli=1&g1_landing_page=0';
const TIMEOUT        = 60_000;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? `${process.cwd()}/public/screenshots`;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface MemberActivity {
  name:    string;
  email:   string | null;   // enriched via getFamilyMembers
  credit:  number;
  checkAt: string;
}

interface ActivityData {
  monthlyCredits:          string | null;
  additionalCredits:       string | null;
  additionalCreditsExpiry: string | null;
  ownActivity:             unknown[];
  memberActivities:        { name: string; credit: number }[];
}

interface CheckResult {
  success:                 true;
  account:                 string;
  checkAt:                 string;
  monthlyCredits:          string | null;
  additionalCredits:       string | null;
  additionalCreditsExpiry: string | null;
  memberActivities:        MemberActivity[];
  familyMembers:           FamilyMember[];   // full member roster with emails
}

interface CheckError {
  success:          false;
  account:          string;
  error:            string;
  screenshotPath?:  string;
}

// ──────────────────────────────────────────────
// Screenshot helpers
// ──────────────────────────────────────────────

function screenshotPath(email: string): string {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return `${SCREENSHOT_DIR}/${email.replace('@', '_at_')}.png`;
}

async function cdpScreenshot(port: number, email: string): Promise<string | undefined> {
  try {
    const wsUrl = await getPageWsUrl(port);
    const data  = await cdpSend<{ data: string }>(wsUrl, 'Page.captureScreenshot', { format: 'png' });
    const path  = screenshotPath(email);
    writeFileSync(path, Buffer.from(data.data, 'base64'));
    log(`Screenshot saved: ${path}`);
    return path;
  } catch (e) {
    log(`Screenshot failed: ${e}`);
    return undefined;
  }
}

// ──────────────────────────────────────────────
// Raw CDP helpers (used in pool mode only)
// ──────────────────────────────────────────────

interface CDPTarget {
  type:                string;
  webSocketDebuggerUrl: string;
}

async function getPageWsUrl(port: number): Promise<string> {
  const targets: CDPTarget[] = await fetch(`http://localhost:${port}/json`).then(r => r.json());
  const t = targets.find(t => t.type === 'page');
  if (!t) throw new Error(`No page target on port ${port}`);
  return t.webSocketDebuggerUrl;
}

function cdpSend<T>(wsUrl: string, method: string, params: object = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ws    = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
    ws.onopen    = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text ?? 'CDP exception'));
      } else {
        resolve((msg.result?.result?.value ?? msg.result) as T);
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`CDP WS error: ${method}`)); };
  });
}

async function cdpNavigate(port: number, url: string): Promise<void> {
  const ws = await getPageWsUrl(port);
  await cdpSend(ws, 'Page.navigate', { url });
}

async function cdpEval<T>(port: number, expression: string): Promise<T> {
  const ws = await getPageWsUrl(port);
  return cdpSend<T>(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise:  true,
  });
}

// ──────────────────────────────────────────────
// Activity page scraper (plain JS string)
// ──────────────────────────────────────────────

const SCRAPE_JS = `(function() {
  var result = { monthlyCredits: null, additionalCredits: null, additionalCreditsExpiry: null, ownActivity: [], memberActivities: [] };
  var lines = document.body.innerText.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
  function isCreditAmount(s) { return /^[+-]?\\d[\\d,]*$/.test(s); }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/monthly ai credits|daily ai credits/i.test(line)) {
      for (var j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/^\\d[\\d,]+$/.test(lines[j])) { result.monthlyCredits = lines[j]; break; }
      }
    }
    if (/additional ai credits/i.test(line)) {
      for (var j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/^\\d[\\d,]+$/.test(lines[j])) result.additionalCredits = lines[j];
        if (/expire/i.test(lines[j])) result.additionalCreditsExpiry = lines[j].replace(/^expire[sd]?\\s*/i, '').trim();
      }
    }
  }
  var fi = -1;
  for (var k = 0; k < lines.length; k++) {
    if (/recent family group members? activity/i.test(lines[k])) { fi = k; break; }
  }
  if (fi !== -1) {
    var i2 = fi + 1;
    while (i2 < lines.length) {
      var line2 = lines[i2];
      if (/^view family group$/i.test(line2) || /^certain ai benefits/i.test(line2)) break;
      if (!line2 || isCreditAmount(line2)) { i2++; continue; }
      var memberName = line2, credit = null;
      for (var j2 = i2 + 1; j2 < Math.min(i2 + 4, lines.length); j2++) {
        if (isCreditAmount(lines[j2])) { credit = parseInt(lines[j2].replace(/,/g, ''), 10); i2 = j2 + 1; break; }
      }
      if (credit !== null) result.memberActivities.push({ name: memberName, credit: credit });
      else i2++;
    }
  }
  return result;
})()`;

async function scrapeActivityPage(port: number): Promise<ActivityData> {
  log('Waiting for activity page to load...');
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const text = await cdpEval<string>(port, 'document.body.innerText');
    if (text.includes('AI credits activity')) break;
    await sleep(500);
  }
  await sleep(1500);
  log('Scraping via raw CDP...');
  return cdpEval<ActivityData>(port, SCRAPE_JS);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Merge email into raw memberActivities, ensuring all family members are included with at least 0 credit. */
function enrichActivities(
  raw: { name: string; credit: number }[],
  familyMembers: FamilyMember[],
  checkAt: string,
): MemberActivity[] {
  const result: MemberActivity[] = [];
  const processedNames = new Set<string>();

  const rawMap = new Map<string, number>();
  for (const r of raw) {
    if (r.name) rawMap.set(r.name.trim(), r.credit);
  }

  for (const m of familyMembers) {
    const name = m.name?.trim() || m.email || 'Unknown';
    const email = m.email?.trim() || null;
    const credit = m.name ? (rawMap.get(m.name.trim()) ?? 0) : 0;
    
    result.push({ name, email, credit, checkAt });
    if (m.name) processedNames.add(m.name.trim());
  }

  for (const r of raw) {
    if (r.name && !processedNames.has(r.name.trim())) {
      result.push({
        name: r.name.trim(),
        email: null,
        credit: r.credit,
        checkAt
      });
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error("Usage: bun checkOne.ts '{\"email\":\"...\",\"password\":\"...\",\"totpSecret\":\"...\"}'");
    process.exit(1);
  }

  const account = JSON.parse(accountArg) as {
    email:        string;
    password:     string;
    totpSecret:   string;
    debugPort?:   number;
  };
  const { email, password, totpSecret, debugPort } = account;

  // ── Standalone mode (no pool) ──────────────────────────────────────────────
  if (!debugPort) {
    const { browser, context, page } = await createBrowser();
    let screenshotP: string | undefined;
    try {
      // ── 1. Login ────────────────────────────────────────────────────────────
      await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(1500);
      await ensureLoggedIn(page, email, password, totpSecret);

      // ── 2. Fetch family members while still authenticated ───────────────────
      log('Fetching family members...');
      const familyMembers = await getFamilyMembers(page);

      // ── 3. Navigate to activity page and scrape ─────────────────────────────
      log('Navigating to activity page...');
      await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(2000);

      // Google may issue a TOTP re-challenge when crossing from myaccount → one.google.com
      await ensureLoggedIn(page, email, password, totpSecret);
      if (page.url().includes('accounts.google.com')) {
        // Still stuck — navigate again
        await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await sleep(2000);
      }

      const activityData = await page.evaluate(SCRAPE_JS) as ActivityData;

      // ── 4. Build enriched result ─────────────────────────────────────────────
      const checkAt = new Date().toISOString();
      const result: CheckResult = {
        success:                 true,
        account:                 email,
        checkAt,
        monthlyCredits:          activityData.monthlyCredits,
        additionalCredits:       activityData.additionalCredits,
        additionalCreditsExpiry: activityData.additionalCreditsExpiry,
        memberActivities:        enrichActivities(activityData.memberActivities, familyMembers, checkAt),
        familyMembers,
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      log(`Done. Monthly: ${result.monthlyCredits}`);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`Error: ${error}`);
      try {
        const path = screenshotPath(email);
        await page.screenshot({ path, fullPage: true });
        screenshotP = path;
        log(`Screenshot saved: ${path}`);
      } catch (ssErr) { log(`Screenshot failed: ${ssErr}`); }
      process.stdout.write(
        JSON.stringify({ success: false, account: email, error, screenshotPath: screenshotP } as CheckError) + '\n'
      );
    } finally {
      await context.close();
      await browser.close();
    }
    return;
  }

  // ── CDP pool mode ──────────────────────────────────────────────────────────
  //
  // Phase 1: Playwright — login + family member fetch, then disconnect.
  //          While Playwright is alive we grab the full family roster.
  // Phase 2: Raw CDP   — navigate + scrape activity page (no automation fingerprint).

  let familyMembers: FamilyMember[] = [];

  try {
    // ── Phase 1 ───────────────────────────────────────────────────────────────
    {
      const { browser, page } = await createBrowserCDP(debugPort);
      try {
        const encodedContinue = encodeURIComponent(ACTIVITY_URL);
        const chooserUrl = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=${encodedContinue}`;
        await page.goto(chooserUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await sleep(1500);

        if (page.url().includes('accounts.google.com')) {
          const loginResult = await ensureLoggedIn(page, email, password, totpSecret);
          log(loginResult === 'logged_in' ? 'Login complete.' : 'Session cache hit — login skipped.');
        }

        // Fetch family members while Playwright is still connected
        log('Fetching family members (Phase 1)...');
        familyMembers = await getFamilyMembers(page);
        log(`Got ${familyMembers.length} family member(s).`);

      } catch (loginErr) {
        try {
          const path = screenshotPath(email);
          await page.screenshot({ path, fullPage: true });
          log(`Login error screenshot: ${path}`);
        } catch { /* non-fatal */ }
        throw loginErr;
      } finally {
        await browser.close(); // Disconnect — Chrome stays alive, session persists
        log('Playwright disconnected — switching to raw CDP.');
      }
    }

    await sleep(500);

    // ── Phase 2: Raw CDP ──────────────────────────────────────────────────────
    await cdpNavigate(debugPort, ACTIVITY_URL);
    await sleep(2000);

    const currentUrl = await cdpEval<string>(debugPort, 'location.href');
    if (currentUrl.includes('accounts.google.com')) {
      throw new Error(`Still on auth page after login: ${currentUrl}`);
    }

    const activityData = await scrapeActivityPage(debugPort);
    const checkAt      = new Date().toISOString();

    const result: CheckResult = {
      success:                 true,
      account:                 email,
      checkAt,
      monthlyCredits:          activityData.monthlyCredits,
      additionalCredits:       activityData.additionalCredits,
      additionalCreditsExpiry: activityData.additionalCreditsExpiry,
      memberActivities:        enrichActivities(activityData.memberActivities, familyMembers, checkAt),
      familyMembers,
    };

    process.stdout.write(JSON.stringify(result) + '\n');
    log(`Done. Monthly: ${result.monthlyCredits}`);

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`Error: ${error}`);
    const screenshotP = await cdpScreenshot(debugPort, email);
    process.stdout.write(
      JSON.stringify({ success: false, account: email, error, screenshotPath: screenshotP } as CheckError) + '\n'
    );
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
