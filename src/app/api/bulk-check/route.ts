import { NextRequest } from 'next/server';
import { updateCreditResult } from '@/lib/sheets';
import { ensureChrome, waitForSlot, CONCURRENCY } from '@/lib/chrome-pool';

export const runtime = 'nodejs';

interface AccountInput {
  rowIndex: number;
  email: string;
  password: string;
  totpSecret: string;
}

function runCheck(account: AccountInput, debugPort: number, scriptPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // No freshContext — persistent Chrome profile caches the session
    const accountData = { ...account, debugPort };
    const env = { ...process.env, ACCOUNT_JSON: JSON.stringify(accountData) };
    import('child_process' as string).then(({ exec }: { exec: Function }) => {
      exec(`npx tsx "${scriptPath}"`,
        { env, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
        (err: Error | null, stdout: string, stderr: string) => {
          if (err && !stdout?.trim()) reject(new Error(stderr?.trim() || err.message || 'Process failed'));
          else resolve(stdout || '');
        }
      );
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const accounts: AccountInput[] = body.accounts;
  if (!accounts?.length) {
    return new Response(JSON.stringify({ error: 'No accounts' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const scriptPath = process.env.CHECKER_PATH ?? `${process.cwd()}/checkOne.ts`;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream closed */ }
      };

      send({ type: 'start', total: accounts.length, concurrency: CONCURRENCY });

      let completed = 0;
      let errors = 0;

      const tasks = accounts.map(async (account) => {
        // Claim a Chrome slot — each slot is a separate persistent Chrome instance
        const { port, release } = await waitForSlot();
        send({ type: 'account_start', rowIndex: account.rowIndex, email: account.email, port });

        try {
          // Auto-launch Chrome on this slot's port if not already running
          await ensureChrome(port);
          send({ type: 'chrome_ready', port });

          const stdout = await runCheck(account, port, scriptPath);
          const result = JSON.parse(stdout.trim());

          if (result.success) {
            const memberText = (result.memberActivities || [])
              .map((m: { name: string; credit: number }) => `${m.name}: ${m.credit}`)
              .join(' | ');
            await updateCreditResult(account.rowIndex, {
              monthlyCredits: result.monthlyCredits || '',
              additionalCredits: result.additionalCredits || '',
              additionalCreditsExpiry: result.additionalCreditsExpiry || '',
              memberActivities: memberText,
              lastChecked: result.checkAt || new Date().toISOString(),
              status: 'ok',
            }).catch(() => {});
            send({ type: 'account_done', rowIndex: account.rowIndex, result });
            completed++;
          } else {
            throw new Error(result.error || 'Unknown error');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ type: 'account_error', rowIndex: account.rowIndex, error: msg });
          await updateCreditResult(account.rowIndex, {
            monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
            memberActivities: '', lastChecked: new Date().toISOString(),
            status: `error: ${msg.slice(0, 100)}`,
          }).catch(() => {});
          errors++;
        } finally {
          release();
        }
      });

      await Promise.all(tasks);
      send({ type: 'done', completed, errors });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
