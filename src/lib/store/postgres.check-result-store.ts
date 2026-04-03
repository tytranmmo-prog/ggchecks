/**
 * postgres.check-result-store.ts — PostgresCheckResultStore
 *
 * Single implementation for check result storage — always goes to the local
 * PostgreSQL database. Check results are never written to Google Sheets.
 */

import * as db from '../db';
import type {
  CheckHistoryOptions,
  CheckHistoryResult,
  CheckResultStore,
  CreditResultInput,
  DateRangeOptions,
  MemberCreditTotal,
} from './types';

export class PostgresCheckResultStore implements CheckResultStore {
  updateCreditResult(accountId: number, data: CreditResultInput): Promise<void> {
    return db.updateCreditResult(accountId, data);
  }

  getCheckHistory(opts: CheckHistoryOptions): Promise<CheckHistoryResult> {
    return db.getCheckHistory(opts);
  }

  getMemberCreditTotals(opts: DateRangeOptions): Promise<MemberCreditTotal[]> {
    return db.getMemberCreditTotals(opts);
  }
}
