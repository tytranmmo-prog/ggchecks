/**
 * checkOne.ts — Single account credit checker
 * Usage: bun checkOne.ts '{"email":"..","password":"..","totpSecret":".."}'
 * Outputs: JSON result to stdout
 */

import type { Page } from 'playwright';
import { sleep, log, createBrowser, createBrowserCDP, googleLogin } from './google-auth';

const ACTIVITY_URL = 'https://one.google.com/ai/activity?pli=1&g1_landing_page=0';
const TIMEOUT = 60_000;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface MemberActivity {
  name: string;
  credit: number;
  checkAt: string;
}

interface ActivityData {
  monthlyCredits: string | null;
  additionalCredits: string | null;
  additionalCreditsExpiry: string | null;
  ownActivity: unknown[];
  memberActivities: { name: string; credit: number }[];
}

interface CheckResult {
  success: true;
  account: string;
  checkAt: string;
  monthlyCredits: string | null;
  additionalCredits: string | null;
  additionalCreditsExpiry: string | null;
  memberActivities: MemberActivity[];
}

interface CheckError {
  success: false;
  account: string;
  error: string;
}

// ──────────────────────────────────────────────
// SCRAPE ACTIVITY PAGE
// ──────────────────────────────────────────────

async function scrapeActivityPage(page: Page): Promise<ActivityData> {
  log('Scraping activity page...');
  await page.waitForFunction(
    () => document.body.innerText.includes('AI credits activity'),
    { timeout: TIMEOUT }
  ).catch(() => {});
  await sleep(1500);

  // Pass as a plain string to avoid esbuild __name injection in CDP mode
  return page.evaluate(`(function() {
    var result = {
      monthlyCredits: null,
      additionalCredits: null,
      additionalCreditsExpiry: null,
      ownActivity: [],
      memberActivities: [],
    };
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

    var familyHeaderIdx = -1;
    for (var k = 0; k < lines.length; k++) {
      if (/recent family group members? activity/i.test(lines[k])) { familyHeaderIdx = k; break; }
    }
    if (familyHeaderIdx !== -1) {
      var i2 = familyHeaderIdx + 1;
      while (i2 < lines.length) {
        var line2 = lines[i2];
        if (/^view family group$/i.test(line2) || /^certain ai benefits/i.test(line2)) break;
        if (!line2 || isCreditAmount(line2)) { i2++; continue; }
        var memberName = line2;
        var credit = null;
        for (var j2 = i2 + 1; j2 < Math.min(i2 + 4, lines.length); j2++) {
          if (isCreditAmount(lines[j2])) { credit = parseInt(lines[j2].replace(/,/g, ''), 10); i2 = j2 + 1; break; }
        }
        if (credit !== null) result.memberActivities.push({ name: memberName, credit: credit });
        else i2++;
      }
    }
    return result;
  })()`);

}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error('Usage: bun checkOne.ts \'{"email":"...","password":"...","totpSecret":"..."}\' ');
    process.exit(1);
  }

  const account = JSON.parse(accountArg) as { email: string; password: string; totpSecret: string; debugPort?: number };
  const { email, password, totpSecret, debugPort } = account;

  const { browser, context, page } = debugPort
    ? await createBrowserCDP(debugPort)
    : await createBrowser();

  try {
    if (debugPort) {
      // CDP / stealth mode:
      // AccountChooser asks Google "sign in as THIS email".
      // If a valid session for that account already exists in this Chrome profile,
      // Google redirects straight to the activity page — no login needed.
      // If not (first run, expired, or different account on this slot),
      // Google shows the login form → we log in and the session is saved for next time.
      const encodedContinue = encodeURIComponent(ACTIVITY_URL);
      const chooserUrl = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=${encodedContinue}`;
      await page.goto(chooserUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    } else {
      await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    }
    await sleep(1500);

    if (page.url().includes('accounts.google.com')) {
      await googleLogin(page, email, password, totpSecret);
      await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(2000);
    }
    else {
      log('Session cache hit — skipping login.');
    }

    const activityData = await scrapeActivityPage(page);
    const checkAt = new Date().toISOString();

    const result: CheckResult = {
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
    const error = err instanceof Error ? err.message : String(err);
    log(`Error: ${error}`);
    const result: CheckError = { success: false, account: email, error };
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    if (debugPort) {
      // CDP mode: disconnect only — Chrome stays running, profile/session persists
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
