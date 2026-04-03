import { getAccounts as getSheetAccounts, batchUpdateProxy } from '@/lib/sheets';
import { ensureSchema, getAccounts as getDbAccounts, deleteAccount } from '@/lib/db';
import { serviceAccounts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/lib/schema';
import { GpmLoginClient } from '@/lib/gpm-login';
import type { Profile } from '@/lib/gpm-login';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/pino-logger';

const log = createLogger('sync-from-sheet');

/** Must match GpmProfilePool.PROFILE_PREFIX exactly. */
const PROFILE_PREFIX = 'ggchecks::';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 5 });
  return drizzle(client, { schema });
}

/**
 * Load ALL ggchecks-owned GPM profiles in one paginated sweep.
 * Returns a Map<email, Profile> for O(1) lookup per account.
 */
async function loadAllGpmProfiles(gpm: GpmLoginClient): Promise<Map<string, Profile>> {
  const map = new Map<string, Profile>();
  let page = 1;

  for (;;) {
    const res = await gpm.profiles.list({ search: PROFILE_PREFIX, page, page_size: 100 });
    if (!res.success || !res.data) {
      log.warn('loadAllGpmProfiles | API call failed', { page });
      break;
    }

    for (const p of res.data.data) {
      if (p.name.startsWith(PROFILE_PREFIX)) {
        const email = p.name.slice(PROFILE_PREFIX.length);
        map.set(email, p);
      }
    }

    log.debug('loadAllGpmProfiles | page loaded', {
      page,
      lastPage: res.data.last_page,
      returned: res.data.data.length,
      totalInMap: map.size,
    });

    if (page >= res.data.last_page) break;
    page++;
  }

  return map;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

type EventType =
  | 'start'
  | 'gpm_prefetch'
  | 'db_insert'
  | 'db_update'
  | 'db_skip'
  | 'db_error'
  | 'gpm_create'
  | 'gpm_update'
  | 'gpm_skip'
  | 'gpm_error'
  | 'tombstone_gpm'
  | 'tombstone_db'
  | 'tombstone_error'
  | 'sheet_proxy_backfill'
  | 'done'
  | 'fatal';

interface SyncEvent {
  type: EventType;
  email?: string;
  message?: string;
  inserted?: number;
  updated?: number;
  deleted?: number;
  gpmCreated?: number;
  gpmUpdated?: number;
  gpmDeleted?: number;
  sheetProxyBackfilled?: number;
  errors?: string[];
}

function evt(controller: ReadableStreamDefaultController, payload: SyncEvent) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST() {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await ensureSchema();
        const db = getDb();

        const gpmBaseUrl = getConfig('GPM_BASE_URL') || 'http://127.0.0.1:9495';
        const gpm = new GpmLoginClient(gpmBaseUrl);

        // ── Prefetch GPM data ─────────────────────────────────────────────────
        let gpmProfiles = new Map<string, Profile>();
        let browserVersion: string | undefined;
        let gpmAvailable = true;

        try {
          evt(controller, { type: 'gpm_prefetch', message: 'Loading GPM profiles…' });
          [gpmProfiles] = await Promise.all([
            loadAllGpmProfiles(gpm),
            gpm.browsers.versions().then(r => {
              browserVersion = r.success && r.data?.chromium?.[0]
                ? r.data.chromium[0]
                : undefined;
            }),
          ]);
          evt(controller, {
            type: 'gpm_prefetch',
            message: `GPM ready — ${gpmProfiles.size} profiles loaded, browser v${browserVersion ?? 'default'}`,
          });
          log.info('GPM prefetch done', { profilesLoaded: gpmProfiles.size, browserVersion });
        } catch (gpmErr) {
          gpmAvailable = false;
          const msg = gpmErr instanceof Error ? gpmErr.message : String(gpmErr);
          evt(controller, { type: 'gpm_prefetch', message: `GPM unavailable — skipping GPM sync (${msg})` });
          log.warn('GPM prefetch failed', { err: msg });
        }

        // ── Read sheet ────────────────────────────────────────────────────────
        evt(controller, { type: 'start', message: 'Reading accounts from Google Sheet…' });
        const sheetAccounts = await getSheetAccounts();

        if (sheetAccounts.length === 0) {
          evt(controller, {
            type: 'done', message: 'No accounts found in sheet',
            inserted: 0, updated: 0, deleted: 0,
            gpmCreated: 0, gpmUpdated: 0, gpmDeleted: 0,
          });
          controller.close();
          return;
        }

        evt(controller, { type: 'start', message: `Found ${sheetAccounts.length} accounts in sheet` });

        let inserted = 0, updated = 0, deleted = 0;
        let gpmCreated = 0, gpmUpdated = 0, gpmDeleted = 0;
        const errors: string[] = [];

        // Rows where sheet proxy is empty but DB has one — collected for bulk backfill at end
        const proxyBackfillQueue: Array<{ email: string; rowIndex: number; proxy: string }> = [];

        // ── Step 1: Upsert sheet accounts → DB + GPM ──────────────────────────
        for (const sa of sheetAccounts) {
          const { email, password, totpSecret } = sa;
          const proxy: string | null = sa.proxy || null;

          if (!email || !password || !totpSecret) {
            const msg = `Skipped row with missing fields (email=${email})`;
            errors.push(msg);
            evt(controller, { type: 'db_skip', email, message: 'missing required fields' });
            continue;
          }

          // DB upsert
          try {
            const existing = await db
              .select({
                id:         serviceAccounts.id,
                password:   serviceAccounts.password,
                totpSecret: serviceAccounts.totpSecret,
                proxy:      serviceAccounts.proxy,
              })
              .from(serviceAccounts)
              .where(eq(serviceAccounts.email, email))
              .limit(1);

            if (existing.length > 0) {
              const dbRow = existing[0];
              const dbProxy = dbRow.proxy ?? null;

              // Proxy backfill: sheet has no proxy but DB does
              if (!proxy && dbProxy) {
                proxyBackfillQueue.push({ email, rowIndex: sa.rowIndex, proxy: dbProxy });
                log.debug('proxy backfill queued', { email, dbProxy });
              }

              // Only write to DB when something actually changed
              const changed: Record<string, unknown> = {};
              if (password   !== dbRow.password)   changed.password   = password;
              if (totpSecret !== dbRow.totpSecret)  changed.totpSecret = totpSecret;
              if (proxy !== null && proxy !== dbProxy) changed.proxy   = proxy;

              if (Object.keys(changed).length > 0) {
                await db
                  .update(serviceAccounts)
                  .set({ ...changed, updatedAt: new Date() })
                  .where(eq(serviceAccounts.email, email));
                updated++;
                const what = Object.keys(changed).join(', ');
                evt(controller, { type: 'db_update', email, message: `updated: ${what}` });
                log.info('DB updated from sheet', { email, changed: what });
              } else {
                evt(controller, { type: 'db_skip', email, message: 'no changes detected' });
                log.debug('DB row unchanged, skipped', { email });
              }

            } else {
              await db.insert(serviceAccounts).values({
                email,
                password,
                totpSecret,
                ...(proxy ? { proxy } : {}),
              });
              inserted++;
              evt(controller, { type: 'db_insert', email, message: 'account inserted' });
              log.info('DB inserted from sheet', { email });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`DB upsert ${email}: ${msg}`);
            evt(controller, { type: 'db_error', email, message: msg });
            log.error('DB upsert failed', { email, err: msg });
          }

          // GPM profile: create if missing, update proxy if changed
          if (gpmAvailable) {
            try {
              const profileName = `${PROFILE_PREFIX}${email}`;
              const existing = gpmProfiles.get(email);

              if (existing) {
                const wantProxy = proxy ?? '';
                const haveProxy = existing.raw_proxy ?? '';
                if (wantProxy !== haveProxy) {
                  await gpm.profiles.update(existing.id, { raw_proxy: wantProxy });
                  gpmUpdated++;
                  evt(controller, { type: 'gpm_update', email, message: `proxy updated → ${wantProxy || '(none)'}` });
                  log.info('GPM profile proxy updated', { email, profileId: existing.id });
                } else {
                  evt(controller, { type: 'gpm_skip', email, message: 'proxy unchanged' });
                  log.debug('GPM profile up-to-date', { email });
                }
              } else {
                const res = await gpm.profiles.create({
                  name: profileName,
                  ...(proxy ? { raw_proxy: proxy } : {}),
                  ...(browserVersion ? { browser_version: browserVersion } : {}),
                });
                if (res.success && res.data) {
                  gpmProfiles.set(email, res.data);
                  gpmCreated++;
                  evt(controller, { type: 'gpm_create', email, message: `profile created (id: ${res.data.id})` });
                  log.info('GPM profile created', { email, profileId: res.data.id });
                } else {
                  throw new Error(res.message || 'create returned no data');
                }
              }
            } catch (gpmErr: unknown) {
              const msg = gpmErr instanceof Error ? gpmErr.message : String(gpmErr);
              errors.push(`GPM profile for ${email}: ${msg}`);
              evt(controller, { type: 'gpm_error', email, message: msg });
              log.warn('GPM profile create/update failed (non-fatal)', { email, err: msg });
            }
          }
        }

        // ── Step 2: Tombstone orphaned accounts ─────────────────────────────
        const sheetEmailSet = new Set(sheetAccounts.map(a => a.email));
        const allDbAccounts = await getDbAccounts();
        const orphaned = allDbAccounts.filter(a => !sheetEmailSet.has(a.email));

        if (orphaned.length > 0) {
          evt(controller, { type: 'start', message: `Tombstoning ${orphaned.length} orphaned account(s)…` });
        }

        for (const orphan of orphaned) {
          if (gpmAvailable) {
            try {
              const profile = gpmProfiles.get(orphan.email);
              if (profile) {
                await gpm.profiles.delete(profile.id);
                gpmProfiles.delete(orphan.email);
                gpmDeleted++;
                evt(controller, { type: 'tombstone_gpm', email: orphan.email, message: `GPM profile deleted (id: ${profile.id})` });
                log.info('GPM profile deleted for orphan', { email: orphan.email, profileId: profile.id });
              } else {
                evt(controller, { type: 'gpm_skip', email: orphan.email, message: 'no GPM profile to delete' });
              }
            } catch (gpmErr: unknown) {
              const msg = gpmErr instanceof Error ? gpmErr.message : String(gpmErr);
              errors.push(`GPM delete for ${orphan.email}: ${msg}`);
              evt(controller, { type: 'tombstone_error', email: orphan.email, message: msg });
              log.warn('GPM profile delete failed (non-fatal)', { email: orphan.email, err: msg });
            }
          }

          try {
            await deleteAccount(orphan.id);
            deleted++;
            evt(controller, { type: 'tombstone_db', email: orphan.email, message: 'account removed from DB' });
            log.info('Tombstoned orphaned account', { email: orphan.email, id: orphan.id });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Tombstone DB ${orphan.email}: ${msg}`);
            evt(controller, { type: 'tombstone_error', email: orphan.email, message: msg });
            log.error('Tombstone DB delete failed', { email: orphan.email, err: msg });
          }
        }

        // ── Step 3: Backfill proxy values to sheet — single API call ─────────
        // All accounts missing a sheet proxy but with a DB proxy are queued
        // above. We flush them in one batchUpdateProxy call (loadCells +
        // saveUpdatedCells) to stay within Google Sheets API quota.
        let sheetProxyBackfilled = 0;
        if (proxyBackfillQueue.length > 0) {
          evt(controller, {
            type:    'start',
            message: `Backfilling proxy to sheet for ${proxyBackfillQueue.length} account(s)…`,
          });
          try {
            await batchUpdateProxy(
              proxyBackfillQueue.map(e => ({ rowIndex: e.rowIndex, proxy: e.proxy })),
            );
            sheetProxyBackfilled = proxyBackfillQueue.length;
            for (const entry of proxyBackfillQueue) {
              evt(controller, {
                type:    'sheet_proxy_backfill',
                email:   entry.email,
                message: `proxy written to sheet row ${entry.rowIndex} → ${entry.proxy}`,
              });
            }
            log.info('batch sheet proxy backfill done', { count: sheetProxyBackfilled });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Sheet proxy batch backfill: ${msg}`);
            evt(controller, { type: 'sheet_proxy_backfill', message: `error: ${msg}` });
            log.error('batch sheet proxy backfill failed', { err: msg });
          }
        }

        const message = [
          `${inserted} inserted, ${updated} updated, ${deleted} deleted`,
          `GPM: ${gpmCreated} created, ${gpmUpdated} updated, ${gpmDeleted} deleted`,
          ...(sheetProxyBackfilled > 0 ? [`Sheet proxy backfilled: ${sheetProxyBackfilled}`] : []),
        ].join(' | ');

        evt(controller, {
          type: 'done', message,
          inserted, updated, deleted,
          gpmCreated, gpmUpdated, gpmDeleted,
          sheetProxyBackfilled,
          errors: errors.length > 0 ? errors : undefined,
        });

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error('sync-from-sheet failed', { err: message });
        evt(controller, { type: 'fatal', message });
      } finally {
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
