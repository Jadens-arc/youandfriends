import { folders, projects, songs, type Database } from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

import { buildChain } from './chain';
import type { ChainLink } from './resolve';
import type { Target } from './subjects';

/**
 * Load a target's scope chain from the database.
 *
 * Every query here is workspace-scoped, and that is not belt-and-braces: a target id from a
 * request is attacker-controlled, so looking it up without the tenant filter is precisely
 * the IDOR this package exists to prevent (`docs/THREAT_MODEL.md` T1). A target in another
 * workspace resolves to `null`, and the caller turns that into a 404-shaped failure — never
 * a 403, which would confirm it exists.
 */
export async function loadChain(db: Database, target: Target): Promise<ChainLink[] | null> {
  switch (target.scopeType) {
    case 'folder': {
      const [row] = await db
        .select({ path: folders.path })
        .from(folders)
        .where(and(eq(folders.id, target.scopeId), eq(folders.workspaceId, target.workspaceId)));

      return row ? buildChain({ targetFolderPath: row.path }) : null;
    }

    case 'project': {
      const [row] = await db
        .select({ id: projects.id, folderPath: folders.path })
        .from(projects)
        .leftJoin(folders, eq(folders.id, projects.folderId))
        .where(and(eq(projects.id, target.scopeId), eq(projects.workspaceId, target.workspaceId)));

      return row
        ? buildChain({ projectId: row.id, folderPath: row.folderPath ?? undefined })
        : null;
    }

    case 'song': {
      const [row] = await db
        .select({ id: songs.id, projectId: songs.projectId, folderPath: folders.path })
        .from(songs)
        .innerJoin(projects, eq(projects.id, songs.projectId))
        .leftJoin(folders, eq(folders.id, projects.folderId))
        .where(and(eq(songs.id, target.scopeId), eq(songs.workspaceId, target.workspaceId)));

      return row
        ? buildChain({
            songId: row.id,
            projectId: row.projectId,
            folderPath: row.folderPath ?? undefined,
          })
        : null;
    }
  }
}
