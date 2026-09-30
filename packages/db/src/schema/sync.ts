import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Mac sync agents and their tokens (task `110`, ADR 0005).
 *
 * A **device** is what a person sees in their settings: a name, who paired it, whether it is still
 * connected. A **token** is its credential. The token's id is the public half of
 * `yaf_sync_<id>_<secret>` and the lookup key; only a slow hash of the secret is kept, so the
 * full token exists in exactly two places — the screen it was shown on, once, and the Mac's
 * Keychain.
 *
 * Where a token may upload is not stored here: it is `permission_grants` rows for the
 * `sync_token` subject, one per destination project, so a token is authorized by the same
 * resolver as everyone else (ADR 0005, "a subject type, not a bypass").
 */
export const syncDevices = pgTable(
  'sync_devices',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Who paired it. The device can never do more than they can. */
    createdBy: reference('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: reference('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('sync_devices_id_workspace_key').on(table.id, table.workspaceId),
    index('sync_devices_workspace_idx').on(table.workspaceId, table.createdBy),
    check('sync_devices_name_length', sql`length(name) between 1 and 80`),
    check('sync_devices_revoker_has_time', sql`revoked_by is null or revoked_at is not null`),
  ],
);

export const syncTokens = pgTable(
  'sync_tokens',
  {
    /** The public half of the token, and the row it is looked up by. */
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Composite with the workspace in the migration: a token belongs to a device in its workspace. */
    deviceId: reference('device_id').notNull(),
    /** A self-describing slow hash of the secret (`packages/authz/src/token-hash.ts`). */
    secretHash: text('secret_hash').notNull(),
    createdBy: reference('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** When its use was last audited: hourly while in use, not every request. */
    useAuditedAt: timestamp('use_audited_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('sync_tokens_device_idx').on(table.workspaceId, table.deviceId),
    // Never the token itself: a hash in the scheme `token-hash.ts` writes.
    check('sync_tokens_secret_is_hashed', sql`secret_hash like 'scrypt$%'`),
  ],
);
