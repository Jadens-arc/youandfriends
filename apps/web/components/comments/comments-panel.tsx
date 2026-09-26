'use client';

import { COMMENT_MAX_CHARACTERS, mentionedUserIds } from '@youandfriends/contracts';
import { Button, cn, focusRing } from '@youandfriends/ui';
import { CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { playAtMoment, type SongPlayback } from '@/lib/comments/playback';
import { plainText, toBody, toDisplay } from '@/lib/comments/mention-format';
import {
  refreshComments,
  sendTo,
  useSongComments,
  type CommentsData,
  type CommentSent,
  type CommentView,
  type MentionView,
  type ThreadView,
} from '@/lib/comments/store';
import { formatClock } from '@/lib/player/format';

import { MentionField } from './mentions/mention-field';
import { MentionText } from './mentions/mention-text';
import { loadMentionable } from './mentions/use-mentionable';
import { Reactions } from './reactions/reactions';
import { VoiceNotePlayer } from './voice-note/voice-note-player';
import { VoiceRecorder } from './voice-note/voice-recorder';

/**
 * The conversation on a song (task `090`): threads of plain-text comments, open ones first,
 * resolved ones folded away below. Bodies are rendered as text — React escapes them — never as
 * markup. Everything a person may not do is simply not offered; the server refuses it anyway.
 */

type Loaded = CommentsData;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A comment action on this page; `false` if refused. */
const send = (url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) =>
  sendTo(url, method, body);

type Submitted = boolean | CommentSent;

function namesOf(ids: readonly string[], known: ReadonlyMap<string, string>): string {
  const names = ids.map((id) => known.get(id) ?? 'someone');
  return names.length <= 1
    ? (names[0] ?? 'someone')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

const reachNote = (names: string) =>
  `${names} can’t see this song, so they won’t be notified. Mentioning someone doesn’t share the song with them.`;

export function Composer({
  label,
  submitLabel,
  initial = '',
  initialMentions,
  songId = null,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly submitLabel: string;
  /** The stored body — `<@id>` references and all. */
  readonly initial?: string;
  readonly initialMentions?: readonly MentionView[] | undefined;
  /** Where mentions are looked up (task `094`). Null: a plain text box. */
  readonly songId?: string | null;
  readonly onSubmit: (body: string) => Promise<Submitted>;
  readonly onCancel?: () => void;
}) {
  const [start] = React.useState(() => toDisplay(initial, initialMentions));
  const [text, setText] = React.useState(start.text);
  const [picked, setPicked] = React.useState(start.picked);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const known = new Map([...picked].map(([name, userId]) => [userId, name]));

  async function submit(body: string) {
    setBusy(true);
    setConfirming(null);
    const sent = await onSubmit(body);
    setBusy(false);
    if (sent === false) {
      setError('That was not saved. Try again.');
      return;
    }
    setText('');
    setPicked(new Map());
    setError(null);
    const unreached = typeof sent === 'object' ? sent.unreachedMentions : [];
    // The server has the last word: someone may have lost access since the list was loaded.
    setNotice(unreached.length === 0 ? null : reachNote(namesOf(unreached, known)));
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === '') {
          setError('Write something first.');
          return;
        }
        const body = toBody(text, picked);
        const mentioned = mentionedUserIds(body);
        if (songId === null || mentioned.length === 0) {
          void submit(body);
          return;
        }
        // Warn before sending, not after: a mention of someone who cannot see the song reaches
        // no one, and the author should know that while they can still change it.
        setBusy(true);
        void loadMentionable(songId).then((list) => {
          setBusy(false);
          const reachable = new Set(list?.people.map((person) => person.id));
          if (list !== null) reachable.add(list.you);
          const unreached = mentioned.filter((userId) => !reachable.has(userId));
          if (list === null || unreached.length === 0) {
            void submit(body);
          } else {
            setConfirming(reachNote(namesOf(unreached, known)));
          }
        });
      }}
    >
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      <MentionField
        id={id}
        songId={songId}
        value={text}
        onChange={(value) => {
          setText(value);
          setNotice(null);
          setConfirming(null);
        }}
        onPick={(person) => setPicked((current) => new Map(current).set(person.name, person.id))}
        invalid={error !== null}
        describedBy={error === null ? undefined : `${id}-error`}
        maxLength={COMMENT_MAX_CHARACTERS}
        className={cn(
          'border-border bg-card text-body text-foreground w-full resize-y rounded-md border p-2 font-sans',
          focusRing,
        )}
      />
      {error === null ? null : (
        <p id={`${id}-error`} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      {confirming === null ? null : (
        <div role="alert" className="text-caption text-foreground flex flex-col gap-2">
          <p>{confirming}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => void submit(toBody(text, picked))}
            >
              Post anyway
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="max-md:min-h-11"
              onClick={() => setConfirming(null)}
            >
              Keep editing
            </Button>
          </div>
        </div>
      )}
      {notice === null ? null : (
        <p role="status" className="text-caption text-muted-foreground">
          {notice}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || confirming !== null}
          className="max-md:min-h-11"
        >
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
  onPerson,
}: {
  readonly comment: CommentView;
  readonly songId: string;
  readonly threadId: string;
  readonly base: string;
  readonly canComment: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onPerson: ((person: MentionView) => void) | undefined;
}) {
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
          initialMentions={comment.mentions}
          songId={songId}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const sent = await send(`${base}/comments/${encodeURIComponent(comment.id)}`, 'PATCH', {
              body,
            });
            if (sent !== false) {
              setEditing(false);
              await onChanged();
            }
            return sent;
          }}
        />
      ) : comment.body === '' ? null : (
        // Plain text, whitespace kept: React escapes it, so markup in a comment stays text.
        <p className="text-body text-foreground font-sans break-words whitespace-pre-wrap">
          <MentionText body={comment.body} mentions={comment.mentions} onPerson={onPerson} />
        </p>
      )}
      {comment.voiceNote == null ? null : (
        <VoiceNotePlayer songId={songId} voiceNote={comment.voiceNote} author={comment.author} />
      )}
      <Reactions
        songId={songId}
        threadId={threadId}
        commentId={comment.id}
        reactions={comment.reactions ?? []}
        canReact={canComment}
      />
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
  const words = plainText(first.body, first.mentions).replace(/\s+/g, ' ').trim();
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
  onPerson,
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
  /** A mention was pressed: show the conversation with that person (task `094`). */
  readonly onPerson?: (person: MentionView) => void;
}) {
  const [replying, setReplying] = React.useState(false);
  const base = `/api/songs/${encodeURIComponent(songId)}/comments/${encodeURIComponent(thread.id)}`;
  const resolved = thread.resolvedAt !== null;
  return (
    <article
      id={domId}
      tabIndex={domId === undefined ? undefined : -1}
      aria-label={threadName(thread)}
      className="border-border-subtle bg-card flex flex-col gap-3 rounded-md border p-3"
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
            onPerson={onPerson}
          />
        ))}
      </ol>
      {resolved ? (
        <p className="text-caption text-muted-foreground flex items-center gap-1">
          <CheckCircle2 aria-hidden className="size-3.5" />
          Resolved{thread.resolvedBy === null ? '' : ` by ${thread.resolvedBy}`}
          {thread.resolvedAt === null ? null : (
            <>
              {' · '}
              <time dateTime={thread.resolvedAt}>{when.format(new Date(thread.resolvedAt))}</time>
            </>
          )}
        </p>
      ) : null}
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
              const sent = await send(`${base}/replies`, 'POST', { body });
              if (sent !== false) {
                setReplying(false);
                await onChanged();
              }
              return sent;
            }}
          />
          <VoiceRecorder
            songId={songId}
            onRecorded={async (voiceNoteAssetId) => {
              const sent = await send(`${base}/replies`, 'POST', { voiceNoteAssetId });
              if (sent !== false) {
                setReplying(false);
                await onChanged();
              }
              return sent !== false;
            }}
          />
        </>
      ) : null}
    </article>
  );
}

