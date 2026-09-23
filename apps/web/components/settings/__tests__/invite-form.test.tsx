import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteForm, type InviteAction, type InviteState } from '../invite-form';

/**
 * What each rule needs (CLAUDE.md §13): the "sent" state has to show a link *and* let it be
 * copied, so a fixture that renders a link without a working copy button would still pass a
 * shallow "the link shows up" test; the checkbox names have to actually reach the action's
 * `FormData`, so a test that only clicks them without reading what was submitted would not
 * catch a checkbox whose `name` doesn't match what the action reads.
 */

beforeEach(() => {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('inviting a collaborator', () => {
  it('submits email, scope, role, and only the capabilities that were checked', async () => {
    const action = vi.fn<InviteAction>(async () => ({
      status: 'sent',
      link: 'https://app.youandfriends.org/invite/tok',
      email: 'sam@example.test',
    }));
    render(<InviteForm action={action} />);

    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.test');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'editor');
    await userEvent.selectOptions(screen.getByLabelText('Scope'), 'project');
    await userEvent.type(screen.getByLabelText('Scope id'), 'proj_123');
    await userEvent.click(screen.getByLabelText('Can download originals'));
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get('email')).toBe('sam@example.test');
    expect(submitted?.get('role')).toBe('editor');
    expect(submitted?.get('scopeType')).toBe('project');
    expect(submitted?.get('scopeId')).toBe('proj_123');
    expect(submitted?.get('canDownload')).toBe('on');
    // Never checked — must be absent, not merely falsy, so the action's own
    // `formData.get('canInvite') === 'on'` reads it as false rather than throwing on `null`.
    expect(submitted?.get('canInvite')).toBeNull();
  });

  it('shows the one-time link and copies it on request', async () => {
    const action = vi.fn<InviteAction>(async () => ({
      status: 'sent',
      link: 'https://app.youandfriends.org/invite/tok',
      email: 'sam@example.test',
    }));
    render(<InviteForm action={action} />);

    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.test');
    await userEvent.type(screen.getByLabelText('Scope id'), 'song_1');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    const link = await screen.findByLabelText('Invitation link');
    expect(link).toHaveValue('https://app.youandfriends.org/invite/tok');

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://app.youandfriends.org/invite/tok',
    );
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('announces a refusal without showing a link', async () => {
    const action = vi.fn<InviteAction>(async () => ({
      status: 'error',
      message: 'You cannot invite someone to a higher role than your own (viewer).',
    }));
    render(<InviteForm action={action} />);

    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.test');
    await userEvent.type(screen.getByLabelText('Scope id'), 'song_1');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(
      await screen.findByText('You cannot invite someone to a higher role than your own (viewer).'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Invitation link')).not.toBeInTheDocument();
  });

  it('defaults to viewer at song scope', () => {
    const noop: InviteAction = async () => ({ status: 'idle' }) as InviteState;
    render(<InviteForm action={noop} />);
    expect(screen.getByLabelText('Role')).toHaveValue('viewer');
    expect(screen.getByLabelText('Scope')).toHaveValue('song');
  });
});
