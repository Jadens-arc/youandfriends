import { GRANT_SCOPES, SUBJECT_KINDS } from '@youandfriends/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, roleEnum, updatedAt, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

export const grantScopeEnum = pgEnum('grant_scope', GRANT_SCOPES);
export const subjectKindEnum = pgEnum('subject_kind', SUBJECT_KINDS);

/**
 * A permission grant: one subject's access to one scope.
 *
 * Grants inherit downward — folder to project to song — and the most specific one wins, with
 * an explicit deny beating anything inherited from further up. All of that resolution lives
 * in `packages/authz`; this table only stores the facts (ADR 0006).
 *
 * Three column choices carry the semantics:
 *
 *   - **`role` is nullable, and `isDeny` exists.** A deny row says "not here", which has no
 *     role to state. A check constraint requires one or the other, so a row that says
 *     nothing cannot be written.
 *   - **`canDownload` and `canInvite` are nullable booleans, not `false` defaults.** Null
 *     means "this grant is silent about it", which is what lets a song-level role grant
 *     leave a folder-level download permission alone. A `false` default would silently
 *     revoke it, and the revocation would look deliberate.
 *   - **`startsAt` and `endsAt` bound the active window.** Time-limited access is how a
 *     mastering engineer gets a week rather than forever.
 */
export const permissionGrants = pgTable(
  'permission_grants',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    scopeType: grantScopeEnum('scope_type').notNull(),
    /** No foreign key: the target is one of three tables. Resolution checks the scope chain. */
    scopeId: reference('scope_id').notNull(),
    subjectKind: subjectKindEnum('subject_kind').notNull(),
    /** A user id, a sync token id, or a share link id, depending on `subjectKind`. */
    subjectId: reference('subject_id').notNull(),
    role: roleEnum('role'),
    canDownload: boolean('can_download'),
    canInvite: boolean('can_invite'),
    isDeny: boolean('is_deny').notNull().default(false),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** Who granted it. Null once that person is deleted; the grant itself survives. */
    createdByUserId: reference('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One grant per subject per scope. Two would make the effective access depend on row
    // order, which is not a decision anyone made — and it is the kind of ambiguity that
    // resolves differently under a different query plan.
    uniqueIndex('permission_grants_scope_subject_key').on(
      table.workspaceId,
      table.scopeType,
      table.scopeId,
      table.subjectKind,
      table.subjectId,
    ),
    // The resolution query: every grant this subject holds anywhere in this workspace, then
    // filtered against the target's scope chain in memory.
    index('permission_grants_subject_idx').on(
      table.workspaceId,
      table.subjectKind,
      table.subjectId,
    ),
    // "Who can see this?" — the sharing panel's query.
    index('permission_grants_scope_idx').on(table.workspaceId, table.scopeType, table.scopeId),
    // A grant that neither names a role nor denies says nothing at all.
    check('permission_grants_states_something', sql`is_deny or role is not null`),
    // An inverted window would be active never, or always, depending on how it was read.
    check(
      'permission_grants_window_ordered',
      sql`starts_at is null or ends_at is null or starts_at < ends_at`,
    ),
  ],
);
