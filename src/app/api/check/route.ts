import { NextRequest } from 'next/server';
import { getAccountStore } from '@/lib/store';
import { createLogger } from '@/lib/pino-logger';
import { runCheckWorker } from '@/lib/check-worker';

export const runtime = 'nodejs';

const log = createLogger('check');

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userEmail } = body;

  if (!userEmail) {
    return new Response(JSON.stringify({ error: 'Missing userEmail' }), { status: 400 });
  }

  const account = await getAccountStore().getAccountByEmail(userEmail);
  if (!account) {
    return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404 });
  }

  const rlog = log.child({ email: account.email, id: account.id });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream already closed */ }
      };

      const outcome = await runCheckWorker(
        account,
        'gpm',
        (msg) => send({ type: 'log', message: msg }),
        rlog,
      );

      if (outcome.success) {
        send({ type: 'result', data: outcome });
      } else {
        send({ type: 'error', message: outcome.error, screenshotUrl: outcome.screenshotUrl });
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