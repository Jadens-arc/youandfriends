import { AppError } from '@youandfriends/contracts';
import type { Route } from 'next';
import { notFound } from 'next/navigation';

import { CoverArt } from '@/components/library/cover-art';
import { MobileBackTarget } from '@/components/shell/mobile/back-target';
import { SongList } from '@/components/song/song-list';
import { SplitLayout } from '@/components/song/song-workspace';
import { WorkStatusBadge } from '@/components/song/status-badge';
import { libraryContext } from '@/lib/library/context';
import { formatSongCount } from '@/lib/library/format';
import { folderHref } from '@/lib/songs/routes';
import { readProjectWorkspace } from '@/lib/songs/workspace';
import { currentWorkspace } from '@/lib/workspace/current';

export const metadata = { title: 'Project · You & Friends' };

// `/library` is the optional catch-all's root; `typedRoutes` does not list it as a literal.
const LIBRARY = '/library' as Route;

/**
 * A project: its songs, and — on a desktop — the project's own summary where a song's detail
 * will open. On a phone the song list is the page, and a song is one tap further in.
 */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await currentWorkspace();
  if (context === null) notFound();

  const workspace = await readProjectWorkspace(libraryContext(context), projectId).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.publicCode === 'not_found') notFound();
      throw error;
    },
  );
  const { project } = workspace;
  const listLabel = `Songs in ${project.name}`;

  const summary = (
    <header className="flex items-end gap-4">
      <div className="w-20 shrink-0 md:w-36">
        <CoverArt
          id={project.id}
          name={project.name}
          cover={workspace.cover}
          sizes="(min-width: 768px) 144px, 80px"
          className="shadow-paper"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-title text-foreground font-serif break-words">{project.name}</h1>
        <p className="text-body text-muted-foreground font-sans">
          {project.artist ?? <span className="italic">No artist yet</span>}
        </p>
        <p className="text-caption text-muted-foreground flex items-center gap-2 font-sans">
          <span className="tabular">{formatSongCount(workspace.songs.length)}</span>
          <WorkStatusBadge status={project.status} />
        </p>
      </div>
    </header>
  );

  return (
    <>
      <MobileBackTarget
        href={workspace.folder === null ? LIBRARY : folderHref(workspace.folder.id)}
        label={workspace.folder?.name ?? 'Library'}
      />
      <SplitLayout
        listLabel={listLabel}
        showListOnMobile
        list={
          <div className="flex flex-col">
            <div className="p-4 md:hidden">{summary}</div>
            <SongList songs={workspace.songs} currentSongId={null} label={listLabel} />
          </div>
        }
        detail={
          <div className="flex flex-col gap-6 p-6">
            {summary}
            <p className="text-body text-muted-foreground font-sans">
              {workspace.songs.length === 0
                ? 'This project has no songs yet.'
                : 'Choose a song to open it.'}
            </p>
          </div>
        }
      />
    </>
  );
}
