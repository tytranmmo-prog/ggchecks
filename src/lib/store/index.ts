/**
 * store/index.ts — Factory singletons for the data layer.
 *
 * Routes call getAccountStore() / getCheckResultStore() and work purely
 * against the interface — no concrete implementation leaks through.
 *
 * Environment variables:
 *   ACCOUNT_STORE_MODE=hybrid    (default) — Sheet write-through + DB reads
 *   ACCOUNT_STORE_MODE=postgres  — DB-only (legacy / testing)
 */

import { HybridAccountStore }        from './hybrid.account-store';
import { PostgresAccountStore }       from './postgres.account-store';
import { PostgresCheckResultStore }   from './postgres.check-result-store';
import { PostgresFamilyMemberStore }  from './postgres.family-member-store';
import type { AccountStore, CheckResultStore, FamilyMemberStore } from './types';

// Re-export types so callers can import everything from '@/lib/store'
export type { AccountStore, CheckResultStore, FamilyMemberStore };
export type {
  Account,
  CheckHistoryItem,
  MemberActivity,
  CreditResultInput,
  CheckHistoryOptions,
  CheckHistoryResult,
  DateRangeOptions,
  MemberCreditTotal,
} from './types';

// ── Singletons ────────────────────────────────────────────────────────────────

let _accountStore:      AccountStore      | null = null;
let _checkResultStore:  CheckResultStore  | null = null;
let _familyMemberStore: FamilyMemberStore | null = null;

export function getAccountStore(): AccountStore {
  if (!_accountStore) {
    const mode = process.env.ACCOUNT_STORE_MODE ?? 'hybrid';
    _accountStore = mode === 'postgres'
      ? new PostgresAccountStore()
      : new HybridAccountStore();
  }
  return _accountStore;
}

export function getCheckResultStore(): CheckResultStore {
  if (!_checkResultStore) {
    _checkResultStore = new PostgresCheckResultStore();
  }
  return _checkResultStore;
}

export function getFamilyMemberStore(): FamilyMemberStore {
  if (!_familyMemberStore) {
    _familyMemberStore = new PostgresFamilyMemberStore();
  }
  return _familyMemberStore;
}
