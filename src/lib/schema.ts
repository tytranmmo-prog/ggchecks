import {
  pgTable,
  bigserial,
  bigint,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ── Shared types ────────────────────────────────────────────────────────────

export interface MemberActivity {
  name: string;
  email?: string | null;
  credit: number;
}

// ── service_accounts ─────────────────────────────────────────────────────────

export const serviceAccounts = pgTable('service_accounts', {
  id:         bigserial('id',          { mode: 'number' }).primaryKey(),
  email:      text('email').notNull().unique(),
  password:   text('password').notNull(),
  totpSecret: text('totp_secret').notNull(),
  notes:      text('notes').notNull().default(''),
  proxy:      text('proxy'),
  createdAt:  timestamp('created_at',  { withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp('updated_at',  { withTimezone: true }).defaultNow().notNull(),
});

// ── check_results ────────────────────────────────────────────────────────────

export const checkResults = pgTable(
  'check_results',
  {
    id:                      bigserial('id', { mode: 'number' }).primaryKey(),
    serviceAccountId:        bigint('service_account_id', { mode: 'number' })
                               .notNull()
                               .references(() => serviceAccounts.id, { onDelete: 'cascade' }),
    monthlyCredits:          text('monthly_credits').notNull().default(''),
    additionalCredits:       text('additional_credits').notNull().default(''),
    additionalCreditsExpiry: text('additional_credits_expiry').notNull().default(''),
    memberActivities:        jsonb('member_activities')
                               .$type<MemberActivity[]>()
                               .notNull()
                               .default([]),
    lastChecked:             timestamp('last_checked', { withTimezone: true }).defaultNow().notNull(),
    status:                  text('status').notNull().default('pending'),
    screenshot:              text('screenshot').notNull().default(''),
    createdAt:               timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('check_results_sa_id_idx').on(t.serviceAccountId),
    index('check_results_created_at').on(t.createdAt),
  ],
);
