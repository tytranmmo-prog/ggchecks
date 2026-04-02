import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { update2FASecret } from '@/lib/db';
import { getAllConfigs, getConfig } from '@/lib/config';
import { createLogger } from '@/lib/pino-logger';

export const runtime = 'nodejs';

const log = createLogger('2fa');

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, id, port } = body;

  if (!email || !password || !totpSecret || !id) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const cwd = process.cwd();
      const scriptPath = getConfig('CHANGE2FA_PATH') || `${cwd}/change2fa.ts`;
      const accountData: Record<string, unknown> = { email, password, totpSecret, debugPort: port };

      // Bind email + id for every server-side log in this request.
      const rlog = log.child({ email, id, port });
      rlog.info('2FA rotation requested', { scriptPath });

      const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };
      const cmd = `npx tsx "${scriptPath}"`;

      send({ type: 'log', message: `🔐 Starting 2FA rotation for ${email}...` });

      const child = exec(cmd, {
        env: env as NodeJS.ProcessEnv,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Stream stderr (debug/progress logs) to client
      child.stderr?.on('data', (d: string | Buffer) => {
        const lines = d.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          send({ type: 'log', message: line });
        }
      });

      // Collect stdout (JSON result)
      let resultBuf = '';
      child.stdout?.on('data', (d: string | Buffer) => { resultBuf += d.toString(); });

      await new Promise<void>((resolveProc) => {
        child.on('close', async (code: number | null) => {
          rlog.info('2fa script exited', { code, stdoutBytes: resultBuf.length });
          try {
            const result = JSON.parse(resultBuf.trim());

            if (result.success) {
              rlog.info('2fa rotation succeeded', { newSecret: result.newTotpSecret ? '***' : 'none' });
              try {
                await update2FASecret(id, result.newTotpSecret);
                send({ type: 'log', message: `✅ New secret saved: ${result.newTotpSecret}` });
              } catch (saveErr: unknown) {
                const msg = saveErr instanceof Error ? saveErr.message : 'Unknown';
                rlog.error('sheet save error', { err: msg });
                send({ type: 'log', message: `⚠️ Sheet save error: ${msg}` });
              }
              send({ type: 'result', data: result });
            } else {
              const errMsg = result.error || `Script exited with code ${code}`;
              rlog.error('2fa rotation failed', { err: errMsg });
              send({ type: 'error', message: errMsg });
            }
          } catch {
            const raw = resultBuf.trim().slice(0, 300);
            rlog.error('output parse error', { code, preview: raw });
            send({ type: 'error', message: `Parse error (exit ${code}): ${raw}` });
          }

          send({ type: 'done' });
          controller.close();
          resolveProc();
        });

        child.on('error', (err: Error) => {
          rlog.error('child process error', { err: err.message });
          send({ type: 'error', message: err.message });
          send({ type: 'done' });
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
