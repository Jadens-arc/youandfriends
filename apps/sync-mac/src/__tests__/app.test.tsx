import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../app';
import { loadStatus } from '../status';

describe('the agent window (task 111)', () => {
  it('shows the status the agent reports, in its words', async () => {
    render(
      <App
        load={async () => ({
          state: 'unpaired',
          summary: 'Not paired. Pair this Mac from Settings → Devices.',
          version: '0.1.0',
        })}
      />,
    );
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Not paired.');
    expect(screen.getByText('Version 0.1.0')).toBeInTheDocument();
  });

  it('says it cannot tell, rather than guessing, when the answer is missing or unknown', async () => {
    expect(
      await loadStatus(async () => ({ state: 'syncing_everything', summary: 'x', version: '1' })),
    ).toBeNull();
    expect(await loadStatus(async () => null)).toBeNull();
    expect(
      await loadStatus(async () => {
        throw new Error('not inside the app');
      }),
    ).toBeNull();
    render(<App load={async () => null} />);
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
  });
});
