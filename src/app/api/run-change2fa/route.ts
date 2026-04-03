import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import { update2FASecret } from '@/lib/db';
import { getAccounts as getSheetAccounts, update2FASecret as updateSheetSecret } from '@/lib/sheets';
import { getAllConfigs, getConfig } from '@/lib/config';
import { createLogger } from '@/lib/pino-logger';
import { getPool, type PoolType } from '@/lib/browser-pool';

export const runtime = 'nodejs';

const log = createLogger('2fa');

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, totpSecret, id, poolType: rawPoolType } = body;

  if (!email || !password || !totpSecret || !id) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  // Resolve pool type — default to 'gpm' to match bulk-check behaviour.
  const poolType: PoolType =
    rawPoolType === 'ephemeral' ? 'ephemeral'
    : rawPoolType === 'persistent' ? 'persistent'
    : 'gpm';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const cwd        = process.cwd();
      const scriptPath = getConfig('CHANGE2FA_PATH') || `${cwd}/change2fa.ts`;

      const rlog = log.child({ email, id, poolType });
      rlog.info('2FA rotation requested', { scriptPath, poolType });

      send({ type: 'log', message: `🔐 Starting 2FA rotation for ${email}...` });

      // ── Acquire a GPM browser handle (or fall through to standalone) ───────
      let handle: { port: number; release: () => Promise<void> } | null = null;

      if (poolType !== 'ephemeral') {
        try {
          send({ type: 'log', message: `🌐 Acquiring ${poolType} browser profile...` });
          const pool = await getPool(poolType);
          rlog.info('pool ready', { type: pool.type, concurrency: pool.concurrency });
          handle = await pool.acquire(email);
          rlog.info('browser handle acquired', { port: handle.port });
          send({ type: 'log', message: `✅ Browser ready on port ${handle.port}` });
        } catch (poolErr: unknown) {
          const msg = poolErr instanceof Error ? poolErr.message : String(poolErr);
          rlog.error('pool acquire failed — falling back to standalone', { err: msg });
          send({ type: 'log', message: `⚠️ Pool acquire failed (${msg}) — using standalone browser` });
          handle = null;
        }
      }

      // Build account payload; inject debugPort when we have a handle.
      const accountData: Record<string, unknown> = {
        email,
        password,
        totpSecret,
        ...(handle ? { debugPort: handle.port } : {}),
      };

      const env = { ...process.env, ...getAllConfigs(), ACCOUNT_JSON: JSON.stringify(accountData) };
      const cmd = `npx tsx "${scriptPath}"`;

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

          // ── Release browser handle before processing result ──────────────
          if (handle) {
            try {
              rlog.info('releasing browser handle', { port: handle.port });
              await handle.release();
              rlog.info('browser handle released');
            } catch (relErr: unknown) {
              const msg = relErr instanceof Error ? relErr.message : String(relErr);
              rlog.warn('release failed (non-fatal)', { err: msg });
            }
            handle = null;
          }

          try {
            const result = JSON.parse(resultBuf.trim());

            if (result.success) {
              rlog.info('2fa rotation succeeded', { newSecret: result.newTotpSecret ? '***' : 'none' });
              try {
                await update2FASecret(id, result.newTotpSecret);
                send({ type: 'log', message: `✅ New secret saved to DB: ${result.newTotpSecret}` });
              } catch (saveErr: unknown) {
                const msg = saveErr instanceof Error ? saveErr.message : 'Unknown';
                rlog.error('db save error', { err: msg });
                send({ type: 'log', message: `⚠️ DB save error: ${msg}` });
              }

              // Sync new secret to Google Sheet (non-fatal)
              try {
                send({ type: 'log', message: `🔄 Syncing new secret to Google Sheet...` });
                const sheetAccounts = await getSheetAccounts();
                const sheetRow = sheetAccounts.find(a => a.email === email);
                if (sheetRow) {
                  await updateSheetSecret(sheetRow.rowIndex, result.newTotpSecret);
                  rlog.info('sheet secret synced', { email, rowIndex: sheetRow.rowIndex });
                  send({ type: 'log', message: `✅ Google Sheet updated (row ${sheetRow.rowIndex})` });
                } else {
                  rlog.warn('account not found in sheet — skipping sheet sync', { email });
                  send({ type: 'log', message: `⚠️ Account not found in Google Sheet — skipped sheet sync` });
                }
              } catch (sheetErr: unknown) {
                const msg = sheetErr instanceof Error ? sheetErr.message : 'Unknown';
                rlog.warn('sheet sync failed (non-fatal)', { err: msg });
                send({ type: 'log', message: `⚠️ Sheet sync failed (non-fatal): ${msg}` });
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

        child.on('error', async (err: Error) => {
          rlog.error('child process error', { err: err.message });
          if (handle) {
            await handle.release().catch(() => {});
            handle = null;
          }
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
