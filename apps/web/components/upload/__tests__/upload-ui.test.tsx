import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UploadDestination, UploadJob, UploadQueue } from '@/lib/upload/store';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { UploadTray } = await import('../upload-tray');
const { UploadDialog, guessChoice, quotaWarning } = await import('../upload-dialog');
const { describeJob, formatEta } = await import('../format');

const DESTINATION: UploadDestination = {
  type: 'asset',
  owner: { songId: 'S1' },
  kind: 'stem',
  label: 'Headlights · Stem',
};

function job(overrides: Partial<UploadJob>): UploadJob {
  return {
    id: 'j1',
    fileName: 'drums.wav',
    sizeBytes: 10 * 1024 * 1024,
    destination: DESTINATION,
    state: 'uploading',
    uploadedBytes: 5 * 1024 * 1024,
    speed: 1024 * 1024,
    etaSeconds: 150,
    error: null,
    ...overrides,
  };
}

/** A queue the tray can render, with its commands recorded. */
function fakeQueue(jobs: readonly UploadJob[]) {
  const calls: string[] = [];
  const record = (name: string) => (id?: string) => {
    calls.push(id === undefined ? name : `${name}:${id}`);
  };
  const queue = {
    subscribe: () => () => {},
    getSnapshot: () => jobs,
    whenCompleted: () => () => {},
    pause: record('pause'),
    resume: record('resume'),
    retry: record('retry'),
    cancel: async (id: string) => record('cancel')(id),
    dismiss: record('dismiss'),
    pauseAll: record('pauseAll'),
    resumeAll: record('resumeAll'),
    cancelAll: async () => record('cancelAll')(),
    clearFinished: record('clearFinished'),
    add: vi.fn(),
  } as unknown as UploadQueue;
  return { queue, calls };
}

describe('UploadTray', () => {
  it('shows each upload with progress, speed, and a smoothed estimate in words', () => {
    const { queue } = fakeQueue([job({})]);
    render(<UploadTray queue={queue} />);
    const tray = screen.getByRole('region', { name: 'Uploads' });
    expect(within(tray).getByText('Uploading 1 file')).toBeInTheDocument();
    expect(within(tray).getByText('To Headlights · Stem')).toBeInTheDocument();
    const bar = within(tray).getByRole('progressbar', { name: 'Uploading drums.wav' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute(
      'aria-valuetext',
      '5.0 MB of 10.0 MB · 1.0 MB/s · about 3 min left',
    );
  });

  it('offers per-file and whole-queue controls', async () => {
    const { queue, calls } = fakeQueue([job({})]);
    render(<UploadTray queue={queue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause drums.wav' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel drums.wav' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    expect(calls).toEqual(['pause:j1', 'cancel:j1', 'pauseAll', 'cancelAll']);
  });

  it('distinguishes a connection problem from a refusal, in words and icon', () => {
    const { queue } = fakeQueue([
      job({
        id: 'a',
        fileName: 'a.wav',
        state: 'failed',
        error: { message: 'The network request failed.', transient: true },
      }),
      job({
        id: 'b',
        fileName: 'b.wav',
        state: 'failed',
        error: { message: 'Not found.', transient: false },
      }),
    ]);
    render(<UploadTray queue={queue} />);
    const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(alerts).toEqual(['Connection trouble — The network request failed.', 'Not found.']);
    expect(screen.getByRole('button', { name: 'Retry a.wav' })).toBeInTheDocument();
    expect(screen.getByText('Uploads need attention')).toBeInTheDocument();
  });

  it('asks before the tab closes while anything is moving', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { queue } = fakeQueue([job({})]);
    render(<UploadTray queue={queue} />);
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    add.mockRestore();
  });

  it('does not hold the tab hostage once uploads are done', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { queue } = fakeQueue([job({ state: 'completed' })]);
    render(<UploadTray queue={queue} />);
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    add.mockRestore();
  });
});

describe('UploadDialog', () => {
  const song = { type: 'song', id: 'S1', name: 'Headlights' } as const;
  const project = { type: 'project', id: 'P1', name: 'Night Drive' } as const;
  const wav = (name: string, size = 100) =>
    new File([new Uint8Array(size)], name, { type: 'audio/wav' });

  it('guesses sensibly: one mix, several stems, artwork on a project', () => {
    expect(guessChoice(wav('a.wav'), song, 1)).toBe('mix');
    expect(guessChoice(wav('a.wav'), song, 3)).toBe('stem');
    expect(guessChoice(new File([''], 'cover.png', { type: 'image/png' }), project, 0)).toBe(
      'artwork',
    );
    expect(guessChoice(new File([''], 'Song.logicx.zip'), song, 0)).toBe('project_file');
  });

  it('names the destination and queues each file as the kind chosen', async () => {
    const add = vi.fn();
    const onClose = vi.fn();
    render(
      <UploadDialog
        surface={song}
        files={[wav('bass.wav'), wav('keys.wav')]}
        onClose={onClose}
        queue={{ add } as unknown as UploadQueue}
        loadQuota={async () => ({ quota: { usedBytes: 0, quotaBytes: 1e9 }, maxObjectBytes: 1e9 })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Upload to Headlights' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('keys.wav'), 'sample');
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));
    expect(add).toHaveBeenNthCalledWith(
      1,
      [expect.any(File)],
      expect.objectContaining({ kind: 'stem' }),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      [expect.any(File)],
      expect.objectContaining({ kind: 'sample' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses before sending when the files will not fit, and warns near the limit', async () => {
    render(
      <UploadDialog
        surface={song}
        files={[wav('big.wav', 500)]}
        onClose={() => {}}
        queue={{ add: vi.fn() } as unknown as UploadQueue}
        loadQuota={async () => ({
          quota: { usedBytes: 800, quotaBytes: 1000 },
          maxObjectBytes: 1e9,
        })}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/has 200 B left/);
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeDisabled();
    expect(
      quotaWarning({ quota: { usedBytes: 850, quotaBytes: 1000 }, maxObjectBytes: 1e9 }, 100),
    ).toEqual({
      block: false,
      message: 'After this upload the workspace will be 95% full.',
    });
    expect(quotaWarning(null, 100)).toBeNull();
  });
});

describe('estimates', () => {
  it('stays coarse', () => {
    expect(formatEta(4)).toBe('a few seconds left');
    expect(formatEta(42)).toBe('about 40 s left');
    expect(formatEta(150)).toBe('about 3 min left');
    expect(formatEta(3900)).toBe('about 1 h 5 min left');
    expect(formatEta(null)).toBeNull();
    expect(describeJob(job({ state: 'queued' }))).toBe('Waiting');
  });
});
