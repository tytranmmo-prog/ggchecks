import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { update2FASecret } from '@/lib/sheets';
import { getAllConfigs, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, rowIndex, port } = body;

  if (!email || !password || !totpSecret || !rowIndex) {
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
          try {
            const result = JSON.parse(resultBuf.trim());

            if (result.success) {
              // Save the new TOTP secret to the spreadsheet
              try {
                await update2FASecret(rowIndex, result.newTotpSecret);
                send({ type: 'log', message: `✅ New secret saved to sheet: ${result.newTotpSecret}` });
              } catch (saveErr: unknown) {
                const msg = saveErr instanceof Error ? saveErr.message : 'Unknown';
                send({ type: 'log', message: `⚠️ Sheet save error: ${msg}` });
              }
              send({ type: 'result', data: result });
            } else {
              send({ type: 'error', message: result.error || `Script exited with code ${code}` });
            }
          } catch {
            const raw = resultBuf.trim().slice(0, 300);
            send({ type: 'error', message: `Parse error (exit ${code}): ${raw}` });
          }

          send({ type: 'done' });
          controller.close();
          resolveProc();
        });

        child.on('error', (err: Error) => {
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
