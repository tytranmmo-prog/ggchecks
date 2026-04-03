/**
 * hybrid.account-store.ts — HybridAccountStore
 *
 * "Sheet as Write Master, DB as Read Replica" implementation.
 *
 * Reads   → always from local PostgreSQL (fast, no rate limits)
 * Writes  → Google Sheets first (source of truth), then PostgreSQL (sync)
 *
 * If a Sheet write fails the error propagates and the DB is not written —
 * the operation is atomic from the caller's perspective. If the DB write
 * fails after a successful Sheet write, the next "Sync from Sheet" will
 * recover the DB automatically.
 *
 * Exception: updateAccountProxy() is DB-only. The auto-assigned Oxylabs
 * proxy (computed by GpmProfilePool from the email hash) is internal
 * infrastructure — it should never pollute the user-managed Sheet.
 */

import * as db from '../db';
import * as sheets from '../sheets';
import type { Account, AccountStore } from './types';
import { createLogger } from '../pino-logger';

const log = createLogger('hybrid-store');

export class HybridAccountStore implements AccountStore {

  // ── Reads (always DB) ────────────────────────────────────────────────────────

  getAccounts(): Promise<Account[]> {
    return db.getAccounts();
  }

  getAccountById(id: number): Promise<Account | null> {
    return db.getAccountById(id);
  }

  getAccountByEmail(email: string): Promise<Account | null> {
    return db.getAccountByEmail(email);
  }

  // ── Writes (Sheet first → DB second) ─────────────────────────────────────────

  async addAccount(data: {
    email:      string;
    password:   string;
    totpSecret: string;
    proxy?:     string;
  }): Promise<void> {
    // 1. Write to Sheet (source of truth)
    await sheets.addAccount(data);
    log.info('addAccount | written to sheet', { email: data.email });

    // 2. Sync to DB (read replica)
    await db.addAccount(data);
    log.info('addAccount | synced to db', { email: data.email });
  }

  async deleteAccount(id: number): Promise<void> {
    // Need the email to locate the row in the sheet
    const account = await db.getAccountById(id);
    if (!account) throw new Error(`Account id=${id} not found`);

    // 1. Delete from Sheet (source of truth)
    const sheetAccounts = await sheets.getAccounts();
    const sheetRow = sheetAccounts.find(r => r.email === account.email);
    if (sheetRow) {
      await sheets.deleteAccount(sheetRow.rowIndex);
      log.info('deleteAccount | deleted from sheet', { email: account.email });
    } else {
      log.warn('deleteAccount | row not found in sheet — deleting from DB only', { email: account.email });
    }

    // 2. Delete from DB (check_results deleted via ON DELETE CASCADE)
    await db.deleteAccount(id);
    log.info('deleteAccount | deleted from db', { id });
  }

  async update2FASecret(id: number, totpSecret: string): Promise<void> {
    // Need the email to locate the row in the sheet
    const account = await db.getAccountById(id);
    if (!account) throw new Error(`Account id=${id} not found`);

    // 1. Update Sheet (source of truth)
    const sheetAccounts = await sheets.getAccounts();
    const sheetRow = sheetAccounts.find(r => r.email === account.email);
    if (sheetRow) {
      await sheets.update2FASecret(sheetRow.rowIndex, totpSecret);
      log.info('update2FASecret | updated in sheet', { email: account.email });
    } else {
      log.warn('update2FASecret | row not found in sheet — updating DB only', { email: account.email });
    }

    // 2. Update DB (read replica)
    await db.update2FASecret(id, totpSecret);
    log.info('update2FASecret | updated in db', { id });
  }

  // ── Proxy write (Sheet + DB) ──────────────────────────────────────────────────

  /**
   * Persist a proxy change to both the Google Sheet (source of truth) and the DB.
   * Called by GpmProfilePool whenever the browser profile's proxy differs from
   * the requested one (onProxyChanged) or a new one is auto-generated (onProxyAssigned).
   *
   * Sheet write is best-effort: if the row isn't found we log a warning and fall
   * through to the DB write so the read-replica stays consistent.
   */
  async updateAccountProxy(email: string, proxy: string): Promise<void> {
    // 1. Update Sheet (source of truth)
    try {
      const sheetAccounts = await sheets.getAccounts();
      const sheetRow = sheetAccounts.find(r => r.email === email);
      if (sheetRow) {
        await sheets.updateProxy(sheetRow.rowIndex, proxy);
        log.info('updateAccountProxy | updated in sheet', { email });
      } else {
        log.warn('updateAccountProxy | row not found in sheet — updating DB only', { email });
      }
    } catch (sheetErr) {
      log.warn('updateAccountProxy | sheet update failed (non-fatal) — continuing to DB', {
        email, err: String(sheetErr),
      });
    }

    // 2. Update DB (read replica)
    await db.updateAccountProxy(email, proxy);
    log.info('updateAccountProxy | updated in db', { email });
  }

  async getServiceAccountMembers(id: number): Promise<{ email: string | null; name: string }[]> {
    return db.getServiceAccountMembers(id);
  }

  async upsertServiceAccountMembers(id: number, members: { email: string | null; name: string }[]): Promise<void> {
    return db.upsertServiceAccountMembers(id, members);
  }
}
