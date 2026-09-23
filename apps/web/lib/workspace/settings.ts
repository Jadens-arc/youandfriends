import {
  canInWorkspace,
  withAuditedTransaction,
  type AuditContext,
  type Subject,
} from '@youandfriends/authz';
import {
  fieldErrorsFromZod,
  forbidden,
  newUlid,
  notFound,
  validationFailed,
  type WorkspaceAction,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  membersOf,
  renameWorkspace,
  storageUsage,
  workspaceName,
  type DirectDatabase,
  type WorkspaceMember,
} from '@youandfriends/db';
import { z } from 'zod';

export type { WorkspaceMember };

/**
 * A member as the settings page shows them: the email only when the viewer manages members.
 *
 * The list is who works with whom (`docs/THREAT_MODEL.md`, asset 3), and the addresses are the
 * part a collaborator could take away and use. A viewer let in to hear one song sees names and
 * roles; the owner, who needs to tell two people with the same name apart, sees addresses too
 * (found in security review; ADR 0009).
 */
export type VisibleMember = Omit<WorkspaceMember, 'email'> & { readonly email: string | null };

/**
 * The workspace settings surface: its name, what it stores, and who is in it.
 *
 * The member list is sensitive — it is who works with whom, on music nobody has heard yet
 * (`docs/THREAT_MODEL.md`, asset 3). So every entry point here asks `packages/authz` first, a
 * refusal is recorded in the workspace's audit log before it is thrown, and the thrown error is
 * `forbidden`, which reaches the client 404-shaped.
 *
 * Everything is scoped by the `workspaceId` on the context, which comes from request resolution
 * (`resolve.ts`) and is re-authorized here regardless. No query below can be pointed at another
 * workspace by anything the page or the form supplies.
 */

export interface WorkspaceRequest {
  readonly db: DirectDatabase;
  readonly subject: Subject;
  readonly workspaceId: WorkspaceId;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly correlationId?: string | undefined;
}

function auditContextOf(request: WorkspaceRequest): AuditContext {
  return {
    workspaceId: request.workspaceId,
    actor: request.subject,
    correlationId: request.correlationId,
    newId: request.newId ?? newUlid,
    ...(request.now === undefined ? {} : { now: request.now }),
  };
}

/**
 * Refuse unless the subject may perform this workspace-level action, recording the refusal.
 *
 * The record is written in its own transaction before the throw: a refusal is the event, and
 * there is no other change for it to be atomic with.
 */
export async function requireInWorkspace(
  request: WorkspaceRequest,
  action: WorkspaceAction,
): Promise<void> {
  if (await canInWorkspace(request.db, request.subject, action, request.workspaceId)) return;

  await withAuditedTransaction(request.db, auditContextOf(request), async ({ audit }) => {
    await audit({
      action: 'access.denied',
      targetType: 'workspace',
      targetId: request.workspaceId,
      metadata: { attemptedAction: action },
    });
  });

  throw forbidden({
    detail: `${request.subject.kind} may not ${action} workspace ${request.workspaceId}`,
  });
}

export interface WorkspaceSettings {
  readonly name: string;
  readonly usage: { readonly usedBytes: number; readonly refreshedAt: Date };
  readonly quotaBytes: number;
  readonly members: readonly VisibleMember[];
  /** What this viewer may change. Decided by `authz`, so the page never compares roles. */
  readonly mayRename: boolean;
  readonly mayManageMembers: boolean;
}

/**
 * Everything the settings page shows.
 *
 * `quotaBytes` is passed in rather than read here: it is configuration
 * (`YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`, ADR 0001), and taking it as an argument keeps the
 * caller — which already parsed the environment — the one place it is read.
 */
export async function readWorkspaceSettings(
  request: WorkspaceRequest,
  quotaBytes: number,
): Promise<WorkspaceSettings> {
  await requireInWorkspace(request, 'view_settings');

  const now = (request.now ?? (() => new Date()))();
  const [name, usage, members, mayRename, mayManageMembers] = await Promise.all([
    workspaceName(request.db, request.workspaceId),
    storageUsage(request.db, request.workspaceId, now),
    membersOf(request.db, request.workspaceId),
    canInWorkspace(request.db, request.subject, 'rename', request.workspaceId),
    canInWorkspace(request.db, request.subject, 'manage_members', request.workspaceId),
  ]);

  // Membership was just confirmed, so a missing workspace means it was deleted in between.
  if (name === null || usage === null) throw notFound();

  return {
    name,
    usage,
    quotaBytes,
    members: mayManageMembers ? members : members.map((member) => ({ ...member, email: null })),
    mayRename,
    mayManageMembers,
  };
}

/**
 * The member list, for the owner-only management surface.
 *
 * A separate entry point from {@link readWorkspaceSettings}, with a stricter check, because the
 * management surface is where adding and removing people will live (task `032`). Its route
 * existing is what makes "only owners reach member management" something a test can hold.
 */
export async function readMemberManagement(
  request: WorkspaceRequest,
): Promise<readonly WorkspaceMember[]> {
  await requireInWorkspace(request, 'manage_members');
  return membersOf(request.db, request.workspaceId);
}

/**
 * A workspace name, as a person may set it.
 *
 * Trimmed, bounded, and made of characters someone can see. It is rendered in navigation, in page
 * titles, and eventually in invitation emails, so a newline or an escape sequence is a layout bug
 * at best — and a bidirectional override or a run of zero-width characters is a name that reads
 * as something it is not, or as nothing (found in security review). Format characters are refused
 * except the zero-width joiner, without which emoji sequences fall apart.
 */
const ZERO_WIDTH_JOINER = '\u200D';

function isInvisibleOrControl(character: string): boolean {
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(character)) return true;
  return /\p{Cf}/u.test(character) && character !== ZERO_WIDTH_JOINER;
}

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the workspace a name.')
  .max(80, 'Keep the name to 80 characters or fewer.')
  .refine(
    (name) => ![...name].some(isInvisibleOrControl),
    'The name cannot contain control or invisible formatting characters.',
  )
  .refine(
    (name) => /[\p{L}\p{N}\p{S}\p{P}]/u.test(name),
    'The name needs at least one visible character.',
  );

/** Rename the workspace. Owner-only; audited with the name before and after. */
export async function renameCurrentWorkspace(
  request: WorkspaceRequest,
  rawName: unknown,
): Promise<{ name: string }> {
  await requireInWorkspace(request, 'rename');

  const parsed = workspaceNameSchema.safeParse(rawName);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const name = parsed.data;

  await withAuditedTransaction(request.db, auditContextOf(request), async ({ tx, audit }) => {
    const renamed = await renameWorkspace(tx, request.workspaceId, name);
    if (renamed === null) throw notFound();
    if (renamed.previousName === name) return;

    await audit({
      action: 'workspace.settings_changed',
      targetType: 'workspace',
      targetId: request.workspaceId,
      metadata: { field: 'name', from: renamed.previousName, to: name },
    });
  });

  return { name };
}
