import type { LyricsDocument } from '@youandfriends/contracts';

/**
 * Lyrics autosave (task `080`): debounced on idle, flushed on blur, page hide and navigation, and
 * honest about where the words are.
 *
 * States, each said in words by `SaveStateIndicator`:
 * - `saved` — what is on screen is what Postgres holds.
 * - `dirty` — edited, waiting for a pause in typing.
 * - `saving` — on its way.
 * - `offline` — could not reach the server; the edit is kept in this tab and retried when the
 *   connection returns. Never "saved".
 * - `conflict` — someone saved a newer version first; nothing was overwritten.
 * - `refused` — this person may no longer edit the song; nothing more will be sent.
 *
 * Edits are held in memory only — never written to `localStorage`, where unpublished words would
 * outlive the tab on a shared machine.
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'refused';

export type SaveOutcome =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly kind: 'conflict' | 'offline' | 'refused' | 'invalid' };

export type SaveLyrics = (
  document: LyricsDocument,
  baseVersion: number,
  options: { readonly keepalive: boolean },
) => Promise<SaveOutcome>;

/** Idle time before an edit is saved. */
export const AUTOSAVE_DEBOUNCE_MS = 1_500;
/** While offline, how often to try again besides the `online` event. */
export const OFFLINE_RETRY_MS = 15_000;

export interface AutosaveOptions {
  readonly version: number;
  readonly save: SaveLyrics;
  readonly onChange?: (state: SaveState, version: number) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface Autosave {
  readonly state: () => SaveState;
  readonly version: () => number;
  /** The editor changed. */
  edit(document: LyricsDocument): void;
  /** Save now if anything is waiting — on blur, page hide, navigation. */
  flush(options?: { readonly keepalive?: boolean }): Promise<void>;
  /** After a conflict: adopt the server's newer version as the new base. */
  rebase(version: number): void;
  dispose(): void;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let state: SaveState = 'saved';
  let version = options.version;
  let pending: LyricsDocument | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: unknown = null;
  let disposed = false;

  function set(next: SaveState) {
    state = next;
    options.onChange?.(state, version);
  }

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms: number) {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, ms);
  }

  async function flush(flushOptions: { readonly keepalive?: boolean } = {}): Promise<void> {
    if (disposed || state === 'conflict' || state === 'refused') return;
    if (inFlight !== null) {
      // One save at a time; whatever arrived meanwhile goes right after it.
      await inFlight;
      if (pending !== null) return flush(flushOptions);
      return;
    }
    const document = pending;
    if (document === null) return;
    cancelTimer();
    pending = null;
    set('saving');
    inFlight = (async () => {
      const outcome = await options.save(document, version, {
        keepalive: flushOptions.keepalive ?? false,
      });
      inFlight = null;
      if (outcome.ok) {
        version = outcome.version;
        if (pending !== null) {
          set('dirty');
          schedule(0);
        } else {
          set('saved');
        }
        return;
      }
      // Not saved: whatever was being sent is still the newest thing unless typing continued.
      pending ??= document;
      if (outcome.kind === 'offline') {
        set('offline');
        schedule(OFFLINE_RETRY_MS);
      } else if (outcome.kind === 'conflict') {
        set('conflict');
      } else {
        // Refused (access lost) or invalid (the document broke a rule): stop sending.
        set('refused');
      }
    })();
    await inFlight;
  }

  return {
    state: () => state,
    version: () => version,
    edit(document) {
      if (disposed || state === 'refused') return;
      pending = document;
      if (state === 'conflict') return; // Kept, but nothing is sent until the conflict is resolved.
      if (state !== 'saving' && state !== 'offline') set('dirty');
      if (state === 'offline') return; // The retry timer is already running.
      schedule(AUTOSAVE_DEBOUNCE_MS);
    },
    flush,
    rebase(next) {
      version = next;
      pending = null;
      set('saved');
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

/**
 * The real save: `PUT /api/songs/:songId/lyrics`, sorted into outcomes. Editing together, the
 * shared Yjs state goes with it (`yjsState`), and the server merges rather than version-checks.
 */
export function httpSave(songId: string, yjsState?: () => string): SaveLyrics {
  return async (document, baseVersion, { keepalive }) => {
    let response: Response;
    try {
      response = await fetch(`/api/songs/${encodeURIComponent(songId)}/lyrics`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          document,
          baseVersion,
          ...(yjsState === undefined ? {} : { yjsState: yjsState() }),
        }),
        // On page hide the page may be gone before the response; `keepalive` lets the request
        // finish anyway (bodies up to 64 KB — a long lyric sheet, comfortably).
        keepalive,
      });
    } catch {
      return { ok: false, kind: 'offline' };
    }
    if (response.ok) {
      const body = (await response.json()) as { version: number };
      return { ok: true, version: body.version };
    }
    if (response.status === 409) return { ok: false, kind: 'conflict' };
    if (response.status === 404 || response.status === 401) return { ok: false, kind: 'refused' };
    if (response.status === 422 || response.status === 400) return { ok: false, kind: 'invalid' };
    return { ok: false, kind: 'offline' };
  };
}
