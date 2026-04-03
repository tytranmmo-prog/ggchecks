/**
 * hybrid.account-store.test.ts
 *
 * Unit tests for HybridAccountStore.
 * All external modules are mocked — no real DB or Sheet calls are made.
 *
 * Run: bun test
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { Account } from '@/lib/store/types';

// ── Mock implementations (module-level so factories can reference them) ────────

const db = {
  getAccounts:        mock(async () => [] as Account[]),
  getAccountById:     mock(async (_id: number) => null as null | { id: number; email: string }),
  addAccount:         mock(async () => {}),
  deleteAccount:      mock(async () => {}),
  update2FASecret:    mock(async () => {}),
  updateAccountProxy: mock(async () => {}),
};

const sheets = {
  getAccounts:     mock(async () => [] as Array<{ email: string; rowIndex: number }>),
  addAccount:      mock(async () => {}),
  deleteAccount:   mock(async () => {}),
  update2FASecret: mock(async () => {}),
};

// Register mocks before import (Bun hoists mock.module() above imports)
mock.module('@/lib/db',      () => db);
mock.module('@/lib/sheets',  () => sheets);
mock.module('@/lib/pino-logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));

import { HybridAccountStore } from '@/lib/store/hybrid.account-store';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeAccount = (id = 1, email = 'a@b.com'): Account => ({
  id, email, password: 'pass', totpSecret: 'secret', proxy: null,
  monthlyCredits: '', additionalCredits: '', additionalCreditsExpiry: '',
  memberActivities: [], lastChecked: '', status: 'pending', screenshot: '',
});

const makeSheetRow = (email = 'a@b.com', rowIndex = 2) => ({
  email, password: 'pass', totpSecret: 'secret', proxy: '', rowIndex,
});

function clearAllMocks() {
  Object.values(db).forEach(m => m.mockClear());
  Object.values(sheets).forEach(m => m.mockClear());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HybridAccountStore', () => {
  let store: HybridAccountStore;

  beforeEach(() => {
    clearAllMocks();
    // Restore default implementations
    db.getAccounts.mockResolvedValue([]);
    db.getAccountById.mockResolvedValue(null);
    db.addAccount.mockResolvedValue(undefined);
    db.deleteAccount.mockResolvedValue(undefined);
    db.update2FASecret.mockResolvedValue(undefined);
    db.updateAccountProxy.mockResolvedValue(undefined);
    sheets.getAccounts.mockResolvedValue([]);
    sheets.addAccount.mockResolvedValue(undefined);
    sheets.deleteAccount.mockResolvedValue(undefined);
    sheets.update2FASecret.mockResolvedValue(undefined);
    store = new HybridAccountStore();
  });

  // ── getAccounts ─────────────────────────────────────────────────────────────

  describe('getAccounts', () => {
    it('delegates to db.getAccounts', async () => {
      const accounts = [makeAccount()];
      db.getAccounts.mockResolvedValue(accounts);
      const result = await store.getAccounts();
      expect(result).toBe(accounts);
      expect(db.getAccounts).toHaveBeenCalledTimes(1);
      expect(sheets.getAccounts).not.toHaveBeenCalled();
    });
  });

  // ── addAccount ──────────────────────────────────────────────────────────────

  describe('addAccount', () => {
    const data = { email: 'a@b.com', password: 'p', totpSecret: 'ts', proxy: 'host:8080' };

    it('writes to sheet FIRST, then DB', async () => {
      const callOrder: string[] = [];
      sheets.addAccount.mockImplementation(async () => { callOrder.push('sheet'); });
      db.addAccount.mockImplementation(async () => { callOrder.push('db'); });

      await store.addAccount(data);

      expect(callOrder).toEqual(['sheet', 'db']);
    });

    it('passes all fields including proxy to both sheet and DB', async () => {
      await store.addAccount(data);
      expect(sheets.addAccount).toHaveBeenCalledWith(data);
      expect(db.addAccount).toHaveBeenCalledWith(data);
    });

    it('propagates sheet errors without writing to DB', async () => {
      sheets.addAccount.mockRejectedValue(new Error('Sheet API error'));
      await expect(store.addAccount(data)).rejects.toThrow('Sheet API error');
      expect(db.addAccount).not.toHaveBeenCalled();
    });
  });

  // ── deleteAccount ───────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('deletes from sheet then DB when account exists in both', async () => {
      db.getAccountById.mockResolvedValue(makeAccount(1, 'a@b.com'));
      sheets.getAccounts.mockResolvedValue([makeSheetRow('a@b.com', 5)]);

      await store.deleteAccount(1);

      expect(sheets.deleteAccount).toHaveBeenCalledWith(5);
      expect(db.deleteAccount).toHaveBeenCalledWith(1);
    });

    it('still deletes from DB when account not found in sheet', async () => {
      db.getAccountById.mockResolvedValue(makeAccount(1, 'a@b.com'));
      sheets.getAccounts.mockResolvedValue([]); // not in sheet

      await store.deleteAccount(1);

      expect(sheets.deleteAccount).not.toHaveBeenCalled();
      expect(db.deleteAccount).toHaveBeenCalledWith(1);
    });

    it('throws when account does not exist in DB', async () => {
      db.getAccountById.mockResolvedValue(null);
      await expect(store.deleteAccount(99)).rejects.toThrow('Account id=99 not found');
      expect(db.deleteAccount).not.toHaveBeenCalled();
    });
  });

  // ── update2FASecret ─────────────────────────────────────────────────────────

  describe('update2FASecret', () => {
    it('updates sheet then DB when account found in both', async () => {
      db.getAccountById.mockResolvedValue(makeAccount(1, 'a@b.com'));
      sheets.getAccounts.mockResolvedValue([makeSheetRow('a@b.com', 3)]);

      await store.update2FASecret(1, 'NEWSECRET');

      expect(sheets.update2FASecret).toHaveBeenCalledWith(3, 'NEWSECRET');
      expect(db.update2FASecret).toHaveBeenCalledWith(1, 'NEWSECRET');
    });

    it('updates DB only when account not in sheet', async () => {
      db.getAccountById.mockResolvedValue(makeAccount(1, 'a@b.com'));
      sheets.getAccounts.mockResolvedValue([]);

      await store.update2FASecret(1, 'NEWSECRET');

      expect(sheets.update2FASecret).not.toHaveBeenCalled();
      expect(db.update2FASecret).toHaveBeenCalledWith(1, 'NEWSECRET');
    });

    it('throws when account does not exist in DB', async () => {
      db.getAccountById.mockResolvedValue(null);
      await expect(store.update2FASecret(99, 'X')).rejects.toThrow('Account id=99 not found');
    });
  });

  // ── updateAccountProxy ──────────────────────────────────────────────────────

  describe('updateAccountProxy', () => {
    it('is DB-only: never touches Google Sheets', async () => {
      await store.updateAccountProxy('a@b.com', 'host:1234:user:pass');
      expect(db.updateAccountProxy).toHaveBeenCalledWith('a@b.com', 'host:1234:user:pass');
      expect(sheets.getAccounts).not.toHaveBeenCalled();
      expect(sheets.update2FASecret).not.toHaveBeenCalled();
    });
  });
});
