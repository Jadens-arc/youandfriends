'use client';

import { Command } from '@youandfriends/ui';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { PaletteBody, usePaletteActions } from './command-palette';

/**
 * Search as a page (task `045`) — the mobile Search destination, where there is no ⌘K. The same
 * body as the palette, laid out full width.
 */
export function SearchPage() {
  const router = useRouter();
  const { run, elements } = usePaletteActions();
  return (
    <>
      <Command
        shouldFilter={false}
        label="Search and commands"
        className="border-border-subtle bg-card h-auto rounded-md border"
      >
        <PaletteBody onNavigate={(href) => router.push(href as Route)} onAction={run} />
      </Command>
      {elements}
    </>
  );
}
