'use client';

import { COMMENT_MAX_CHARACTERS } from '@youandfriends/contracts';
import { Button, cn, focusRing } from '@youandfriends/ui';
import { CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { playAtMoment, type SongPlayback } from '@/lib/comments/playback';
import {
  refreshComments,
  useSongComments,
  type CommentsData,
  type CommentView,
  type ThreadView,
} from '@/lib/comments/store';
import { formatClock } from '@/lib/player/format';

import { MentionTextarea, useMentionable } from './mentions/mention-input';
import { MentionText } from './mentions/mention-text';
import { toEditable, toStored, type Person } from './mentions/tokens';
import { ReactionBar } from './reactions/reaction-bar';
import { VoiceNotePlayer } from './voice-note/voice-note-player';
import { VoiceRecorder } from './voice-note/voice-recorder';

/**
 * The conversation on a song (task `090`): threads of plain-text comments, open ones first,
 * resolved ones folded away below. Bodies are rendered as text — React escapes them — never as
 * markup. Everything a person may not do is simply not offered; the server refuses it anyway.
 */

type Loaded = CommentsData;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The DOM id prefix of a thread in the Comments tab — what a notification's deep link targets. */
export const COMMENT_THREAD_PREFIX = 'comment-thread-';

/**
 * The thread named by `?thread=` (task `095`): once the comments are loaded, scroll it into view
 * and move focus to it, once. Returns its id while it is the linked one.
 */
export function useLinkedThread(
  loaded: CommentsData | null | 'error',
  prefix: string,
  onFound?: (thread: ThreadView) => void,
): ThreadView | null {
  const wanted = useSearchParams()?.get('thread') ?? null;
  const thread =
    wanted === null || loaded === null || loaded === 'error'
      ? null
      : (loaded.threads.find((candidate) => candidate.id === wanted) ?? null);
  const done = React.useRef(false);
  const threadId = thread?.id ?? null;
  React.useEffect(() => {
    if (done.current || threadId === null) return;
    done.current = true;
    if (thread !== null) onFound?.(thread);
    requestAnimationFrame(() => {
      const element = document.getElementById(`${prefix}${threadId}`);
      element?.scrollIntoView?.({ block: 'center' });
      element?.focus({ preventScroll: true });
    });
    // Once per landing: the thread's later changes are not a new arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, prefix]);
  return thread;
}

async function send(url: string, method: string, body?: unknown): Promise<boolean> {
  return (await sendFor(url, method, body)) === true;
}

/**
 * Send, and on refusal say why when the server gave a reason a person can act on — a mention of
 * someone who cannot open the song (task `094`) is the case that matters.
 */
async function sendFor(url: string, method: string, body?: unknown): Promise<true | string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return 'That was not saved. Check your connection and try again.';
  }
  if (response.ok) return true;
  try {
    const problem = (await response.json()) as { fields?: { message?: unknown }[] };
    const message = problem.fields?.[0]?.message;
    if (typeof message === 'string') return message;
  } catch {
    // Not JSON: fall through to the general message.
  }
  return 'That was not saved. Try again.';
}

export function Composer({
  label,
  submitLabel,
  initial = '',
  initialPeople = [],
  songId,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly submitLabel: string;
  /** Stored words to start from; mentions in them are shown by name. */
  readonly initial?: string;
  /** The people `initial` mentions, so they stay mentions when it is saved again. */
  readonly initialPeople?: readonly Person[];
  /** Turns on @-mentions (task `094`) over the people who can open this song. */
  readonly songId?: string;
  /** Resolves `true` when saved, `false` or a reason when not. */
  readonly onSubmit: (body: string) => Promise<boolean | string>;
  readonly onCancel?: () => void;
}) {
  const [body, setBody] = React.useState(() => toEditable(initial, initialPeople));
  const [picked, setPicked] = React.useState<readonly Person[]>(initialPeople);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const people = useMentionable(songId);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === '') {
          setError('Write something first.');
          return;
        }
        setBusy(true);
        void onSubmit(toStored(body, picked)).then((ok) => {
          setBusy(false);
          if (ok === true) {
            setBody('');
            setPicked([]);
            setError(null);
          } else {
            setError(typeof ok === 'string' ? ok : 'That was not saved. Try again.');
          }
        });
      }}
    >
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      {songId === undefined ? (
        <textarea
          id={id}
          value={body}
          maxLength={COMMENT_MAX_CHARACTERS}
          rows={3}
          onChange={(event) => setBody(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${id}-error`}
          className={cn(
            'border-border bg-card text-body text-foreground w-full resize-y rounded-md border p-2 font-sans',
            focusRing,
          )}
        />
      ) : (
        <MentionTextarea
          id={id}
          value={body}
          onChange={setBody}
          people={people}
          onPick={(person) => setPicked((list) => [...list, person])}
          maxLength={COMMENT_MAX_CHARACTERS}
          rows={3}
          aria-invalid={error !== null}
          aria-describedby={error === null ? `${id}-hint` : `${id}-error`}
          className={cn(
            'border-border bg-card text-body text-foreground w-full resize-y rounded-md border p-2 font-sans',
            focusRing,
          )}
        />
      )}
      {songId === undefined || error !== null ? null : (
        <p id={`${id}-hint`} className="sr-only">
          Type @ to mention someone who can open this song.
        </p>
      )}
      {error === null ? null : (
        <p id={`${id}-error`} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy} className="max-md:min-h-11">
          {submitLabel}
        </Button>
        {onCancel === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="max-md:min-h-11"
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function Comment({
  comment,
  songId,
  threadId,
  base,
  canComment,
  onChanged,
}: {
  readonly comment: CommentView;
  readonly songId: string;
  readonly threadId: string;
  readonly base: string;
  readonly canComment: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const mentions = comment.mentions ?? [];
  const [editing, setEditing] = React.useState(false);
  if (comment.deleted) {
    return <li className="text-caption text-muted-foreground italic">This comment was deleted.</li>;
  }
  return (
    <li className="flex flex-col gap-1">
      <p className="text-caption text-muted-foreground">
        <span className="text-foreground font-medium">{comment.author ?? 'Someone'}</span>
        {' · '}
        <time dateTime={comment.createdAt}>{when.format(new Date(comment.createdAt))}</time>
        {comment.editedAt === null ? null : (
          <span title={`Edited ${when.format(new Date(comment.editedAt))}`}> · edited</span>
        )}
      </p>
      {editing ? (
        <Composer
          label="Edit your comment"
          submitLabel="Save"
          initial={comment.body}
          initialPeople={mentions.flatMap((mention) =>
            mention.displayName === null
              ? []
              : [{ userId: mention.userId, displayName: mention.displayName }],
          )}
          songId={songId}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const ok = await sendFor(
              `${base}/comments/${encodeURIComponent(comment.id)}`,
              'PATCH',
              { body },
            );
            if (ok === true) {
              setEditing(false);
              await onChanged();
            }
            return ok;
          }}
        />
      ) : comment.body === '' ? null : (
        // Plain text, whitespace kept: React escapes it, so markup in a comment stays text.
        <p className="text-body text-foreground font-sans break-words whitespace-pre-wrap">
          <MentionText body={comment.body} mentions={mentions} />
        </p>
      )}
      {editing ? null : (
        <ReactionBar
          songId={songId}
          threadId={threadId}
          commentId={comment.id}
          reactions={comment.reactions ?? []}
          canReact={canComment}
        />
      )}
      {comment.voiceNote == null ? null : (
        <VoiceNotePlayer songId={songId} voiceNote={comment.voiceNote} author={comment.author} />
      )}
      {!editing && (comment.canEdit || comment.canDelete) ? (
        <div className="flex gap-1">
          {comment.canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          ) : null}
          {comment.canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => {
                if (!window.confirm('Delete this comment? Its words will be erased.')) return;
                void send(`${base}/comments/${encodeURIComponent(comment.id)}`, 'DELETE').then(
                  onChanged,
                );
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** A thread's accessible name: its opening words, so two threads by one person differ. */
function threadName(thread: ThreadView): string {
  const first = thread.comments[0];
  if (first === undefined || first.deleted) return 'Thread whose first comment was deleted';
  const words = first.body.replace(/\s+/g, ' ').trim();
  if (words === '' && first.voiceNote != null) {
    return `Thread: a voice note by ${first.author ?? 'someone'}`;
  }
  return `Thread: ${words.length > 60 ? `${words.slice(0, 57)}…` : words}`;
}

/** A thread's moment (task `091`): the time in mono, tabular figures, and a press plays it. */
function MomentChip({
  anchor,
  playback,
}: {
  readonly anchor: Extract<ThreadView['anchor'], { kind: 'timestamp' }>;
  readonly playback: SongPlayback | null;
}) {
  const clock = formatClock(anchor.ms / 1000);
  const version = playback?.versions.find((candidate) => candidate.id === anchor.versionId);
  const heard = version === undefined ? '' : ` in version ${version.number}`;
  return (
    <button
      type="button"
      disabled={playback === null}
      onClick={() =>
        playback === null ? undefined : playAtMoment(playback, anchor.versionId, anchor.ms)
      }
      aria-label={`Play from ${clock}${heard}`}
      className={cn(
        'border-border-subtle text-caption text-foreground tabular w-fit rounded-sm border px-1.5 font-mono max-md:min-h-11',
        focusRing,
      )}
    >
      {clock}
      {heard === '' ? null : (
        <span className="text-muted-foreground font-sans"> · v{version?.number}</span>
      )}
    </button>
  );
}

export function Thread({
  thread,
  songId,
  canComment,
  onChanged,
  playback,
  domId,
  lead = null,
  highlighted = false,
}: {
  readonly thread: ThreadView;
  readonly songId: string;
  readonly canComment: boolean;
  readonly onChanged: () => Promise<void>;
  readonly playback: SongPlayback | null;
  /** An id to scroll and move focus to (a lyric anchor opens its thread, task `092`). */
  readonly domId?: string;
  /** Shown above the comments — a lyric thread's quote. */
  readonly lead?: React.ReactNode;
  /** The thread a notification linked to (task `095`): outlined, so the eye lands on it. */
  readonly highlighted?: boolean;
}) {
  const [replying, setReplying] = React.useState(false);
  const base = `/api/songs/${encodeURIComponent(songId)}/comments/${encodeURIComponent(thread.id)}`;
  const resolved = thread.resolvedAt !== null;
  return (
    <article
      id={domId}
      tabIndex={domId === undefined ? undefined : -1}
      aria-label={threadName(thread)}
      className={cn(
        'bg-card flex flex-col gap-3 rounded-md border p-3',
        highlighted ? 'border-foreground border-2' : 'border-border-subtle',
      )}
    >
      {thread.anchor.kind === 'timestamp' ? (
        <MomentChip anchor={thread.anchor} playback={playback} />
      ) : null}
      {thread.anchor.kind === 'lyric' && lead === null ? (
        <blockquote className="border-border text-caption text-muted-foreground border-l-2 pl-2 font-mono whitespace-pre-wrap">
          {thread.anchor.quote}
        </blockquote>
      ) : null}
      {lead}
      <ol className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <Comment
            key={comment.id}
            comment={comment}
            songId={songId}
            threadId={thread.id}
            base={base}
            canComment={canComment}
            onChanged={onChanged}
          />
        ))}
      </ol>
      {thread.resolvedAt === null ? null : (
        <p className="text-caption text-muted-foreground flex items-center gap-1">
          <CheckCircle2 aria-hidden className="size-3.5" />
          Resolved{thread.resolvedBy === null ? '' : ` by ${thread.resolvedBy}`}
          {' · '}
          <time dateTime={thread.resolvedAt}>{when.format(new Date(thread.resolvedAt))}</time>
        </p>
      )}
      {canComment ? (
        <div className="flex flex-wrap gap-2">
          {replying || resolved ? null : (
            <Button
              variant="secondary"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => setReplying(true)}
            >
              <MessageSquare aria-hidden />
              Reply
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="max-md:min-h-11"
            onClick={() => void send(base, 'PATCH', { resolved: !resolved }).then(onChanged)}
          >
            {resolved ? <RotateCcw aria-hidden /> : <CheckCircle2 aria-hidden />}
            {resolved ? 'Reopen' : 'Resolve'}
          </Button>
        </div>
      ) : null}
      {replying ? (
        <>
          <Composer
            label="Your reply"
            submitLabel="Reply"
            songId={songId}
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              const ok = await sendFor(`${base}/replies`, 'POST', { body });
              if (ok === true) {
                setReplying(false);
                await onChanged();
              }
              return ok;
            }}
          />
          <VoiceRecorder
            songId={songId}
            onRecorded={async (voiceNoteAssetId) => {
              const ok = await send(`${base}/replies`, 'POST', { voiceNoteAssetId });
              if (ok) {
                setReplying(false);
                await onChanged();
              }
              return ok;
            }}
          />
        </>
      ) : null}
    </article>
  );
}

export function CommentsPanel({
  songId,
  playback = null,
}: {
  readonly songId: string;
  /** For playing a comment's moment (task `091`); null where there is no audio to play. */
  readonly playback?: SongPlayback | null;
}) {
  const state = useSongComments(songId);
  const loaded: Loaded | null | 'error' = state === 'loading' ? null : state;
  const [unresolvedOnly, setUnresolvedOnly] = React.useState(false);
  const linkedThread = useLinkedThread(loaded, COMMENT_THREAD_PREFIX);
  const linked = linkedThread?.id ?? null;
  // A link to a resolved thread (task `095`) unfolds the resolved list to show it, until the
  // person folds it themselves.
  const [resolvedOpen, setResolvedOpen] = React.useState<boolean | null>(null);
  const showResolved = resolvedOpen ?? (linkedThread !== null && linkedThread.resolvedAt !== null);
  const base = `/api/songs/${encodeURIComponent(songId)}/comments`;
  const load = React.useCallback(() => refreshComments(songId), [songId]);

  if (loaded === null)
    return <p className="text-body text-muted-foreground font-sans">Loading comments…</p>;
  if (loaded === 'error') {
    return (
      <p className="text-body text-muted-foreground font-sans">The comments could not be loaded.</p>
    );
  }
  const open = loaded.threads.filter((thread) => thread.resolvedAt === null);
  const resolved = loaded.threads.filter((thread) => thread.resolvedAt !== null);
  return (
    <section aria-labelledby="song-comments-heading" className="flex flex-col gap-3 font-sans">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="song-comments-heading"
          className="text-caption text-muted-foreground font-medium tracking-wide uppercase"
        >
          Comments
        </h2>
        {resolved.length === 0 ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={unresolvedOnly}
            className="max-md:min-h-11"
            onClick={() => setUnresolvedOnly((only) => !only)}
          >
            {unresolvedOnly ? 'Showing unresolved only' : 'Show unresolved only'}
          </Button>
        )}
      </div>
      {loaded.canComment ? (
        <Composer
          label="Start a conversation about this song"
          submitLabel="Comment"
          songId={songId}
          onSubmit={async (body) => {
            const ok = await sendFor(base, 'POST', { anchor: { kind: 'general' }, body });
            if (ok === true) await load();
            return ok;
          }}
        />
      ) : null}
      {loaded.canComment ? (
        <VoiceRecorder
          songId={songId}
          onRecorded={async (voiceNoteAssetId) => {
            const ok = await send(base, 'POST', { anchor: { kind: 'general' }, voiceNoteAssetId });
            if (ok) await load();
            return ok;
          }}
        />
      ) : null}
      {open.length === 0 && resolved.length === 0 ? (
        <p className="text-body text-muted-foreground">No comments yet.</p>
      ) : null}
      {open.map((thread) => (
        <Thread
          key={thread.id}
          thread={thread}
          songId={songId}
          canComment={loaded.canComment}
          onChanged={load}
          playback={playback}
          domId={`${COMMENT_THREAD_PREFIX}${thread.id}`}
          highlighted={linked === thread.id}
        />
      ))}
      {unresolvedOnly && open.length === 0 && resolved.length > 0 ? (
        <p className="text-body text-muted-foreground">Every thread is resolved.</p>
      ) : null}
      {resolved.length === 0 || unresolvedOnly ? null : (
        <details
          className="flex flex-col gap-3"
          open={showResolved}
          onToggle={(event) => setResolvedOpen(event.currentTarget.open)}
        >
          <summary
            className={cn(
              'text-caption text-muted-foreground w-fit cursor-pointer rounded-sm',
              focusRing,
            )}
          >
            {resolved.length} resolved {resolved.length === 1 ? 'thread' : 'threads'}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {resolved.map((thread) => (
              <Thread
                key={thread.id}
                thread={thread}
                songId={songId}
                canComment={loaded.canComment}
                onChanged={load}
                playback={playback}
                domId={`${COMMENT_THREAD_PREFIX}${thread.id}`}
                highlighted={linked === thread.id}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
