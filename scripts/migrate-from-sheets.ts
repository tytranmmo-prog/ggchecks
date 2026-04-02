/**
 * One-time migration script: Google Sheets → PostgreSQL
 *
 * Run with:  bun scripts/migrate-from-sheets.ts
 *
 * Reads all rows from the Google Sheet (using the existing sheets.ts helpers)
 * and upserts them into the local PostgreSQL database.
 * Safe to re-run — uses ON CONFLICT DO UPDATE (upsert by email).
 */

import { getAccounts } from '../src/lib/sheets';
import { ensureSchema } from '../src/lib/db';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is not set. Add it to .env.local or export it before running.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  console.log('🔌 Connecting to PostgreSQL...');
  await sql`SELECT 1`; // connection test
  console.log('✅ Connected.\n');

  console.log('🏗  Ensuring schema exists...');
  // Temporarily set global SQL so ensureSchema uses it
  (global as any).__pgSql = sql;
  await ensureSchema();
  console.log('✅ Schema ready.\n');

  console.log('📊 Reading accounts from Google Sheets...');
  const accounts = await getAccounts();
  console.log(`✅ Found ${accounts.length} accounts in Sheets.\n`);

  if (accounts.length === 0) {
    console.log('Nothing to migrate. Exiting.');
    await sql.end();
    return;
  }

  let inserted = 0;
  let updated  = 0;
  let errors   = 0;

  for (const account of accounts) {
    try {
      const result = await sql`
        INSERT INTO accounts (
          email, password, totp_secret,
          monthly_credits, additional_credits, additional_credits_expiry,
          member_activities, last_checked, status
        ) VALUES (
          ${account.email},
          ${account.password},
          ${account.totpSecret},
          ${account.monthlyCredits   ?? ''},
          ${account.additionalCredits ?? ''},
          ${account.additionalCreditsExpiry ?? ''},
          ${account.memberActivities ?? ''},
          ${account.lastChecked ?? ''},
          ${account.status ?? 'pending'}
        )
        ON CONFLICT (email) DO UPDATE SET
          password                  = EXCLUDED.password,
          totp_secret               = EXCLUDED.totp_secret,
          monthly_credits           = EXCLUDED.monthly_credits,
          additional_credits        = EXCLUDED.additional_credits,
          additional_credits_expiry = EXCLUDED.additional_credits_expiry,
          member_activities         = EXCLUDED.member_activities,
          last_checked              = EXCLUDED.last_checked,
          status                    = EXCLUDED.status,
          updated_at                = NOW()
        RETURNING (xmax = 0) AS inserted
      `;

      if (result[0]?.inserted) {
        inserted++;
        console.log(`  ✅ Inserted:  ${account.email}`);
      } else {
        updated++;
        console.log(`  🔄 Updated:   ${account.email}`);
      }
    } catch (err) {
      errors++;
      console.error(`  ❌ Error for ${account.email}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\n─────────────────────────────────');
  console.log(`Migration complete:`);
  console.log(`  ✅ Inserted: ${inserted}`);
  console.log(`  🔄 Updated:  ${updated}`);
  console.log(`  ❌ Errors:   ${errors}`);
  console.log(`  Total:       ${accounts.length}`);
  console.log('─────────────────────────────────');

  await sql.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
