import { NextRequest } from 'next/server';
import { updateCreditResult } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, rowIndex } = body;

  if (!email || !password || !totpSecret || !rowIndex) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // checkOne.js is at the project root
      const cwd = process.cwd();
      const scriptPath = process.env.CHECKER_PATH ?? `${cwd}/checkOne.js`;
      const accountData = { email, password, totpSecret };

      // Use exec (shell string) so Turbopack doesn't analyze args as module paths
      const { exec } = await import('child_process' as string);

      // Safely pass account JSON via environment variable to avoid shell injection
      const env = { ...process.env, ACCOUNT_JSON: JSON.stringify(accountData) };

      // The script reads from ACCOUNT_JSON env var; pass a placeholder arg for compat
      // Actually we pass it as a base64 env var and update checkOne.js to support it
      const cmd = `node "${scriptPath}" "$ACCOUNT_JSON"`;

      const child = exec(cmd, { env: env as NodeJS.ProcessEnv, maxBuffer: 10 * 1024 * 1024 });

      child.stderr?.on('data', (d: string | Buffer) => {
        const lines = d.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`));
        }
      });

      let resultBuf = '';
      child.stdout?.on('data', (d: string | Buffer) => { resultBuf += d.toString(); });

      await new Promise<void>((resolveProc) => {
        child.on('close', async (code: number | null) => {
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
