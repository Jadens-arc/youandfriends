import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, roleEnum, updatedAt, workspaceId } from './columns';
import { grantScopeEnum } from './permissions';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * An invitation: an owner or a `can_invite` delegate's offer of access, before anyone has
 * accepted it.
 *
 * **The row's own id is the token's lookup key.** The token handed to the invitee is
 * `yaf_invite_<id>_<secret>` (`packages/authz/src/token-hash.ts`) — the same shape ADR 0005
 * chose for sync tokens, for the same reason: the id is public (it is how the row is found),
 * and only the secret half is sensitive. `tokenHash` is what is compared against it; the secret
 * itself is never stored.
 *
 * **Bound to an email, not an identity.** Nobody has an account yet at invite time — that is
 * the point of inviting them — so the only thing to bind to is the address the owner typed.
 * Acceptance checks the signed-in person's Clerk email against it (`docs/THREAT_MODEL.md` T2):
 * accepting with a different identity is exactly the privilege-transfer vector the check
 * exists to close.
 *
 * **No `owner` role, ever.** See `INVITABLE_ROLES` in `@youandfriends/contracts` — enforced
 * again here by a check constraint, because a role this table could never legally grant is a
 * mistake worth catching twice.
 */
export const invitationStateEnum = pgEnum('invitation_state', ['pending', 'accepted', 'revoked']);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Lowercased and trimmed before it reaches this column — see `normalizeEmail`. */
    email: varchar('email', { length: 320 }).notNull(),

    scopeType: grantScopeEnum('scope_type').notNull(),
    /** No foreign key: the target is one of three tables, exactly like `permission_grants`. */
    scopeId: reference('scope_id').notNull(),

    role: roleEnum('role').notNull(),
    /**
     * Explicit, never silent. A `permission_grants` row may leave these `null` to inherit a
     * broader grant's answer; an invitation has no broader grant standing behind it to inherit
     * from, so leaving them ambiguous here would mean the accepted grant is ambiguous too.
     */
    canDownload: boolean('can_download').notNull().default(false),
    canInvite: boolean('can_invite').notNull().default(false),

    /** The row's own `id`, prefixed, is the token; this is what a presented token is checked
     *  against. Never the plaintext secret — see the module comment. */
    tokenHash: text('token_hash').notNull(),

    state: invitationStateEnum('state').notNull().default('pending'),

    invitedByUserId: reference('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Past this moment a `pending` invitation fails closed, indistinguishably from revoked or
     *  never having existed. No sweep flips a stored state — nothing needs to list "expired"
     *  invitations, so there is nothing a background job would do that this column does not
     *  already answer at read time. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: reference('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: reference('revoked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('invitations_workspace_state_idx').on(table.workspaceId, table.state),
    // "Everything pending for this address" — accept resolves nothing from this index (it
    // looks up by id), but a re-invite check and an owner's own listing both want it.
    index('invitations_workspace_email_idx').on(table.workspaceId, table.email),
    // At most one *live* invitation per address per scope. Partial, over `pending` only, so a
    // new invitation can be sent once a prior one is accepted or revoked — the unique index
    // would otherwise permanently block re-inviting someone who left.
    uniqueIndex('invitations_pending_email_scope_key')
      .on(table.workspaceId, table.email, table.scopeType, table.scopeId)
      .where(sql`state = 'pending'`),
    check('invitations_role_not_owner', sql`role <> 'owner'`),
    check('invitations_expiry_after_creation', sql`expires_at > created_at`),
  ],
);
