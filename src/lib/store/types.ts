/**
 * store/types.ts — Domain interfaces for the data layer.
 *
 * Routes depend ONLY on these interfaces, never on concrete implementations.
 * This lets us swap PostgresAccountStore ↔ HybridAccountStore without
 * touching a single route file.
 */

import type { Account, CheckHistoryItem, MemberActivity } from '../db';

// Re-export domain types so consumers only need one import.
export type { Account, CheckHistoryItem, MemberActivity };

// ── Input / result shapes ─────────────────────────────────────────────────────

export interface CreditResultInput {
  monthlyCredits:          string;
  additionalCredits:       string;
  additionalCreditsExpiry: string;
  memberActivities:        MemberActivity[];
  lastChecked:             string;
  status:                  string;
  screenshot?:             string;
}

export interface CheckHistoryOptions {
  serviceAccountId: number;
  cursor:           number; // last id seen; 0 = first page
  limit:            number;
}

export interface CheckHistoryResult {
  items:      CheckHistoryItem[];
  nextCursor: number | null;
  hasMore:    boolean;
}

export interface DateRangeOptions {
  from: Date;
  to:   Date;
}

export interface MemberCreditTotal {
  memberEmail:  string;
  totalCredits: number;
  checkCount:   number;
}

// ── AccountStore ──────────────────────────────────────────────────────────────
//
// Owns account configuration — data that also lives in Google Sheets.
// Reads always come from the fast local DB.
// In HybridAccountStore, writes go to the Sheet first, then DB.

export interface AccountStore {
  getAccounts(): Promise<Account[]>;
  getAccountById(id: number): Promise<Account | null>;
  addAccount(data: {
    email:      string;
    password:   string;
    totpSecret: string;
    proxy?:     string;
  }): Promise<void>;
  deleteAccount(id: number): Promise<void>;
  update2FASecret(id: number, totpSecret: string): Promise<void>;
  /**
   * System-only: called by the GPM pool to record an auto-assigned Oxylabs
   * proxy. Intentionally DB-only even in Hybrid mode — this is infrastructure
   * plumbing, not user-managed configuration that belongs in the Sheet.
   */
  updateAccountProxy(email: string, proxy: string): Promise<void>;
  getServiceAccountMembers(id: number): Promise<{ email: string | null; name: string }[]>;
  upsertServiceAccountMembers(id: number, members: { email: string | null; name: string }[]): Promise<void>;
}

// ── CheckResultStore ──────────────────────────────────────────────────────────
//
// Owns check-result history — append-only writes, always local DB only.
// Completely decoupled from Sheet management.

export interface CheckResultStore {
  updateCreditResult(accountId: number, data: CreditResultInput): Promise<void>;
  getCheckHistory(opts: CheckHistoryOptions): Promise<CheckHistoryResult>;
  getMemberCreditTotals(opts: DateRangeOptions): Promise<MemberCreditTotal[]>;
}
