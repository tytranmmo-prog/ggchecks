import { NextRequest } from 'next/server';
import { updateCreditResult } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, rowIndex } = body;

  if (!email || !password || !totpSecret || !rowIndex) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  // CHECKER_PATH must be set in .env.local
  // e.g. CHECKER_PATH=/Users/you/ggchecks/checkOne.js
  const checkerPath = process.env.CHECKER_PATH;
  if (!checkerPath) {
    return new Response(JSON.stringify({ error: 'CHECKER_PATH env var not set in .env.local' }), { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Dynamic imports at call-time to keep Turbopack happy
      const cp = await import('child_process' as string);
      const spawn = cp.spawn;

      const accountJson = JSON.stringify({ email, password, totpSecret });
      const child = spawn('node', [checkerPath, accountJson], {
        env: { ...process.env } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resultBuf = '';

      (child.stderr as NodeJS.ReadableStream).on('data', (d: Buffer) => {
        const line = d.toString().trim();
        if (line) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`));
      });

      (child.stdout as NodeJS.ReadableStream).on('data', (d: Buffer) => { resultBuf += d.toString(); });

      await new Promise<void>((resolveProc) => {
        child.on('close', async (code: number) => {
          try {
            const result = JSON.parse(resultBuf.trim());
            if (result.success) {
              const memberText = (result.memberActivities || [])
                .map((m: { name: string; credit: number }) => `${m.name}: ${m.credit}`)
                .join(' | ');
              try {
                await updateCreditResult(rowIndex, {
                  monthlyCredits: result.monthlyCredits || '',
                  additionalCredits: result.additionalCredits || '',
                  additionalCreditsExpiry: result.additionalCreditsExpiry || '',
                  memberActivities: memberText,
                  lastChecked: result.checkAt || new Date().toISOString(),
                  status: 'ok',
                });
              } catch (saveErr: unknown) {
                const msg = saveErr instanceof Error ? saveErr.message : 'Unknown';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: `⚠️ Sheet save error: ${msg}` })}\n\n`));
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`));
            } else {
              await updateCreditResult(rowIndex, {
                monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
                memberActivities: '', lastChecked: new Date().toISOString(),
                status: `error: ${result.error}`,
              }).catch(() => {});
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: result.error })}\n\n`));
            }
          } catch {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: `Parse error (exit ${code})` })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
          resolveProc();
        });

        child.on('error', (err: Error) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
          resolveProc();
        });
      });
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
