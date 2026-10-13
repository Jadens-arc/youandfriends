import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationPreferences, type PreferencesData } from '../notification-preferences';

function data(available: boolean): PreferencesData {
  return {
    email: { available },
    categories: [
      {
        id: 'conversation',
        label: 'Conversation',
        events: [
          {
            event: 'comment.mentioned',
            label: 'Someone mentions you',
            inApp: true,
            inAppLocked: true,
            email: available ? 'immediate' : 'off',
          },
          {
            event: 'comment.created',
            label: 'New comments',
            inApp: true,
            inAppLocked: false,
            email: 'off',
          },
        ],
      },
    ],
  };
}

function stub(available: boolean, putStatus = 200) {
  const calls: { method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
      if (method === 'PUT' && putStatus !== 200) return new Response(null, { status: putStatus });
      return new Response(JSON.stringify(data(available)));
    }),
  );
  return calls;
}

describe('notification preferences (task 096)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says plainly when email is unavailable, and offers no email control', async () => {
    stub(false);
    render(<NotificationPreferences />);
    await act(async () => {});
    expect(screen.getByText(/Email notifications are not available/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps required in-app notifications on, and says why', async () => {
    stub(true);
    render(<NotificationPreferences />);
    await act(async () => {});
    const boxes = screen.getAllByRole('checkbox', { name: /In the app/ });
    expect(boxes[0]).toBeDisabled();
    expect(boxes[0]).toBeChecked();
    expect(screen.getByText('always on')).toBeInTheDocument();
    expect(boxes[1]).toBeEnabled();
  });

  it('saves a change, and puts it back when the save fails', async () => {
    const calls = stub(true, 500);
    render(<NotificationPreferences />);
    await act(async () => {});
    const select = screen.getByRole('combobox', { name: 'Email for “New comments”' });
    await act(async () => {
      fireEvent.change(select, { target: { value: 'digest' } });
    });
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      preferences: [{ event: 'comment.created', inApp: true, email: 'digest' }],
    });
    expect(select).toHaveValue('off');
    expect(screen.getByText('That change was not saved. Try again.')).toBeInTheDocument();
  });
});
