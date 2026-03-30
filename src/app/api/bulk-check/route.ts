import { exec }        from 'child_process';
import { NextRequest } from 'next/server';
import { updateCreditResult, uploadScreenshotToDrive, updateErrorScreenshot } from '@/lib/sheets';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { getAllConfigs } from '@/lib/config';

export const runtime = 'nodejs';

const log = (...args: unknown[]) =>
  console.log(`[bulk-check ${new Date().toISOString()}]`, ...args);

interface AccountInput {
  rowIndex: number;
  email: string;
  password: string;
  totpSecret: string;
}

// ── runCheck ──────────────────────────────────────────────────────────────────
// Uses a static `exec` import (no dynamic import hack) to avoid silent hangs.

function runCheck(
  account: AccountInput,
  debugPort: number,
  scriptPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const accountData = { ...account, debugPort };
    const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };

    log(`[${account.email}] spawning checker on port ${debugPort}`);

    const child = exec(
      `npx tsx "${scriptPath}"`,
      { env, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout?.trim()) {
          log(`[${account.email}] checker error:`, stderr?.trim() || err.message);
          reject(new Error(stderr?.trim() || err.message || 'Process failed'));
        } else {
          log(`[${account.email}] checker stdout (${stdout?.length ?? 0} bytes)`);
          resolve(stdout || '');
        }
      },
    );

    child.on('exit', (code, signal) =>
      log(`[${account.email}] checker exited code=${code} signal=${signal}`),
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

  log(`request: ${accounts?.length ?? 0} accounts, pool=${poolType}`);

  if (!accounts?.length) {
    return new Response(JSON.stringify({ error: 'No accounts' }), { status: 400 });
  }

  const encoder   = new TextEncoder();
  const scriptPath = process.env.CHECKER_PATH ?? `${process.cwd()}/checkOne.ts`;

  log(`using scriptPath=${scriptPath}`);

  const pool = await getPool(poolType);
  log(`pool ready: type=${pool.type} concurrency=${pool.concurrency}`);

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
        log(`[${account.email}] waiting for pool slot…`);

        let release: (() => Promise<void>) | undefined;
        let port: number | undefined;

        try {
          // acquire() itself may throw (e.g. Chrome failed to start).
          // We wrap it here so the semaphore is always released even on startup failure.
          ({ port, release } = await pool.acquire(account.email));
          log(`[${account.email}] acquired port=${port}`);
          send({ type: 'account_start', rowIndex: account.rowIndex, email: account.email, port });
          send({ type: 'chrome_ready', port });

          const stdout = await runCheck(account, port, scriptPath);

          let result: Record<string, unknown>;
          try {
            result = JSON.parse(stdout.trim());
          } catch {
            throw new Error(`Non-JSON output from checker:\n${stdout.slice(0, 300)}`);
          }

          if (result.success) {
            const memberText = ((result.memberActivities ?? []) as { name: string; credit: number }[])
              .map(m => `${m.name}: ${m.credit}`)
              .join(' | ');

            await updateCreditResult(account.rowIndex, {
              monthlyCredits:          String(result.monthlyCredits          ?? ''),
              additionalCredits:       String(result.additionalCredits       ?? ''),
              additionalCreditsExpiry: String(result.additionalCreditsExpiry ?? ''),
              memberActivities:        memberText,
              lastChecked:             String(result.checkAt                 ?? new Date().toISOString()),
              status:                  'ok',
            }).catch(e => log(`[${account.email}] sheets update failed:`, e));

            send({ type: 'account_done', rowIndex: account.rowIndex, result });
            log(`[${account.email}] done ✓`);
            completed++;
          } else {
            // Checker returned a structured error — may include a screenshotPath
            const errObj: Error & { screenshotPath?: string } = Object.assign(
              new Error(String(result.error) || 'Unknown error from checker'),
              { screenshotPath: result.screenshotPath as string | undefined },
            );
            throw errObj;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`[${account.email}] ERROR:`, msg);

          let screenshotUrl: string | undefined;
          if (typeof err === 'object' && err !== null && 'screenshotPath' in err) {
            const p = (err as { screenshotPath?: string }).screenshotPath;
            if (p) {
              screenshotUrl = `/screenshots/${p.split('/').pop()}`;
            }
          }
          // Also try parsing stdout if it's a JSON error from checkOne
          if (!screenshotUrl) {
            try {
              const parsed = JSON.parse(msg) as { screenshotPath?: string };
              if (parsed.screenshotPath) {
                screenshotUrl = `/screenshots/${parsed.screenshotPath.split('/').pop()}`;
              }
            } catch { /* msg isn't JSON, that's fine */ }
          }

          send({ type: 'account_error', rowIndex: account.rowIndex, error: msg, screenshotUrl });

          await updateCreditResult(account.rowIndex, {
            monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
            memberActivities: '', lastChecked: new Date().toISOString(),
            status: `error: ${msg.slice(0, 100)}`,
          }).catch(e => log(`[${account.email}] sheets error update failed:`, e));

          // We no longer update the sheet with a screenshot URL.
          // if (screenshotUrl) {
          //   await updateErrorScreenshot(account.rowIndex, screenshotUrl)
          //     .catch(e => log(`[${account.email}] screenshot column update failed:`, e));
          // }

          errors++;
        } finally {
          // CRITICAL: always release — even if acquire() itself threw.
          // release is only defined if acquire() succeeded, in which case
          // the semaphore was already incremented and MUST be decremented.
          if (release) {
            log(`[${account.email}] releasing port=${port}`);
            await release().catch(e => log(`[${account.email}] release error:`, e));
          }
        }
      });

      log(`all ${tasks.length} tasks launched, awaiting…`);
      await Promise.all(tasks);
      log(`all tasks done: completed=${completed} errors=${errors}`);

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
