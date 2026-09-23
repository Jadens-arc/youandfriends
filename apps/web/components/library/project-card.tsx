import { Avatar, AvatarFallback, cn } from '@youandfriends/ui';
import Link from 'next/link';

import { formatRelative, formatSongCount, initialsOf } from '@/lib/library/format';
import type { Collaborator, ProjectCard as ProjectCardData } from '@/lib/library/projects';
import { projectHref } from '@/lib/songs/routes';

import { CoverArt } from './cover-art';

/** How many collaborator avatars a card shows before summarizing the rest as "+N". */
export const VISIBLE_COLLABORATORS = 3;

/**
 * `sizes` for each layout, matching the grid's own breakpoints in `project-grid.tsx`: two
 * columns on a phone, then three, four, five as the content pane widens. A browser picks the
 * smallest rendition that covers the slot, rather than downloading the largest for every card.
 */
export const GRID_COVER_SIZES =
  '(min-width: 1536px) 18vw, (min-width: 1280px) 20vw, (min-width: 1024px) 24vw, (min-width: 640px) 30vw, 46vw';
export const LIST_COVER_SIZES = '56px';

/** "Shared with Avery, Sam, and 2 others" — the whole list, said once, for a screen reader. */
export function collaboratorSummary(collaborators: readonly Collaborator[]): string {
  const names = collaborators.map((person) => person.displayName);
  if (names.length === 0) return 'No collaborators';
  if (names.length <= VISIBLE_COLLABORATORS) {
    return `Shared with ${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)}`;
  }
  const shown = names.slice(0, VISIBLE_COLLABORATORS);
  const rest = names.length - VISIBLE_COLLABORATORS;
  return `Shared with ${shown.join(', ')}, and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

export function CollaboratorStack({
  collaborators,
  className,
}: {
  readonly collaborators: readonly Collaborator[];
  readonly className?: string;
}) {
  if (collaborators.length === 0) return null;
  const shown = collaborators.slice(0, VISIBLE_COLLABORATORS);
  const rest = collaborators.length - shown.length;

  return (
    <div className={cn('flex items-center', className)}>
      <span className="sr-only">{collaboratorSummary(collaborators)}</span>
      <div aria-hidden className="flex -space-x-1.5">
        {shown.map((person) => (
          <Avatar
            key={person.userId}
            title={person.displayName}
            className="ring-card size-6 ring-2"
          >
            <AvatarFallback className="text-[0.625rem]">
              {initialsOf(person.displayName)}
            </AvatarFallback>
          </Avatar>
        ))}
        {rest > 0 ? (
          <span className="bg-border-subtle text-muted-foreground ring-card text-caption relative flex size-6 items-center justify-center rounded-full font-sans text-[0.625rem] font-medium ring-2">
            +{rest}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The card's one link. `after:absolute after:inset-0` makes the whole card its hit area; the
 * focus ring is drawn on that same pseudo-element so it outlines the card, not just the name.
 */
function ProjectLink({
  id,
  children,
}: {
  readonly id: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Link
      href={projectHref(id)}
      className={cn(
        'rounded-sm outline-none after:absolute after:inset-0 after:rounded-md after:content-[""] hover:underline',
        'focus-visible:after:outline-ring focus-visible:after:outline-2 focus-visible:after:outline-offset-2',
      )}
    >
      {children}
    </Link>
  );
}

export interface ProjectCardProps {
  readonly project: ProjectCardData;
  readonly now: Date;
}

function LastActivity({ at, now }: { readonly at: Date; readonly now: Date }) {
  return (
    <span>
      <span className="sr-only">Last activity </span>
      <time dateTime={at.toISOString()} title={at.toISOString()}>
        {formatRelative(at, now)}
      </time>
    </span>
  );
}

/**
 * A project on the shelf (`docs/DESIGN.md` §4): the cover first and largest, then the name in
 * the editorial serif, the artist, and one quiet line of metadata. Nothing is laid over the
 * artwork (§11) — it carries the card.
 *
 * An `article` with the name as its heading, so a screen reader can move card to card by
 * heading. The name is the one link, stretched over the whole card with a pseudo-element, so the
 * cover is clickable without a second tab stop or a link wrapping a heading.
 */
export function ProjectCard({ project, now }: ProjectCardProps) {
  return (
    <article className="group relative flex min-w-0 flex-col gap-2.5" data-project-id={project.id}>
      <CoverArt
        id={project.id}
        name={project.name}
        cover={project.cover}
        sizes={GRID_COVER_SIZES}
        className="shadow-paper"
      />
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <h3 className="text-heading text-foreground truncate font-serif">
          <ProjectLink id={project.id}>{project.name}</ProjectLink>
        </h3>
        <p className="text-caption text-muted-foreground truncate font-sans">
          {project.artist ?? <span className="italic">No artist yet</span>}
        </p>
        <div className="text-caption text-muted-foreground mt-1 flex min-h-6 items-center justify-between gap-2 font-sans">
          <p className="flex min-w-0 items-center gap-1.5 truncate">
            <span className="tabular">{formatSongCount(project.songCount)}</span>
            <span aria-hidden>·</span>
            <LastActivity at={project.lastActivityAt} now={now} />
          </p>
          <CollaboratorStack collaborators={project.collaborators} className="shrink-0" />
        </div>
      </div>
    </article>
  );
}

/**
 * The same project as a row, for list mode: a small cover, then the same facts in columns that
 * line up down the page. The cover stays — a list of records is still a list of records.
 */
export function ProjectRow({ project, now }: ProjectCardProps) {
  return (
    <article
      className="relative grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 md:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1fr)_6rem_8rem_auto]"
      data-project-id={project.id}
    >
      <CoverArt
        id={project.id}
        name={project.name}
        cover={project.cover}
        sizes={LIST_COVER_SIZES}
      />
      <div className="min-w-0">
        <h3 className="text-body text-foreground truncate font-serif text-[1.0625rem]">
          <ProjectLink id={project.id}>{project.name}</ProjectLink>
        </h3>
        <p className="text-caption text-muted-foreground truncate font-sans md:hidden">
          {project.artist ?? 'No artist yet'} · {formatSongCount(project.songCount)}
        </p>
      </div>
      <p className="text-caption text-muted-foreground hidden truncate font-sans md:block">
        {project.artist ?? <span className="italic">No artist yet</span>}
      </p>
      <p className="text-caption text-muted-foreground hidden font-sans md:block">
        <span className="tabular">{formatSongCount(project.songCount)}</span>
      </p>
      <p className="text-caption text-muted-foreground hidden font-sans md:block">
        <LastActivity at={project.lastActivityAt} now={now} />
      </p>
      <CollaboratorStack collaborators={project.collaborators} className="justify-end" />
    </article>
  );
}
