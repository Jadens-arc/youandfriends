'use client';

import type { Editor } from '@tiptap/core';
import { Button, cn, focusRing } from '@youandfriends/ui';
import { MessageSquarePlus, Search } from 'lucide-react';
import * as React from 'react';

import {
  refreshComments,
  sendComment,
  useSongComments,
  type ThreadView,
} from '@/lib/comments/store';
import {
  anchorFromRange,
  rangeForScope,
  resolveAnchor,
  type LyricAnchor,
  type LyricAnchorScope,
} from '@/lib/lyrics/anchors';

import { Composer, Thread } from '../comments-panel';
import type { AnchorThread } from './extension';

/**
 * Comments on the lyrics (task `092`), under the editor: start one on a selection, a line, or a
 * section — the range is taken when the comment begins — and read each with the words it is
 * about. A thread whose words were deleted is **orphaned**, not lost: it stays, with the quote.
 */

type LyricThread = ThreadView & {
  readonly anchor: Extract<ThreadView['anchor'], { kind: 'lyric' }>;
};

export function isLyricThread(thread: ThreadView): thread is LyricThread {
  return thread.anchor.kind === 'lyric';
}

function excerpt(quote: string, length = 40): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** The anchors the editor draws, named for a screen reader: who, on which words, how many. */
export function anchorThreads(threads: readonly ThreadView[]): AnchorThread[] {
  return threads.filter(isLyricThread).map((thread) => {
    const first = thread.comments[0];
    const author = first === undefined || first.deleted ? 'someone' : (first.author ?? 'someone');
    const replies = thread.comments.length - 1;
    return {
      id: thread.id,
      anchor: thread.anchor,
      label: `Comment by ${author} on “${excerpt(thread.anchor.quote)}”${
        replies > 0 ? `, ${replies} ${replies === 1 ? 'reply' : 'replies'}` : ''
      }`,
    };
  });
}

/** Re-render when the editor's document or selection changes. */
function useEditorTick(editor: Editor | null): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (editor === null) return;
    const bump = () => setTick((value) => value + 1);
    editor.on('transaction', bump);
    return () => {
      editor.off('transaction', bump);
    };
  }, [editor]);
  return tick;
}

const SCOPE_TEXT: Readonly<Record<LyricAnchorScope, string>> = {
  selection: 'Comment on the selection',
  line: 'Comment on this line',
  section: 'Comment on this section',
};

export function LyricComments({
  songId,
  editor,
  active,
  onShow,
}: {
  readonly songId: string;
  readonly editor: Editor | null;
  readonly active: string | null;
  /** Mark a thread as the one being looked at, in the editor. */
  readonly onShow: (threadId: string) => void;
}) {
  const state = useSongComments(songId);
  useEditorTick(editor);
  const [draft, setDraft] = React.useState<LyricAnchor | null>(null);
  const [message, setMessage] = React.useState('');
  if (state === 'loading' || state === 'error' || editor === null) return null;
  const threads = state.threads.filter(isLyricThread);
  const hasSelection = !editor.state.selection.empty;

  function begin(scope: LyricAnchorScope) {
    if (editor === null) return;
    // The range is taken now, at the press — the text may change while the comment is written.
    const range = rangeForScope(editor.state, scope);
    const anchor = range === null ? null : anchorFromRange(editor.state, range, scope);
    if (anchor === null) {
      setMessage('Put the cursor in the lyrics first, or select the words to comment on.');
      return;
    }
    setMessage('');
    setDraft(anchor);
  }

  function show(thread: LyricThread) {
    if (editor === null) return;
    const range = resolveAnchor(editor.state, thread.anchor);
    if (range === null) return;
    onShow(thread.id);
    editor.commands.setTextSelection(range.from);
    const dom = editor.view.domAtPos(range.from).node;
    const element = dom instanceof Element ? dom : dom.parentElement;
    if (element !== null && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' });
    }
  }

  // In the order they appear in the lyrics; orphaned ones after, still there.
  const placed = threads
    .map((thread) => ({ thread, range: resolveAnchor(editor.state, thread.anchor) }))
    .sort(
      (a, b) =>
        (a.range?.from ?? Number.MAX_SAFE_INTEGER) - (b.range?.from ?? Number.MAX_SAFE_INTEGER),
    );

  return (
    <section aria-labelledby={`lyric-comments-${songId}`} className="flex flex-col gap-3 font-sans">
      <h2
        id={`lyric-comments-${songId}`}
        className="text-caption text-muted-foreground font-medium tracking-wide uppercase"
      >
        Comments on the lyrics
      </h2>
      {state.canComment && draft === null ? (
        <div className="flex flex-wrap gap-2">
          {(['selection', 'line', 'section'] as const).map((scope) => (
            <Button
              key={scope}
              variant="secondary"
              size="sm"
              className="max-md:min-h-11"
              disabled={scope === 'selection' && !hasSelection}
              // A press must not move the selection it is about to use.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => begin(scope)}
            >
              <MessageSquarePlus aria-hidden />
              {SCOPE_TEXT[scope]}
            </Button>
          ))}
        </div>
      ) : null}
      <p aria-live="polite" className="text-caption text-muted-foreground empty:hidden">
        {message}
      </p>
      {draft === null ? null : (
        <div className="flex flex-col gap-2">
          <blockquote className="border-border text-caption text-muted-foreground border-l-2 pl-2 font-mono whitespace-pre-wrap">
            {draft.quote}
          </blockquote>
          <Composer
            label={`Comment on “${excerpt(draft.quote)}”`}
            submitLabel="Comment"
            songId={songId}
            onCancel={() => setDraft(null)}
            onSubmit={async (body) => {
              const ok = await sendComment(songId, '', 'POST', {
                anchor: { kind: 'lyric', ...draft },
                body,
              });
              if (ok) setDraft(null);
              return ok;
            }}
          />
        </div>
      )}
      {placed.length === 0 ? (
        <p className="text-body text-muted-foreground">No comments on the lyrics yet.</p>
      ) : null}
      {placed.map(({ thread, range }) => (
        <Thread
          key={thread.id}
          domId={`lyric-thread-${thread.id}`}
          thread={thread}
          songId={songId}
          canComment={state.canComment}
          onChanged={() => refreshComments(songId)}
          playback={null}
          lead={
            <div
              className={cn(
                'flex flex-col gap-1',
                active === thread.id && 'border-foreground border-l-2 pl-2',
              )}
            >
              <blockquote className="border-border text-caption text-muted-foreground border-l-2 pl-2 font-mono whitespace-pre-wrap">
                {thread.anchor.quote}
              </blockquote>
              {range === null ? (
                <p className="text-caption text-muted-foreground italic" data-orphaned>
                  The words this was about have been removed from the lyrics.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => show(thread)}
                  className={cn(
                    'text-caption text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 rounded-sm max-md:min-h-11',
                    focusRing,
                  )}
                >
                  <Search aria-hidden className="size-3.5" />
                  Show in the lyrics
                </button>
              )}
            </div>
          }
        />
      ))}
    </section>
  );
}
