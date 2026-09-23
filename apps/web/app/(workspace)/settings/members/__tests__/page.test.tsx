import { forbidden } from '@youandfriends/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The member-management route's own logic: what it does with a missing workspace, a refusal
 * from either use case it depends on, and a success that wires the invite form, the pending
 * list, and the member list together. The use cases themselves are tested against a real
 * database elsewhere (`lib/workspace/__tests__/settings.test.ts`,
 * `lib/invitations/__tests__/service.test.ts`); here the question is how the route responds.
 */

const current = vi.hoisted(() => ({
  currentWorkspace: vi.fn(),
  workspaceRequest: vi.fn(),
  memberManagementContext: vi.fn(),
}));
const settingsUseCases = vi.hoisted(() => ({ readMemberManagement: vi.fn() }));
const invitationCtx = vi.hoisted(() => ({ invitationContext: vi.fn() }));
const invitationService = vi.hoisted(() => ({
  pendingInvitations: vi.fn(),
  sendInvitation: vi.fn(),
  revokeInvitationById: vi.fn(),
}));
const memberLib = vi.hoisted(() => ({ changeMemberRole: vi.fn(), removeMember: vi.fn() }));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/workspace/current', () => current);
vi.mock('@/lib/workspace/settings', () => settingsUseCases);
vi.mock('@/lib/invitations/context', () => invitationCtx);
vi.mock('@/lib/invitations/service', () => invitationService);
vi.mock('@/lib/workspace/members', () => memberLib);
vi.mock('next/navigation', () => navigation);
vi.mock('next/cache', () => cache);

const { default: MembersPage } = await import('../page');

const CONTEXT = {
  subject: { kind: 'member', userId: 'u1' },
  userId: 'u1',
  workspace: { workspaceId: 'w1', name: 'Blue Hour', role: 'owner' },
  correlationId: undefined,
};

const MEMBER = {
  userId: 'u1',
  displayName: 'Avery',
  email: 'avery@example.test',
  role: 'owner' as const,
  canDownload: true,
  canInvite: true,
  joinedAt: new Date('2026-09-01T00:00:00Z'),
  grantCount: 0,
};

const INVITATION = {
  id: 'inv1',
  email: 'sam@example.test',
  scopeType: 'song' as const,
  scopeId: 'song1',
  role: 'viewer' as const,
  expiresAt: new Date('2026-10-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  current.currentWorkspace.mockResolvedValue(CONTEXT);
  current.workspaceRequest.mockReturnValue({ workspaceId: 'w1' });
  invitationCtx.invitationContext.mockReturnValue({ workspaceId: 'w1' });
  settingsUseCases.readMemberManagement.mockResolvedValue([MEMBER]);
  invitationService.pendingInvitations.mockResolvedValue([]);
});

describe('the member management page', () => {
  it('lists members, and invites and pending invitations sections', async () => {
    invitationService.pendingInvitations.mockResolvedValue([INVITATION]);

    render(await MembersPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite someone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument();
    expect(screen.getByText('Avery')).toBeInTheDocument();
    expect(screen.getByText('sam@example.test')).toBeInTheDocument();
  });

  it('says so when there are no invitations pending', async () => {
    render(await MembersPage());
    expect(screen.getByText('No invitations are pending.')).toBeInTheDocument();
  });

  it('shows a scope-limited collaborator’s grant count in place of a role', async () => {
    settingsUseCases.readMemberManagement.mockResolvedValue([
      { ...MEMBER, userId: 'u2', displayName: 'Sam', role: null, grantCount: 2 },
    ]);
    render(await MembersPage());
    expect(within(screen.getByRole('list')).getByText('2 scopes')).toBeInTheDocument();
  });

  it('is not found for someone the member-management use case refuses', async () => {
    settingsUseCases.readMemberManagement.mockRejectedValue(forbidden());
    await expect(MembersPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is not found for someone the invitations use case refuses', async () => {
    invitationService.pendingInvitations.mockRejectedValue(forbidden());
    await expect(MembersPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is not found without a workspace', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    await expect(MembersPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(settingsUseCases.readMemberManagement).not.toHaveBeenCalled();
  });

  it('lets anything else surface as the error it is', async () => {
    settingsUseCases.readMemberManagement.mockRejectedValue(new Error('boom'));
    await expect(MembersPage()).rejects.toThrow('boom');
  });
});
