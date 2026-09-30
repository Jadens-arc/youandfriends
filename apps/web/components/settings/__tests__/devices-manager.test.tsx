import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevicesManager } from '../devices-manager';

const TOKEN = ['yaf', 'sync', '01J00000000000000000000000', 'EXAMPLENOTAREALSECRET'].join('_');

const device = (overrides: Record<string, unknown>) => ({
  id: '01J0000000000000000000DEV1',
  name: 'Studio iMac',
  pairedBy: 'Avery',
  mine: true,
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  destinations: [{ projectId: 'P1', name: 'Night Drive' }],
  ...overrides,
});

function server(devices: unknown[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/uploads/destinations') {
        return new Response(
          JSON.stringify({
            destinations: [
              { type: 'project', id: 'P1', name: 'Night Drive' },
              { type: 'song', id: 'S1', name: 'Headlights' },
            ],
          }),
        );
      }
      if (method === 'POST') {
        return new Response(JSON.stringify({ deviceId: 'D2', token: TOKEN, expiresAt: null }), {
          status: 201,
        });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ devices }));
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

async function mount() {
  render(<DevicesManager />);
  await act(async () => {});
}

describe('device management (task 110)', () => {
  it('shows each device: where it uploads, when it was last used, and whether it is connected', async () => {
    server([
      device({ lastUsedAt: '2026-09-29T10:00:00.000Z' }),
      device({ id: 'D0', name: 'Old Laptop', revokedAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    await mount();
    const list = screen.getByRole('list', { name: 'Paired devices' });
    const [studio, old] = within(list).getAllByRole('listitem');
    expect(studio).toHaveTextContent('Studio iMac · Connected');
    expect(studio).toHaveTextContent('Uploads to Night Drive');
    expect(studio?.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-09-29T10:00:00.000Z',
    );
    expect(old).toHaveTextContent('Old Laptop · Disconnected');
    expect(within(old as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('pairs into projects only, and shows the token once, saying so', async () => {
    const calls = server([]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pair a Mac' }));
    // Projects are offered; songs are not destinations.
    expect(screen.getByRole('checkbox', { name: 'Night Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Headlights' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Studio iMac' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Night Drive' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pair device' }));
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Studio iMac',
      projectIds: ['P1'],
      expiresInDays: 90,
    });
    expect(screen.getByLabelText('Pairing token')).toHaveValue(TOKEN);
    expect(screen.getByText(/won’t be shown again/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Pairing token')).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('disconnects a device after confirming', async () => {
    const calls = server([device({})]);
    vi.stubGlobal('confirm', () => true);
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect Studio iMac' }));
    });
    expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('DEV1'))).toBe(true);
  });
});
