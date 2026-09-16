import { timestamp } from 'drizzle-orm/pg-core';

import { reference } from './columns';
import { users } from './users';

/**
 * Soft-deletion columns, shared by every user-visible entity.
 *
 * Trash is a real place with real contents, not a euphemism for gone
 * (`docs/THREAT_MODEL.md` T8). Deleting marks; purging destroys; the two are separated by a
 * recovery window the user can rely on.
 *
 * Four columns, and the fourth is the one that matters most.
 */
export const softDeleteColumns = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Null once that person is deleted; the tombstone itself survives. */
  deletedBy: reference('deleted_by').references(() => users.id, { onDelete: 'set null' }),

  /**
   * Recorded **at delete time**, not computed at purge time.
   *
   * Otherwise lowering the retention setting would retroactively purge things a user was
   * told they could still recover — a promise broken by a configuration change, which is the
   * worst way to lose someone's work.
   */
  purgeAfter: timestamp('purge_after', { withTimezone: true }),

  /**
   * Which delete operation removed this row.
   *
   * This is what makes restore the exact inverse of delete. Deleting a project cascades to
   * its songs — but some of those songs may have been trashed individually first, days
   * earlier. Restoring the project must bring back the songs *it* deleted and leave the
   * others in the trash where their owner put them. Without a batch id there is no way to
   * tell the two apart, and restore quietly resurrects things nobody asked for.
   */
  deletedBatch: reference('deleted_batch'),
});
