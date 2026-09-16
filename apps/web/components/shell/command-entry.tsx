'use client';

import { Button, cn } from '@youandfriends/ui';
import { Search } from 'lucide-react';
import * as React from 'react';

/**
 * Command and search entry (docs/DESIGN.md §4: "always available").
 *
 * The palette itself — search across projects, songs, lyrics, and files — is task `045`.
 * This is the always-present entry point and its keyboard shortcut, which belong to the
 * shell rather than to the search feature.
 */
export function CommandEntry() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Cmd+K on macOS, Ctrl+K elsewhere.
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn('text-muted-foreground w-64 justify-start gap-2')}
      >
        <Search className="size-4" aria-hidden />
        <span>Search…</span>
        <kbd className="text-caption ml-auto font-mono tracking-widest">⌘K</kbd>
      </Button>
      {open ? (
        <p role="status" className="sr-only">
          Command palette opens in task 045.
        </p>
      ) : null}
    </>
  );
}
