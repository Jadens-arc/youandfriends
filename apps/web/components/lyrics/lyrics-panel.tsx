'use client';

import type { LyricsDocument } from '@youandfriends/contracts';
import { Button, cn } from '@youandfriends/ui';
import { AlertTriangle, Check, CloudOff, Loader2, Lock, PencilLine } from 'lucide-react';
import * as React from 'react';

import { createAutosave, httpSave, type Autosave, type SaveState } from '@/lib/lyrics/autosave';
import { lyricsToText } from '@/lib/lyrics/text-format';

import { LyricsEditor, type LyricsEditorHandle } from './editor/lyrics-editor';

/**
 * The song's lyrics (tasks `080`, `081`): the structured editor, autosaving, with its save state
 * always in words. Saves go to Postgres, the canonical store (ADR 0003).
 *
 * On a wide screen the song's audio sits beside the words (`docs/DESIGN.md` §6), so a writer can
 * play, loop, and scrub without leaving the page they are writing on.
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
  audio = null,
}: {
  readonly songId: string;
  readonly songTitle: string;
  /** The song's audio, shown beside the lyrics on a wide screen and above them on a narrow one. */
  readonly audio?: React.ReactNode;
}) {
  const [loaded, setLoaded] = React.useState<Loaded | null | 'error'>(null);
  const [state, setState] = React.useState<SaveState>('saved');
  const [kept, setKept] = React.useState<string | null>(null);
  const autosave = React.useRef<Autosave | null>(null);
  const editor = React.useRef<LyricsEditorHandle>(null);
  const current = React.useRef<LyricsDocument | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetchLyrics(songId).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setLoaded('error');
        return;
      }
      current.current = result.document;
      setLoaded(result);
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
    if (current.current !== null) setKept(lyricsToText(current.current));
    const latest = await fetchLyrics(songId);
    if (latest === null) return;
    current.current = latest.document;
    editor.current?.replace(latest.document);
    autosave.current?.rebase(latest.version);
  }

  let body: React.ReactNode;
  if (loaded === null) {
    body = <p className="text-body text-muted-foreground font-sans">Loading lyrics…</p>;
  } else if (loaded === 'error') {
    body = (
      <p className="text-body text-muted-foreground font-sans">The lyrics could not be loaded.</p>
    );
  } else {
    const editable = loaded.canEdit && state !== 'refused';
    body = (
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
        <LyricsEditor
          ref={editor}
          document={loaded.document}
          editable={editable}
          label={`Lyrics for ${songTitle}`}
          onChange={(document) => {
            current.current = document;
            autosave.current?.edit(document);
          }}
          onBlur={() => void autosave.current?.flush()}
        />
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

  if (audio === null) return body;
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <aside aria-label={`Audio for ${songTitle}`} className="lg:sticky lg:top-4">
        {audio}
      </aside>
      <div className="min-w-0">{body}</div>
    </div>
  );
}
