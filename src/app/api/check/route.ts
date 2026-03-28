import { exec }        from 'child_process';
import { NextRequest } from 'next/server';
import { updateCreditResult, uploadScreenshotToDrive, updateErrorScreenshot } from '@/lib/sheets';
import { getPool } from '@/lib/browser-pool';

export const runtime = 'nodejs';

const log = (...args: unknown[]) =>
  console.log(`[check ${new Date().toISOString()}]`, ...args);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, rowIndex } = body;

  if (!email || !password || !totpSecret || !rowIndex) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const encoder    = new TextEncoder();
  const scriptPath = process.env.CHECKER_PATH ?? `${process.cwd()}/checkOne.ts`;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream already closed */ }
      };

      let cleanup = () => {};

      try {
        send({ type: 'log', message: `Waiting for Chrome profile slot...` });
        const pool = await getPool('persistent');
        const { port, release } = await pool.acquire(email);
        cleanup = () => release().catch(e => log(`[${email}] release error:`, e));

        send({ type: 'log', message: `Acquired slot on debug port ${port}.` });

        const accountData: Record<string, unknown> = { email, password, totpSecret, debugPort: port };
        const env = { ...process.env, ACCOUNT_JSON: JSON.stringify(accountData) };
        const cmd = `npx tsx "${scriptPath}"`;

        log(`spawning: ${cmd}`);

        await new Promise<void>((resolveProc) => {
          const child = exec(cmd, {
            env:       env as NodeJS.ProcessEnv,
            timeout:   120_000,
            maxBuffer: 10 * 1024 * 1024,
          });

        // stderr → log events (live streaming)
        child.stderr?.on('data', (d: string | Buffer) => {
          const lines = d.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            send({ type: 'log', message: line });
          }
        });

        // stdout → accumulate for final JSON parse
        let resultBuf = '';
        child.stdout?.on('data', (d: string | Buffer) => { resultBuf += d.toString(); });

        child.on('error', (err: Error) => {
          log(`child error for ${email}:`, err.message);
          send({ type: 'error', message: err.message });
          resolveProc();
        });

        child.on('close', async (code: number | null) => {
          log(`checker exited code=${code} stdout=${resultBuf.length}b`);
          try {
            const raw = resultBuf.trim();
            if (!raw) {
              throw new Error(`Empty stdout from checker (exit ${code})`);
            }
            const result = JSON.parse(raw);

            if (result.success) {
              const memberText = (result.memberActivities || [])
                .map((m: { name: string; credit: number }) => `${m.name}: ${m.credit}`)
                .join(' | ');
              try {
                await updateCreditResult(rowIndex, {
                  monthlyCredits:          result.monthlyCredits          || '',
                  additionalCredits:       result.additionalCredits       || '',
                  additionalCreditsExpiry: result.additionalCreditsExpiry || '',
                  memberActivities:        memberText,
                  lastChecked:             result.checkAt                 || new Date().toISOString(),
                  status:                  'ok',
                });
              } catch (saveErr: unknown) {
                const msg = saveErr instanceof Error ? saveErr.message : 'Unknown';
                send({ type: 'log', message: `⚠️ Sheet save error: ${msg}` });
              }
              send({ type: 'result', data: result });
            } else {
              let screenshotUrl: string | undefined;
              if (result.screenshotPath) {
                // Just map it directly to the public path
                screenshotUrl = `/screenshots/${result.screenshotPath.split('/').pop()}`;
                send({ type: 'log', message: `📸 Screenshot saved locally as ${screenshotUrl}` });
              }

              await updateCreditResult(rowIndex, {
                monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
                memberActivities: '', lastChecked: new Date().toISOString(),
                status: `error: ${result.error}`,
              }).catch(() => {});

              // We no longer update the sheet with a screenshot URL since we serve it locally.
              // if (screenshotUrl) {
              //   await updateErrorScreenshot(rowIndex, screenshotUrl).catch(() => {});
              // }

              send({ type: 'error', message: result.error, screenshotUrl });
            }
          } catch (parseErr) {
            const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            const preview = resultBuf.slice(0, 300);
            send({ type: 'error', message: `${msg}${preview ? ` | stdout: ${preview}` : ''}` });
          }

          resolveProc();
        });
      });
      } catch (poolErr) {
        const msg = poolErr instanceof Error ? poolErr.message : String(poolErr);
        send({ type: 'error', message: msg });
      } finally {
        cleanup();
        send({ type: 'done' });
        controller.close();
      }
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
