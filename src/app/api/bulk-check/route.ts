import { NextRequest } from 'next/server';
import { getAccountStore } from '@/lib/store';
import { getPool, type PoolType } from '@/lib/browser-pool';
import { createLogger } from '@/lib/pino-logger';
import { runCheckWorker } from '@/lib/check-worker';

export const runtime = 'nodejs';

const log = createLogger('bulk-check');

function randomRunId(): string {
  return Math.random().toString(36).slice(2, 8);
}

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
    return new Response(JSON.stringify({ error: 'No accounts found for the provided emails' }), { status: 404 });
  }

  const pool = await getPool(poolType);
  rlog.info('pool ready', { type: pool.type, concurrency: pool.concurrency });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* client disconnected */ }
      };

      send({ type: 'start', total: accounts.length, concurrency: pool.concurrency, poolType });

      let completed = 0;
      let errors    = 0;

      const tasks = accounts.map(async (account) => {
        const alog = rlog.child({ email: account.email, id: account.id });
        alog.info('account task | starting');
        send({ type: 'account_start', id: account.id, email: account.email });

        const outcome = await runCheckWorker(
          account,
          poolType,
          (msg) => send({ type: 'account_log', id: account.id, message: msg }),
          alog,
        );

        if (outcome.success) {
          send({ type: 'account_done', id: account.id, result: outcome });
          alog.info('account task | done ✓');
          completed++;
        } else {
          send({ type: 'account_error', id: account.id, error: outcome.error, screenshotUrl: outcome.screenshotUrl });
          alog.error('account task | FAILED', { err: outcome.error });
          errors++;
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
