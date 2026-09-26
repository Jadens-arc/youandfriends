'use client';

import { cn, focusRing } from '@youandfriends/ui';
import * as React from 'react';

import { mentionQuery } from '@/lib/comments/mention-format';
import type { MentionView } from '@/lib/comments/store';

import { useMentionable } from './use-mentionable';

/**
 * A comment's text box with `@` suggestions (task `094`). Type `@` and part of a name; the people
 * who can see the song and match are listed. ↑ ↓ move, Enter or Tab picks, Escape closes. The
 * list is the server's (`/mentionable`); it is only filtered by name here.
 */
const SHOWN = 6;

export function MentionField({
  id,
  songId,
  value,
  onChange,
  onPick,
  describedBy,
  invalid,
  maxLength,
  className,
}: {
  readonly id: string;
  /** Null: no mentions here — a plain text box. */
  readonly songId: string | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onPick: (person: MentionView) => void;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly maxLength: number;
  readonly className: string;
}) {
  const [caret, setCaret] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [dismissed, setDismissed] = React.useState<number | null>(null);
  const [textarea, setTextarea] = React.useState<HTMLTextAreaElement | null>(null);
  const query = songId === null ? null : mentionQuery(value, caret);
  const open = query !== null && dismissed !== query.start;
  const people = useMentionable(songId, query !== null);
  const matches =
    open && typeof people === 'object'
      ? people
          .filter((person) => person.name.toLowerCase().includes(query.query.toLowerCase()))
          .slice(0, SHOWN)
      : [];
  const listId = `${id}-people`;
  const selected = matches[Math.min(active, matches.length - 1)];

  function pick(person: MentionView) {
    if (query === null) return;
    const inserted = `@${person.name} `;
    const next = value.slice(0, query.start) + inserted + value.slice(caret);
    const at = query.start + inserted.length;
    onPick(person);
    onChange(next);
    setCaret(at);
    setActive(0);
    queueMicrotask(() => textarea?.setSelectionRange(at, at));
  }

  return (
    <div className="relative">
      <textarea
        ref={setTextarea}
        id={id}
        value={value}
        maxLength={maxLength}
        rows={3}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setActive(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (!open || matches.length === 0) {
            if (open && event.key === 'Escape') setDismissed(query.start);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (current + step + matches.length) % matches.length);
          } else if ((event.key === 'Enter' || event.key === 'Tab') && selected !== undefined) {
            event.preventDefault();
            pick(selected);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDismissed(query.start);
          }
        }}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-autocomplete={songId === null ? undefined : 'list'}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && selected !== undefined ? `${listId}-${selected.id}` : undefined
        }
        className={className}
      />
      {open ? (
        <div className="border-border bg-card absolute inset-x-0 top-full z-10 mt-1 rounded-md border p-1 shadow-sm">
          {people === 'loading' ? (
            <p role="status" className="text-caption text-muted-foreground p-2">
              Finding people…
            </p>
          ) : people === 'error' ? (
            <p role="status" className="text-caption text-muted-foreground p-2">
              The people on this song couldn’t be loaded.
            </p>
          ) : matches.length === 0 ? (
            <p role="status" className="text-caption text-muted-foreground p-2">
              No one who can see this song matches “{query.query}”.
            </p>
          ) : (
            <>
              <ul id={listId} role="listbox" aria-label="People who can see this song">
                {matches.map((person) => (
                  <li
                    key={person.id}
                    id={`${listId}-${person.id}`}
                    role="option"
                    aria-selected={person === selected}
                    // Mouse down, not click: the text box keeps focus and its caret.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(person);
                    }}
                    className={cn(
                      'text-body text-foreground cursor-pointer rounded-sm px-2 py-1 max-md:min-h-11',
                      person === selected ? 'bg-muted' : '',
                      focusRing,
                    )}
                  >
                    {person.name}
                  </li>
                ))}
              </ul>
              <p role="status" className="sr-only">
                {matches.length === 1 ? '1 person' : `${matches.length} people`} can be mentioned.
                Up and down to choose, Enter to pick.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
