import { cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';

import { CoverArt } from '@/components/library/cover-art';
import { CollaboratorStack } from '@/components/library/project-card';
import { formatDuration, spokenDuration } from '@/lib/songs/format';
import { projectHref } from '@/lib/songs/routes';
import type { SongWorkspace } from '@/lib/songs/workspace';

import { InlineField, InlineStatus } from '@/components/metadata/inline-field';
import { STATUS_OPTIONS } from '@/lib/songs/format';

import { SongActions } from './song-actions';
import { WorkStatusBadge } from './status-badge';

/**
 * The song header (`docs/DESIGN.md` §4): cover, title, artist, project, duration, status,
 * collaborators, favourite, share, and the overflow menu.
 *
 * Dense by nature, so it reflows rather than truncates at phone widths: the cover shrinks and
 * sits beside the title, the title wraps onto as many lines as it needs, and the metadata line
 * wraps below. Truncating a song's title into "Night Dri…" would leave the one thing the page is
 * about unreadable.
 */
export function SongHeader({ workspace }: { readonly workspace: SongWorkspace }) {
  const { song, project } = workspace;
  const endpoint = `/api/songs/${encodeURIComponent(song.id)}`;
  const editable = workspace.capabilities.edit;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-end">
        <div className="w-20 shrink-0 sm:w-28 lg:w-36">
          <CoverArt
            id={project?.id ?? song.id}
            name={project?.name ?? song.title}
            cover={workspace.cover}
            sizes="(min-width: 1024px) 144px, (min-width: 640px) 112px, 80px"
            className="shadow-paper"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-caption text-muted-foreground font-sans">
            {project === null ? (
              'Song'
            ) : (
              <>
                <span className="sr-only">Project: </span>
                <Link
                  href={projectHref(project.id)}
                  className={cn('rounded-sm hover:underline', transition, focusRing)}
                >
                  {project.name}
                </Link>
              </>
            )}
          </p>
          <InlineField
            as="h1"
            endpoint={endpoint}
            field="title"
            label="Title"
            rule="songTitle"
            value={song.title}
            placeholder="Untitled"
            editable={editable}
            className="text-title text-foreground font-serif break-words"
          />
          <InlineField
            as="p"
            endpoint={endpoint}
            field="artist"
            label="Artist"
            rule="artist"
            value={song.artist}
            placeholder={workspace.artist ?? 'No artist yet'}
            editable={editable}
            className="text-body text-muted-foreground font-sans"
          />
          <div className="text-caption text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 font-sans">
            <span>
              <span className="sr-only">Duration: </span>
              <span className="tabular" aria-hidden>
                {formatDuration(song.durationMs)}
              </span>
              <span className="sr-only">{spokenDuration(song.durationMs)}</span>
            </span>
            <InlineStatus
              endpoint={endpoint}
              value={song.status}
              options={STATUS_OPTIONS}
              editable={editable}
            >
              <WorkStatusBadge status={song.status} />
            </InlineStatus>
            <CollaboratorStack collaborators={workspace.collaborators} />
          </div>
        </div>
      </div>
      <SongActions
        isFavorite={workspace.isFavorite}
        projectHref={project === null ? null : projectHref(project.id)}
      />
    </header>
  );
}
