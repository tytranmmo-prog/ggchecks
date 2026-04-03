/**
 * postgres.family-member-store.ts — PostgresFamilyMemberStore
 *
 * Owns the service_account_members table.
 * DB-only — family member data is discovered at runtime (not managed in Sheet).
 *
 * upsertServiceAccountMembers performs change-detection:
 * if the incoming member list is identical (same emails + names, same order-
 * agnostic set) it skips the write entirely, saving a round-trip transaction.
 */

import * as db from '../db';
import type { FamilyMemberStore } from './types';
import { createLogger } from '../pino-logger';

const log = createLogger('family-member-store');

type Member = { email: string | null; name: string };

function membersEqual(a: Member[], b: Member[]): boolean {
  if (a.length !== b.length) return false;
  // Compare as sorted JSON strings — order-agnostic, exact match.
  const key = (m: Member) => `${m.email ?? ''}|${m.name}`;
  const sortedA = [...a].map(key).sort().join('\n');
  const sortedB = [...b].map(key).sort().join('\n');
  return sortedA === sortedB;
}

export class PostgresFamilyMemberStore implements FamilyMemberStore {
  async getServiceAccountMembers(id: number): Promise<Member[]> {
    return db.getServiceAccountMembers(id);
  }

  async upsertServiceAccountMembers(id: number, members: Member[]): Promise<void> {
    // Change-detection: skip the DB write if nothing actually changed.
    const existing = await db.getServiceAccountMembers(id);
    if (membersEqual(existing, members)) {
      log.debug('upsertServiceAccountMembers | no change, skipping write', { id, count: members.length });
      return;
    }
    await db.upsertServiceAccountMembers(id, members);
  }
}
