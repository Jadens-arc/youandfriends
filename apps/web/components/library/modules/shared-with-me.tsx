import type { SharedWithMe as SharedWithMeData } from '@/lib/library/projects';

import { ModuleItem, ModuleSection } from './module-section';

/**
 * What someone explicitly opened up to this viewer — a grant, not just workspace membership.
 * For a scope-limited collaborator (ADR 0010) this is the whole of their library; a song shared
 * on its own appears here even though its project never gets a card.
 */
export function SharedWithMe({ shared }: { readonly shared: SharedWithMeData }) {
  const empty = shared.projects.length === 0 && shared.songs.length === 0;
  return (
    <ModuleSection
      title="Shared with me"
      empty={
        empty ? 'When someone shares a project or a song with you, it will be waiting here.' : null
      }
    >
      <ul>
        {shared.projects.map((project) => (
          <ModuleItem key={`project-${project.id}`} primary={project.name} secondary="Project" />
        ))}
        {shared.songs.map((song) => (
          <ModuleItem
            key={`song-${song.id}`}
            primary={song.title}
            secondary={song.projectName === null ? 'Song' : `Song · ${song.projectName}`}
          />
        ))}
      </ul>
    </ModuleSection>
  );
}
