import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MemberAction } from '../member-management-list';
import { PendingInvitations, type PendingInvitation } from '../pending-invitations';

function invitation(overrides: Partial<PendingInvitation> = {}): PendingInvitation {
  return {
    id: 'inv1',
    email: 'sam@example.test',
    scopeType: 'song',
    scopeId: 'song_1',
    role: 'viewer',
    expiresAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

describe('pending invitations', () => {
  it('says so when there are none', () => {
    render(<PendingInvitations invitations={[]} revokeAction={async () => ({ status: 'idle' })} />);
    expect(screen.getByText('No invitations are pending.')).toBeInTheDocument();
  });

  it('shows the address, scope, and role', () => {
    render(
      <PendingInvitations
        invitations={[invitation()]}
        revokeAction={async () => ({ status: 'idle' })}
      />,
    );
    expect(screen.getByText('sam@example.test')).toBeInTheDocument();
    expect(screen.getByText(/song song_1/)).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('revokes the invitation this row is for, not another one', async () => {
    const revokeAction = vi.fn<MemberAction>(async () => ({ status: 'ok' }));
    render(
      <PendingInvitations
        invitations={[
          invitation({ id: 'inv1', email: 'sam@example.test' }),
          invitation({ id: 'inv2', email: 'jamie@example.test' }),
        ]}
        revokeAction={revokeAction}
      />,
    );

    const jamieRow = screen.getByText('jamie@example.test').closest('li');
    expect(jamieRow).not.toBeNull();
    await userEvent.click(
      Array.from((jamieRow as HTMLElement).querySelectorAll('button')).find(
        (b) => b.textContent === 'Revoke',
      )!,
    );

    expect(revokeAction).toHaveBeenCalledTimes(1);
    expect(revokeAction.mock.calls[0]?.[1].get('invitationId')).toBe('inv2');
  });

  it('announces a refusal', async () => {
    const revokeAction = vi.fn<MemberAction>(async () => ({
      status: 'error',
      message: 'That invitation is no longer pending.',
    }));
    render(<PendingInvitations invitations={[invitation()]} revokeAction={revokeAction} />);

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument();
  });
});
