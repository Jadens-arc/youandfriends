import { AppError } from '@youandfriends/contracts';
import type { Route } from 'next';
import { notFound } from 'next/navigation';

import { NewSongButton } from '@/components/library/create-dialogs';
import { FavoriteToggle, RecordView } from '@/components/library/personal';
import { CoverUpload } from '@/components/metadata/cover-upload';
import { InlineField, InlineStatus } from '@/components/metadata/inline-field';
import { CoverArt } from '@/components/library/cover-art';
import { MobileBackTarget } from '@/components/shell/mobile/back-target';
import { SongList } from '@/components/song/song-list';
import { ProjectFiles } from '@/components/song/files/project-files';
import { MaybeDropZone, SplitLayout } from '@/components/song/song-workspace';
import { UploadFilesButton } from '@/components/upload/drop-zone';
import { WorkStatusBadge } from '@/components/song/status-badge';
import { FolderUpload } from '@/components/upload/folder-upload';
import { libraryContext } from '@/lib/library/context';
import { formatSongCount } from '@/lib/library/format';
import { STATUS_OPTIONS } from '@/lib/songs/format';
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
  const endpoint = `/api/projects/${encodeURIComponent(project.id)}`;
  const surface = { type: 'project', id: project.id, name: project.name } as const;

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
        <InlineField
          as="h1"
          endpoint={endpoint}
          field="name"
          label="Project name"
          rule="projectName"
          value={project.name}
          placeholder="Untitled"
          editable={workspace.canEdit}
          className="text-title text-foreground font-serif break-words"
        />
        <InlineField
          as="p"
          endpoint={endpoint}
          field="artist"
          label="Artist"
          rule="artist"
          value={project.artist}
          placeholder="No artist yet"
          editable={workspace.canEdit}
          className="text-body text-muted-foreground font-sans"
        />
        <div className="text-caption text-muted-foreground flex flex-wrap items-center gap-2 font-sans">
          <span className="tabular">{formatSongCount(workspace.songs.length)}</span>
          <InlineStatus
            endpoint={endpoint}
            value={project.status}
            options={STATUS_OPTIONS}
            editable={workspace.canEdit}
          >
            <WorkStatusBadge status={project.status} />
          </InlineStatus>
          <FavoriteToggle
            targetType="project"
            targetId={project.id}
            initial={workspace.isFavorite}
            name={project.name}
          />
          {workspace.canEdit ? (
            <CoverUpload projectId={project.id} projectName={project.name} />
          ) : null}
        </div>
      </div>
    </header>
  );

  return (
    <>
      <RecordView targetType="project" targetId={project.id} />
      <MobileBackTarget
        href={workspace.folder === null ? LIBRARY : folderHref(workspace.folder.id)}
        label={workspace.folder?.name ?? 'Library'}
      />
      <SplitLayout
        listLabel={listLabel}
        showListOnMobile
        list={
          <div className="flex flex-col">
            <div className="flex flex-col gap-3 p-4 md:hidden">
              {summary}
              {workspace.canEdit ? <FolderUpload projectId={project.id} /> : null}
            </div>
            {workspace.canEdit ? (
              <div className="px-4 pt-3">
                <NewSongButton projectId={project.id} />
              </div>
            ) : null}
            <SongList songs={workspace.songs} currentSongId={null} label={listLabel} />
          </div>
        }
        detail={
          <MaybeDropZone enabled={workspace.canEdit} surface={surface}>
            <div className="flex flex-col gap-6 p-6">
              {summary}
              <p className="text-body text-muted-foreground font-sans">
                {workspace.songs.length === 0
                  ? 'This project has no songs yet.'
                  : 'Choose a song to open it.'}
              </p>
              <section aria-labelledby="project-files-heading" className="flex flex-col gap-2">
                <h2 id="project-files-heading" className="text-heading text-foreground font-serif">
                  Project Files
                </h2>
                {workspace.canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <UploadFilesButton surface={surface} />
                    <FolderUpload projectId={project.id} />
                  </div>
                ) : null}
                <div className="border-border bg-card rounded-md border">
                  <ProjectFiles
                    files={workspace.files.projectFiles}
                    canEdit={workspace.canEdit}
                    knownTags={workspace.knownTags}
                  />
                </div>
              </section>
            </div>
          </MaybeDropZone>
        }
      />
    </>
  );
}
