import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ManagedMember } from '@/lib/workspace/settings';

import { MemberManagementList, type MemberAction } from '../member-management-list';

function member(overrides: Partial<ManagedMember> = {}): ManagedMember {
  return {
    userId: 'u1',
    displayName: 'Avery Stone',
    email: 'avery@example.test',
    role: 'owner',
    canDownload: true,
    canInvite: true,
    joinedAt: new Date('2026-09-01T00:00:00Z'),
    grantCount: 0,
    ...overrides,
  };
}

describe('the member-management list', () => {
  it('says so when there are no members', () => {
    render(
      <MemberManagementList
        members={[]}
        currentUserId="u1"
        changeRoleAction={async () => ({ status: 'idle' })}
        removeAction={async () => ({ status: 'idle' })}
      />,
    );
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
  });

  it('marks the signed-in person’s own row', () => {
    render(
      <MemberManagementList
        members={[member()]}
        currentUserId="u1"
        changeRoleAction={async () => ({ status: 'idle' })}
        removeAction={async () => ({ status: 'idle' })}
      />,
    );
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
  });

  it('offers "Remove", not "Leave", for someone else', () => {
    render(
      <MemberManagementList
        members={[member({ userId: 'u2', displayName: 'Sam Reyes', role: 'editor' })]}
        currentUserId="u1"
        changeRoleAction={async () => ({ status: 'idle' })}
        removeAction={async () => ({ status: 'idle' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.queryByText('(you)')).not.toBeInTheDocument();
  });

  it('shows a scope-limited collaborator’s grant count, and no role control', () => {
    render(
      <MemberManagementList
        members={[member({ userId: 'u2', displayName: 'Sam Reyes', role: null, grantCount: 3 })]}
        currentUserId="u1"
        changeRoleAction={async () => ({ status: 'idle' })}
        removeAction={async () => ({ status: 'idle' })}
      />,
    );
    const row = screen.getByText('Sam Reyes').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('3 scopes')).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('submits a role change with the target member’s id as soon as a role is picked', async () => {
    const changeRoleAction = vi.fn<MemberAction>(async () => ({ status: 'ok' }));
    render(
      <MemberManagementList
        members={[member({ userId: 'u2', displayName: 'Sam Reyes', role: 'viewer' })]}
        currentUserId="u1"
        changeRoleAction={changeRoleAction}
        removeAction={async () => ({ status: 'idle' })}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Role for Sam Reyes'), 'editor');

    expect(changeRoleAction).toHaveBeenCalledTimes(1);
    const submitted = changeRoleAction.mock.calls[0]?.[1];
    expect(submitted?.get('userId')).toBe('u2');
    expect(submitted?.get('role')).toBe('editor');
  });

  it('submits removal with the target member’s id', async () => {
    const removeAction = vi.fn<MemberAction>(async () => ({ status: 'ok' }));
    render(
      <MemberManagementList
        members={[member({ userId: 'u2', displayName: 'Sam Reyes', role: 'editor' })]}
        currentUserId="u1"
        changeRoleAction={async () => ({ status: 'idle' })}
        removeAction={removeAction}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(removeAction).toHaveBeenCalledTimes(1);
    expect(removeAction.mock.calls[0]?.[1].get('userId')).toBe('u2');
  });

  it('announces a refusal from either action', async () => {
    const removeAction = vi.fn<MemberAction>(async () => ({
      status: 'error',
      message: 'A workspace must keep at least one owner.',
    }));
    render(
      <MemberManagementList
        members={[member()]}
        currentUserId="u1"
        changeRoleAction={async () => ({ status: 'idle' })}
        removeAction={removeAction}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(
      await screen.findByText('A workspace must keep at least one owner.'),
    ).toBeInTheDocument();
  });
});
