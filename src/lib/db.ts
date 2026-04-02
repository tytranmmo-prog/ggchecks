import postgres from 'postgres';
import { createLogger } from './pino-logger';

const log = createLogger('db');

// ── Connection ─────────────────────────────────────────────────────────────────
// Lazily initialised singleton — reused across hot-reloads in dev.

declare global {
  // eslint-disable-next-line no-var
  var __pgSql: ReturnType<typeof postgres> | undefined;
}

function getSql() {
  if (!global.__pgSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set in environment');

    global.__pgSql = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: (notice) => log.debug('pg notice', { message: notice.message }),
    });

    log.info('PostgreSQL connection pool created');
  }
  return global.__pgSql;
}

// ── Schema ─────────────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS accounts (
    id                        BIGSERIAL PRIMARY KEY,
    email                     TEXT NOT NULL UNIQUE,
    password                  TEXT NOT NULL,
    totp_secret               TEXT NOT NULL,
    monthly_credits           TEXT NOT NULL DEFAULT '',
    additional_credits        TEXT NOT NULL DEFAULT '',
    additional_credits_expiry TEXT NOT NULL DEFAULT '',
    member_activities         TEXT NOT NULL DEFAULT '',
    last_checked              TEXT NOT NULL DEFAULT '',
    status                    TEXT NOT NULL DEFAULT 'pending',
    screenshot                TEXT NOT NULL DEFAULT '',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

let schemaInitialised = false;

async function ensureSchema() {
  if (schemaInitialised) return;
  const sql = getSql();
  await sql.unsafe(CREATE_TABLE_SQL);
  schemaInitialised = true;
  log.info('Database schema ready');
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Account {
  id: number;
  email: string;
  password: string;
  totpSecret: string;
  monthlyCredits?: string;
  additionalCredits?: string;
  additionalCreditsExpiry?: string;
  memberActivities?: string;
  lastChecked?: string;
  status?: string;
  screenshot?: string;
}

// ── Row mapper ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccount(row: any): Account {
  return {
    id:                       Number(row.id),
    email:                    row.email ?? '',
    password:                 row.password ?? '',
    totpSecret:               row.totp_secret ?? '',
    monthlyCredits:           row.monthly_credits ?? '',
    additionalCredits:        row.additional_credits ?? '',
    additionalCreditsExpiry:  row.additional_credits_expiry ?? '',
    memberActivities:         row.member_activities ?? '',
    lastChecked:              row.last_checked ?? '',
    status:                   row.status ?? 'pending',
    screenshot:               row.screenshot ?? '',
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<Account[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM accounts ORDER BY id ASC`;
  return rows.map(toAccount);
}

export async function getAccountById(id: number): Promise<Account | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM accounts WHERE id = ${id}`;
  return rows.length ? toAccount(rows[0]) : null;
}

export async function addAccount(account: {
  email: string;
  password: string;
  totpSecret: string;
}): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO accounts (email, password, totp_secret, status)
    VALUES (${account.email}, ${account.password}, ${account.totpSecret}, 'pending')
  `;
  log.info('account added', { email: account.email });
}

export async function updateCreditResult(
  id: number,
  data: {
    monthlyCredits: string;
    additionalCredits: string;
    additionalCreditsExpiry: string;
    memberActivities: string;
    lastChecked: string;
    status: string;
  }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    UPDATE accounts SET
      monthly_credits           = ${data.monthlyCredits},
      additional_credits        = ${data.additionalCredits},
      additional_credits_expiry = ${data.additionalCreditsExpiry},
      member_activities         = ${data.memberActivities},
      last_checked              = ${data.lastChecked},
      status                    = ${data.status},
      updated_at                = NOW()
    WHERE id = ${id}
  `;
  if (result.count === 0) throw new Error(`Account id=${id} not found`);
  log.debug('credit result updated', { id, status: data.status });
}

export async function update2FASecret(id: number, totpSecret: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    UPDATE accounts SET
      totp_secret = ${totpSecret},
      updated_at  = NOW()
    WHERE id = ${id}
  `;
  if (result.count === 0) throw new Error(`Account id=${id} not found`);
  log.info('2FA secret updated', { id });
}

export async function deleteAccount(id: number): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`DELETE FROM accounts WHERE id = ${id}`;
  if (result.count === 0) throw new Error(`Account id=${id} not found`);
  log.info('account deleted', { id });
}

export async function updateScreenshot(id: number, screenshotPath: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE accounts SET
      screenshot = ${screenshotPath},
      updated_at = NOW()
    WHERE id = ${id}
  `;
  log.debug('screenshot updated', { id, screenshotPath });
}

// Legacy alias kept for the migration script
export { ensureSchema };
