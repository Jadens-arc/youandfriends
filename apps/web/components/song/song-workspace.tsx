import { cn } from '@youandfriends/ui';

import type { SongWorkspace as SongWorkspaceData } from '@/lib/songs/workspace';

import { DropZone, UploadFilesButton } from '@/components/upload/drop-zone';

import { FileGroups } from './file-groups';
import { SongHeader } from './song-header';
import { SongList } from './song-list';
import { SongTabs } from './song-tabs';
import { VersionPanel } from './version-selector';

/**
 * The desktop split (`docs/DESIGN.md` §4): the project's songs on the left, the open song on the
 * right. On a phone the list is hidden and the song owns the screen — its project is one "Back"
 * away, through the mobile header.
 *
 * A CSS grid switched at the breakpoint, not a branch on a viewport measurement, for the reason
 * the workspace layout gives: branching in JavaScript remounts the subtree when the breakpoint
 * is crossed, and the version selection held inside it would reset on a phone's rotation.
 */
export const SPLIT_CLASSES =
  'md:grid md:h-full md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]';

export function SplitLayout({
  list,
  detail,
  listLabel,
  showListOnMobile,
}: {
  readonly list: React.ReactNode;
  readonly detail: React.ReactNode;
  readonly listLabel: string;
  /** The project view shows the list on a phone; the song view shows the song. */
  readonly showListOnMobile: boolean;
}) {
  return (
    <div className={cn('min-h-full', SPLIT_CLASSES)} data-testid="split-layout">
      <aside
        aria-label={listLabel}
        className={cn(
          'border-border md:bg-card/40 md:h-full md:overflow-auto md:border-r',
          showListOnMobile ? 'block' : 'hidden md:block',
        )}
      >
        {list}
      </aside>
      <div
        className={cn(
          'min-w-0 md:h-full md:overflow-auto',
          showListOnMobile ? 'hidden md:block' : 'block',
        )}
      >
        {detail}
      </div>
    </div>
  );
}

export function SongWorkspaceView({
  workspace,
  linkedVersionId,
  now,
}: {
  readonly workspace: SongWorkspaceData;
  readonly linkedVersionId: string | null;
  readonly now: Date;
}) {
  const listLabel = workspace.project === null ? 'Songs' : `Songs in ${workspace.project.name}`;
  const surface = { type: 'song', id: workspace.song.id, name: workspace.song.title } as const;

  return (
    <SplitLayout
      listLabel={listLabel}
      showListOnMobile={false}
      list={
        <SongList songs={workspace.siblings} currentSongId={workspace.song.id} label={listLabel} />
      }
      detail={
        <MaybeDropZone enabled={workspace.capabilities.edit} surface={surface}>
          <article className="flex flex-col gap-6 p-4 md:p-6" data-song-id={workspace.song.id}>
            <SongHeader workspace={workspace} />
            <SongTabs
              panels={{
                overview: (
                  <VersionPanel
                    versions={workspace.versions}
                    linkedVersionId={linkedVersionId}
                    now={now}
                    songTitle={workspace.song.title}
                    songId={workspace.song.id}
                    capabilities={workspace.capabilities}
                  />
                ),
                lyrics: (
                  <p className="text-body text-muted-foreground font-sans italic">No lyrics yet.</p>
                ),
                files: (
                  <div className="flex flex-col gap-4">
                    {workspace.capabilities.edit ? (
                      <div>
                        <UploadFilesButton surface={surface} />
                      </div>
                    ) : null}
                    <FileGroups files={workspace.files} />
                  </div>
                ),
                activity: (
                  <p className="text-body text-muted-foreground font-sans italic">
                    No comments yet.
                  </p>
                ),
              }}
            />
          </article>
        </MaybeDropZone>
      }
    />
  );
}

/** A drop zone only for people who may upload; everyone else gets the page as it is. */
export function MaybeDropZone({
  enabled,
  surface,
  children,
}: {
  readonly enabled: boolean;
  readonly surface: React.ComponentProps<typeof DropZone>['surface'];
  readonly children: React.ReactNode;
}) {
  return enabled ? (
    <DropZone surface={surface} className="min-h-full">
      {children}
    </DropZone>
  ) : (
    children
  );
}
