import { exec }        from 'child_process';
import { NextRequest } from 'next/server';
import { getCheckResultStore } from '@/lib/store';
import type { MemberActivity } from '@/lib/store';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { getAllConfigs, getConfig } from '@/lib/config';
import { createLogger } from '@/lib/pino-logger';
import type { ILogger } from '@/lib/logger';

export const runtime = 'nodejs';

/** Feature-scoped logger for all bulk-check activity. */
const log = createLogger('bulk-check');

/** Generate a short random ID to correlate all logs for one bulk-check run. */
function randomRunId(): string {
  return Math.random().toString(36).slice(2, 8);
}

interface AccountInput {
  id: number;
  email: string;
  password: string;
  totpSecret: string;
  proxy?: string | null;
}

// ── runCheck ──────────────────────────────────────────────────────────────────

function runCheck(
  account: AccountInput,
  debugPort: number,
  scriptPath: string,
  alog: ILogger,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const accountData = { ...account, debugPort };
    const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };

    alog.debug('spawning checker', { port: debugPort, scriptPath });

    const child = exec(
      `npx tsx "${scriptPath}"`,
      { env, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout?.trim()) {
          const msg = stderr?.trim() || err.message;
          alog.error('checker process error', { err: msg });
          reject(new Error(msg || 'Process failed'));
        } else {
          alog.debug('checker stdout received', { bytes: stdout?.length ?? 0 });
          resolve(stdout || '');
        }
      },
    );

    child.on('exit', (code, signal) =>
      alog.debug('checker exited', { code, signal }),
    );
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const accounts: AccountInput[] = body.accounts;
  const poolType: PoolType =
    body.poolType === 'persistent' ? 'persistent'
    : body.poolType === 'ephemeral' ? 'ephemeral'
    : 'gpm';

  // Unique ID for correlating all log lines of this single bulk-check run.
  const runId = randomRunId();
  const rlog = log.child({ runId, poolType, total: accounts?.length ?? 0 });

  rlog.info('request received', { accountCount: accounts?.length ?? 0, poolType });

  if (!accounts?.length) {
    return new Response(JSON.stringify({ error: 'No accounts' }), { status: 400 });
  }

  const encoder    = new TextEncoder();
  const scriptPath = getConfig('CHECKER_PATH') || `${process.cwd()}/checkOne.ts`;

  rlog.debug('resolved scriptPath', { scriptPath });

  const pool = await getPool(poolType);
  rlog.info('pool ready', { type: pool.type, concurrency: pool.concurrency });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream closed (client disconnected) */ }
      };

      send({ type: 'start', total: accounts.length, concurrency: pool.concurrency, poolType });

      let completed = 0;
      let errors    = 0;

      const tasks = accounts.map(async (account) => {
        const alog = rlog.child({ email: account.email, id: account.id });
        alog.info('account task | waiting for pool slot');

        let release: (() => Promise<void>) | undefined;
        let port: number | undefined;

        try {
          ({ port, release } = await pool.acquire(account.email, account.proxy ?? null));
          alog.info('account task | slot acquired', { port });
          send({ type: 'account_start', id: account.id, email: account.email, port });
          send({ type: 'chrome_ready', port });

          const stdout = await runCheck(account, port, scriptPath, alog);

          let result: Record<string, unknown>;
          try {
            result = JSON.parse(stdout.trim());
          } catch {
            throw new Error(`Non-JSON output from checker:\n${stdout.slice(0, 300)}`);
          }

          if (result.success) {
            const memberActivities = (result.memberActivities ?? []) as MemberActivity[];

            await getCheckResultStore().updateCreditResult(account.id, {
              monthlyCredits:          String(result.monthlyCredits          ?? ''),
              additionalCredits:       String(result.additionalCredits       ?? ''),
              additionalCreditsExpiry: String(result.additionalCreditsExpiry ?? ''),
              memberActivities,
              lastChecked:             String(result.checkAt                 ?? new Date().toISOString()),
              status:                  'ok',
            }).catch(e => alog.error('db update failed', { err: String(e) }));

            send({ type: 'account_done', id: account.id, result });
            alog.info('account task | done ✓');
            completed++;
          } else {
            const errObj: Error & { screenshotPath?: string } = Object.assign(
              new Error(String(result.error) || 'Unknown error from checker'),
              { screenshotPath: result.screenshotPath as string | undefined },
            );
            throw errObj;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          alog.error('account task | FAILED', { err: msg });

          let screenshotUrl: string | undefined;
          if (typeof err === 'object' && err !== null && 'screenshotPath' in err) {
            const p = (err as { screenshotPath?: string }).screenshotPath;
            if (p) screenshotUrl = `/screenshots/${p.split('/').pop()}`;
          }
          if (!screenshotUrl) {
            try {
              const parsed = JSON.parse(msg) as { screenshotPath?: string };
              if (parsed.screenshotPath) screenshotUrl = `/screenshots/${parsed.screenshotPath.split('/').pop()}`;
            } catch { /* msg is not JSON */ }
          }

          send({ type: 'account_error', id: account.id, error: msg, screenshotUrl });

          await getCheckResultStore().updateCreditResult(account.id, {
            monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
            memberActivities: [], lastChecked: new Date().toISOString(),
            status: `error: ${msg.slice(0, 100)}`,
          }).catch(e => alog.error('db error-status update failed', { err: String(e) }));

          errors++;
        } finally {
          if (release) {
            alog.debug('account task | releasing pool slot', { port });
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
