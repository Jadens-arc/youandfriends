import { loadSongCollaborators, permits } from '@youandfriends/authz';
import {
  forbidden,
  isUlid,
  mentionedUserIds,
  newUlid,
  type WorkspaceId,
} from '@youandfriends/contracts';
import { commentMentions, getSongHeader, users, type DirectDatabase } from '@youandfriends/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Mentions (task `094`).
 *
 * - **Who can be mentioned is who can see the song**, worked out on the server from the same
 *   resolver as every other access decision: members, grants, and denies down to this song.
 *   Offering the whole workspace would tell a song-level collaborator who else is in it and
 *   where (`docs/THREAT_MODEL.md` asset 3).
 * - **A mention grants nothing.** Someone mentioned who cannot see the song is not recorded, not
 *   notified, and not given access; the author is told, so they can share the song deliberately
 *   if that is what they meant.
 * - The body carries `<@USERID>`, never a name; the name is looked up when shown.
 */

type Tx = Parameters<Parameters<DirectDatabase['transaction']>[0]>[0];

export interface Mentionable {
  readonly id: string;
  readonly name: string;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

/** Everyone who can see this song right now, by user id. */
export async function songReach(context: LibraryContext, songId: string): Promise<Set<string>> {
  const header = await getSongHeader(context.db, context.workspaceId, songId);
  if (header === null) refuse(`song ${songId} is not live`);
  const reached = await loadSongCollaborators(
    context.db,
    context.workspaceId as WorkspaceId,
    { id: songId, projectId: header.projectId, folderPath: header.folderPath },
    context.now ?? (() => new Date()),
  );
  return new Set(reached);
}

/**
 * Who this person may mention on this song — only someone who may comment gets the list at all,
 * and it holds only people who can see the song. Themselves excluded.
 */
export async function listMentionable(
  context: LibraryContext,
  songId: string,
): Promise<readonly Mentionable[]> {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  const access = await context.authz.resolveAccess(context.subject, {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  if (!permits(access, 'comment')) refuse(`may not comment on song ${songId}`);
  const reach = [...(await songReach(context, songId))].filter((id) => id !== context.userId);
  if (reach.length === 0) return [];
  return context.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, reach))
    .orderBy(asc(users.displayName), asc(users.id));
}

export interface MentionOutcome {
  /** Mentioned, able to see the song, and not mentioned by this comment before: notify them. */
  readonly newlyReached: readonly string[];
  /** Mentioned but unable to see the song: nothing recorded — the author is told. */
  readonly unreached: readonly string[];
}

/**
 * Bring a comment's mention rows in line with its body: people who can see the song get a row;
 * people it no longer mentions lose theirs. Writing about yourself is not a mention.
 */
export async function syncMentions(
  tx: Tx,
  context: LibraryContext,
  songId: string,
  commentId: string,
  body: string,
): Promise<MentionOutcome> {
  const mentioned = mentionedUserIds(body).filter((id) => id !== context.userId);
  const existing = new Set(
    (
      await tx
        .select({ userId: commentMentions.userId })
        .from(commentMentions)
        .where(
          and(
            eq(commentMentions.commentId, commentId),
            eq(commentMentions.workspaceId, context.workspaceId),
          ),
        )
    ).map((row) => row.userId),
  );
  const gone = [...existing].filter((id) => !mentioned.includes(id));
  if (gone.length > 0) {
    await tx
      .delete(commentMentions)
      .where(
        and(
          eq(commentMentions.commentId, commentId),
          eq(commentMentions.workspaceId, context.workspaceId),
          inArray(commentMentions.userId, gone),
        ),
      );
  }
  if (mentioned.length === 0) return { newlyReached: [], unreached: [] };
  const reach = await songReach(context, songId);
  const reachable = mentioned.filter((id) => reach.has(id));
  const newlyReached = reachable.filter((id) => !existing.has(id));
  if (newlyReached.length > 0) {
    const newId = context.newId ?? newUlid;
    await tx.insert(commentMentions).values(
      newlyReached.map((userId) => ({
        id: newId(),
        workspaceId: context.workspaceId,
        commentId,
        userId,
      })),
    );
  }
  return { newlyReached, unreached: mentioned.filter((id) => !reach.has(id)) };
}

/** The people each comment mentions and reached, with their names as they are now. */
export async function mentionsOf(
  context: LibraryContext,
  commentIds: readonly string[],
): Promise<Map<string, Mentionable[]>> {
  const byComment = new Map<string, Mentionable[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await context.db
    .select({ commentId: commentMentions.commentId, id: users.id, name: users.displayName })
    .from(commentMentions)
    .innerJoin(users, eq(users.id, commentMentions.userId))
    .where(
      and(
        eq(commentMentions.workspaceId, context.workspaceId),
        inArray(commentMentions.commentId, [...commentIds]),
      ),
    );
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push({ id: row.id, name: row.name });
    byComment.set(row.commentId, list);
  }
  return byComment;
}
