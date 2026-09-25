import { loadLibraryAccess } from '@youandfriends/authz';
import { forbidden, queueSelectionSchema, type QueueSelection } from '@youandfriends/contracts';
import { folders, listPlayableVersions, projects, type PlayableSelection } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';
import { resolveCovers } from '@/lib/library/covers';

import type { Track } from './machine';

/**
 * Turning "play this project" — or a queue restored from last session — into tracks this viewer
 * may play right now (task `073`).
 *
 * **A restored queue is untrusted.** It came from the browser's storage and may name a song whose
 * access was revoked since; playing it from local state would skip authorization entirely. So a
 * restore is re-resolved here, through one load of the viewer's grants, and whatever is no longer
 * permitted — or no longer exists, or has no stream — is silently left out.
 */

function refuse(detail: string): never {
  throw forbidden({ detail });
}

export async function resolveQueue(
  context: LibraryContext,
  input: QueueSelection,
): Promise<Track[]> {
  const selection = queueSelectionSchema.parse(input);
  const now = context.now ?? (() => new Date());
  const access = await loadLibraryAccess(context.db, context.subject, context.workspaceId, now);

  let query: PlayableSelection;
  if (selection.kind === 'folder') {
    const [folder] = await context.db
      .select({ path: folders.path })
      .from(folders)
      .where(
        and(
          eq(folders.id, selection.folderId),
          eq(folders.workspaceId, context.workspaceId),
          isNull(folders.deletedAt),
        ),
      );
    if (folder === undefined || access.folder(folder.path) === null) {
      refuse(`folder ${selection.folderId} is not visible`);
    }
    query = { kind: 'folder', folderPath: folder.path };
  } else if (selection.kind === 'project') {
    const [project] = await context.db
      .select({ id: projects.id, folderId: projects.folderId })
      .from(projects)
      .where(
        and(
          eq(projects.id, selection.projectId),
          eq(projects.workspaceId, context.workspaceId),
          isNull(projects.deletedAt),
        ),
      );
    if (project === undefined) refuse(`project ${selection.projectId} is not live`);
    query = { kind: 'project', projectId: project.id };
  } else {
    query = selection;
  }

  const rows = (await listPlayableVersions(context.db, context.workspaceId, query)).filter(
    (row) => access.song(row.songId, row.projectId, row.folderPath) !== null,
  );
  if (selection.kind === 'project' && rows.length === 0) {
    // Nothing playable *and* possibly nothing visible: the same answer either way, so a hidden
    // project cannot be told from an empty one.
    const visible = await projectVisible(context, access, selection.projectId);
    if (!visible) refuse(`project ${selection.projectId} is not visible`);
  }

  // Covers only for projects the viewer can open (task `069`'s rule): a song shared on its own
  // does not bring its project's artwork with it.
  const visibleProjects = [
    ...new Set(
      rows
        .filter((row) => access.project(row.projectId, row.folderPath) !== null)
        .map((row) => row.projectId),
    ),
  ];
  const covers = await resolveCovers(context, visibleProjects);

  const tracks = rows.map((row): Track => ({
    versionId: row.versionId,
    songId: row.songId,
    title: row.title,
    artist: row.songArtist ?? row.projectArtist,
    versionLabel: `Version ${row.versionNumber}`,
    cover: covers.get(row.projectId) ?? null,
  }));
  if (selection.kind !== 'versions') return tracks;
  // A restore keeps its own order, once each.
  const byId = new Map(tracks.map((track) => [track.versionId, track]));
  const seen = new Set<string>();
  return selection.versionIds.flatMap((id) => {
    const track = byId.get(id);
    if (track === undefined || seen.has(id)) return [];
    seen.add(id);
    return [track];
  });
}

async function projectVisible(
  context: LibraryContext,
  access: Awaited<ReturnType<typeof loadLibraryAccess>>,
  projectId: string,
): Promise<boolean> {
  const [row] = await context.db
    .select({ path: folders.path })
    .from(projects)
    .leftJoin(folders, eq(folders.id, projects.folderId))
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, context.workspaceId)));
  return row !== undefined && access.project(projectId, row.path ?? '') !== null;
}
