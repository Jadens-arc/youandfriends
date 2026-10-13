'use client';

import { cn, focusRing } from '@youandfriends/ui';
import * as React from 'react';

import { activeQuery, type Person } from './tokens';

/**
 * @-mention autocomplete for the comment composer (task `094`).
 *
 * The list comes from the server and holds only the people who can open this song — never the
 * whole workspace, which would tell a narrowly-shared collaborator who else works here. Typing
 * `@` opens it; arrows move, Enter or Tab picks, Escape closes. A query nobody matches says so,
 * because a mention cannot reach someone the song is not shared with.
 */

const cache = new Map<string, Promise<readonly Person[]>>();

function loadMentionable(songId: string): Promise<readonly Person[]> {
  let pending = cache.get(songId);
  if (pending === undefined) {
    pending = fetch(`/api/songs/${encodeURIComponent(songId)}/mentionable`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return [];
        const body = (await response.json()) as { people?: unknown };
        return Array.isArray(body.people) ? (body.people as Person[]) : [];
      })
      .catch(() => {
        cache.delete(songId);
        return [];
      });
    cache.set(songId, pending);
  }
  return pending;
}

/** Forget the cached list — for tests, and after sharing changes. */
export function forgetMentionable(songId?: string): void {
  if (songId === undefined) cache.clear();
  else cache.delete(songId);
}

export function useMentionable(songId: string | undefined): readonly Person[] {
  const [people, setPeople] = React.useState<readonly Person[]>([]);
  React.useEffect(() => {
    if (songId === undefined) return;
    let live = true;
    void loadMentionable(songId).then((list) => {
      if (live) setPeople(list);
    });
    return () => {
      live = false;
    };
  }, [songId]);
  return people;
}

export function MentionTextarea({
  id,
  value,
  onChange,
  people,
  onPick,
  className,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly people: readonly Person[];
  readonly onPick: (person: Person) => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = React.useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = React.useState(0);
  const listId = `${id}-mentions`;

  const matches = React.useMemo(() => {
    if (query === null) return [];
    const needle = query.query.toLocaleLowerCase();
    return people
      .filter((person) => person.displayName.toLocaleLowerCase().includes(needle))
      .slice(0, 8);
  }, [people, query]);
  const open = query !== null;

  function track(text: string, caret: number) {
    const next = activeQuery(text, caret);
    setQuery(next);
    setActive(0);
  }

  function pick(person: Person) {
    if (query === null) return;
    const caret = query.start + query.query.length + 1;
    const insert = `@${person.displayName} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    onChange(next);
    onPick(person);
    setQuery(null);
    const at = query.start + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  }

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        id={id}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && matches[active] !== undefined ? `${listId}-${active}` : undefined
        }
        onChange={(event) => {
          onChange(event.target.value);
          track(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === 'ArrowDown' && matches.length > 0) {
            event.preventDefault();
            setActive((index) => (index + 1) % matches.length);
          } else if (event.key === 'ArrowUp' && matches.length > 0) {
            event.preventDefault();
            setActive((index) => (index - 1 + matches.length) % matches.length);
          } else if ((event.key === 'Enter' || event.key === 'Tab') && matches[active]) {
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setQuery(null);
          }
        }}
        onBlur={() => setQuery(null)}
        className={className}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="People who can open this song"
        hidden={!open}
        className="border-border bg-popover text-popover-foreground absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border p-1 shadow-md"
      >
        {matches.map((person, index) => (
          <li
            key={person.userId}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // Keep focus in the textarea: a mouse press must not blur it before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(person)}
            className={cn(
              'text-body cursor-pointer rounded-sm px-2 py-1.5 max-md:min-h-11 max-md:py-3',
              index === active
                ? 'bg-background text-foreground border-foreground border-l-2 font-medium'
                : 'border-l-2 border-transparent',
              focusRing,
            )}
          >
            {person.displayName}
          </li>
        ))}
        {open && matches.length === 0 ? (
          <li role="presentation" className="text-caption text-muted-foreground px-2 py-1.5">
            Nobody by that name can open this song. A mention does not share it.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
