import { AppError, forbidden, validationFailed } from '@youandfriends/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings routes' own logic: what they do with a missing workspace, a refusal, and a
 * success. The use cases they call are tested against a real database in
 * `lib/workspace/__tests__/settings.test.ts`; here they are stand-ins, because the question is
 * how the route responds, not what the database says.
 */

/**
 * `MembersPage` and its actions have grown their own dependency graph (invitations, member
 * management) and their own tests — `members/__tests__/page.test.tsx` and
 * `members/__tests__/actions.test.tsx`. This file stays with the settings overview.
 */

const current = vi.hoisted(() => ({ currentWorkspace: vi.fn(), workspaceRequest: vi.fn() }));
const useCases = vi.hoisted(() => ({
  readWorkspaceSettings: vi.fn(),
  renameCurrentWorkspace: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/workspace/current', () => current);
vi.mock('@/lib/workspace/settings', () => useCases);
vi.mock('next/navigation', () => navigation);
vi.mock('next/cache', () => cache);

const { default: SettingsPage } = await import('../page');
const { renameWorkspaceAction } = await import('../actions');

const CONTEXT = {
  subject: { kind: 'member', userId: 'u1' },
  userId: 'u1',
  workspace: { workspaceId: 'w1', name: 'Blue Hour', role: 'owner' },
  correlationId: undefined,
};

const SETTINGS = {
  name: 'Blue Hour',
  usage: { usedBytes: 0, refreshedAt: new Date() },
  quotaBytes: 1024 ** 3,
  members: [],
  mayRename: false,
  mayManageMembers: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  current.currentWorkspace.mockResolvedValue(CONTEXT);
  current.workspaceRequest.mockReturnValue({ workspaceId: 'w1' });
});

describe('the settings page', () => {
  it('renders the settings it was given, with the configured quota', async () => {
    useCases.readWorkspaceSettings.mockResolvedValue(SETTINGS);
    vi.stubEnv('YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES', String(5 * 1024 ** 3));

    render(await SettingsPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    // Read from configuration, not a constant (ADR 0001).
    expect(useCases.readWorkspaceSettings).toHaveBeenCalledWith(
      { workspaceId: 'w1' },
      5 * 1024 ** 3,
    );
    vi.unstubAllEnvs();
  });

  it('is not found when there is no workspace to show', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(useCases.readWorkspaceSettings).not.toHaveBeenCalled();
  });

  it('is not found — never forbidden — when refused', async () => {
    useCases.readWorkspaceSettings.mockRejectedValue(forbidden());
    await expect(SettingsPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('lets anything else surface as the error it is', async () => {
    useCases.readWorkspaceSettings.mockRejectedValue(new Error('database down'));
    await expect(SettingsPage()).rejects.toThrow('database down');
  });
});

describe('the rename action', () => {
  const form = (name: string) => {
    const data = new FormData();
    data.set('name', name);
    return data;
  };

  it('saves, and re-renders everything that shows the name', async () => {
    useCases.renameCurrentWorkspace.mockResolvedValue({ name: 'New' });
    expect(await renameWorkspaceAction({ status: 'idle' }, form('New'))).toEqual({
      status: 'saved',
      name: 'New',
    });
    expect(useCases.renameCurrentWorkspace).toHaveBeenCalledWith({ workspaceId: 'w1' }, 'New');
    expect(cache.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('passes the field’s own message back for an invalid name', async () => {
    useCases.renameCurrentWorkspace.mockRejectedValue(
      validationFailed([{ path: '', message: 'Give the workspace a name.' }]),
    );
    expect(await renameWorkspaceAction({ status: 'idle' }, form(''))).toEqual({
      status: 'error',
      message: 'Give the workspace a name.',
    });
  });

  it('says only "not found" when refused', async () => {
    useCases.renameCurrentWorkspace.mockRejectedValue(forbidden());
    expect(await renameWorkspaceAction({ status: 'idle' }, form('x'))).toEqual({
      status: 'error',
      message: 'That workspace could not be found.',
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses without a workspace, before touching anything', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    expect(await renameWorkspaceAction({ status: 'idle' }, form('x'))).toMatchObject({
      status: 'error',
    });
    expect(useCases.renameCurrentWorkspace).not.toHaveBeenCalled();
  });

  it('does not disguise an unexpected failure as a validation message', async () => {
    useCases.renameCurrentWorkspace.mockRejectedValue(new AppError('internal'));
    await expect(renameWorkspaceAction({ status: 'idle' }, form('x'))).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
