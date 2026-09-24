'use client';

import { COMMENT_MAX_CHARACTERS } from '@youandfriends/contracts';
import { Button, cn, focusRing } from '@youandfriends/ui';
import { CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react';
import * as React from 'react';

/**
 * The conversation on a song (task `090`): threads of plain-text comments, open ones first,
 * resolved ones folded away below. Bodies are rendered as text — React escapes them — never as
 * markup. Everything a person may not do is simply not offered; the server refuses it anyway.
 */

interface CommentView {
  readonly id: string;
  readonly author: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

interface ThreadView {
  readonly id: string;
  readonly anchor: { readonly kind: string };
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly comments: readonly CommentView[];
}

interface Loaded {
  readonly threads: readonly ThreadView[];
  readonly canComment: boolean;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function send(url: string, method: string, body?: unknown): Promise<boolean> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.ok;
}

function Composer({
  label,
  submitLabel,
  initial = '',
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly submitLabel: string;
  readonly initial?: string;
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly onCancel?: () => void;
}) {
  const [body, setBody] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
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
        void onSubmit(body).then((ok) => {
          setBusy(false);
          if (ok) {
            setBody('');
            setError(null);
          } else {
            setError('That was not saved. Try again.');
          }
        });
      }}
    >
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
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
  base,
  onChanged,
}: {
  readonly comment: CommentView;
  readonly base: string;
  readonly onChanged: () => Promise<void>;
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
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const ok = await send(`${base}/comments/${encodeURIComponent(comment.id)}`, 'PATCH', {
              body,
            });
            if (ok) {
              setEditing(false);
              await onChanged();
            }
            return ok;
          }}
        />
      ) : (
        // Plain text, whitespace kept: React escapes it, so markup in a comment stays text.
        <p className="text-body text-foreground font-sans break-words whitespace-pre-wrap">
          {comment.body}
        </p>
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
  return `Thread: ${words.length > 60 ? `${words.slice(0, 57)}…` : words}`;
}

function Thread({
  thread,
  songId,
  canComment,
  onChanged,
}: {
  readonly thread: ThreadView;
  readonly songId: string;
  readonly canComment: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const [replying, setReplying] = React.useState(false);
  const base = `/api/songs/${encodeURIComponent(songId)}/comments/${encodeURIComponent(thread.id)}`;
  const resolved = thread.resolvedAt !== null;
  return (
    <article
      aria-label={threadName(thread)}
      className="border-border-subtle bg-card flex flex-col gap-3 rounded-md border p-3"
    >
      <ol className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <Comment key={comment.id} comment={comment} base={base} onChanged={onChanged} />
        ))}
      </ol>
      {resolved ? (
        <p className="text-caption text-muted-foreground flex items-center gap-1">
          <CheckCircle2 aria-hidden className="size-3.5" />
          Resolved{thread.resolvedBy === null ? '' : ` by ${thread.resolvedBy}`}
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
        <Composer
          label="Your reply"
          submitLabel="Reply"
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            const ok = await send(`${base}/replies`, 'POST', { body });
            if (ok) {
              setReplying(false);
              await onChanged();
            }
            return ok;
          }}
        />
      ) : null}
    </article>
  );
}

export function CommentsPanel({ songId }: { readonly songId: string }) {
  const [loaded, setLoaded] = React.useState<Loaded | null | 'error'>(null);
  const base = `/api/songs/${encodeURIComponent(songId)}/comments`;

  const load = React.useCallback(async () => {
    const response = await fetch(base, { cache: 'no-store' });
    setLoaded(response.ok ? ((await response.json()) as Loaded) : 'error');
  }, [base]);

  React.useEffect(() => {
    let cancelled = false;
    void fetch(base, { cache: 'no-store' }).then(async (response) => {
      if (cancelled) return;
      setLoaded(response.ok ? ((await response.json()) as Loaded) : 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

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
          onSubmit={async (body) => {
            const ok = await send(base, 'POST', { anchor: { kind: 'general' }, body });
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
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
