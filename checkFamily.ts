/**
 * checkFamily.ts — Google Family Group member name + email fetcher
 *
 * Exports:
 *   FamilyMember                              — type
 *   getFamilyMembers(page, baseUrl?)          — callable from other scripts
 *
 * Standalone usage:
 *   bun checkFamily.ts '{"email":"..","password":"..","totpSecret":".."}'
 *   Outputs: JSON result to stdout
 */

import { writeFileSync, mkdirSync } from 'fs';
import type { Page } from 'playwright';
import { sleep, log, createBrowser, googleLogin, reVerifyForSensitivePage } from './google-auth';

const FAMILY_URL     = 'https://myaccount.google.com/family/details?hl=en&pli=1';
const TIMEOUT        = 60_000;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? `${process.cwd()}/public/screenshots`;

// ──────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────

export interface FamilyMember {
  name:  string | null;
  email: string | null;
  role:  string | null;
  link:  string;
}

// ──────────────────────────────────────────────
// Core parser — pure TypeScript, no injected JS
// ──────────────────────────────────────────────

/**
 * Given a member detail page's innerText, extract name / email / role.
 *
 * Active member page text structure:
 *   "Family member details\n<boilerplate>\nDisplay Name\n\nemail@gmail.com\n\nMember\n…"
 *
 * Pending invitation structure:
 *   "Family member details\n<boilerplate>\n\nemail@gmail.com\n\nInvitation expires…\n…"
 */
function parseMemberPage(text: string, link: string): FamilyMember {
  const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const headerIdx = lines.findIndex(l => /family member details/i.test(l));

  let name:  string | null = null;
  let email: string | null = null;
  let role:  string | null = null;

  if (headerIdx !== -1) {
    const dataLines = lines.slice(headerIdx + 1).filter(l =>
      !/you can (manage|ask|remove|cancel)/i.test(l) &&
      !/learn more/i.test(l)                         &&
      !/give parental/i.test(l)                      &&
      !/remove member/i.test(l)                      &&
      !/cancel invitation/i.test(l)                  &&
      !/privacy|terms|help|about/i.test(l)
    );

    if (dataLines[0] && isEmail(dataLines[0])) {
      // Pending invite — no display name
      email = dataLines[0];
      role  = dataLines[1] ?? null;
    } else if (dataLines[0]) {
      // Active member — display name first
      name  = dataLines[0];
      email = dataLines[1] && isEmail(dataLines[1]) ? dataLines[1] : null;
      role  = dataLines[2] ?? null;
    }
  }

  // Regex fallback in case page structure changes
  if (!email) {
    const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (m) email = m[0];
  }

  return { name, email, role, link };
}

// ──────────────────────────────────────────────
// Exported core function
// ──────────────────────────────────────────────

/**
 * Fetches all family members for the currently authenticated Google account.
 *
 * Requires an already-authenticated Playwright `Page` — this function does
 * NOT handle login; the caller is responsible for authentication.
 *
 * Navigates to the family details page, collects every member link, then
 * visits each member detail page to extract name + email. After completion
 * the page is left on the last member detail URL.
 */
export async function getFamilyMembers(page: Page): Promise<FamilyMember[]> {
  log('Navigating to family details page...');
  await page.goto(FAMILY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await sleep(1500);

  if (!page.url().includes('family/details')) {
    log('Family page did not load — trying once more...');
    await page.goto(FAMILY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(2000);
  }

  const memberLinks: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .map(a => (a as HTMLAnchorElement).href)
      .filter(href => href.includes('family/member/'))
  );

  log(`Found ${memberLinks.length} family member link(s).`);

  const members: FamilyMember[] = [];

  for (const link of memberLinks) {
    log(`Fetching member: ${link}`);
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1000);
    const text = await page.evaluate(() => document.body.innerText);
    members.push(parseMemberPage(text, link));
  }

  log(`Family members resolved: ${members.map(m => m.email ?? m.name).join(', ')}`);
  return members;
}

// ──────────────────────────────────────────────
// Standalone entry point
// ──────────────────────────────────────────────

interface CheckResult {
  success: true;
  account: string;
  checkAt: string;
  members: FamilyMember[];
}

interface CheckError {
  success:        false;
  account:        string;
  error:          string;
  screenshotPath?: string;
}

function screenshotPath(email: string): string {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return `${SCREENSHOT_DIR}/${email.replace('@', '_at_')}_family.png`;
}

async function main(): Promise<void> {
  const accountArg = process.env.ACCOUNT_JSON || process.argv[2];
  if (!accountArg) {
    console.error("Usage: bun checkFamily.ts '{\"email\":\"...\",\"password\":\"...\",\"totpSecret\":\"...\"}'");
    process.exit(1);
  }

  const { email, password, totpSecret } = JSON.parse(accountArg) as {
    email:       string;
    password:    string;
    totpSecret:  string;
  };

  const { browser, context, page } = await createBrowser();
  let screenshotP: string | undefined;

  try {
    log(`Starting family check for ${email}...`);
    await page.goto(FAMILY_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1500);

    // Login if needed
    if (page.url().includes('accounts.google.com')) {
      await googleLogin(page, email, password, totpSecret);
      await sleep(1500);
    }

    // Re-verify if Google demanded identity confirmation for this sensitive page
    if (page.url().includes('accounts.google.com')) {
      await reVerifyForSensitivePage(page, email, password, totpSecret, FAMILY_URL);
      await sleep(2000);
    }

    const members = await getFamilyMembers(page);

    const result: CheckResult = {
      success: true,
      account: email,
      checkAt: new Date().toISOString(),
      members,
    };

    process.stdout.write(JSON.stringify(result) + '\n');
    log(`Done. Found ${members.length} member(s).`);

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`Error: ${error}`);
    try {
      const path = screenshotPath(email);
      await page.screenshot({ path, fullPage: true });
      screenshotP = path;
    } catch { /* non-fatal */ }
    process.stdout.write(
      JSON.stringify({ success: false, account: email, error, screenshotPath: screenshotP } as CheckError) + '\n'
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

// Only run main() when invoked directly (bun checkFamily.ts ...),
// not when this module is imported by checkOne.ts or other scripts.
if (import.meta.main) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
