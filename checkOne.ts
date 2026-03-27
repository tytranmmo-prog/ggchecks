/**
 * checkOne.ts — Single account credit checker
 * Usage: bun checkOne.ts '{"email":"..","password":"..","totpSecret":".."}'
 * Outputs: JSON result to stdout
 */

import type { Page } from 'playwright';
import { sleep, log, createBrowser, googleLogin } from './google-auth';

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

  return page.evaluate((): ActivityData => {
    const result: ActivityData = {
      monthlyCredits: null,
      additionalCredits: null,
      additionalCreditsExpiry: null,
      ownActivity: [],
      memberActivities: [],
    };
    const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    const isCreditAmount = (s: string) => /^[+-]?\d[\d,]*$/.test(s);

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
        let credit: number | null = null;
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

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error('Usage: bun checkOne.ts \'{"email":"...","password":"...","totpSecret":"..."}\' ');
    process.exit(1);
  }

  const account = JSON.parse(accountArg) as { email: string; password: string; totpSecret: string };
  const { email, password, totpSecret } = account;

  const { browser, context, page } = await createBrowser();

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
    await context.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
