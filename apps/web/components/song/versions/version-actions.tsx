'use client';

import { Button, cn, focusRing, transition } from '@youandfriends/ui';
import { VERSION_NOTE_MAX } from '@youandfriends/contracts';
import { Download, PencilLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import type { SongCapabilities, SongVersion } from '@/lib/songs/workspace';

async function send(path: string, method: 'POST' | 'PATCH', body: unknown) {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? 'That did not save. Try again.');
  }
}

/**
 * What can be done with one version (task `056`): make it current, edit its note, download its
 * untouched original. Each appears only for someone who may do it — a viewer sees the note as
 * text and no controls, never a disabled button implying a permission they lack.
 */
export function VersionActions({
  songId,
  version,
  capabilities,
}: {
  readonly songId: string;
  readonly version: SongVersion;
  readonly capabilities: SongCapabilities;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(version.note ?? '');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const base = `/api/songs/${encodeURIComponent(songId)}/versions`;

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not save. Try again.');
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {capabilities.edit && !version.isCurrent ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              void run(() => send(`${base}/current`, 'POST', { versionId: version.id }))
            }
          >
            Make current
          </Button>
        ) : null}
        {version.noteEditable && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilLine aria-hidden />
            {version.note === null ? 'Add a note' : 'Edit note'}
          </Button>
        ) : null}
        {capabilities.download ? (
          <a
            href={`${base}/${encodeURIComponent(version.id)}/download`}
            className={cn(
              'text-caption text-foreground hover:bg-border-subtle inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-sans',
              transition,
              focusRing,
            )}
          >
            <Download aria-hidden className="size-4" />
            Download original
          </a>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              send(`${base}/${encodeURIComponent(version.id)}`, 'PATCH', { note: draft }),
            ).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <label
            className="text-caption text-muted-foreground font-sans"
            htmlFor={`note-${version.id}`}
          >
            Note for version {version.number}
          </label>
          <textarea
            id={`note-${version.id}`}
            value={draft}
            maxLength={VERSION_NOTE_MAX}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            className={cn(
              'border-border bg-card text-body text-foreground rounded-md border px-3 py-2 font-sans',
              focusRing,
            )}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save note
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(version.note ?? '');
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-caption text-destructive font-sans">
          {error}
        </p>
      )}
    </div>
  );
}
