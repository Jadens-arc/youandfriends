/**
 * Recording a voice note in the browser (task `093`).
 *
 * - **Nothing records without a press**, and the microphone is requested only then.
 * - **The microphone is released the moment recording ends** — on stop, cancel, the time limit,
 *   an error, or the page going away. Every track of the stream is stopped, so the browser's
 *   "microphone in use" indicator goes out at once; one left on is a real privacy failure.
 * - **A limit is always enforced**, so a forgotten recording cannot grow without end.
 * - The format is whatever the browser records well: WebM/Opus in Chrome and Firefox, MP4/AAC in
 *   Safari. The media pipeline normalizes both; nothing here assumes one.
 */

export type RecorderState =
  'idle' | 'requesting' | 'recording' | 'processing' | 'denied' | 'unsupported' | 'failed';

/** Three minutes: a hummed part, a spoken note — not a rehearsal. Configurable per recorder. */
export const DEFAULT_VOICE_NOTE_LIMIT_MS = 3 * 60_000;

/** In order of preference; the first the browser supports is used, or its own default. */
export const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

export function pickMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
  return PREFERRED_MIME_TYPES.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/** The file extension to name a recording by, from what the browser actually produced. */
export function extensionFor(mimeType: string): string {
  return mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
}

interface RecorderLike {
  readonly mimeType: string;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface RecorderDeps {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly createRecorder: (stream: MediaStream, options: { mimeType?: string }) => RecorderLike;
  readonly isTypeSupported: (type: string) => boolean;
  readonly limitMs?: number;
  readonly now?: () => number;
  readonly setInterval?: (callback: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly onChange?: () => void;
  /** The limit ended the recording: here it is, kept. */
  readonly onLimit?: (recording: Recording | null) => void;
}

export interface Recording {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
}

export interface VoiceRecorder {
  state(): RecorderState;
  elapsedMs(): number;
  remainingMs(): number;
  readonly limitMs: number;
  /** Ask for the microphone and start. Only ever called from a person's press. */
  start(): Promise<void>;
  /** Stop and keep the recording. The microphone is released before this resolves. */
  stop(): Promise<Recording | null>;
  /** Stop and discard. */
  cancel(): void;
  /** Recording failed or was refused: back to idle to try again. */
  reset(): void;
}

/** The real browser APIs, or null where recording is not possible at all. */
export function browserRecorderDeps(): Omit<
  RecorderDeps,
  'onChange' | 'limitMs' | 'onLimit'
> | null {
  if (
    typeof navigator === 'undefined' ||
    navigator.mediaDevices?.getUserMedia === undefined ||
    typeof MediaRecorder === 'undefined'
  ) {
    return null;
  }
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, options) =>
      new MediaRecorder(stream, options) as unknown as RecorderLike,
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
  };
}

export function createVoiceRecorder(deps: RecorderDeps): VoiceRecorder {
  const limitMs = deps.limitMs ?? DEFAULT_VOICE_NOTE_LIMIT_MS;
  const now = deps.now ?? (() => Date.now());
  const every = deps.setInterval ?? ((callback, ms) => setInterval(callback, ms));
  const clear =
    deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let state: RecorderState = 'idle';
  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let endedAt: number | null = null;
  let ticker: unknown = null;
  let finished: ((recording: Recording | null) => void) | null = null;
  let keep = false;

  function set(next: RecorderState) {
    state = next;
    deps.onChange?.();
  }

  /** Release the microphone: every track, now. */
  function release() {
    if (ticker !== null) clear(ticker);
    ticker = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  function end(keepIt: boolean) {
    keep = keepIt;
    endedAt = now();
    release();
    if (recorder !== null && recorder.state !== 'inactive') {
      set(keepIt ? 'processing' : 'idle');
      recorder.stop();
    } else {
      finish();
    }
  }

  function finish() {
    const done = finished;
    finished = null;
    const kept = recorder;
    recorder = null;
    if (!keep || kept === null || chunks.length === 0) {
      chunks = [];
      if (state !== 'failed' && state !== 'denied') set('idle');
      done?.(null);
      return;
    }
    const mimeType = kept.mimeType || chunks[0]?.type || 'audio/webm';
    const recording: Recording = {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      durationMs: Math.min(limitMs, (endedAt ?? now()) - startedAt),
    };
    chunks = [];
    set('idle');
    done?.(recording);
  }

  const self: VoiceRecorder = {
    limitMs,
    state: () => state,
    elapsedMs: () =>
      state === 'recording'
        ? Math.min(limitMs, now() - startedAt)
        : endedAt === null
          ? 0
          : endedAt - startedAt,
    remainingMs: () => Math.max(0, limitMs - self.elapsedMs()),
    async start() {
      if (state !== 'idle') return;
      set('requesting');
      try {
        stream = await deps.getUserMedia({ audio: true });
      } catch (error) {
        release();
        const name = (error as { name?: string }).name;
        set(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
        return;
      }
      // The press might have been cancelled while the prompt was up.
      if ((state as RecorderState) !== 'requesting') {
        release();
        return;
      }
      try {
        const mimeType = pickMimeType(deps.isTypeSupported);
        recorder = deps.createRecorder(stream, mimeType === undefined ? {} : { mimeType });
      } catch {
        release();
        set('unsupported');
        return;
      }
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = finish;
      recorder.onerror = () => {
        keep = false;
        release();
        set('failed');
        finish();
      };
      startedAt = now();
      endedAt = null;
      recorder.start(1_000);
      set('recording');
      ticker = every(() => {
        if (now() - startedAt >= limitMs) {
          // The limit: stop, and hand what was recorded to whoever is listening for it.
          void self.stop().then((recording) => deps.onLimit?.(recording));
        } else {
          deps.onChange?.();
        }
      }, 250);
    },
    stop() {
      if (state !== 'recording') return Promise.resolve(null);
      return new Promise<Recording | null>((resolve) => {
        finished = resolve;
        end(true);
      });
    },
    cancel() {
      if (state === 'requesting') {
        set('idle');
        return;
      }
      if (state !== 'recording') return;
      end(false);
    },
    reset() {
      release();
      if (state === 'denied' || state === 'failed' || state === 'unsupported') set('idle');
    },
  };
  return self;
}
