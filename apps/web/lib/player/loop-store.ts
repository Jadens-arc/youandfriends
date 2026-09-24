import { permits } from '@youandfriends/authz';
import {
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  loopRegionSchema,
  newUlid,
  validationFailed,
  type LoopRegion,
} from '@youandfriends/contracts';
import { loopRegions, songs } from '@youandfriends/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Loop regions, per user per song (task `074`). Every read and write is for the signed-in user
 * only — the user id comes from the session, never the request — after `view` on the song, so a
 * region is never shown for a song the viewer cannot open, nor another person's region ever.
 */

function refuse(detail: string): never {
  throw forbidden({ detail });
}

async function assertMayView(context: LibraryContext, songId: string) {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  const access = await context.authz.resolveAccess(context.subject, {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  if (!permits(access, 'view')) refuse(`may not view song ${songId}`);
  const [song] = await context.db
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        eq(songs.id, songId),
        eq(songs.workspaceId, context.workspaceId),
        isNull(songs.deletedAt),
      ),
    );
  if (song === undefined) refuse(`song ${songId} is not live`);
}

const mine = (context: LibraryContext, songId: string) =>
  and(
    eq(loopRegions.workspaceId, context.workspaceId),
    eq(loopRegions.userId, context.userId),
    eq(loopRegions.songId, songId),
  );

export async function readLoop(
  context: LibraryContext,
  songId: string,
): Promise<LoopRegion | null> {
  await assertMayView(context, songId);
  const [row] = await context.db
    .select({ startMs: loopRegions.startMs, endMs: loopRegions.endMs })
    .from(loopRegions)
    .where(mine(context, songId));
  return row ?? null;
}

export async function saveLoop(
  context: LibraryContext,
  songId: string,
  input: LoopRegion,
): Promise<void> {
  const parsed = loopRegionSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  await assertMayView(context, songId);
  await context.db
    .insert(loopRegions)
    .values({
      id: (context.newId ?? newUlid)(),
      workspaceId: context.workspaceId,
      userId: context.userId,
      songId,
      ...parsed.data,
    })
    .onConflictDoUpdate({
      target: [loopRegions.workspaceId, loopRegions.userId, loopRegions.songId],
      set: { ...parsed.data, updatedAt: sql`now()` },
    });
}

export async function clearLoop(context: LibraryContext, songId: string): Promise<void> {
  await assertMayView(context, songId);
  await context.db.delete(loopRegions).where(mine(context, songId));
}
