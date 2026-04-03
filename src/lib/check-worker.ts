/**
 * check-worker.ts — shared single-account check execution.
 *
 * Imported by /api/check and /api/bulk-check.
 * Handles: child process spawn, browser pool acquire/release,
 * family member upsert, and credit result persistence.
 *
 * The caller supplies an `onLog` callback to receive streamed log lines,
 * which each route forwards to its own SSE stream.
 */

import { exec } from 'child_process';
import { getCheckResultStore, getAccountStore, getFamilyMemberStore } from '@/lib/store';
import type { Account, MemberActivity } from '@/lib/store';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { getAllConfigs, getConfig } from '@/lib/config';
import type { ILogger } from '@/lib/logger';

// ── Result shapes ─────────────────────────────────────────────────────────────

export interface CheckSuccess {
  success:                 true;
  account:                 string;
  monthlyCredits:          string;
  additionalCredits:       string;
  additionalCreditsExpiry: string;
  memberActivities:        MemberActivity[];
  familyMembers:           { name: string | null; email: string | null }[];
  checkAt:                 string;
  screenshotPath?:         string;
}

export interface CheckFailure {
  success:        false;
  error:          string;
  screenshotUrl?: string;
}

export type CheckOutcome = CheckSuccess | CheckFailure;

// ── Core worker ───────────────────────────────────────────────────────────────

/**
 * Run the checkOne.ts script for a single account.
 *
 * @param account    Full account row from the store.
 * @param poolType   Browser pool to acquire from.
 * @param onLog      Receives each stderr log line from the checker script.
 * @param log        Pino child logger already scoped to this account.
 * @returns          Resolved CheckOutcome — never throws.
 */
export async function runCheckWorker(
  account:  Account,
  poolType: PoolType,
  onLog:    (msg: string) => void,
  log:      ILogger,
): Promise<CheckOutcome> {
  const scriptPath = getConfig('CHECKER_PATH') || `${process.cwd()}/checkOne.ts`;

  // ── 1. Acquire browser slot ──────────────────────────────────────────────
  let release: (() => Promise<void>) | undefined;
  let port: number;

  try {
    onLog(`Waiting for ${poolType} browser slot...`);
    const pool = await getPool(poolType);
    ({ port, release } = await pool.acquire(account.email, account.proxy ?? null));
    onLog(`Acquired slot on debug port ${port}.`);
  } catch (poolErr) {
    const msg = poolErr instanceof Error ? poolErr.message : String(poolErr);
    log.error('pool acquire failed', { err: msg });
    return { success: false, error: `Pool acquire failed: ${msg}` };
  }

  // ── 2. Load cached family members ────────────────────────────────────────
  const familyMembers = await getFamilyMemberStore()
    .getServiceAccountMembers(account.id)
    .catch(() => []);

  // ── 3. Spawn checker script ──────────────────────────────────────────────
  const accountData = { ...account, debugPort: port, familyMembers };
  const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };

  log.debug('spawning checker', { port, scriptPath });

  let outcome: CheckOutcome;

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = exec(
        `npx tsx "${scriptPath}"`,
        { env: env as NodeJS.ProcessEnv, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );

      child.stderr?.on('data', (d: string | Buffer) => {
        d.toString().split('\n').filter((l: string) => l.trim()).forEach(onLog);
      });

      let resultBuf = '';
      child.stdout?.on('data', (d: string | Buffer) => { resultBuf += d.toString(); });

      child.on('error', (err: Error) => {
        log.error('child process error', { err: err.message });
        reject(err);
      });

      child.on('close', (code: number | null) => {
        log.debug('checker exited', { code, stdoutBytes: resultBuf.length });
        if (!resultBuf.trim()) {
          reject(new Error(`Empty stdout from checker (exit ${code})`));
        } else {
          resolve(resultBuf);
        }
      });
    });

    const result = JSON.parse(stdout.trim()) as Record<string, unknown>;

    if (result.success) {
      // ── 3a. Persist family members ──────────────────────────────────────
      if (Array.isArray(result.familyMembers) && result.familyMembers.length > 0) {
        const members = (result.familyMembers as { name: string | null; email: string | null }[])
          .map(m => ({ name: m.name ?? '', email: m.email }));
        await getFamilyMemberStore().upsertServiceAccountMembers(account.id, members)
          .then(() => {
            log.info('family members saved', { count: members.length });
            onLog(`👨‍👩‍👧 Saved ${members.length} family member(s) to DB`);
          })
          .catch((e: unknown) => log.error('failed to upsert family members', { err: String(e) }));
      }

      // ── 3b. Persist credit result ────────────────────────────────────────
      const memberActivities = (result.memberActivities ?? []) as MemberActivity[];
      await getCheckResultStore().updateCreditResult(account.id, {
        monthlyCredits:          String(result.monthlyCredits          ?? ''),
        additionalCredits:       String(result.additionalCredits       ?? ''),
        additionalCreditsExpiry: String(result.additionalCreditsExpiry ?? ''),
        memberActivities,
        lastChecked:             String(result.checkAt ?? new Date().toISOString()),
        status:                  'ok',
      }).catch(e => log.error('db update failed', { err: String(e) }));

      outcome = result as unknown as CheckSuccess;

    } else {
      // ── 3c. Persist error status ─────────────────────────────────────────
      const errMsg = String(result.error ?? 'Unknown error from checker');
      let screenshotUrl: string | undefined;
      if (result.screenshotPath) {
        screenshotUrl = `/screenshots/${String(result.screenshotPath).split('/').pop()}`;
        onLog(`📸 Screenshot saved locally as ${screenshotUrl}`);
      }

      await getCheckResultStore().updateCreditResult(account.id, {
        monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
        memberActivities: [], lastChecked: new Date().toISOString(),
        status: `error: ${errMsg}`,
      }).catch(() => {});

      outcome = { success: false, error: errMsg, screenshotUrl };
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('checker failed', { err: msg });

    let screenshotUrl: string | undefined;
    try {
      const parsed = JSON.parse(msg) as { screenshotPath?: string };
      if (parsed.screenshotPath) screenshotUrl = `/screenshots/${parsed.screenshotPath.split('/').pop()}`;
    } catch { /* msg is not JSON */ }

    await getCheckResultStore().updateCreditResult(account.id, {
      monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
      memberActivities: [], lastChecked: new Date().toISOString(),
      status: `error: ${msg.slice(0, 100)}`,
    }).catch(() => {});

    outcome = { success: false, error: msg, screenshotUrl };

  } finally {
    if (release) {
      log.debug('releasing pool slot', { port });
      await release().catch(e => log.error('release error', { err: String(e) }));
    }
  }

  return outcome;
}
