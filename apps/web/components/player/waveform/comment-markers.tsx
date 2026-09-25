'use client';

import { cn, focusRing } from '@youandfriends/ui';
import { MessageSquare } from 'lucide-react';
import * as React from 'react';

import { formatClock } from '@/lib/player/format';

/**
 * Timestamp comments on the timeline (task `091`) — in their own lane under the waveform, never
 * drawn over the audio shape. Each is a real button named with its time, author, and opening
 * words (a mark on a canvas would be invisible to assistive technology); arrow keys move between
 * them. Comments closer together than the lane can show apart are gathered into one cluster that
 * opens into a list.
 */

export interface TimelineComment {
  readonly threadId: string;
  readonly ms: number;
  readonly versionId: string;
  readonly author: string | null;
  readonly excerpt: string;
}

export interface MarkerCluster {
  readonly ms: number;
  readonly items: readonly TimelineComment[];
}

/**
 * Group comments that would sit within `gap` of the lane's width of each other. Greedy from the
 * left: a cluster spans at most `gap` from its first comment, so it never swallows the lane.
 */
export function clusterMarkers(
  comments: readonly TimelineComment[],
  durationMs: number,
  gap = 0.025,
): MarkerCluster[] {
  const sorted = [...comments].sort((a, b) => a.ms - b.ms);
  const clusters: { ms: number; items: TimelineComment[] }[] = [];
  const span = Math.max(1, durationMs) * gap;
  for (const comment of sorted) {
    const last = clusters.at(-1);
    if (last !== undefined && comment.ms - last.ms <= span) last.items.push(comment);
    else clusters.push({ ms: comment.ms, items: [comment] });
  }
  return clusters;
}

function describe(comment: TimelineComment): string {
  const words = comment.excerpt.length > 60 ? `${comment.excerpt.slice(0, 57)}…` : comment.excerpt;
  return `Comment at ${formatClock(comment.ms / 1000)} by ${comment.author ?? 'someone'}: ${words}`;
}

export function CommentMarkers({
  comments,
  durationMs,
  onPlay,
}: {
  readonly comments: readonly TimelineComment[];
  readonly durationMs: number | null;
  readonly onPlay: (comment: TimelineComment) => void;
}) {
  const [open, setOpen] = React.useState<number | null>(null);
  const lane = React.useRef<HTMLDivElement>(null);
  if (durationMs === null || durationMs <= 0 || comments.length === 0) return null;
  const clusters = clusterMarkers(comments, durationMs);
  const expanded = open === null ? null : (clusters.find((cluster) => cluster.ms === open) ?? null);

  // Left and Right move between markers, Home and End to the ends — the lane is one stop in the
  // tab order's worth of ground, walked with arrows.
  function onKeyDown(event: React.KeyboardEvent) {
    const buttons = Array.from(lane.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(buttons.length - 1, index + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={lane}
        role="group"
        aria-label="Comments on the timeline"
        onKeyDown={onKeyDown}
        className="border-border-subtle relative h-7 w-full border-t max-md:h-11"
      >
        {clusters.map((cluster) => {
          const left = `${Math.min(100, (cluster.ms / durationMs) * 100)}%`;
          const single = cluster.items.length === 1 ? cluster.items[0] : null;
          const first = cluster.items[0];
          const lastItem = cluster.items.at(-1);
          const label =
            single !== null && single !== undefined
              ? describe(single)
              : `${cluster.items.length} comments from ${formatClock(cluster.ms / 1000)} to ${formatClock((lastItem?.ms ?? cluster.ms) / 1000)}`;
          return (
            <button
              key={`${cluster.ms}-${first?.threadId ?? ''}`}
              type="button"
              aria-label={label}
              title={label}
              {...(single === null || single === undefined
                ? { 'aria-expanded': open === cluster.ms }
                : {})}
              onClick={() => {
                if (single !== null && single !== undefined) onPlay(single);
                else setOpen(open === cluster.ms ? null : cluster.ms);
              }}
              style={{ left }}
              className={cn(
                'text-foreground bg-card border-border absolute top-1/2 flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-0.5 rounded-full border px-1 max-md:h-11 max-md:min-w-11',
                focusRing,
              )}
            >
              <MessageSquare aria-hidden className="size-3" />
              {cluster.items.length > 1 ? (
                <span aria-hidden className="tabular text-[0.6875rem]">
                  {cluster.items.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {expanded === null ? null : (
        <ul aria-label="Comments in this cluster" className="flex flex-col gap-1">
          {expanded.items.map((comment) => (
            <li key={comment.threadId}>
              <button
                type="button"
                onClick={() => onPlay(comment)}
                className={cn(
                  'text-caption flex w-full items-baseline gap-2 rounded-sm px-1 text-left max-md:min-h-11',
                  focusRing,
                )}
              >
                <span className="tabular font-mono">{formatClock(comment.ms / 1000)}</span>
                <span className="text-muted-foreground truncate">
                  {comment.author ?? 'Someone'} — {comment.excerpt}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
