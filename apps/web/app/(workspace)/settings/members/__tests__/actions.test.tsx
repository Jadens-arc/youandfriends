import { AppError, conflict, forbidden, validationFailed } from '@youandfriends/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The member-management server actions' own logic: what they extract from `FormData`, which
 * refusal becomes which message, and that every mutation revalidates the page it changed. The
 * use cases they call are tested against a real database elsewhere
 * (`lib/invitations/__tests__/service.test.ts`, `lib/workspace/__tests__/members.test.ts`).
 */

const current = vi.hoisted(() => ({
  currentWorkspace: vi.fn(),
  memberManagementContext: vi.fn(),
}));
const invitationCtx = vi.hoisted(() => ({ invitationContext: vi.fn() }));
const invitationService = vi.hoisted(() => ({
  sendInvitation: vi.fn(),
  revokeInvitationById: vi.fn(),
}));
const memberLib = vi.hoisted(() => ({ changeMemberRole: vi.fn(), removeMember: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const nextHeaders = vi.hoisted(() => ({ headers: vi.fn() }));

vi.mock('@/lib/workspace/current', () => current);
vi.mock('@/lib/invitations/context', () => invitationCtx);
vi.mock('@/lib/invitations/service', () => invitationService);
vi.mock('@/lib/workspace/members', () => memberLib);
vi.mock('next/cache', () => cache);
vi.mock('next/headers', () => nextHeaders);

const { changeMemberRoleAction, removeMemberAction, revokeInvitationAction, sendInvitationAction } =
  await import('../actions');

const CONTEXT = {
  subject: { kind: 'member', userId: 'u1' },
  userId: 'u1',
  workspace: { workspaceId: 'w1', name: 'Blue Hour', role: 'owner' },
  correlationId: undefined,
};

function emptyHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers({ host: 'app.youandfriends.org', 'x-forwarded-proto': 'https', ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  current.currentWorkspace.mockResolvedValue(CONTEXT);
  current.memberManagementContext.mockReturnValue({ workspaceId: 'w1' });
  invitationCtx.invitationContext.mockReturnValue({ workspaceId: 'w1' });
  nextHeaders.headers.mockResolvedValue(emptyHeaders());
});

describe('sendInvitationAction', () => {
  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  const FIELDS = {
    email: 'sam@example.test',
    scopeType: 'song',
    scopeId: 'song1',
    role: 'viewer',
    canDownload: 'on',
  };

  it('sends what the form carries, and returns a shareable link', async () => {
    invitationService.sendInvitation.mockResolvedValue({
      invitationId: 'inv1',
      token: 'yaf_invite_01ABC_secret',
      expiresAt: new Date(),
    });

    const result = await sendInvitationAction({ status: 'idle' }, form(FIELDS));

    expect(invitationService.sendInvitation).toHaveBeenCalledWith(
      { workspaceId: 'w1' },
      {
        email: 'sam@example.test',
        scopeType: 'song',
        scopeId: 'song1',
        role: 'viewer',
        canDownload: true,
        canInvite: false,
      },
    );
    expect(result).toEqual({
      status: 'sent',
      link: 'https://app.youandfriends.org/invite/yaf_invite_01ABC_secret',
      email: 'sam@example.test',
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('falls back to http for a localhost host', async () => {
    nextHeaders.headers.mockResolvedValue(new Headers({ host: 'localhost:3000' }));
    invitationService.sendInvitation.mockResolvedValue({
      invitationId: 'inv1',
      token: 'yaf_invite_01ABC_secret',
      expiresAt: new Date(),
    });

    const result = await sendInvitationAction({ status: 'idle' }, form(FIELDS));
    expect(result).toMatchObject({ link: 'http://localhost:3000/invite/yaf_invite_01ABC_secret' });
  });

  it('passes the field’s own message back for a rejected request', async () => {
    invitationService.sendInvitation.mockRejectedValue(
      validationFailed([
        {
          path: 'role',
          message: 'You cannot invite someone to a higher role than your own (viewer).',
        },
      ]),
    );
    const result = await sendInvitationAction({ status: 'idle' }, form(FIELDS));
    expect(result).toEqual({
      status: 'error',
      message: 'You cannot invite someone to a higher role than your own (viewer).',
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('says only that the scope could not be found when refused', async () => {
    invitationService.sendInvitation.mockRejectedValue(forbidden());
    const result = await sendInvitationAction({ status: 'idle' }, form(FIELDS));
    expect(result).toEqual({
      status: 'error',
      message: 'That folder, project, or song could not be found.',
    });
  });

  it('names a duplicate pending invitation as a conflict', async () => {
    invitationService.sendInvitation.mockRejectedValue(conflict());
    const result = await sendInvitationAction({ status: 'idle' }, form(FIELDS));
    expect(result).toEqual({
      status: 'error',
      message: 'An invitation to that address is already pending here.',
    });
  });

  it('refuses without a workspace, before touching anything', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    const result = await sendInvitationAction({ status: 'idle' }, form(FIELDS));
    expect(result).toMatchObject({ status: 'error' });
    expect(invitationService.sendInvitation).not.toHaveBeenCalled();
  });

  it('does not disguise an unexpected failure as a validation message', async () => {
    invitationService.sendInvitation.mockRejectedValue(new AppError('internal'));
    await expect(sendInvitationAction({ status: 'idle' }, form(FIELDS))).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe('revokeInvitationAction', () => {
  const form = (id: string) => {
    const data = new FormData();
    data.set('invitationId', id);
    return data;
  };

  it('revokes, and revalidates the page', async () => {
    invitationService.revokeInvitationById.mockResolvedValue(undefined);
    const result = await revokeInvitationAction({ status: 'idle' }, form('inv1'));
    expect(invitationService.revokeInvitationById).toHaveBeenCalledWith(
      { workspaceId: 'w1' },
      'inv1',
    );
    expect(result).toEqual({ status: 'ok' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('distinguishes "no longer pending" from "not found"', async () => {
    invitationService.revokeInvitationById.mockRejectedValue(conflict());
    expect(await revokeInvitationAction({ status: 'idle' }, form('inv1'))).toEqual({
      status: 'error',
      message: 'That invitation is no longer pending.',
    });

    invitationService.revokeInvitationById.mockRejectedValue(forbidden());
    expect(await revokeInvitationAction({ status: 'idle' }, form('inv1'))).toEqual({
      status: 'error',
      message: 'That invitation could not be found.',
    });
  });

  it('refuses without a workspace, before touching anything', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    const result = await revokeInvitationAction({ status: 'idle' }, form('inv1'));
    expect(result).toMatchObject({ status: 'error' });
    expect(invitationService.revokeInvitationById).not.toHaveBeenCalled();
  });
});

describe('changeMemberRoleAction', () => {
  const form = (userId: string, role: string) => {
    const data = new FormData();
    data.set('userId', userId);
    data.set('role', role);
    return data;
  };

  it('changes the role, and revalidates the page', async () => {
    memberLib.changeMemberRole.mockResolvedValue(undefined);
    const result = await changeMemberRoleAction({ status: 'idle' }, form('u2', 'editor'));
    expect(memberLib.changeMemberRole).toHaveBeenCalledWith({ workspaceId: 'w1' }, 'u2', 'editor');
    expect(result).toEqual({ status: 'ok' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('refuses a role the schema does not recognize, before calling the use case', async () => {
    const result = await changeMemberRoleAction({ status: 'idle' }, form('u2', 'superadmin'));
    expect(result).toEqual({ status: 'error', message: 'Choose a valid role.' });
    expect(memberLib.changeMemberRole).not.toHaveBeenCalled();
  });

  it('names the last-owner guard as a conflict, distinct from "not found"', async () => {
    memberLib.changeMemberRole.mockRejectedValue(conflict());
    expect(await changeMemberRoleAction({ status: 'idle' }, form('u1', 'editor'))).toEqual({
      status: 'error',
      message: 'A workspace must keep at least one owner.',
    });

    memberLib.changeMemberRole.mockRejectedValue(forbidden());
    expect(await changeMemberRoleAction({ status: 'idle' }, form('u2', 'editor'))).toEqual({
      status: 'error',
      message: 'That member could not be found.',
    });
  });

  it('refuses without a workspace, before touching anything', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    const result = await changeMemberRoleAction({ status: 'idle' }, form('u2', 'editor'));
    expect(result).toMatchObject({ status: 'error' });
    expect(memberLib.changeMemberRole).not.toHaveBeenCalled();
  });
});

describe('removeMemberAction', () => {
  const form = (userId: string) => {
    const data = new FormData();
    data.set('userId', userId);
    return data;
  };

  it('removes, and revalidates the page', async () => {
    memberLib.removeMember.mockResolvedValue(undefined);
    const result = await removeMemberAction({ status: 'idle' }, form('u2'));
    expect(memberLib.removeMember).toHaveBeenCalledWith({ workspaceId: 'w1' }, 'u2');
    expect(result).toEqual({ status: 'ok' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('names the last-owner guard as a conflict, distinct from "not found"', async () => {
    memberLib.removeMember.mockRejectedValue(conflict());
    expect(await removeMemberAction({ status: 'idle' }, form('u1'))).toEqual({
      status: 'error',
      message: 'A workspace must keep at least one owner.',
    });

    memberLib.removeMember.mockRejectedValue(forbidden());
    expect(await removeMemberAction({ status: 'idle' }, form('u2'))).toEqual({
      status: 'error',
      message: 'That member could not be found.',
    });
  });

  it('refuses without a workspace, before touching anything', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    const result = await removeMemberAction({ status: 'idle' }, form('u2'));
    expect(result).toMatchObject({ status: 'error' });
    expect(memberLib.removeMember).not.toHaveBeenCalled();
  });
});
