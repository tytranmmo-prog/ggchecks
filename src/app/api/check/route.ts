import { NextRequest } from 'next/server';
import { updateCreditResult } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, rowIndex, debugPort } = body;

  if (!email || !password || !totpSecret || !rowIndex) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const cwd = process.cwd();
      const scriptPath = process.env.CHECKER_PATH ?? `${cwd}/checkOne.ts`;

      // Stealth mode: include debugPort so checkOne.ts uses connectOverCDP
      const accountData: Record<string, unknown> = { email, password, totpSecret };
      if (debugPort) accountData.debugPort = Number(debugPort);

      // Use exec (shell string) so Turbopack doesn't analyze args as module paths
      const { exec } = await import('child_process' as string);

      // Safely pass account JSON via environment variable to avoid shell injection
      const env = { ...process.env, ACCOUNT_JSON: JSON.stringify(accountData) };

      // Stealth mode needs npx tsx (Node) — connectOverCDP doesn't work in Bun's WS impl
      const cmd = debugPort
        ? `npx tsx "${scriptPath}"`
        : `bun "${scriptPath}"`;

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
