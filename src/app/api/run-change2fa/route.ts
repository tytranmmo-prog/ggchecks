import { NextRequest } from 'next/server';
import { getAccountStore } from '@/lib/store';
import { createLogger } from '@/lib/pino-logger';
import { runChange2FAWorker } from '@/lib/change2fa-worker';
import type { PoolType } from '@/lib/browser-pool';

export const runtime = 'nodejs';

const log = createLogger('2fa');

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userEmail, poolType: rawPoolType } = body;

  if (!userEmail) {
    return new Response(JSON.stringify({ error: 'Missing userEmail' }), { status: 400 });
  }

  const account = await getAccountStore().getAccountByEmail(userEmail);
  if (!account) {
    return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404 });
  }

  const poolType: PoolType =
    rawPoolType === 'ephemeral' ? 'ephemeral'
    : rawPoolType === 'persistent' ? 'persistent'
    : 'gpm';

  const rlog = log.child({ email: account.email, id: account.id, poolType });
  rlog.info('2FA rotation requested');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream already closed */ }
      };

      send({ type: 'log', message: `🔐 Starting 2FA rotation for ${account.email}...` });

      const outcome = await runChange2FAWorker(
        account,
        poolType,
        (msg) => send({ type: 'log', message: msg }),
        rlog,
      );

      if (outcome.success) {
        send({ type: 'result', data: outcome });
      } else {
        send({ type: 'error', message: outcome.error });
      }

      send({ type: 'done' });
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
