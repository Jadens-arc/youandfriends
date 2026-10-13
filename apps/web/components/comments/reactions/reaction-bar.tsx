'use client';

import { COMMENT_REACTIONS } from '@youandfriends/contracts';
import { cn, focusRing } from '@youandfriends/ui';
import { SmilePlus } from 'lucide-react';
import * as React from 'react';

import { toggleReaction, type ReactionView } from '@/lib/comments/store';

/**
 * Reactions on a comment (task `094`): a fixed set of emoji, each with a count and who reacted.
 * A tap is instant — the count changes before the server answers, and is put back if it says no.
 * Whether a reaction is yours is said in words and by the pressed state, not by color alone.
 */

const NAMES: Record<string, string> = {
  '👍': 'thumbs up',
  '❤️': 'heart',
  '🔥': 'fire',
  '😂': 'laughing',
  '🎵': 'music note',
  '👀': 'eyes',
};

function who(by: readonly string[]): string {
  if (by.length <= 3) return by.join(', ');
  return `${by.slice(0, 3).join(', ')} and ${by.length - 3} more`;
}

export function ReactionBar({
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
  const [failed, setFailed] = React.useState(false);
  const pickerId = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);

  if (reactions.length === 0 && !canReact) return null;

  const react = (emoji: string, on: boolean) => {
    setFailed(false);
    void toggleReaction(songId, threadId, commentId, emoji, on, COMMENT_REACTIONS).then((ok) => {
      if (!ok) setFailed(true);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Reactions">
      {reactions.map((reaction) => {
        const name = NAMES[reaction.emoji] ?? reaction.emoji;
        const label = `${name}, ${reaction.count}: ${who(reaction.by)}${
          canReact ? (reaction.mine ? '. Remove your reaction' : '. Add your reaction') : ''
        }`;
        return (
          <button
            key={reaction.emoji}
            type="button"
            disabled={!canReact}
            aria-pressed={reaction.mine}
            aria-label={label}
            title={who(reaction.by)}
            onClick={() => react(reaction.emoji, !reaction.mine)}
            className={cn(
              'text-caption tabular inline-flex items-center gap-1 rounded-full border px-2 py-0.5 max-md:min-h-11',
              reaction.mine
                ? 'border-foreground bg-background text-foreground font-medium'
                : 'border-border-subtle text-muted-foreground',
              focusRing,
            )}
          >
            <span aria-hidden>{reaction.emoji}</span>
            <span aria-hidden>{reaction.count}</span>
          </button>
        );
      })}
      {canReact ? (
        <>
          <button
            ref={trigger}
            type="button"
            aria-expanded={picking}
            aria-controls={pickerId}
            aria-label="Add a reaction"
            onClick={() => setPicking((open) => !open)}
            className={cn(
              'text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-full max-md:size-11',
              focusRing,
            )}
          >
            <SmilePlus aria-hidden className="size-4" />
          </button>
          <div
            id={pickerId}
            hidden={!picking}
            role="group"
            aria-label="Choose a reaction"
            className="border-border bg-popover flex gap-0.5 rounded-full border px-1 py-0.5"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setPicking(false);
                trigger.current?.focus();
              }
            }}
          >
            {COMMENT_REACTIONS.map((emoji) => {
              const mine = reactions.some((reaction) => reaction.emoji === emoji && reaction.mine);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={mine}
                  aria-label={NAMES[emoji] ?? emoji}
                  onClick={() => {
                    react(emoji, !mine);
                    setPicking(false);
                    trigger.current?.focus();
                  }}
                  className={cn(
                    'inline-flex size-7 items-center justify-center rounded-full text-base max-md:size-11',
                    focusRing,
                  )}
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {failed ? (
        <p role="alert" className="text-caption text-destructive w-full">
          That reaction was not saved.
        </p>
      ) : null}
    </div>
  );
}
