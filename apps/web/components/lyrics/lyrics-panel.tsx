'use client';

import type { LyricsDocument } from '@youandfriends/contracts';
import { Button, cn } from '@youandfriends/ui';
import { AlertTriangle, Check, CloudOff, Loader2, Lock, PencilLine } from 'lucide-react';
import * as React from 'react';
import * as Y from 'yjs';

import { createAutosave, httpSave, type Autosave, type SaveState } from '@/lib/lyrics/autosave';
import {
  SessionFactoryContext,
  type CollaborationSession,
  type ConnectionStatus,
} from '@/lib/lyrics/collaboration-client';
import { lyricsToText } from '@/lib/lyrics/text-format';
import { fromBase64, toBase64 } from '@/lib/lyrics/yjs';

import { LyricsEditor, type LyricsEditorHandle } from './editor/lyrics-editor';
import { PresenceList } from './presence/presence-list';

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
  const createSession = React.useContext(SessionFactoryContext);
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
      setLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  // Editing together: one shared document per loaded song, carried through its room. The room
  // token is minted server-side at this person's current access; a new session asks again.
  const room = loaded !== null && loaded !== 'error' ? (loaded.collaboration ?? null) : null;
  const seed = loaded !== null && loaded !== 'error' ? loaded.yjsState : null;
  const shared = React.useRef<Y.Doc | null>(null);
  React.useEffect(() => {
    if (room === null || seed === null) return;
    if (shared.current === null) {
      shared.current = new Y.Doc();
      Y.applyUpdate(shared.current, fromBase64(seed));
    }
    const doc = shared.current;
    const session = createSession(room.room, doc);
    session.awareness.setLocalStateField('user', {
      name: room.self.name,
      color: resolveColor(room.self.color),
    });
    setConnection(session.status());
    const unsubscribe = session.onStatus(setConnection);
    setTogether({ doc, session });
    return () => {
      unsubscribe();
      session.destroy();
      setTogether(null);
    };
  }, [room, seed, createSession, sessionKey]);

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
  const collaborative = room !== null;
  React.useEffect(() => {
    if (baseVersion === null) return;
    const saver = createAutosave({
      version: baseVersion,
      save: collaborative
        ? httpSave(songId, () =>
            shared.current === null ? '' : toBase64(Y.encodeStateAsUpdate(shared.current)),
          )
        : httpSave(songId),
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
  }, [songId, baseVersion, collaborative]);

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
          collaboration={
            together === null || room === null
              ? null
              : {
                  doc: together.doc,
                  awareness: together.session.awareness,
                  user: { name: room.self.name, color: resolveColor(room.self.color) },
                }
          }
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
