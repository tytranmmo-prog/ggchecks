/**
 * postgres.account-store.ts — PostgresAccountStore
 *
 * Thin wrapper around existing db.ts functions. Zero behavior change —
 * all reads and writes go directly to the local PostgreSQL database.
 * Used when ACCOUNT_STORE_MODE=postgres.
 */

import * as db from '../db';
import type { Account, AccountStore } from './types';

export class PostgresAccountStore implements AccountStore {
  getAccounts(): Promise<Account[]> {
    return db.getAccounts();
  }

  getAccountById(id: number): Promise<Account | null> {
    return db.getAccountById(id);
  }

  getAccountByEmail(email: string): Promise<Account | null> {
    return db.getAccountByEmail(email);
  }

  addAccount(data: { email: string; password: string; totpSecret: string; proxy?: string }): Promise<void> {
    return db.addAccount(data);
  }

  deleteAccount(id: number): Promise<void> {
    return db.deleteAccount(id);
  }

  update2FASecret(id: number, totpSecret: string): Promise<void> {
    return db.update2FASecret(id, totpSecret);
  }

  updateAccountProxy(email: string, proxy: string): Promise<void> {
    return db.updateAccountProxy(email, proxy);
  }
}
