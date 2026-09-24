'use client';

import { cn } from '@youandfriends/ui';
import { CloudOff, Loader2, Users } from 'lucide-react';
import * as React from 'react';
import type { Awareness } from 'y-protocols/awareness';

import type { ConnectionStatus } from '@/lib/lyrics/collaboration-client';

/**
 * Who else is writing (task `082`), and whether this tab is connected to them.
 *
 * Names are always in words beside their colour. Assistive technology hears a polite line when
 * someone arrives or leaves — never cursor movements, which change awareness many times a second
 * and would drown out the writing (`docs/DESIGN.md` §12).
 */

interface Person {
  readonly name: string;
  readonly color: string;
}

function othersOf(awareness: Awareness): Person[] {
  const seen = new Map<string, Person>();
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = (state as { user?: { name?: unknown; color?: unknown } }).user;
    if (typeof user?.name !== 'string') continue;
    // One person in two tabs is one person here.
    seen.set(user.name, {
      name: user.name,
      color: typeof user.color === 'string' ? user.color : 'var(--color-secondary)',
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Names who arrived and who left between two lists — the only things worth announcing. */
export function presenceChanges(before: readonly string[], after: readonly string[]): string[] {
  const joined = after.filter((name) => !before.includes(name));
  const left = before.filter((name) => !after.includes(name));
  return [
    ...joined.map((name) => `${name} joined the lyrics.`),
    ...left.map((name) => `${name} left the lyrics.`),
  ];
}

/** "Sam Rivera" → "SR"; one name → its first letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : parts.slice(0, 1);
  return letters.map((part) => Array.from(part ?? '')[0]?.toUpperCase() ?? '').join('');
}

const STATUS_TEXT: Readonly<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting — your changes still save',
  offline: 'Working alone — live editing is unreachable, your changes still save',
};

/** The same, at phone width — still in words, just fewer of them. */
const STATUS_SHORT: Readonly<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Working alone — still saving',
};

export function PresenceList({
  awareness,
  status,
}: {
  readonly awareness: Awareness;
  readonly status: ConnectionStatus;
}) {
  const [others, setOthers] = React.useState<Person[]>(() => othersOf(awareness));
  const [announcement, setAnnouncement] = React.useState('');
  const names = React.useRef<string[]>(others.map((person) => person.name));

  React.useEffect(() => {
    const update = () => {
      const next = othersOf(awareness);
      const nextNames = next.map((person) => person.name);
      const changes = presenceChanges(names.current, nextNames);
      names.current = nextNames;
      // Awareness changes on every cursor move; only a change in who is here re-renders.
      if (changes.length > 0) {
        setOthers(next);
        setAnnouncement(changes.join(' '));
      }
    };
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness]);

  const Icon = status === 'connected' ? Users : status === 'offline' ? CloudOff : Loader2;
  return (
    <div className="flex flex-wrap items-center gap-2 font-sans" data-connection={status}>
      <p className="text-caption text-muted-foreground flex items-center gap-1.5">
        <Icon
          aria-hidden
          className={cn(
            'size-3.5 shrink-0',
            (status === 'connecting' || status === 'reconnecting') && 'motion-safe:animate-spin',
          )}
        />
        <span className="md:hidden">{STATUS_SHORT[status]}</span>
        <span className="max-md:hidden">{STATUS_TEXT[status]}</span>
      </p>
      {status === 'connected' && others.length > 0 ? (
        <ul aria-label="Also here" className="flex flex-wrap items-center gap-1.5">
          {others.map((person) => (
            <li
              key={person.name}
              title={person.name}
              className="text-caption border-border-subtle flex items-center gap-1 rounded-full border px-2 py-0.5 max-md:border-0 max-md:p-0"
            >
              <span
                aria-hidden
                className="size-2 rounded-full max-md:hidden"
                style={{ backgroundColor: person.color }}
              />
              {/* At phone width, space is scarce: an initial in their colour; the name stays for
                  screen readers and on long-press as the title. */}
              <span
                aria-hidden
                data-avatar
                className="text-paper flex size-7 items-center justify-center rounded-full text-xs font-semibold md:hidden"
                style={{ backgroundColor: person.color }}
              >
                {initials(person.name)}
              </span>
              <span className="max-md:sr-only">{person.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
