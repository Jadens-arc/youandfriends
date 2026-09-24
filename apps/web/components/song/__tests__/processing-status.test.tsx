import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { version } from './fixtures';

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { ProcessingPoller, ProcessingStatus, VIEWER_FAILURE, describeTransition, POLL_INITIAL_MS } =
  await import('../processing-status');
const { ProcessingBadge } = await import('../status-badge');

function respond(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('processing status (task 065)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router.refresh.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives each state its own word and icon, and never a progress bar', () => {
    const { container, rerender } = render(<ProcessingBadge state="queued" />);
    const seen = new Set<string>();
    for (const state of ['queued', 'running', 'complete', 'failed'] as const) {
      rerender(<ProcessingBadge state={state} />);
      const text = container.textContent ?? '';
      expect(text).not.toBe('');
      seen.add(text);
      // An icon beside the word: state is never colour alone.
      expect(container.querySelector('svg')).not.toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
    }
    expect(seen.size).toBe(4);
    rerender(<ProcessingBadge state="running" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-safe:animate-spin',
    );
  });

  it('tells a viewer that a version failed, without the reason, a reference, or a retry', () => {
    render(
      <ProcessingStatus
        songId="S1"
        version={version({ processingState: 'failed', processingError: null })}
        canRetry={false}
      />,
    );
    expect(screen.getByText(VIEWER_FAILURE)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Reference/)).toBeNull();
  });

  it('gives an editor the reason in plain words, a reference to quote, and a retry that reports refusals', async () => {
    fetchMock.mockResolvedValueOnce(
      respond(
        {
          code: 'conflict',
          message: 'This changed somewhere else. Reload and try again.',
          correlationId: 'corr-123',
        },
        409,
      ),
    );
    render(
      <ProcessingStatus
        songId="S1"
        version={version({
          id: 'V9',
          processingState: 'failed',
          processingError: 'This file doesn’t appear to be audio we can process.',
          processingReference: 'run_abc',
        })}
        canRetry
      />,
    );
    expect(screen.getByText(/doesn’t appear to be audio/)).toBeInTheDocument();
    expect(screen.getByText('run_abc')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try processing again/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/S1/versions/V9/retry',
      expect.objectContaining({ method: 'POST' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reload and try again');
    expect(alert).toHaveTextContent('corr-123');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('refreshes the page after a successful retry', async () => {
    fetchMock.mockResolvedValueOnce(respond(null, 204));
    render(
      <ProcessingStatus
        songId="S1"
        version={version({ processingState: 'failed', processingError: 'x' })}
        canRetry
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /try processing again/i }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('polls while a version is pending, backing off, and refreshes when one changes', async () => {
    vi.useFakeTimers();
    const pending = [version({ id: 'V2', number: 2, processingState: 'running' })];
    fetchMock.mockResolvedValue(respond({ versions: [{ id: 'V2', processingState: 'running' }] }));
    render(<ProcessingPoller songId="S1" versions={pending} />);

    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INITIAL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/songs/S1/versions/status');
    // Backed off: the second poll waits longer than the first did.
    await act(() => vi.advanceTimersByTimeAsync(POLL_INITIAL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(POLL_INITIAL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(router.refresh).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(respond({ versions: [{ id: 'V2', processingState: 'complete' }] }));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not poll when nothing is pending', async () => {
    vi.useFakeTimers();
    render(
      <ProcessingPoller
        songId="S1"
        versions={[
          version({ processingState: 'complete' }),
          version({ id: 'V2', processingState: 'failed' }),
        ]}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('announces a version finishing once fresh props arrive', () => {
    const { rerender } = render(
      <ProcessingPoller
        songId="S1"
        versions={[version({ id: 'V2', number: 2, processingState: 'running' })]}
      />,
    );
    rerender(
      <ProcessingPoller
        songId="S1"
        versions={[version({ id: 'V2', number: 2, processingState: 'complete' })]}
      />,
    );
    expect(screen.getByText('Version 2 is ready.')).toBeInTheDocument();
  });

  it('describes only transitions worth saying', () => {
    expect(describeTransition(3, 'running', 'complete')).toBe('Version 3 is ready.');
    expect(describeTransition(3, 'running', 'failed')).toBe('Version 3 could not be processed.');
    expect(describeTransition(3, 'queued', 'running')).toBe('Version 3 is processing.');
    expect(describeTransition(3, 'complete', 'complete')).toBeNull();
    expect(describeTransition(3, undefined, 'complete')).toBeNull();
  });
});
