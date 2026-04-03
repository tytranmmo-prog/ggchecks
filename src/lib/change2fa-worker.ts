/**
 * change2fa-worker.ts — shared single-account 2FA rotation execution.
 *
 * Imported by /api/run-change2fa and /api/bulk-change2fa.
 * Handles: child process spawn, browser pool acquire/release,
 * TOTP secret persistence via the account store.
 *
 * The caller supplies an `onLog` callback to receive streamed log lines,
 * which each route forwards to its own SSE stream.
 */

import { exec } from 'child_process';
import { getAccountStore } from '@/lib/store';
import type { Account } from '@/lib/store';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { getAllConfigs, getConfig } from '@/lib/config';
import type { ILogger } from '@/lib/logger';

// ── Result shapes ─────────────────────────────────────────────────────────────

export interface Change2FASuccess {
  success:       true;
  account:       string;
  newTotpSecret: string;
  changedAt:     string;
}

export interface Change2FAFailure {
  success: false;
  error:   string;
}

export type Change2FAOutcome = Change2FASuccess | Change2FAFailure;

// ── Core worker ───────────────────────────────────────────────────────────────

/**
 * Run the change2fa.ts script for a single account.
 *
 * @param account   Full account row from the store.
 * @param poolType  Browser pool to acquire from.
 * @param onLog     Receives each stderr log line from the script.
 * @param log       Pino child logger already scoped to this account.
 * @returns         Resolved Change2FAOutcome — never throws.
 */
export async function runChange2FAWorker(
  account:  Account,
  poolType: PoolType,
  onLog:    (msg: string) => void,
  log:      ILogger,
): Promise<Change2FAOutcome> {
  const scriptPath = getConfig('CHANGE2FA_PATH') || `${process.cwd()}/change2fa.ts`;

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

  // ── 2. Spawn change2fa script ────────────────────────────────────────────
  const accountData = { ...account, debugPort: port };
  const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };

  log.debug('spawning change2fa', { port, scriptPath });

  let outcome: Change2FAOutcome;

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = exec(
        `npx tsx "${scriptPath}"`,
        { env: env as NodeJS.ProcessEnv, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
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
        log.debug('change2fa exited', { code, stdoutBytes: resultBuf.length });
        if (!resultBuf.trim()) {
          reject(new Error(`Empty stdout from change2fa (exit ${code})`));
        } else {
          resolve(resultBuf);
        }
      });
    });

    const result = JSON.parse(stdout.trim()) as Record<string, unknown>;

    if (result.success) {
      // ── 3. Persist new TOTP secret (Sheet + DB via HybridAccountStore) ────
      const newTotpSecret = String(result.newTotpSecret ?? '');
      await getAccountStore().update2FASecret(account.id, newTotpSecret)
        .then(() => {
          log.info('new TOTP secret saved', { id: account.id });
          onLog(`✅ New secret saved: ${newTotpSecret}`);
        })
        .catch((e: unknown) => {
          log.error('store save failed', { err: String(e) });
          onLog(`⚠️ Save error: ${String(e)}`);
        });

      outcome = result as unknown as Change2FASuccess;

    } else {
      const errMsg = String(result.error ?? 'change2fa failed');
      log.error('change2fa script reported failure', { err: errMsg });
      outcome = { success: false, error: errMsg };
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('change2fa worker failed', { err: msg });
    outcome = { success: false, error: msg };

  } finally {
    if (release) {
      log.debug('releasing pool slot', { port });
      await release().catch((e: unknown) => log.error('release error', { err: String(e) }));
    }
  }

  return outcome;
}
