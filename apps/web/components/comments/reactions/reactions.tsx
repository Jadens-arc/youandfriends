'use client';

import {
  REACTION_LABELS,
  REACTION_NAMES,
  REACTIONS,
  type Reaction,
} from '@youandfriends/contracts';
import { cn, focusRing } from '@youandfriends/ui';
import { SmilePlus } from 'lucide-react';
import * as React from 'react';

import { setReaction, type ReactionView } from '@/lib/comments/store';

/**
 * Reactions on a comment (task `094`): a fixed set, each shown with its count, pressed when it is
 * yours. Pressing shows the change at once and sends it; if it does not save, it goes back and
 * says so. Each says in words what it is, how many, and who — the emoji alone is not a label.
 */

function who(people: readonly string[]): string {
  if (people.length <= 3) return people.join(', ');
  return `${people.slice(0, 3).join(', ')} and ${people.length - 3} more`;
}

export function Reactions({
  songId,
  threadId,
  commentId,
  reactions,
  canReact,
}: {
  readonly songId: string;
  readonly threadId: string;
  readonly commentId: string;
  readonly reactions: readonly ReactionView[];
  readonly canReact: boolean;
}) {
  const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pickerId = React.useId();

  function toggle(reaction: Reaction, on: boolean) {
    setError(null);
    setPicking(false);
    void setReaction(songId, threadId, commentId, reaction, on).then((ok) => {
      if (!ok) setError('Your reaction didn’t save. Try again.');
    });
  }

  if (reactions.length === 0 && !canReact) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Reactions">
        {reactions.map((entry) => {
          const label = REACTION_LABELS[entry.reaction];
          const description = `${label}: ${entry.count} — ${who(entry.people)}`;
          return canReact ? (
            <button
              key={entry.reaction}
              type="button"
              aria-pressed={entry.mine}
              aria-label={`${description}. ${entry.mine ? 'Remove your' : 'Add your'} ${label}.`}
              title={description}
              onClick={() => toggle(entry.reaction, !entry.mine)}
              className={cn(
                'text-caption flex h-7 items-center gap-1 rounded-full border px-2 max-md:min-h-11',
                entry.mine
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border-subtle text-muted-foreground',
                focusRing,
              )}
            >
              <span aria-hidden>{REACTIONS[entry.reaction]}</span>
              <span className="tabular font-mono">{entry.count}</span>
            </button>
          ) : (
            <span
              key={entry.reaction}
              aria-label={description}
              title={description}
              className="border-border-subtle text-caption text-muted-foreground flex h-7 items-center gap-1 rounded-full border px-2"
            >
              <span aria-hidden>{REACTIONS[entry.reaction]}</span>
              <span className="tabular font-mono">{entry.count}</span>
            </span>
          );
        })}
        {canReact ? (
          <button
            type="button"
            aria-expanded={picking}
            aria-controls={picking ? pickerId : undefined}
            aria-label="Add a reaction"
            onClick={() => setPicking((open) => !open)}
            className={cn(
              'text-muted-foreground hover:text-foreground flex h-7 items-center rounded-full px-1.5 max-md:min-h-11',
              focusRing,
            )}
          >
            <SmilePlus aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      {picking ? (
        <div
          id={pickerId}
          role="group"
          aria-label="Choose a reaction"
          className="border-border-subtle flex w-fit gap-0.5 rounded-md border p-0.5"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPicking(false);
          }}
        >
          {REACTION_NAMES.map((reaction) => {
            const mine = reactions.some((entry) => entry.reaction === reaction && entry.mine);
            return (
              <button
                key={reaction}
                type="button"
                aria-label={`React with ${REACTION_LABELS[reaction]}`}
                aria-pressed={mine}
                onClick={() => toggle(reaction, !mine)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-sm text-base max-md:size-11',
                  mine ? 'bg-muted' : '',
                  focusRing,
                )}
              >
                <span aria-hidden>{REACTIONS[reaction]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
