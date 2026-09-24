'use client';

import type { LyricsDocument } from '@youandfriends/contracts';
import { Button, cn, focusRing } from '@youandfriends/ui';
import { AlertTriangle, Check, CloudOff, Loader2, Lock, PencilLine } from 'lucide-react';
import * as React from 'react';

import { createAutosave, httpSave, type Autosave, type SaveState } from '@/lib/lyrics/autosave';
import { lyricsToText, textToLyrics } from '@/lib/lyrics/text-format';

/**
 * The song's lyrics (task `080`): an autosaving editor with its save state always in words.
 *
 * The editing surface is plain text with bracketed section headings — `[Chorus]` — until the
 * structured editor arrives (task `081`); the section structure round-trips, so nothing written
 * here is lost then. Saves go to Postgres, the canonical store (ADR 0003).
 */

const STATE_TEXT: Readonly<Record<SaveState, string>> = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline — your changes are kept in this tab and will save when you’re back online',
  conflict: 'Someone saved a newer version. Nothing was overwritten.',
  refused: 'You can no longer edit these lyrics. Your last changes were not saved.',
};

const STATE_ICON = {
  saved: Check,
  dirty: PencilLine,
  saving: Loader2,
  offline: CloudOff,
  conflict: AlertTriangle,
  refused: Lock,
} as const;

export function SaveStateIndicator({ state }: { readonly state: SaveState }) {
  const Icon = STATE_ICON[state];
  return (
    <p
      role="status"
      data-save-state={state}
      className={cn(
        'text-caption flex items-center gap-1.5 font-sans',
        state === 'conflict' || state === 'refused' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <Icon
        aria-hidden
        className={cn('size-3.5 shrink-0', state === 'saving' && 'motion-safe:animate-spin')}
      />
      {STATE_TEXT[state]}
    </p>
  );
}

interface Loaded {
  readonly document: LyricsDocument;
  readonly version: number;
  readonly canEdit: boolean;
}

async function fetchLyrics(songId: string): Promise<Loaded | null> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/lyrics`, {
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as Loaded;
}

export function LyricsPanel({
  songId,
  songTitle,
}: {
  readonly songId: string;
  readonly songTitle: string;
}) {
  const [loaded, setLoaded] = React.useState<Loaded | null | 'error'>(null);
  const [text, setText] = React.useState('');
  const [state, setState] = React.useState<SaveState>('saved');
  const [kept, setKept] = React.useState<string | null>(null);
  const autosave = React.useRef<Autosave | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetchLyrics(songId).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setLoaded('error');
        return;
      }
      setLoaded(result);
      setText(lyricsToText(result.document));
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  // One autosave per loaded document, flushed on every way out of the page.
  const baseVersion = loaded !== null && loaded !== 'error' ? loaded.version : null;
  React.useEffect(() => {
    if (baseVersion === null) return;
    const saver = createAutosave({
      version: baseVersion,
      save: httpSave(songId),
      onChange: (next) => setState(next),
    });
    autosave.current = saver;
    const hide = () => {
      if (document.visibilityState === 'hidden') void saver.flush({ keepalive: true });
    };
    // `pagehide` and `visibilitychange`, not `beforeunload`, which mobile Safari does not fire
    // reliably — closing the tab mid-thought must not lose the last lines.
    const pagehide = () => void saver.flush({ keepalive: true });
    const online = () => void saver.flush();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
      // Navigating away inside the app unmounts this: save what is waiting on the way out.
      void saver.flush({ keepalive: true });
      saver.dispose();
      autosave.current = null;
    };
    // `loaded` is replaced wholesale on "load latest"; the version is what identifies it.
  }, [songId, baseVersion]);

  async function loadLatest() {
    setKept(text);
    const latest = await fetchLyrics(songId);
    if (latest === null) return;
    setLoaded(latest);
    setText(lyricsToText(latest.document));
    autosave.current?.rebase(latest.version);
  }

  if (loaded === null) {
    return <p className="text-body text-muted-foreground font-sans">Loading lyrics…</p>;
  }
  if (loaded === 'error') {
    return (
      <p className="text-body text-muted-foreground font-sans">The lyrics could not be loaded.</p>
    );
  }

  const editable = loaded.canEdit && state !== 'refused';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {loaded.canEdit ? (
          <SaveStateIndicator state={state} />
        ) : (
          <p className="text-caption text-muted-foreground font-sans">View only</p>
        )}
        {state === 'conflict' ? (
          <Button variant="secondary" size="sm" onClick={() => void loadLatest()}>
            Load the newer version
          </Button>
        ) : null}
      </div>
      <label className="sr-only" htmlFor={`lyrics-${songId}`}>
        Lyrics for {songTitle}
      </label>
      <textarea
        id={`lyrics-${songId}`}
        value={text}
        readOnly={!editable}
        aria-describedby={`lyrics-help-${songId}`}
        onChange={(event) => {
          setText(event.target.value);
          autosave.current?.edit(textToLyrics(event.target.value));
        }}
        onBlur={() => void autosave.current?.flush()}
        placeholder={editable ? '[Verse]\nThe first line…' : 'No lyrics yet.'}
        spellCheck
        className={cn(
          'border-border bg-card text-foreground min-h-[24rem] w-full resize-y rounded-md border p-4 font-mono text-[0.9375rem] leading-relaxed',
          focusRing,
        )}
      />
      <p id={`lyrics-help-${songId}`} className="text-caption text-muted-foreground font-sans">
        Start a section with its name in brackets — [Verse], [Chorus], [Bridge] — on a line of its
        own.
      </p>
      {kept === null ? null : (
        <details className="text-caption font-sans">
          <summary className="text-muted-foreground cursor-pointer">
            Your text before loading the newer version
          </summary>
          <textarea
            readOnly
            value={kept}
            aria-label="Your text before loading the newer version"
            className="border-border bg-card mt-2 min-h-32 w-full rounded-md border p-3 font-mono"
          />
        </details>
      )}
    </div>
  );
}
