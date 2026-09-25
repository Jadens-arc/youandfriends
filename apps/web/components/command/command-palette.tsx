'use client';

import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@youandfriends/ui';
import {
  Clock,
  FileAudio,
  FolderOpen,
  Heart,
  Library,
  Music,
  Pause,
  Play,
  Plus,
  Quote,
  Settings,
  Share2,
  Upload,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { NewProjectDialog } from '@/components/library/create-dialogs';
import { UploadDialog } from '@/components/upload/upload-dialog';
import { useSearch, type SearchState } from '@/lib/command/use-search';
import { getPlayer, usePlayerState } from '@/lib/player/store';
import type { LyricsHit, SearchHit } from '@/lib/search/service';
import { useCurrentUploadSurface } from '@/lib/upload/current-surface';

/**
 * The command palette (task `045`): go anywhere, do the common things, and search projects,
 * songs, lyrics, and files — one input. Results come from `/api/search`, which only ever
 * matches what this person may open; this component renders what it is given.
 *
 * The same body is the mobile Search destination, where there is no ⌘K to press.
 */

interface Destination {
  readonly id: string;
  readonly label: string;
  readonly href: Route;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const DESTINATIONS: readonly Destination[] = [
  { id: 'library', label: 'Library', href: '/library' as Route, icon: Library },
  { id: 'recent', label: 'Recent', href: '/recent', icon: Clock },
  { id: 'favorites', label: 'Favorites', href: '/favorites', icon: Heart },
  { id: 'shared', label: 'Shared with me', href: '/shared', icon: Share2 },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

export type PaletteAction = 'new-project' | 'upload' | 'toggle-playback';

const matches = (label: string, query: string) =>
  query === '' || label.toLowerCase().includes(query.trim().toLowerCase());

/** The actions the palette can start, and the dialogs and file picker they open. */
export function usePaletteActions(): {
  readonly run: (action: PaletteAction) => void;
  readonly elements: React.ReactNode;
} {
  const surface = useCurrentUploadSurface();
  const [creating, setCreating] = React.useState(false);
  const [files, setFiles] = React.useState<{
    surface: NonNullable<typeof surface>;
    files: File[];
  } | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  const run = React.useCallback((action: PaletteAction) => {
    if (action === 'new-project') setCreating(true);
    else if (action === 'upload') input.current?.click();
    else getPlayer().toggle();
  }, []);

  const elements = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (picked.length > 0 && surface !== null) setFiles({ surface, files: picked });
        }}
      />
      {creating ? <NewProjectDialog folderId={null} onClose={() => setCreating(false)} /> : null}
      {files === null ? null : (
        <UploadDialog surface={files.surface} files={files.files} onClose={() => setFiles(null)} />
      )}
    </>
  );
  return { run, elements };
}

function statusText(state: SearchState, query: string, count: number): string {
  if (state.status === 'loading') return 'Searching…';
  if (state.status === 'error') return 'Search is not reachable right now. Try again in a moment.';
  if (state.status === 'ready' && query.trim() !== '') {
    return count === 0
      ? `Nothing matches “${query.trim()}”.`
      : `${count} ${count === 1 ? 'result' : 'results'}`;
  }
  return '';
}

function HitItem({
  hit,
  kind,
  icon: Icon,
  onSelect,
}: {
  readonly hit: SearchHit | LyricsHit;
  readonly kind: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly onSelect: (href: string) => void;
}) {
  const snippet = 'snippet' in hit ? hit.snippet : null;
  return (
    <CommandItem value={`${kind}:${hit.id}`} onSelect={() => onSelect(hit.href)}>
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground truncate">{hit.title}</span>
        {snippet === null ? null : (
          <span className="text-caption text-muted-foreground truncate font-mono">
            {snippet.map((run, index) =>
              run.match ? (
                <mark
                  key={index}
                  className="text-foreground bg-transparent font-semibold underline"
                >
                  {run.text}
                </mark>
              ) : (
                <React.Fragment key={index}>{run.text}</React.Fragment>
              ),
            )}
          </span>
        )}
        {hit.detail === null ? null : (
          <span className="text-caption text-muted-foreground truncate">{hit.detail}</span>
        )}
      </span>
    </CommandItem>
  );
}

