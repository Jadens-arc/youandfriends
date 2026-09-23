import { cn } from '@youandfriends/ui';

import type { ProjectCard as ProjectCardData } from '@/lib/library/projects';
import type { LibraryView } from '@/lib/library/sort';

import { ProjectCard, ProjectRow } from './project-card';

/**
 * The grid's columns. Shared with the skeleton (`library-skeleton.tsx`) so the placeholder
 * occupies exactly the space the real cards will — the only way to keep the page still when
 * data lands.
 */
export const GRID_CLASSES =
  'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-x-5 md:gap-y-7';
export const LIST_CLASSES =
  'border-border divide-border bg-card divide-y overflow-hidden rounded-md border';

export interface ProjectGridProps {
  readonly projects: readonly ProjectCardData[];
  readonly view: LibraryView;
  readonly now: Date;
  /** The accessible name of the list — the folder open, or "Projects". */
  readonly label: string;
}

/** The projects, already sorted, as a grid of covers or a list of rows. */
export function ProjectGrid({ projects, view, now, label }: ProjectGridProps) {
  const Item = view === 'grid' ? ProjectCard : ProjectRow;
  return (
    <ul aria-label={label} className={cn(view === 'grid' ? GRID_CLASSES : LIST_CLASSES)}>
      {projects.map((project) => (
        <li key={project.id} className="min-w-0">
          <Item project={project} now={now} />
        </li>
      ))}
    </ul>
  );
}
