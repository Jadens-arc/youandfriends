import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeMic } from '@/lib/audio/__tests__/fake-mic';
import type { Recording } from '@/lib/audio/recorder';

import { CommentsPanel } from '../comments-panel';
import { VoiceNotePlayer } from '../voice-note/voice-note-player';
import { VoiceRecorder } from '../voice-note/voice-recorder';

afterEach(() => vi.unstubAllGlobals());

const phase = () => document.querySelector('[data-voice-phase]')?.getAttribute('data-voice-phase');

function mountRecorder({
  mic = fakeMic(),
  upload = vi.fn(async (_songId: string, _recording: Recording) => 'A-voice' as string | null),
  onRecorded = vi.fn(async (_assetId: string) => true),
} = {}) {
  render(<VoiceRecorder songId="S1" deps={mic.deps} upload={upload} onRecorded={onRecorded} />);
  return { mic, upload, onRecorded };
}

describe('recording a voice note (task 093)', () => {
  it('explains the microphone before the browser asks for it', async () => {
    const { mic } = mountRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    expect(screen.getByText(/Your browser will ask to use your microphone/)).toBeInTheDocument();
    expect(mic.requested).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    expect(mic.requested).toHaveLength(1);
    expect(phase()).toBe('recording');
  });

  it('counts down to the limit, then uploads, posts, and releases the microphone on stop', async () => {
    const { mic, upload, onRecorded } = mountRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    act(() => mic.advance(12_000));
    expect(screen.getByText('0:12')).toBeInTheDocument();
    expect(screen.getByText('2:48')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop and post' }));
    });
    expect(mic.live()).toBe(0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[1]).toMatchObject({ durationMs: 12_000 });
    expect(onRecorded).toHaveBeenCalledWith('A-voice');
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument();
  });

  it('warns once, politely, when thirty seconds are left', async () => {
    const { mic } = mountRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('');
    act(() => mic.advance(151_000));
    expect(live?.textContent).toBe('30 seconds of recording left.');
  });

  it('posts what was recorded when the limit stops it', async () => {
    const { mic, onRecorded } = mountRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    await act(async () => {
      mic.advance(181_000);
    });
    expect(mic.live()).toBe(0);
    expect(onRecorded).toHaveBeenCalledWith('A-voice');
  });

  it('discards without uploading', async () => {
    const { mic, upload } = mountRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    });
    expect(mic.live()).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it('says plainly when the microphone was refused, and nothing was recorded', async () => {
    const { upload } = mountRecorder({ mic: fakeMic({ refuse: 'NotAllowedError' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/microphone was not allowed/);
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument();
  });

  it('keeps a failed upload to try again, and says it was not posted', async () => {
    const upload = vi
      .fn<(songId: string, recording: Recording) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('A-second');
    const { mic, onRecorded } = mountRecorder({ upload });
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    });
    act(() => mic.advance(5_000));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop and post' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('hasn’t been posted');
    expect(onRecorded).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try the upload again' }));
    });
    expect(upload.mock.calls[1]?.[1]).toBe(upload.mock.calls[0]?.[1]);
    expect(onRecorded).toHaveBeenCalledWith('A-second');
  });
});

const VOICE = (state: 'processing' | 'ready' | 'failed') => ({
  assetId: 'A-voice',
  durationMs: 12_400,
  state,
});

describe('hearing a voice note (task 093)', () => {
  it('names it — whose, how long — before anyone plays it', () => {
    render(<VoiceNotePlayer songId="S1" voiceNote={VOICE('processing')} author="Sam" />);
    expect(screen.getByRole('group', { name: 'Voice note by Sam, 0:12' })).toBeInTheDocument();
    expect(screen.getByText(/being prepared for playback/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so when it could not be prepared', () => {
    render(<VoiceNotePlayer songId="S1" voiceNote={VOICE('failed')} author="Sam" />);
    expect(screen.getByText(/couldn’t be prepared for playback/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fetches a stream only when pressed, and plays it', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.endsWith('/stream')
          ? new Response(JSON.stringify({ url: 'https://media.test/v', expiresAt: 'x' }))
          : new Response(null, { status: 409 });
      }),
    );
    const played: string[] = [];
    class FakeAudio extends EventTarget {
      currentTime = 0;
      duration = 12.4;
      constructor(readonly src: string) {
        super();
      }
      async play() {
        played.push(this.src);
        this.dispatchEvent(new Event('play'));
      }
      pause() {
        this.dispatchEvent(new Event('pause'));
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    render(<VoiceNotePlayer songId="S1" voiceNote={VOICE('ready')} author="Sam" />);
    await act(async () => {});
    expect(urls.some((url) => url.endsWith('/stream'))).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play the voice note by Sam' }));
    });
    expect(urls).toContain('/api/songs/S1/voice-notes/A-voice/stream');
    expect(played).toEqual(['https://media.test/v']);
    expect(screen.getByRole('button', { name: 'Pause the voice note by Sam' })).toBeInTheDocument();
  });

  it('says it cannot be played when the stream is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    render(<VoiceNotePlayer songId="S1" voiceNote={VOICE('ready')} author="Sam" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play the voice note by Sam' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('can’t be played right now');
  });
});

function stubThreads(songId: string, canComment: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === `/api/songs/${songId}/comments`
        ? new Response(
            JSON.stringify({
              canComment,
              threads: [
                {
                  id: 'T1',
                  anchor: { kind: 'general' },
                  resolvedAt: null,
                  resolvedBy: null,
                  comments: [
                    {
                      id: 'C1',
                      author: 'Sam',
                      body: '',
                      voiceNote: VOICE('processing'),
                      createdAt: '2026-09-24T10:00:00.000Z',
                      editedAt: null,
                      deleted: false,
                      canEdit: false,
                      canDelete: false,
                    },
                  ],
                },
              ],
            }),
          )
        : new Response(null, { status: 409 }),
    ),
  );
}

describe('voice notes in the conversation (task 093)', () => {
  it('shows a voice-only comment by what it is, and names its thread', async () => {
    stubThreads('S-voice', true);
    render(<CommentsPanel songId="S-voice" />);
    await act(async () => {});
    expect(
      screen.getByRole('article', { name: 'Thread: a voice note by Sam' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Voice note by Sam, 0:12' })).toBeInTheDocument();
  });

  it('offers recording to commenters, and says so where the browser cannot record', async () => {
    stubThreads('S-rec', true);
    render(<CommentsPanel songId="S-rec" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    // jsdom has no MediaRecorder: the honest answer, not a silent button.
    expect(screen.getByText('This browser can’t record audio here.')).toBeInTheDocument();
  });

  it('offers no recording to someone who may only view — but they can still hear', async () => {
    stubThreads('S-viewer', false);
    render(<CommentsPanel songId="S-viewer" />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Voice note by Sam, 0:12' })).toBeInTheDocument();
  });
});