/** The palette's input and list — inside a `Command` with `shouldFilter={false}`. */
export function PaletteBody({
  onNavigate,
  onAction,
  enabled = true,
}: {
  readonly onNavigate: (href: string) => void;
  readonly onAction: (action: PaletteAction) => void;
  readonly enabled?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const state = useSearch(query, enabled);
  const player = usePlayerState();
  const surface = useCurrentUploadSurface();
  const results = state.status === 'idle' ? null : state.results;
  const searching = query.trim() !== '';

  const groups =
    results === null || !searching
      ? []
      : ([
          ['Projects', 'project', FolderOpen, results.projects],
          ['Songs', 'song', Music, results.songs],
          ['Lyrics', 'lyrics', Quote, results.lyrics],
          ['Files', 'file', FileAudio, results.files],
        ] as const);
  const count = groups.reduce((total, group) => total + group[3].length, 0);

  const actions: { id: PaletteAction; label: string; icon: typeof Plus }[] = [
    { id: 'new-project', label: 'Create project', icon: Plus },
  ];
  if (surface !== null) {
    actions.push({ id: 'upload', label: `Upload files to ${surface.name}`, icon: Upload });
  }
  if (player.track !== null) {
    actions.push({
      id: 'toggle-playback',
      label: player.wantsToPlay ? `Pause ${player.track.title}` : `Play ${player.track.title}`,
      icon: player.wantsToPlay ? Pause : Play,
    });
  }
  const shownActions = actions.filter((action) => matches(action.label, query));
  const shownDestinations = DESTINATIONS.filter((destination) =>
    matches(`Go to ${destination.label}`, query),
  );
  const recent = !searching && results !== null ? results.recent : [];
  const status = statusText(state, query, count);

  return (
    <>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search songs, lyrics, and files — or type a command"
      />
      <p
        role="status"
        className="text-caption text-muted-foreground min-h-5 px-3 pt-2 font-sans empty:hidden"
      >
        {status}
      </p>
      <CommandList className="max-h-[60vh]">
        {recent.length > 0 ? (
          <CommandGroup heading="Recent">
            {recent.map((hit) => (
              <HitItem key={hit.id} hit={hit} kind="recent" icon={Clock} onSelect={onNavigate} />
            ))}
          </CommandGroup>
        ) : null}
        {groups.map(([heading, kind, icon, hits]) =>
          hits.length === 0 ? null : (
            <CommandGroup key={kind} heading={heading}>
              {hits.map((hit) => (
                <HitItem key={hit.id} hit={hit} kind={kind} icon={icon} onSelect={onNavigate} />
              ))}
            </CommandGroup>
          ),
        )}
        {(recent.length > 0 || count > 0) && shownActions.length + shownDestinations.length > 0 ? (
          <CommandSeparator />
        ) : null}
        {shownActions.length === 0 ? null : (
          <CommandGroup heading="Actions">
            {shownActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`action:${action.id}`}
                onSelect={() => onAction(action.id)}
              >
                <action.icon className="text-muted-foreground size-4" aria-hidden />
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shownDestinations.length === 0 ? null : (
          <CommandGroup heading="Go to">
            {shownDestinations.map((destination) => (
              <CommandItem
                key={destination.id}
                value={`go:${destination.id}`}
                onSelect={() => onNavigate(destination.href)}
              >
                <destination.icon className="text-muted-foreground size-4" aria-hidden />
                {destination.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </>
  );
}

/** The palette as a dialog, from the shell's search button or ⌘K / Ctrl+K. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { run, elements } = usePaletteActions();
  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Search and commands"
        commandProps={{ shouldFilter: false, loop: true, label: 'Search and commands' }}
      >
        {open ? (
          <PaletteBody
            onNavigate={(href) => {
              onOpenChange(false);
              router.push(href as Route);
            }}
            onAction={(action) => {
              onOpenChange(false);
              run(action);
            }}
          />
        ) : null}
      </CommandDialog>
      {elements}
    </>
  );
}
