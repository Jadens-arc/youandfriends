import { permits } from '@youandfriends/authz';
import { forbidden, isUlid } from '@youandfriends/contracts';
import { songs, users } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Realtime lyrics rooms (task `082`, ADR 0003, threat T6).
 *
 * One Liveblocks room per song, `lyrics:<songId>`. A room token is minted **here, on the
 * server**, after the same authorization every other lyrics route runs, and names exactly one
 * room: an editor gets write access, a commenter or viewer read access and their own presence,
 * anyone else a 404-shaped refusal. The client never states its own room or role.
 *
 * Liveblocks is transport, never the record: Postgres stays canonical, and every save — from the
 * room or not — re-checks `edit` and merges into what is stored (`service.ts`).
 */

export const LYRICS_ROOM_PREFIX = 'lyrics:';

export function roomForSong(songId: string): string {
  return `${LYRICS_ROOM_PREFIX}${songId}`;
}

/** The song a room id names, or null for anything else — including another room scheme. */
export function songForRoom(room: string): string | null {
  if (!room.startsWith(LYRICS_ROOM_PREFIX)) return null;
  const songId = room.slice(LYRICS_ROOM_PREFIX.length);
  return isUlid(songId) ? songId : null;
}

export interface RoomAccess {
  readonly room: string;
  readonly songId: string;
  readonly write: boolean;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

/** What this person may do in a lyrics room — or a 404-shaped refusal. */
export async function roomAccess(context: LibraryContext, room: string): Promise<RoomAccess> {
  const songId = songForRoom(room);
  if (songId === null) refuse(`not a lyrics room: ${room.slice(0, 80)}`);
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
  return { room, songId, write: permits(access, 'edit') };
}

/**
 * Collaborator colours, from the palette's text-safe accents. A cursor always carries its
 * person's name as well, so colour never has to identify anyone alone.
 */
export const PRESENCE_COLORS = [
  'var(--color-olive-text)',
  'var(--color-rust-text)',
  'var(--color-ochre-text)',
  'var(--color-espresso)',
  'var(--color-secondary)',
] as const;

export function presenceColor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0];
}

/** The part of `@youandfriends`' use of the Liveblocks SDK a token needs — the real `Liveblocks`. */
export interface RoomTokenIssuer {
  prepareSession(
    userId: string,
    options: { userInfo: { name: string; color: string } },
  ): {
    allow(room: string, permissions: readonly string[]): unknown;
    authorize(): Promise<{ status: number; body: string }>;
  };
}

/** Permissions for one room: write for editors; read plus own presence for everyone else. */
export function roomPermissions(write: boolean): readonly string[] {
  return write ? ['room:write'] : ['room:read', 'room:presence:write'];
}

/** Mint a token for exactly one room, at exactly the access `roomAccess` decided. */
export async function mintRoomToken(
  issuer: RoomTokenIssuer,
  access: RoomAccess,
  person: { readonly userId: string; readonly name: string },
): Promise<{ status: number; body: string }> {
  const session = issuer.prepareSession(person.userId, {
    userInfo: { name: person.name, color: presenceColor(person.userId) },
  });
  session.allow(access.room, roomPermissions(access.write));
  return session.authorize();
}

/** The name a collaborator's cursor and presence carry. */
export async function displayNameOf(context: LibraryContext): Promise<string> {
  const [person] = await context.db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, context.userId));
  return person?.name ?? 'A collaborator';
}
