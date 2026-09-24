'use client';

import type { LyricsDocument } from '@youandfriends/contracts';
import {
  Button,
  cn,
  focusRing,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@youandfriends/ui';
import { History, Minus, Plus, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { lineDiff, RETENTION_POLICY_TEXT } from '@/lib/lyrics/revisions-policy';
import { lyricsToText } from '@/lib/lyrics/text-format';

/**
 * Lyric history (task `084`): named checkpoints, automatic snapshots, and the draft kept before
 * each restore — each comparable against the lyrics as they are now, and restorable. Restoring
 * never loses anything: what is there now is kept as a revision first, and the panel says so.
 */

export type RevisionKind = 'automatic' | 'checkpoint' | 'before_restore';

interface RevisionSummary {
  readonly id: string;
  readonly kind: RevisionKind;
  readonly name: string | null;
  readonly createdAt: string;
  readonly author: string | null;
}

export interface RestoreResponse {
  readonly version: number;
  readonly document: LyricsDocument;
  readonly yjsUpdate: string;
  readonly beforeRevisionId: string;
}

const KIND_TEXT: Readonly<Record<RevisionKind, string>> = {
  automatic: 'Automatic snapshot',
  checkpoint: 'Checkpoint',
  before_restore: 'Kept before a restore',
};

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function api(songId: string, path = '') {
  return `/api/songs/${encodeURIComponent(songId)}/lyrics/revisions${path}`;
}

/** The diff of a revision against now, one line per row, said in words as well as marks. */
export function RevisionDiff({
  before,
  after,
}: {
  readonly before: LyricsDocument;
  readonly after: LyricsDocument;
}) {
  const lines = lineDiff(lyricsToText(before), lyricsToText(after));
  if (lines.every((line) => line.kind === 'same')) {
    return <p className="text-caption text-muted-foreground">Same as the lyrics now.</p>;
  }
  return (
    <ol
      aria-label="Changes from this draft to now"
      className="font-mono text-[0.8125rem] leading-relaxed"
    >
      {lines.map((line, index) => {
        const heading = /^\[.+\]$/.test(line.text);
        return (
          <li
            key={index}
            data-change={line.kind}
            className={cn(
              'flex gap-2 px-2',
              line.kind === 'added' && 'bg-[color-mix(in_srgb,var(--color-olive)_18%,transparent)]',
              line.kind === 'removed' &&
                'bg-[color-mix(in_srgb,var(--color-rust)_16%,transparent)] line-through decoration-1',
              heading && 'mt-2 font-serif font-medium not-italic',
            )}
          >
            <span aria-hidden className="w-3 shrink-0 select-none">
              {line.kind === 'added' ? (
                <Plus className="mt-1 size-3" />
              ) : line.kind === 'removed' ? (
                <Minus className="mt-1 size-3" />
              ) : null}
            </span>
            <span className="sr-only">
              {line.kind === 'added' ? 'Added: ' : line.kind === 'removed' ? 'Removed: ' : ''}
            </span>
            <span className="min-w-0 break-words">{line.text === '' ? ' ' : line.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function HistoryPanel({
  songId,
  canEdit,
  current,
  beforeCheckpoint,
  onRestored,
}: {
  readonly songId: string;
  readonly canEdit: boolean;
  /** The lyrics as they are on screen now, for comparison. */
  readonly current: () => LyricsDocument;
  /** Save whatever is waiting first, so a checkpoint is of what is on screen. */
  readonly beforeCheckpoint: () => Promise<void>;
  readonly onRestored: (result: RestoreResponse) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [revisions, setRevisions] = React.useState<readonly RevisionSummary[] | null>(null);
  const [selected, setSelected] = React.useState<{ id: string; document: LyricsDocument } | null>(
    null,
  );
  const [name, setName] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const response = await fetch(api(songId), { cache: 'no-store' });
    if (!response.ok) {
      setMessage('The history could not be loaded.');
      return;
    }
    setRevisions(((await response.json()) as { revisions: RevisionSummary[] }).revisions);
  }, [songId]);

  async function select(id: string) {
    const response = await fetch(api(songId, `/${encodeURIComponent(id)}`), { cache: 'no-store' });
    if (!response.ok) return;
    const detail = (await response.json()) as { document: LyricsDocument };
    setSelected({ id, document: detail.document });
  }

  async function checkpoint(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === '') {
      setMessage('Give the checkpoint a name.');
      return;
    }
    setBusy(true);
    await beforeCheckpoint();
    const response = await fetch(api(songId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!response.ok) {
      setMessage('The checkpoint was not saved.');
      return;
    }
    setMessage(`Checkpoint “${name.trim()}” saved.`);
    setName('');
    await load();
  }

  async function restore(id: string) {
    setBusy(true);
    const response = await fetch(api(songId, `/${encodeURIComponent(id)}/restore`), {
      method: 'POST',
    });
    setBusy(false);
    if (!response.ok) {
      setMessage('That draft was not restored. Nothing changed.');
      return;
    }
    onRestored((await response.json()) as RestoreResponse);
    setMessage('Restored. What was there before is kept at the top of this list.');
    setSelected(null);
    await load();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <History aria-hidden />
        History
      </Button>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetTitle className="font-serif">Lyrics history</SheetTitle>
        <SheetDescription className="text-caption">{RETENTION_POLICY_TEXT}</SheetDescription>

        {canEdit ? (
          <form onSubmit={(event) => void checkpoint(event)} className="flex items-end gap-2">
            <label className="text-caption text-muted-foreground flex flex-1 flex-col gap-1">
              Name a checkpoint of the lyrics as they are now
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Before the bridge rewrite"
                className={cn(
                  'border-border bg-card text-body text-foreground h-9 rounded-md border px-2',
                  focusRing,
                )}
              />
            </label>
            <Button type="submit" size="sm" disabled={busy}>
              Save checkpoint
            </Button>
          </form>
        ) : null}

        <p role="status" className="text-caption text-muted-foreground empty:hidden">
          {message}
        </p>

        {revisions === null ? (
          <p className="text-caption text-muted-foreground">Loading history…</p>
        ) : revisions.length === 0 ? (
          <p className="text-caption text-muted-foreground">No earlier drafts yet.</p>
        ) : (
          <ul aria-label="Earlier drafts" className="flex flex-col gap-1">
            {revisions.map((revision) => {
              const isSelected = selected?.id === revision.id;
              return (
                <li key={revision.id} className="flex flex-col gap-2">
                  <button
                    type="button"
                    aria-expanded={isSelected}
                    onClick={() => (isSelected ? setSelected(null) : void select(revision.id))}
                    className={cn(
                      'border-border-subtle flex flex-col items-start rounded-md border px-3 py-2 text-left',
                      isSelected && 'border-foreground',
                      focusRing,
                    )}
                  >
                    <span className="text-body text-foreground font-medium">
                      {revision.name ?? KIND_TEXT[revision.kind]}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {KIND_TEXT[revision.kind]} ·{' '}
                      <time dateTime={revision.createdAt}>
                        {when.format(new Date(revision.createdAt))}
                      </time>
                      {revision.author === null ? '' : ` · ${revision.author}`}
                    </span>
                  </button>
                  {isSelected ? (
                    <div className="flex flex-col gap-2 pl-2">
                      <RevisionDiff before={selected.document} after={current()} />
                      {canEdit ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void restore(revision.id)}
                          >
                            <RotateCcw aria-hidden />
                            Restore this draft
                          </Button>
                          <span className="text-caption text-muted-foreground">
                            What is there now is kept as a revision first.
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
