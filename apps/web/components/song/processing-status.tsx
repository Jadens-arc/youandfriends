'use client';

import type { ProcessingState } from '@youandfriends/contracts';
import { Button } from '@youandfriends/ui';
import { RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { postJson, RequestFailed } from '@/lib/api/client';
import type { SongVersion } from '@/lib/songs/workspace';

import { ProcessingBadge } from './status-badge';

/**
 * Processing status on the song page (task `065`): what state each version is in, why one failed
 * in words a person can act on, a retry for editors, and live updates while anything is pending.
 *
 * No progress bar. How long a transcode takes is not known in advance, and a bar that stalls at
 * 90% is a small lie; the badge's indeterminate spinner says "working" and nothing more.
 */

/** Said to viewers, who are not shown the reason (only editors can act on it). */
export const VIEWER_FAILURE = 'This version couldn’t be processed.';

export function isPending(state: ProcessingState): boolean {
  return state === 'queued' || state === 'running';
}

/** The first poll comes quickly; after that each waits longer, up to the ceiling. */
export const POLL_INITIAL_MS = 3_000;
export const POLL_MAX_MS = 30_000;
export const POLL_BACKOFF = 1.5;

/**
 * While any version is still queued or processing, ask the server how they are doing, and
 * refresh the page's data when one of them changes. Polling with backoff rather than a socket:
 * the answer changes a few times per upload, and Liveblocks is scoped to lyrics (the task's
 * notes). Paused while the tab is hidden — nobody is watching, and a backgrounded tab should not
 * spend someone's battery asking.
 */
export function useProcessingPoll(
  songId: string,
  versions: readonly Pick<SongVersion, 'id' | 'processingState'>[],
  options: { readonly initialMs?: number; readonly maxMs?: number } = {},
): void {
  const router = useRouter();
  const known = React.useMemo(
    () => new Map(versions.map((version) => [version.id, version.processingState])),
    [versions],
  );
  const pending = versions.some((version) => isPending(version.processingState));
  const initialMs = options.initialMs ?? POLL_INITIAL_MS;
  const maxMs = options.maxMs ?? POLL_MAX_MS;

  React.useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = initialMs;

    async function poll() {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      try {
        const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/versions/status`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (response.ok) {
          const body = (await response.json()) as {
            versions: { id: string; processingState: ProcessingState }[];
          };
          if (cancelled) return;
          const changed = body.versions.some(
            (version) => known.get(version.id) !== version.processingState,
          );
          if (changed) {
            // The page's own data — durations, loudness, the reason for a failure — comes from
            // the server render; this only notices that it has moved on.
            router.refresh();
            return;
          }
        }
      } catch {
        // Offline or a blip: keep polling at the slower pace rather than giving up for good.
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(poll, delay);
      delay = Math.min(maxMs, Math.round(delay * POLL_BACKOFF));
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pending, songId, known, router, initialMs, maxMs]);
}

/**
 * The selected version's status: the badge, and for a failure the reason (editors) or the fact
 * of it (everyone else), a reference to quote, and "Try again" for editors.
 */
export function ProcessingStatus({
  songId,
  version,
  canRetry,
}: {
  readonly songId: string;
  readonly version: SongVersion;
  readonly canRetry: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; reference: string | null } | null>(
    null,
  );

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/songs/${encodeURIComponent(songId)}/versions/${encodeURIComponent(version.id)}/retry`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof RequestFailed
          ? { message: caught.message, reference: caught.correlationId }
          : { message: 'Something went wrong. Try again.', reference: null },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ProcessingBadge state={version.processingState} />
      {version.processingState === 'failed' ? (
        <div role="note" className="flex flex-col gap-2">
          <p className="text-caption text-destructive font-sans">
            {version.processingError ?? VIEWER_FAILURE}
            {canRetry ? ' The original file is safe; you can try again.' : null}
          </p>
          {version.processingReference === null ? null : (
            <p className="text-caption text-muted-foreground font-sans">
              Reference: <span className="font-mono select-all">{version.processingReference}</span>
            </p>
          )}
          {canRetry ? (
            <div>
              <Button variant="secondary" size="sm" onClick={retry} disabled={busy}>
                <RotateCw aria-hidden />
                {busy ? 'Asking to try again…' : 'Try processing again'}
              </Button>
            </div>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="text-caption text-destructive font-sans">
              {error.message}
              {error.reference === null ? null : (
                <>
                  {' '}
                  Reference: <span className="font-mono select-all">{error.reference}</span>
                </>
              )}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The words announced when a version's state moves on, or `null` when nothing worth saying
 * changed. Compared across renders because the new state arrives as fresh props after
 * `router.refresh()`.
 */
export function describeTransition(
  number: number,
  before: ProcessingState | undefined,
  after: ProcessingState,
): string | null {
  if (before === undefined || before === after) return null;
  if (after === 'complete') return `Version ${number} is ready.`;
  if (after === 'failed') return `Version ${number} could not be processed.`;
  if (after === 'running') return `Version ${number} is processing.`;
  return null;
}

/**
 * Keeps a song page's processing status live and announces a version finishing, for someone
 * who is not looking at the badge (a screen reader user, or anyone on another part of the page).
 */
export function ProcessingPoller({
  songId,
  versions,
}: {
  readonly songId: string;
  readonly versions: readonly SongVersion[];
}) {
  useProcessingPoll(songId, versions);
  const previous = React.useRef(new Map(versions.map((v) => [v.id, v.processingState])));
  const [announcement, setAnnouncement] = React.useState('');

  React.useEffect(() => {
    const said = versions
      .map((version) =>
        describeTransition(
          version.number,
          previous.current.get(version.id),
          version.processingState,
        ),
      )
      .filter((line): line is string => line !== null);
    previous.current = new Map(versions.map((v) => [v.id, v.processingState]));
    if (said.length > 0) setAnnouncement(said.join(' '));
  }, [versions]);

  return (
    <p aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
}