/** A thread someone wrote in or was mentioned in. */
const withPerson = (userId: string) => (thread: ThreadView) =>
  thread.comments.some(
    (comment) =>
      comment.authorId === userId ||
      (comment.mentions ?? []).some((person) => person.id === userId),
  );

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
  const base = `/api/songs/${encodeURIComponent(songId)}/comments`;
  const load = React.useCallback(() => refreshComments(songId), [songId]);
  const [unresolvedOnly, setUnresolvedOnly] = React.useState(false);
  const [person, setPerson] = React.useState<MentionView | null>(null);

  if (loaded === null)
    return <p className="text-body text-muted-foreground font-sans">Loading comments…</p>;
  if (loaded === 'error') {
    return (
      <p className="text-body text-muted-foreground font-sans">The comments could not be loaded.</p>
    );
  }
  const shown = person === null ? loaded.threads : loaded.threads.filter(withPerson(person.id));
  const open = shown.filter((thread) => thread.resolvedAt === null);
  const resolved = unresolvedOnly ? [] : shown.filter((thread) => thread.resolvedAt !== null);
  const choosePerson = (chosen: MentionView) => setPerson(chosen);
  return (
    <section aria-labelledby="song-comments-heading" className="flex flex-col gap-3 font-sans">
      <h2
        id="song-comments-heading"
        className="text-caption text-muted-foreground font-medium tracking-wide uppercase"
      >
        Comments
      </h2>
      {loaded.canComment ? (
        <Composer
          label="Start a conversation about this song"
          submitLabel="Comment"
          songId={songId}
          onSubmit={async (body) => {
            const sent = await send(base, 'POST', { anchor: { kind: 'general' }, body });
            if (sent !== false) await load();
            return sent;
          }}
        />
      ) : null}
      {loaded.canComment ? (
        <VoiceRecorder
          songId={songId}
          onRecorded={async (voiceNoteAssetId) => {
            const sent = await send(base, 'POST', {
              anchor: { kind: 'general' },
              voiceNoteAssetId,
            });
            if (sent !== false) await load();
            return sent !== false;
          }}
        />
      ) : null}
      {loaded.threads.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show">
          <Button
            variant={unresolvedOnly ? 'ghost' : 'secondary'}
            size="sm"
            aria-pressed={!unresolvedOnly}
            className="max-md:min-h-11"
            onClick={() => setUnresolvedOnly(false)}
          >
            All threads
          </Button>
          <Button
            variant={unresolvedOnly ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={unresolvedOnly}
            className="max-md:min-h-11"
            onClick={() => setUnresolvedOnly(true)}
          >
            Unresolved
          </Button>
          {person === null ? null : (
            <p className="text-caption text-foreground flex items-center gap-1" role="status">
              Threads with {person.name}
              <Button
                variant="ghost"
                size="sm"
                className="max-md:min-h-11"
                onClick={() => setPerson(null)}
              >
                Show everyone’s
              </Button>
            </p>
          )}
        </div>
      )}
      {loaded.threads.length === 0 ? (
        <p className="text-body text-muted-foreground">No comments yet.</p>
      ) : open.length === 0 && resolved.length === 0 ? (
        <p className="text-body text-muted-foreground">
          {unresolvedOnly ? 'Nothing unresolved.' : 'No threads to show.'}
        </p>
      ) : null}
      {open.map((thread) => (
        <Thread
          key={thread.id}
          thread={thread}
          songId={songId}
          canComment={loaded.canComment}
          onChanged={load}
          playback={playback}
          onPerson={choosePerson}
        />
      ))}
      {resolved.length === 0 ? null : (
        <details className="flex flex-col gap-3">
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
                onPerson={choosePerson}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
