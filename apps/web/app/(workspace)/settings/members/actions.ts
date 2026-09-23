'use server';

import { PRODUCT_DOMAIN } from '@youandfriends/config';
import { AppError, roleSchema, type Role } from '@youandfriends/contracts';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import type { InviteState } from '@/components/settings/invite-form';
import type { MemberActionState } from '@/components/settings/member-management-list';
import { invitationContext } from '@/lib/invitations/context';
import { revokeInvitationById, sendInvitation } from '@/lib/invitations/service';
import { currentWorkspace, memberManagementContext } from '@/lib/workspace/current';
import { changeMemberRole, removeMember } from '@/lib/workspace/members';

/**
 * Server actions for the member-management page (task `032`).
 *
 * A server action is a public endpoint whether or not the form that calls it ever rendered, so
 * each one resolves its own workspace and re-authorizes through the same use cases the page
 * used to decide what to show — exactly as `../actions.ts` (task `031`) already does for
 * renaming. Refusals never distinguish "you may not" from "that does not exist"
 * (`docs/THREAT_MODEL.md` T1): both come back through the same `AppError.publicCode` check.
 *
 * The task file lists `apps/web/app/api/invitations/**` as the expected surface. This app has
 * no other REST API for same-origin browser mutations — every other settings write is a Server
 * Action reached from a form in this same app, and a route handler would exist only to be
 * called by a `fetch` from the page it sits beside. Colocated actions are that pattern, so this
 * built the members surface with them instead of adding the app's first REST endpoint for
 * something a route handler was never going to be a client of. `apps/web/app/invite/[token]`
 * still exists as a real route: invitation *acceptance* is reached from a link outside the app
 * (an emailless share of the link itself, task `096`'s eventual replacement), which is exactly
 * what a route, not an action bound to a rendered form, is for.
 */

const WORKSPACE_NOT_FOUND = 'That workspace could not be found.';

function messageFor(error: AppError, notFoundMessage: string, conflictMessage: string): string {
  if (error.code === 'conflict') return conflictMessage;
  return notFoundMessage;
}

async function inviteLinkFor(token: string): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? PRODUCT_DOMAIN;
  const proto =
    requestHeaders.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}/invite/${token}`;
}

/**
 * Send an invitation. See `sendInvitation` (`lib/invitations/service.ts`) for the three checks
 * this rests on: may the caller invite here at all, may they offer this role and these
 * capabilities, and is there already a live invitation to this address at this scope.
 */
export async function sendInvitationAction(
  _state: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  const email = formData.get('email');
  const raw = {
    email,
    scopeType: formData.get('scopeType'),
    scopeId: formData.get('scopeId'),
    role: formData.get('role'),
    canDownload: formData.get('canDownload') === 'on',
    canInvite: formData.get('canInvite') === 'on',
  };

  try {
    const sent = await sendInvitation(invitationContext(context), raw);
    revalidatePath('/settings/members');
    return {
      status: 'sent',
      link: await inviteLinkFor(sent.token),
      email: typeof email === 'string' ? email : '',
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'validation_failed') {
      return { status: 'error', message: error.fields?.[0]?.message ?? 'Check the invitation.' };
    }
    if (error instanceof AppError && error.publicCode === 'not_found') {
      return { status: 'error', message: 'That folder, project, or song could not be found.' };
    }
    if (error instanceof AppError && error.code === 'conflict') {
      return { status: 'error', message: 'An invitation to that address is already pending here.' };
    }
    throw error;
  }
}

/** Revoke a pending invitation. Whoever holds `invite` at its scope may withdraw it. */
export async function revokeInvitationAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  const invitationId = String(formData.get('invitationId') ?? '');

  try {
    await revokeInvitationById(invitationContext(context), invitationId);
    revalidatePath('/settings/members');
    return { status: 'ok' };
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.publicCode === 'not_found' || error.code === 'conflict')
    ) {
      return {
        status: 'error',
        message: messageFor(
          error,
          'That invitation could not be found.',
          'That invitation is no longer pending.',
        ),
      };
    }
    throw error;
  }
}

/** Change a full member's workspace-wide role. Owner-only; refuses to leave zero owners. */
export async function changeMemberRoleAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  const targetUserId = String(formData.get('userId') ?? '');
  const parsedRole = roleSchema.safeParse(formData.get('role'));
  if (!parsedRole.success) return { status: 'error', message: 'Choose a valid role.' };
  const role: Role = parsedRole.data;

  try {
    await changeMemberRole(memberManagementContext(context), targetUserId, role);
    revalidatePath('/settings/members');
    return { status: 'ok' };
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.publicCode === 'not_found' || error.code === 'conflict')
    ) {
      return {
        status: 'error',
        message: messageFor(
          error,
          'That member could not be found.',
          'A workspace must keep at least one owner.',
        ),
      };
    }
    throw error;
  }
}

/** Remove a member: their membership, and every grant they held here. Owner-only. */
export async function removeMemberAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  const targetUserId = String(formData.get('userId') ?? '');

  try {
    await removeMember(memberManagementContext(context), targetUserId);
    revalidatePath('/settings/members');
    return { status: 'ok' };
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.publicCode === 'not_found' || error.code === 'conflict')
    ) {
      return {
        status: 'error',
        message: messageFor(
          error,
          'That member could not be found.',
          'A workspace must keep at least one owner.',
        ),
      };
    }
    throw error;
  }
}
