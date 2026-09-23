import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceSettings } from '@/lib/workspace/settings';

import { RenameForm, type RenameAction } from '../rename-form';
import { WorkspaceSettingsView } from '../workspace-settings';

const GB = 1024 ** 3;

function settings(overrides: Partial<WorkspaceSettings> = {}): WorkspaceSettings {
  return {
    name: 'Blue Hour Sessions',
    usage: { usedBytes: 12 * GB, refreshedAt: new Date('2026-09-22T10:00:00Z') },
    quotaBytes: 100 * GB,
    members: [
      {
        userId: 'u1',
        displayName: 'Avery Stone',
        email: 'avery@example.test',
        role: 'owner',
        canDownload: true,
        canInvite: true,
        joinedAt: new Date('2026-09-01T00:00:00Z'),
      },
      {
        userId: 'u2',
        displayName: 'Sam Reyes',
        email: 'sam@example.test',
        role: 'editor',
        canDownload: true,
        canInvite: false,
        joinedAt: new Date('2026-09-02T00:00:00Z'),
      },
    ],
    mayRename: true,
    mayManageMembers: true,
    ...overrides,
  };
}

const noop: RenameAction = async () => ({ status: 'idle' });

describe('workspace settings', () => {
  it('shows usage as words and as a labelled meter, never by the bar alone', () => {
    render(<WorkspaceSettingsView settings={settings()} renameAction={noop} />);

    expect(screen.getByText(/12 GB of 100 GB used/)).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: 'Storage used' });
    expect(meter).toHaveAttribute('aria-valuenow', '12');
    expect(meter).toHaveAttribute('aria-valuetext', '12 GB of 100 GB used');
    expect(screen.queryByText('Nearly full')).not.toBeInTheDocument();
  });

  it('says a nearly full workspace is nearly full, in words', () => {
    render(
      <WorkspaceSettingsView
        settings={settings({ usage: { usedBytes: 95 * GB, refreshedAt: new Date() } })}
        renameAction={noop}
      />,
    );
    expect(screen.getByText('Nearly full')).toBeInTheDocument();
  });

  it('lists members with their roles as words', () => {
    render(<WorkspaceSettingsView settings={settings()} renameAction={noop} />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('Avery Stone')).toBeInTheDocument();
    expect(within(list).getByText('Owner')).toBeInTheDocument();
    expect(within(list).getByText('Editor')).toBeInTheDocument();
  });

  it('offers the owner renaming and member management', () => {
    render(<WorkspaceSettingsView settings={settings()} renameAction={noop} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Blue Hour Sessions');
    expect(screen.getByRole('link', { name: 'Manage members' })).toHaveAttribute(
      'href',
      '/settings/members',
    );
  });

  it('shows a collaborator the name without a form, and no way into member management', () => {
    render(
      <WorkspaceSettingsView
        settings={settings({ mayRename: false, mayManageMembers: false })}
        renameAction={noop}
      />,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage members' })).not.toBeInTheDocument();
  });

  it('shows no address it was not given', () => {
    const base = settings();
    render(
      <WorkspaceSettingsView
        settings={settings({
          mayManageMembers: false,
          members: base.members.map((member) => ({ ...member, email: null })),
        })}
        renameAction={noop}
      />,
    );
    expect(screen.getByText('Avery Stone')).toBeInTheDocument();
    expect(screen.queryByText(/@example\.test/)).not.toBeInTheDocument();
  });

  it('says so when there are no members to list', () => {
    render(<WorkspaceSettingsView settings={settings({ members: [] })} renameAction={noop} />);
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
  });
});

describe('renaming the workspace', () => {
  it('announces a save', async () => {
    const action = vi.fn<RenameAction>(async () => ({ status: 'saved', name: 'New' }));
    render(<RenameForm currentName="Old" action={action} />);

    const input = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'New');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(action.mock.calls[0]?.[1].get('name')).toBe('New');
  });

  it('announces why a name was refused, and marks the field', async () => {
    const action: RenameAction = async () => ({
      status: 'error',
      message: 'Give the workspace a name.',
    });
    render(<RenameForm currentName="Old" action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Give the workspace a name.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
  });
});
