import { exec }        from 'child_process';
import { NextRequest } from 'next/server';
import { getAccountStore } from '@/lib/store';
import type { Account } from '@/lib/store';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { getAllConfigs, getConfig } from '@/lib/config';
import { createLogger } from '@/lib/pino-logger';
import type { ILogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('bulk-2fa');

function randomRunId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ── runChange2FA ──────────────────────────────────────────────────────────────
// Spawns change2fa.ts with a CDP port injected, collects per-line stderr logs
// via onLog callback, and resolves with the final JSON stdout.

function runChange2FA(
  account: Account,
  debugPort: number,
  scriptPath: string,
  alog: ILogger,
  onLog: (line: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const accountData = { ...account, debugPort };
    const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };

    alog.debug('spawning change2fa', { port: debugPort, scriptPath });

    const child = exec(
      `npx tsx "${scriptPath}"`,
      { env, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );

    // Pipe stderr (progress logs) back to the SSE stream in real-time
    child.stderr?.on('data', (d: Buffer | string) => {
      d.toString().split('\n').filter((l: string) => l.trim()).forEach(onLog);
    });

    let stdout = '';
    child.stdout?.on('data', (d: Buffer | string) => { stdout += d.toString(); });

    child.on('close', (code) => {
      alog.debug('change2fa exited', { code, stdoutBytes: stdout.length });
      if (!stdout.trim() && code !== 0) {
        reject(new Error(`Script exited with code ${code} and no stdout`));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (err) => {
      alog.error('change2fa process error', { err: err.message });
      reject(err);
    });
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const userEmails: string[] = body.userEmails ?? [];
  const poolType: PoolType =
    body.poolType === 'persistent' ? 'persistent'
    : body.poolType === 'ephemeral' ? 'ephemeral'
    : 'gpm';

  const runId = randomRunId();
  const rlog = log.child({ runId, poolType, total: userEmails.length });

  rlog.info('request received', { accountCount: userEmails.length, poolType });

  if (!userEmails.length) {
    return new Response(JSON.stringify({ error: 'No userEmails provided' }), { status: 400 });
  }

  const allAccounts = await getAccountStore().getAccounts();
  const accounts = allAccounts.filter(a => userEmails.includes(a.email));

  if (!accounts.length) {
    return new Response(JSON.stringify({ error: 'No accounts found' }), { status: 404 });
  }

  const encoder    = new TextEncoder();
  const scriptPath = getConfig('CHANGE2FA_PATH') || `${process.cwd()}/change2fa.ts`;

  rlog.debug('resolved scriptPath', { scriptPath });

  const pool = await getPool(poolType);
  rlog.info('pool ready', { type: pool.type, concurrency: pool.concurrency });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream closed */ }
      };

      send({ type: 'start', total: accounts.length, concurrency: pool.concurrency, poolType });

      let completed = 0;
      let errors    = 0;

      const tasks = accounts.map(async (account) => {
        const alog = rlog.child({ email: account.email, id: account.id });
        alog.info('task | waiting for pool slot');

        let release: (() => Promise<void>) | undefined;
        let port: number | undefined;

        try {
          ({ port, release } = await pool.acquire(account.email, account.proxy ?? null));
          alog.info('task | slot acquired', { port });
          send({ type: 'account_start', id: account.id, email: account.email, port });

          const stdout = await runChange2FA(
            account,
            port,
            scriptPath,
            alog,
            (line) => send({ type: 'account_log', id: account.id, message: line }),
          );

          let result: Record<string, unknown>;
          try {
            result = JSON.parse(stdout.trim());
          } catch {
            throw new Error(`Non-JSON output from change2fa:\n${stdout.slice(0, 300)}`);
          }

          if (result.success) {
            const newTotpSecret = String(result.newTotpSecret ?? '');

            // HybridAccountStore handles Sheet + DB sync internally
            await getAccountStore().update2FASecret(account.id, newTotpSecret)
              .catch(e => alog.error('store update failed', { err: String(e) }));

            send({ type: 'account_done', id: account.id, newTotpSecret });
            alog.info('task | done ✓', { newTotpSecret: '***' });
            completed++;
          } else {
            throw new Error(String(result.error) || 'change2fa failed');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          alog.error('task | FAILED', { err: msg });
          send({ type: 'account_error', id: account.id, error: msg });
          errors++;
        } finally {
          if (release) {
            alog.debug('task | releasing pool slot', { port });
            await release().catch(e => alog.error('release error', { err: String(e) }));
          }
        }
      });

      rlog.info('all tasks launched', { count: tasks.length });
      await Promise.all(tasks);
      rlog.info('all tasks done', { completed, errors });

      send({ type: 'done', completed, errors });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
