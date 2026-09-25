import { vi } from 'vitest';

import type { RecorderDeps } from '../recorder';

/**
 * A microphone and a MediaRecorder for tests (task `093`): the stream's tracks record whether
 * they were stopped — the thing that turns the browser's "microphone in use" indicator off — and
 * the clock and interval are driven by hand.
 */
export function fakeMic({
  refuse = null,
  supported = ['audio/webm;codecs=opus'],
  recorderThrows = false,
}: {
  readonly refuse?: string | null;
  readonly supported?: readonly string[];
  readonly recorderThrows?: boolean;
} = {}) {
  let clock = 1_000;
  let tick: (() => void) | null = null;
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const requested: MediaStreamConstraints[] = [];
  const recorders: {
    mimeType: string;
    state: string;
    ondataavailable: ((event: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
    onerror: ((event: unknown) => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: () => void;
  }[] = [];

  const deps: Omit<RecorderDeps, 'onChange' | 'onLimit'> = {
    getUserMedia: async (constraints) => {
      requested.push(constraints);
      if (refuse !== null) throw Object.assign(new Error(refuse), { name: refuse });
      return stream;
    },
    createRecorder: (_stream, options) => {
      if (recorderThrows) throw new Error('NotSupportedError');
      const recorder = {
        mimeType: options.mimeType ?? 'audio/webm',
        state: 'inactive',
        ondataavailable: null as ((event: { data: Blob }) => void) | null,
        onstop: null as (() => void) | null,
        onerror: null as ((event: unknown) => void) | null,
        start: vi.fn(() => {
          recorder.state = 'recording';
        }),
        stop: () => {
          recorder.state = 'inactive';
          // As a browser does: the last chunk, then stop — asynchronously.
          queueMicrotask(() => {
            recorder.ondataavailable?.({
              data: new Blob([new Uint8Array(512)], { type: recorder.mimeType }),
            });
            recorder.onstop?.();
          });
        },
      };
      recorders.push(recorder);
      return recorder;
    },
    isTypeSupported: (type) => supported.includes(type),
    now: () => clock,
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  };

  return {
    deps,
    tracks,
    requested,
    recorders,
    /** Tracks still live — the microphone indicator is on while this is non-zero. */
    live: () => tracks.filter((track) => track.stop.mock.calls.length === 0).length,
    advance(ms: number) {
      clock += ms;
      tick?.();
    },
    ticking: () => tick !== null,
  };
}
