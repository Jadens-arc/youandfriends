import { AppError } from '@youandfriends/contracts';
import { notFound } from 'next/navigation';

import { RecordView } from '@/components/library/personal';
import { MobileBackTarget } from '@/components/shell/mobile/back-target';
import { SongWorkspaceView } from '@/components/song/song-workspace';
import { libraryContext } from '@/lib/library/context';
import { projectHref } from '@/lib/songs/routes';
import { readActivity } from '@/lib/library/personal';
import { readSongWorkspace } from '@/lib/songs/workspace';
import { currentWorkspace } from '@/lib/workspace/current';

export const metadata = { title: 'Song · You & Friends' };

/**
 * The song workspace (task `042`).
 *
 * Every refusal is a 404: a song id from another workspace, one this viewer was never given,
 * one in the trash, and one that never existed are indistinguishable (`docs/THREAT_MODEL.md`
 * T1). The tab comes from `?tab=` and is parsed on the client by `SongTabs`, which reads the
 * same search parameters the server rendered with — so a reload opens on the tab it left.
 */
export default async function SongPage({
  params,
  searchParams,
}: {
  params: Promise<{ songId: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const [{ songId }, query] = await Promise.all([params, searchParams]);
  const context = await currentWorkspace();
  if (context === null) notFound();

  const library = libraryContext(context);
  const workspace = await readSongWorkspace(library, songId).catch((error: unknown) => {
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });

  // After the refusal check above: activity about a song is read only once the song is readable.
  const activity = await readActivity(library, { songId: workspace.song.id });
  const linked = Array.isArray(query.version)
    ? (query.version[0] ?? null)
    : (query.version ?? null);

  return (
    <>
      {workspace.project === null ? null : (
        <MobileBackTarget href={projectHref(workspace.project.id)} label={workspace.project.name} />
      )}
      <RecordView targetType="song" targetId={workspace.song.id} />
      <SongWorkspaceView
        workspace={workspace}
        activity={activity}
        linkedVersionId={linked}
        now={new Date()}
      />
    </>
  );
}
