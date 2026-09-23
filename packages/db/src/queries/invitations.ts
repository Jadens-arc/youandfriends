import { and, desc, eq, sql } from 'drizzle-orm';

import type { DirectDatabase } from '../client';
import { invitations } from '../schema/invitations';
import type { Transaction } from '../transaction';

/**
 * Invitations: creating them, finding one by its token's lookup key, listing the pending
 * ones, and closing them out (accepted or revoked).
 *
 * **No authorization here**, as everywhere in this package (`docs/ARCHITECTURE.md` §3). Whether
 * a caller may invite, revoke, or accept is decided in `packages/authz` and `apps/web/lib`
 * before these are called; every write below still filters on `workspaceId` where the caller
 * has one, so a check that already ran cannot be second-guessed by a query that forgot the
 * tenant.
 */

export type InvitationRow = typeof invitations.$inferSelect;

export interface CreateInvitationInput {
  readonly id: string;
  readonly workspaceId: string;
  /** Already lowercased and trimmed — see `normalizeEmail` in `packages/authz`. */
  readonly email: string;
  readonly scopeType: 'folder' | 'project' | 'song';
  readonly scopeId: string;
  readonly role: 'viewer' | 'commenter' | 'editor';
  readonly canDownload: boolean;
  readonly canInvite: boolean;
  /** Never the plaintext token — see `packages/authz/src/token-hash.ts`. */
  readonly tokenHash: string;
  readonly invitedByUserId: string;
  readonly expiresAt: Date;
}

/**
 * Create a pending invitation, or `null` if this address already has a live one for this
 * scope.
 *
 * The partial unique index (`invitations_pending_email_scope_key`, over `state = 'pending'`
 * rows only) is what makes `null` here a real fact rather than a race an application check
 * could lose: two simultaneous "invite Sam to this song" clicks resolve to one row, whichever
 * wins the insert, and the caller reports a conflict rather than silently sending two emails
 * for one offer.
 */
export async function createInvitation(
  tx: Transaction,
  input: CreateInvitationInput,
): Promise<InvitationRow | null> {
  const [row] = await tx
    .insert(invitations)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      email: input.email,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      role: input.role,
      canDownload: input.canDownload,
      canInvite: input.canInvite,
      tokenHash: input.tokenHash,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: [
        invitations.workspaceId,
        invitations.email,
        invitations.scopeType,
        invitations.scopeId,
      ],
      where: sql`state = 'pending'`,
    })
    .returning();

  return row ?? null;
}

/**
 * Find an invitation by the id embedded in its token, whatever its state.
 *
 * Deliberately **not** workspace-scoped: at this point in the acceptance flow the caller does
 * not yet know which workspace the token names, only the token itself — the same shape as a
 * share-link lookup (`docs/THREAT_MODEL.md` T5). The security boundary here is the token hash
 * comparison and the email-binding check the caller performs on the row this returns, not the
 * `SELECT`.
 */
export async function findInvitationById(
  db: DirectDatabase,
  id: string,
): Promise<InvitationRow | null> {
  const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
  return row ?? null;
}

/** Every invitation still pending for a workspace, newest first. */
export async function listPendingInvitations(
  db: DirectDatabase,
  workspaceId: string,
): Promise<InvitationRow[]> {
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.state, 'pending')))
    .orderBy(desc(invitations.createdAt), desc(invitations.id));
}

/**
 * Mark a pending invitation revoked, workspace-scoped so an id from another tenant cannot be
 * revoked by guessing it. `null` if there is no such **pending** invitation in this workspace —
 * already accepted, already revoked, or never existed are all the same refusal to the caller
 * (`docs/THREAT_MODEL.md` T2: a generic failure that does not reveal which).
 */
export async function revokeInvitation(
  tx: Transaction,
  workspaceId: string,
  id: string,
  revokedByUserId: string,
  now: Date,
): Promise<InvitationRow | null> {
  const [row] = await tx
    .update(invitations)
    .set({ state: 'revoked', revokedAt: now, revokedByUserId })
    .where(
      and(
        eq(invitations.id, id),
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.state, 'pending'),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Mark a pending, unexpired invitation accepted. `null` for anything else — expired, already
 * accepted, already revoked, wrong id — so the caller's refusal is the same generic message in
 * every case (task `032`: "Expired and revoked invitations fail closed with a generic message
 * that does not reveal whether the invitation ever existed").
 *
 * The email-binding check (does the accepting identity match `email`?) is the caller's, not
 * this query's — it needs the accepting person's own record, which this function is not handed.
 */
export async function acceptInvitation(
  tx: Transaction,
  id: string,
  acceptedByUserId: string,
  now: Date,
): Promise<InvitationRow | null> {
  const [row] = await tx
    .update(invitations)
    .set({ state: 'accepted', acceptedAt: now, acceptedByUserId })
    .where(
      and(
        eq(invitations.id, id),
        eq(invitations.state, 'pending'),
        sql`${invitations.expiresAt} > ${now}`,
      ),
    )
    .returning();
  return row ?? null;
}
