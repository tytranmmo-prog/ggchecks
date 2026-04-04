import { exec } from 'child_process';
import type { Account } from '@/lib/store';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { getAllConfigs, getConfig } from '@/lib/config';
import type { ILogger } from '@/lib/logger';

export interface ClosePaymentsSuccess {
  success:  true;
  account:  string;
  closedAt: string;
}

export interface ClosePaymentsFailure {
  success: false;
  error:   string;
}

export type ClosePaymentsOutcome = ClosePaymentsSuccess | ClosePaymentsFailure;

export async function runClosePaymentsWorker(
  account:  Account,
  poolType: PoolType,
  onLog:    (msg: string) => void,
  log:      ILogger,
): Promise<ClosePaymentsOutcome> {
  const scriptPath = getConfig('CLOSE_PAYMENTS_PATH') || `${process.cwd()}/closePayments.ts`;

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

  const accountData = { ...account, debugPort: port };
  const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };

  log.debug('spawning closePayments', { port, scriptPath });

  let outcome: ClosePaymentsOutcome;

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
        log.debug('closePayments exited', { code, stdoutBytes: resultBuf.length });
        if (!resultBuf.trim()) {
          reject(new Error(`Empty stdout from closePayments (exit ${code})`));
        } else {
          resolve(resultBuf);
        }
      });
    });

    const result = JSON.parse(stdout.trim()) as Record<string, unknown>;

    if (result.success) {
      outcome = result as unknown as ClosePaymentsSuccess;
    } else {
      const errMsg = String(result.error ?? 'closePayments failed');
      log.error('closePayments script reported failure', { err: errMsg });
      outcome = { success: false, error: errMsg };
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('closePayments worker failed', { err: msg });
    outcome = { success: false, error: msg };

  } finally {
    if (release) {
      log.debug('releasing pool slot', { port });
      await release().catch((e: unknown) => log.error('release error', { err: String(e) }));
    }
  }

  return outcome;
}
