import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import * as schema from './schema';
import { serviceAccounts, checkResults } from './schema';
import type { MemberActivity } from './schema';
import { createLogger } from './pino-logger';

export type { MemberActivity };

const log = createLogger('db');

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __drizzleDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getDb() {
  if (!global.__drizzleDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set in environment');

    const client = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: (n) => log.debug('pg notice', { message: n.message }),
    });

    global.__drizzleDb = drizzle(client, { schema });
    log.info('Drizzle ORM initialized');
  }
  return global.__drizzleDb;
}

// ── Schema guard ──────────────────────────────────────────────────────────────

let schemaVerified = false;

export async function ensureSchema() {
  if (schemaVerified) return;
  const db = getDb();
  const res = await db.execute(sql`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('service_accounts', 'check_results')
  `);
  if (Number(res[0].n) < 2) {
    throw new Error(
      'Database tables are missing. Run the migration script first.',
    );
  }
  schemaVerified = true;
  log.info('Database schema verified');
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface Account {
  id:                      number;
  email:                   string;
  password:                string;
  totpSecret:              string;
  proxy:                   string | null;
  monthlyCredits:          string;
  additionalCredits:       string;
  additionalCreditsExpiry: string;
  memberActivities:        MemberActivity[];
  lastChecked:             string;
  status:                  string;
  screenshot:              string;
}

export interface CheckHistoryItem {
  id:                      number;
  monthlyCredits:          string;
  additionalCredits:       string;
  additionalCreditsExpiry: string;
  memberActivities:        MemberActivity[];
  lastChecked:             string;
  status:                  string;
  screenshot:              string;
  createdAt:               string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(d: Date | string | null | undefined): string {
  if (!d) return '';
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Returns each service_account with the latest check_result joined in.
 * Uses DISTINCT ON subquery so Drizzle returns one row per account.
 */
export async function getAccounts(): Promise<Account[]> {
  await ensureSchema();
  const db = getDb();

  // Subquery: latest check_result per service_account
  const latestCr = db
    .selectDistinctOn([checkResults.serviceAccountId], {
      serviceAccountId:        checkResults.serviceAccountId,
      monthlyCredits:          checkResults.monthlyCredits,
      additionalCredits:       checkResults.additionalCredits,
      additionalCreditsExpiry: checkResults.additionalCreditsExpiry,
      memberActivities:        checkResults.memberActivities,
      lastChecked:             checkResults.lastChecked,
      status:                  checkResults.status,
      screenshot:              checkResults.screenshot,
    })
    .from(checkResults)
    .orderBy(checkResults.serviceAccountId, desc(checkResults.createdAt))
    .as('latest_cr');

  const rows = await db
    .select({
      id:                      serviceAccounts.id,
      email:                   serviceAccounts.email,
      password:                serviceAccounts.password,
      totpSecret:              serviceAccounts.totpSecret,
      proxy:                   serviceAccounts.proxy,
      monthlyCredits:          latestCr.monthlyCredits,
      additionalCredits:       latestCr.additionalCredits,
      additionalCreditsExpiry: latestCr.additionalCreditsExpiry,
      memberActivities:        latestCr.memberActivities,
      lastChecked:             latestCr.lastChecked,
      status:                  latestCr.status,
      screenshot:              latestCr.screenshot,
    })
    .from(serviceAccounts)
    .leftJoin(latestCr, eq(serviceAccounts.id, latestCr.serviceAccountId))
    .orderBy(asc(serviceAccounts.id));

  return rows.map(r => ({
    id:                      r.id,
    email:                   r.email,
    password:                r.password,
    totpSecret:              r.totpSecret,
    proxy:                   r.proxy,
    monthlyCredits:          r.monthlyCredits          ?? '',
    additionalCredits:       r.additionalCredits       ?? '',
    additionalCreditsExpiry: r.additionalCreditsExpiry ?? '',
    memberActivities:        (r.memberActivities as MemberActivity[]) ?? [],
    lastChecked:             toIso(r.lastChecked),
    status:                  r.status                  ?? 'pending',
    screenshot:              r.screenshot              ?? '',
  }));
}

export async function getAccountById(id: number): Promise<Account | null> {
  await ensureSchema();
  const db = getDb();

  const latestCr = db
    .selectDistinctOn([checkResults.serviceAccountId], {
      serviceAccountId:        checkResults.serviceAccountId,
      monthlyCredits:          checkResults.monthlyCredits,
      additionalCredits:       checkResults.additionalCredits,
      additionalCreditsExpiry: checkResults.additionalCreditsExpiry,
      memberActivities:        checkResults.memberActivities,
      lastChecked:             checkResults.lastChecked,
      status:                  checkResults.status,
      screenshot:              checkResults.screenshot,
    })
    .from(checkResults)
    .where(eq(checkResults.serviceAccountId, id))
    .orderBy(checkResults.serviceAccountId, desc(checkResults.createdAt))
    .as('latest_cr');

  const rows = await db
    .select({
      id:                      serviceAccounts.id,
      email:                   serviceAccounts.email,
      password:                serviceAccounts.password,
      totpSecret:              serviceAccounts.totpSecret,
      proxy:                   serviceAccounts.proxy,
      monthlyCredits:          latestCr.monthlyCredits,
      additionalCredits:       latestCr.additionalCredits,
      additionalCreditsExpiry: latestCr.additionalCreditsExpiry,
      memberActivities:        latestCr.memberActivities,
      lastChecked:             latestCr.lastChecked,
      status:                  latestCr.status,
      screenshot:              latestCr.screenshot,
    })
    .from(serviceAccounts)
    .leftJoin(latestCr, eq(serviceAccounts.id, latestCr.serviceAccountId))
    .where(eq(serviceAccounts.id, id))
    .limit(1);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id:                      r.id,
    email:                   r.email,
    password:                r.password,
    totpSecret:              r.totpSecret,
    proxy:                   r.proxy,
    monthlyCredits:          r.monthlyCredits          ?? '',
    additionalCredits:       r.additionalCredits       ?? '',
    additionalCreditsExpiry: r.additionalCreditsExpiry ?? '',
    memberActivities:        (r.memberActivities as MemberActivity[]) ?? [],
    lastChecked:             toIso(r.lastChecked),
    status:                  r.status                  ?? 'pending',
    screenshot:              r.screenshot              ?? '',
  };
}

export async function addAccount(account: {
  email:      string;
  password:   string;
  totpSecret: string;
  proxy?:     string;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.insert(serviceAccounts).values({
    email:      account.email,
    password:   account.password,
    totpSecret: account.totpSecret,
    ...(account.proxy ? { proxy: account.proxy } : {}),
  });
  log.info('account added', { email: account.email });
}

/** Appends a new check_result row — full history preserved. */
export async function updateCreditResult(
  serviceAccountId: number,
  data: {
    monthlyCredits:          string;
    additionalCredits:       string;
    additionalCreditsExpiry: string;
    memberActivities:        MemberActivity[];
    lastChecked:             string;
    status:                  string;
    screenshot?:             string;
  },
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.insert(checkResults).values({
    serviceAccountId,
    monthlyCredits:          data.monthlyCredits,
    additionalCredits:       data.additionalCredits,
    additionalCreditsExpiry: data.additionalCreditsExpiry,
    memberActivities:        data.memberActivities,
    lastChecked:             data.lastChecked ? new Date(data.lastChecked) : new Date(),
    status:                  data.status,
    screenshot:              data.screenshot ?? '',
  });
  log.debug('check result recorded', { serviceAccountId, status: data.status });
}

export async function update2FASecret(id: number, totpSecret: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const result = await db
    .update(serviceAccounts)
    .set({ totpSecret, updatedAt: new Date() })
    .where(eq(serviceAccounts.id, id));
  if (result.count === 0) throw new Error(`Account id=${id} not found`);
  log.info('2FA secret updated', { id });
}

export async function updateAccountProxy(email: string, proxyString: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const result = await db
    .update(serviceAccounts)
    .set({ proxy: proxyString, updatedAt: new Date() })
    .where(eq(serviceAccounts.email, email));
  if (result.count === 0) throw new Error(`Account email=${email} not found`);
  log.info('proxy updated', { email });
}

export async function deleteAccount(id: number): Promise<void> {
  await ensureSchema();
  const db = getDb();
  // check_results deleted via ON DELETE CASCADE
  const result = await db
    .delete(serviceAccounts)
    .where(eq(serviceAccounts.id, id));
  if (result.count === 0) throw new Error(`Account id=${id} not found`);
  log.info('account deleted', { id });
}

// ── History ───────────────────────────────────────────────────────────────────

/** Cursor-based paginated check history for one service account (newest first). */
export async function getCheckHistory(opts: {
  serviceAccountId: number;
  cursor:           number; // last id seen; 0 = first page
  limit:            number;
}): Promise<{ items: CheckHistoryItem[]; nextCursor: number | null; hasMore: boolean }> {
  await ensureSchema();
  const db = getDb();

  const where = opts.cursor > 0
    ? and(
        eq(checkResults.serviceAccountId, opts.serviceAccountId),
        lt(checkResults.id, opts.cursor),
      )
    : eq(checkResults.serviceAccountId, opts.serviceAccountId);

  const rows = await db
    .select()
    .from(checkResults)
    .where(where)
    .orderBy(desc(checkResults.id))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const items   = (hasMore ? rows.slice(0, opts.limit) : rows).map(r => ({
    id:                      r.id,
    monthlyCredits:          r.monthlyCredits,
    additionalCredits:       r.additionalCredits,
    additionalCreditsExpiry: r.additionalCreditsExpiry,
    memberActivities:        (r.memberActivities as MemberActivity[]) ?? [],
    lastChecked:             toIso(r.lastChecked),
    status:                  r.status,
    screenshot:              r.screenshot,
    createdAt:               toIso(r.createdAt),
  }));

  return { items, nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/** Total credits consumed per member name within a date range. */
export async function getMemberCreditTotals(opts: {
  from: Date;
  to:   Date;
}): Promise<{ memberEmail: string; totalCredits: number; checkCount: number }[]> {
  await ensureSchema();
  const db = getDb();

  // jsonb_array_elements requires raw SQL
  const rows = await db.execute(sql`
    SELECT
      COALESCE(activity->>'email', activity->>'name') AS member_email,
      SUM((activity->>'credit')::numeric)             AS total_credits,
      COUNT(*)::int                                   AS check_count
    FROM check_results cr,
      jsonb_array_elements(cr.member_activities) AS activity
    WHERE cr.created_at BETWEEN ${opts.from} AND ${opts.to}
      AND cr.status = 'ok'
    GROUP BY COALESCE(activity->>'email', activity->>'name')
    ORDER BY total_credits DESC
  `);

  return rows.map(r => ({
    memberEmail:  r.member_email  as string,
    totalCredits: Number(r.total_credits),
    checkCount:   Number(r.check_count),
  }));
}
