import { ALWAYS_IN_APP, resolvePreferences, type EmailMode } from '@youandfriends/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationPreferencesForm } from '../notification-preferences';

const view = (available: boolean, emailMode: EmailMode = 'immediate') => ({
  preferences: resolvePreferences([]),
  emailMode,
  alwaysInApp: ALWAYS_IN_APP,
  email: { available },
});

function server(available: boolean, save: () => Response) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return save();
      }
      return new Response(JSON.stringify(view(available)));
    }),
  );
  return puts;
}

async function mount() {
  render(<NotificationPreferencesForm />);
  await act(async () => {});
}

afterEach(() => vi.unstubAllGlobals());

describe('notification preferences (task 096)', () => {
  it('groups events, with the required ones shown on and locked in the app', async () => {
    server(true, () => new Response(JSON.stringify(view(true))));
    await mount();
    for (const legend of ['Conversation', 'Uploads and versions', 'Lyrics and details', 'Access']) {
      expect(screen.getByRole('group', { name: legend })).toBeInTheDocument();
    }
    const mention = screen.getByRole('checkbox', { name: 'Someone mentions you — in the app' });
    expect(mention).toBeChecked();
    expect(mention).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'New comments — in the app' })).not.toBeDisabled();
    // Conservative email: addressed to you on, every comment off.
    expect(screen.getByRole('checkbox', { name: 'Someone mentions you — by email' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'New comments — by email' })).not.toBeChecked();
  });

  it('offers no email switch at all when email is not set up, and says so', async () => {
    server(false, () => new Response(null, { status: 422 }));
    await mount();
    expect(screen.getByText(/Email notifications aren’t available yet/)).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox', { name: /by email/ })).toEqual([]);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('saves a change as it is made, and puts it back if it does not save', async () => {
    const puts = server(true, () => new Response(null, { status: 500 }));
    await mount();
    const comments = screen.getByRole('checkbox', { name: 'New comments — in the app' });
    await act(async () => {
      fireEvent.click(comments);
    });
    expect(puts[0]).toEqual({
      preferences: [{ event: 'comment.created', channel: 'in_app', enabled: false }],
    });
    expect(comments).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('New comments in the app didn’t save.');
  });

  it('chooses between email as it happens and a daily digest', async () => {
    const puts = server(true, () => new Response(JSON.stringify(view(true, 'daily'))));
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Once a day, in one email' }));
    });
    expect(puts[0]).toEqual({ emailMode: 'daily' });
    expect(screen.getByRole('radio', { name: 'Once a day, in one email' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('When to email saved.');
  });
});
