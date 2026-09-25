'use client';

import type { LyricsDocument } from '@youandfriends/contracts';
import { Button, cn } from '@youandfriends/ui';
import { AlertTriangle, Check, CloudOff, Loader2, Lock, Maximize2, PencilLine } from 'lucide-react';
import * as React from 'react';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';

import { useSongComments } from '@/lib/comments/store';

import { createAutosave, httpSave, type Autosave, type SaveState } from '@/lib/lyrics/autosave';
import {
  SessionFactoryContext,
  type CollaborationSession,
  type ConnectionStatus,
} from '@/lib/lyrics/collaboration-client';
import { lyricsToText } from '@/lib/lyrics/text-format';
import type { Track } from '@/lib/player/machine';
import { fromBase64, toBase64, yjsFromDocument, yjsReplace } from '@/lib/lyrics/yjs';

import { LyricsEditor, type LyricsEditorHandle } from './editor/lyrics-editor';
import { useKeyboardInset } from './mobile/keyboard';
import { PresenceList } from './presence/presence-list';
import { HistoryPanel, type RestoreResponse } from './revisions/history-panel';
import { anchorThreads, LyricComments } from '@/components/comments/lyric-anchor/lyric-comments';

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
  readonly yjsState: string;
  /** Present when live collaboration is configured (task `082`). */
  readonly collaboration: {
    readonly room: string;
    readonly self: { readonly name: string; readonly color: string };
  } | null;
}

/** How often an open editor re-asks whether this person may still write (task `082`). */
export const ACCESS_RECHECK_MS = 30_000;

/**
 * A palette colour as the value it resolves to. The cursor layer (y-prosemirror) accepts only
 * six-digit hex, so the `var(--color-…)` the server names is resolved from the page's own tokens
 * — the palette stays in one place.
 */
function resolveColor(color: string): string {
  const variable = /^var\((--[a-z0-9-]+)\)$/.exec(color)?.[1];
  if (variable === undefined || typeof window === 'undefined') return color;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value === '' ? color : value;
}

interface Together {
  readonly doc: Y.Doc;
  readonly session: CollaborationSession;
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
  track = null,
}: {
  readonly songId: string;
  readonly songTitle: string;
  /** The song's audio, shown beside the lyrics on a wide screen and above them on a narrow one. */
  readonly audio?: React.ReactNode;
  /** The version a timestamp plays from when nothing of this song is loaded (task `083`). */
  readonly track?: Track | null;
}) {
  const [loaded, setLoaded] = React.useState<Loaded | null | 'error'>(null);
  const [state, setState] = React.useState<SaveState>('saved');
  const [kept, setKept] = React.useState<string | null>(null);
  const autosave = React.useRef<Autosave | null>(null);
  const editor = React.useRef<LyricsEditorHandle>(null);
  const current = React.useRef<LyricsDocument | null>(null);
  const createSession = React.useContext(SessionFactoryContext);
  const shared = React.useRef<Y.Doc | null>(null);
  const [sharedDoc, setSharedDoc] = React.useState<Y.Doc | null>(null);
  // Lyric comments (task `092`): the live editor, and the thread being looked at.
  const [liveEditor, setLiveEditor] = React.useState<Editor | null>(null);
  const [activeThread, setActiveThread] = React.useState<string | null>(null);
  const comments = useSongComments(songId);
  const threads = comments === 'loading' || comments === 'error' ? null : comments.threads;
  const commentAnchors = React.useMemo(
    () =>
      threads === null
        ? null
        : {
            threads: anchorThreads(threads),
            active: activeThread,
            onOpen: (threadId: string) => {
              setActiveThread(threadId);
              const target = document.getElementById(`lyric-thread-${threadId}`);
              target?.scrollIntoView?.({ block: 'center' });
              target?.focus();
            },
          },
    [threads, activeThread],
  );
  const timing = React.useMemo(() => ({ songId, track }), [songId, track]);
  // Full screen on a phone (task `085`). CSS decides whether it applies — the same editor stays
  // mounted either way, so nothing is lost switching in and out.
  const [fullScreen, setFullScreen] = React.useState(false);
  const inset = useKeyboardInset(fullScreen);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [together, setTogether] = React.useState<Together | null>(null);
  const [connection, setConnection] = React.useState<ConnectionStatus>('connecting');
  // Bumped when access changes: a fresh session asks for a fresh room token.
  const [sessionKey, setSessionKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void fetchLyrics(songId).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setLoaded('error');
        return;
      }
      current.current = result.document;
      // Every editor edits a Yjs document (task `092`): alone, a local one; together, the room's.
      // It starts from the server's state — or, from an older server, a deterministic seed.
      const doc = new Y.Doc();
      Y.applyUpdate(
        doc,
        result.yjsState === '' || result.yjsState === undefined
          ? yjsFromDocument(result.document)
          : fromBase64(result.yjsState),
      );
      shared.current = doc;
      setSharedDoc(doc);
      setLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  // Editing together: the shared document carried through the song's room. The room token is
  // minted server-side at this person's current access; a new session asks again.
  const room = loaded !== null && loaded !== 'error' ? (loaded.collaboration ?? null) : null;
  React.useEffect(() => {
    if (room === null || sharedDoc === null) return;
    const doc = sharedDoc;
    const session = createSession(room.room, doc);
    session.awareness.setLocalStateField('user', {
      name: room.self.name,
      color: resolveColor(room.self.color),
    });
    const unsubscribe = session.onStatus(setConnection);
    // Published from a callback, once the effect has run — the session is an external system.
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setConnection(session.status());
      setTogether({ doc, session });
    });
    return () => {
      disposed = true;
      unsubscribe();
      session.destroy();
      setTogether(null);
    };
  }, [room, sharedDoc, createSession, sessionKey]);

  // Access can change while the page is open. Re-ask on a cadence and on return to the tab; a
  // change takes effect at once — the editor stops accepting input, and the room is rejoined
  // with a token at the new access.
  const canEdit = loaded !== null && loaded !== 'error' ? loaded.canEdit : null;
  React.useEffect(() => {
    if (canEdit === null) return;
    let cancelled = false;
    const recheck = async () => {
      const latest = await fetchLyrics(songId);
      if (cancelled || latest === null || latest.canEdit === canEdit) return;
      setLoaded((previous) =>
        previous === null || previous === 'error'
          ? previous
          : { ...previous, canEdit: latest.canEdit },
      );
      setSessionKey((key) => key + 1);
    };
    const timer = setInterval(() => void recheck(), ACCESS_RECHECK_MS);
    const focus = () => void recheck();
    window.addEventListener('focus', focus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [songId, canEdit]);

  // One autosave per loaded document, flushed on every way out of the page.
  const baseVersion = loaded !== null && loaded !== 'error' ? loaded.version : null;
  React.useEffect(() => {
    if (baseVersion === null) return;
    const saver = createAutosave({
      version: baseVersion,
      // Always the Yjs state: the server merges it, so saves from two tabs never conflict.
      save: httpSave(songId, () =>
        shared.current === null ? '' : toBase64(Y.encodeStateAsUpdate(shared.current)),
      ),
      onChange: (next) => {
        setState(next);
        // A refused save means access was lost: rejoin the room at whatever access remains.
        if (next === 'refused') setSessionKey((key) => key + 1);
      },
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
    if (shared.current !== null) {
      // Merge the server's state; without one, apply its document as an edit of ours.
      Y.applyUpdate(
        shared.current,
        latest.yjsState === ''
          ? yjsReplace(Y.encodeStateAsUpdate(shared.current), latest.document).update
          : fromBase64(latest.yjsState),
      );
    } else {
      editor.current?.replace(latest.document);
    }
    autosave.current?.rebase(latest.version);
  }

  function restored(result: RestoreResponse) {
    current.current = result.document;
    if (shared.current !== null) {
      // Together: apply the restore as an edit of the shared document, which carries it to
      // everyone in the room — nobody is left on a copy that silently diverges.
      Y.applyUpdate(shared.current, fromBase64(result.yjsUpdate));
      return;
    }
    editor.current?.replace(result.document);
    autosave.current?.rebase(result.version);
  }

  let body: React.ReactNode;
  if (loaded === null) {
    body = <p className="text-body text-muted-foreground font-sans">Loading lyrics…</p>;
  } else if (loaded === 'error') {
    body = (
      <p className="text-body text-muted-foreground font-sans">The lyrics could not be loaded.</p>
    );
  } else if (room !== null && together === null) {
    body = <p className="text-body text-muted-foreground font-sans">Loading lyrics…</p>;
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
          {together === null ? null : (
            <PresenceList awareness={together.session.awareness} status={connection} />
          )}
          <HistoryPanel
            songId={songId}
            canEdit={editable}
            current={() => current.current ?? loaded.document}
            beforeCheckpoint={() => autosave.current?.flush() ?? Promise.resolve()}
            onRestored={restored}
          />
          {state === 'conflict' ? (
            <Button variant="secondary" size="sm" onClick={() => void loadLatest()}>
              Load the newer version
            </Button>
          ) : null}
        </div>
        {editable && !fullScreen ? (
          <Button
            variant="secondary"
            className="min-h-11 self-start md:hidden"
            onClick={() => setFullScreen(true)}
          >
            <Maximize2 aria-hidden />
            Write full screen
          </Button>
        ) : null}
        <LyricsEditor
          ref={editor}
          document={loaded.document}
          editable={editable}
          dock={fullScreen && editable ? { inset, scroller } : null}
          onFocus={() => {
            // Starting to type on a phone opens the full-screen editor.
            if (editable && window.matchMedia?.('(max-width: 767px)').matches) setFullScreen(true);
          }}
          label={`Lyrics for ${songTitle}`}
          onChange={(document) => {
            current.current = document;
            autosave.current?.edit(document);
          }}
          onBlur={() => void autosave.current?.flush()}
          timing={timing}
          onEditor={setLiveEditor}
          commentAnchors={commentAnchors}
          collaboration={
            sharedDoc === null
              ? null
              : {
                  doc: sharedDoc,
                  awareness: together?.session.awareness ?? null,
                  user:
                    room === null
                      ? null
                      : { name: room.self.name, color: resolveColor(room.self.color) },
                }
          }
        />
        <LyricComments
          songId={songId}
          editor={liveEditor}
          active={activeThread}
          onShow={setActiveThread}
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

  return (
    <div
      data-full-screen={fullScreen ? 'true' : undefined}
      onKeyDown={(event) => {
        if (fullScreen && event.key === 'Escape') setFullScreen(false);
      }}
      className={cn(
        'flex flex-col gap-6',
        audio !== null && 'lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start',
        fullScreen &&
          'max-md:bg-background max-md:fixed max-md:inset-0 max-md:z-40 max-md:gap-0 max-md:overscroll-contain max-md:[&_[data-lyrics-extra]]:hidden',
      )}
    >
      {fullScreen ? (
        <div className="border-border-subtle flex min-h-14 items-center justify-between gap-2 border-b px-3 md:hidden">
          <p className="text-heading text-foreground truncate font-serif">{songTitle}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => setFullScreen(false)}>
            Done
          </Button>
        </div>
      ) : null}
      {audio === null ? null : (
        <aside
          aria-label={`Audio for ${songTitle}`}
          className={cn(
            'lg:sticky lg:top-4',
            // Above the lyrics while writing on a phone: the audio stays in view as you type.
            fullScreen && 'max-md:border-border-subtle max-md:shrink-0 max-md:border-b max-md:p-2',
          )}
        >
          {audio}
        </aside>
      )}
      <div
        ref={scroller}
        className={cn('min-w-0', fullScreen && 'max-md:flex-1 max-md:overflow-y-auto max-md:p-3')}
      >
        {body}
      </div>
    </div>
  );
}
