import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  lyricsDocuments,
  songs,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { LibraryContext } from '@/lib/library/context';

import {
  mintRoomToken,
  presenceColor,
  PRESENCE_COLORS,
  roomAccess,
  roomForSong,
  songForRoom,
  type RoomTokenIssuer,
} from '../collaboration';
import { mergeRoomState, readLyrics, saveLyrics } from '../service';
import { lyricsToText, textToLyrics } from '../text-format';
import { fromBase64, LYRICS_FRAGMENT, toBase64 } from '../yjs';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING lyrics collaboration tests: ${reason}`);

/** A stand-in for `new Liveblocks({ secret })` that records what a token was asked to allow. */
function recordingIssuer() {
  const calls: { userId: string; info: unknown; allowed: [string, readonly string[]][] }[] = [];
  const issuer: RoomTokenIssuer = {
    prepareSession(userId, options) {
      const call = { userId, info: options.userInfo, allowed: [] as [string, readonly string[]][] };
      calls.push(call);
      return {
        allow(room, permissions) {
          call.allowed.push([room, permissions]);
        },
        authorize: async () => ({ status: 200, body: '{"token":"test"}' }),
      };
    },
  };
  return { issuer, calls };
}

/** What a collaborator's editor would send: the stored seed plus words typed at the start. */
function typed(seedBase64: string, words: string): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(seedBase64));
  const section = doc
    .getXmlFragment(LYRICS_FRAGMENT)
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName === 'lyricsSection',
    );
  if (section === undefined) throw new Error('no section to type into');
  const line = section.get(0) as Y.XmlElement;
  let text = line.get(0) as Y.XmlText | undefined;
  if (text === undefined) {
    text = new Y.XmlText();
    line.insert(0, [text]);
  }
  text.insert(0, words);
  return toBase64(Y.encodeStateAsUpdate(doc));
}

/**
 * Room access and collaborative persistence (task `082`), against a real database. The fixture
 * has an editor to demote mid-session, a commenter and a viewer (read-only in the room), a
 * stranger with no membership, a trashed song, and a populated foreign workspace.
 */
describeWithDatabase('lyrics collaboration', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  const people = {} as Record<
    'owner' | 'editor' | 'commenter' | 'viewer' | 'stranger' | 'foreigner',
    string
  >;
  const ids = {} as Record<'song' | 'second' | 'trashed' | 'foreign', string>;

  function contextFor(userId: string): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
    };
  }

  async function refusal(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    database = await createTestDatabase('lyrics_collaboration');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      people[role] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[role], role);
    }
    people.stranger = (await makeUser(db)).id;
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.second = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    ids.trashed = (await makeSong(db, workspaceId, project.id, 'Thrown Away')).id;
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, ids.trashed));
    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    ids.foreign = (await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('names rooms by song, and reads nothing else as one', () => {
    expect(songForRoom(roomForSong(ids.song))).toBe(ids.song);
    for (const room of ['lyrics:', 'lyrics:../x', `comments:${ids.song}`, `lyrics:${ids.song}x`]) {
      expect(songForRoom(room)).toBeNull();
    }
  });

  it('gives editors write access and everyone else who can see the song read access', async () => {
    const room = roomForSong(ids.song);
    for (const userId of [people.owner, people.editor]) {
      expect(await roomAccess(contextFor(userId), room)).toMatchObject({ write: true });
    }
    for (const userId of [people.commenter, people.viewer]) {
      expect(await roomAccess(contextFor(userId), room)).toMatchObject({ write: false });
    }
  });

  it('refuses, 404-shaped, a room someone may not see, or that is not a lyrics room', async () => {
    const attempts: [string, string][] = [
      [people.stranger, roomForSong(ids.song)],
      [people.owner, roomForSong(ids.foreign)],
      [people.owner, roomForSong(ids.trashed)],
      [people.owner, `other:${ids.song}`],
      [people.owner, 'lyrics:*'],
    ];
    for (const [userId, room] of attempts) {
      expect((await refusal(roomAccess(contextFor(userId), room))).publicCode).toBe('not_found');
    }
  });

  it('mints a token for exactly one room at exactly the access decided', async () => {
    const { issuer, calls } = recordingIssuer();
    const editor = await roomAccess(contextFor(people.editor), roomForSong(ids.song));
    const viewer = await roomAccess(contextFor(people.viewer), roomForSong(ids.song));
    await mintRoomToken(issuer, editor, { userId: people.editor, name: 'Sam' });
    await mintRoomToken(issuer, viewer, { userId: people.viewer, name: 'Alex' });
    expect(calls.map((call) => call.allowed)).toEqual([
      [[roomForSong(ids.song), ['room:write']]],
      [[roomForSong(ids.song), ['room:read', 'room:presence:write']]],
    ]);
    expect(calls[0]?.info).toEqual({ name: 'Sam', color: presenceColor(people.editor) });
    expect(PRESENCE_COLORS).toContain(presenceColor(people.editor));
  });

  it('revokes write access on demotion: the next token is read-only and saves are refused', async () => {
    const context = contextFor(people.editor);
    const seed = (await readLyrics(context, ids.second)).yjsState;
    await saveLyrics(context, ids.second, {
      document: textToLyrics('[Verse]\n'),
      baseVersion: 0,
      yjsState: typed(seed, 'before '),
    });
    await db
      .update(workspaceMemberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(workspaceMemberships.userId, people.editor),
          eq(workspaceMemberships.workspaceId, workspaceId),
        ),
      );
    try {
      expect(await roomAccess(contextFor(people.editor), roomForSong(ids.second))).toMatchObject({
        write: false,
      });
      const error = await refusal(
        saveLyrics(contextFor(people.editor), ids.second, {
          document: textToLyrics('[Verse]\n'),
          baseVersion: 0,
          yjsState: typed(seed, 'after '),
        }),
      );
      expect(error.publicCode).toBe('not_found');
      expect(
        lyricsToText((await readLyrics(contextFor(people.owner), ids.second)).document),
      ).not.toContain('after');
    } finally {
      await db
        .update(workspaceMemberships)
        .set({ role: 'editor' })
        .where(eq(workspaceMemberships.userId, people.editor));
    }
  });

  it('merges collaborative saves in any order, with no version to conflict on', async () => {
    const seed = (await readLyrics(contextFor(people.owner), ids.song)).yjsState;
    const sam = typed(seed, 'Sam ');
    const alex = typed(seed, 'Alex ');
    await saveLyrics(contextFor(people.editor), ids.song, {
      document: textToLyrics('[Verse]\nignored'),
      baseVersion: 0,
      yjsState: alex,
    });
    // A stale base version and a stale document: neither matters, the Yjs state is merged.
    await saveLyrics(contextFor(people.owner), ids.song, {
      document: textToLyrics('[Verse]\nignored'),
      baseVersion: 0,
      yjsState: sam,
    });
    await saveLyrics(contextFor(people.owner), ids.song, {
      document: textToLyrics('[Verse]\nignored'),
      baseVersion: 0,
      yjsState: sam,
    });
    const stored = await readLyrics(contextFor(people.owner), ids.song);
    const text = lyricsToText(stored.document);
    expect(text).toContain('Sam ');
    expect(text).toContain('Alex ');
    expect(text).not.toContain('ignored');
    const [row] = await db
      .select({ plainText: lyricsDocuments.plainText })
      .from(lyricsDocuments)
      .where(eq(lyricsDocuments.songId, ids.song));
    expect(row?.plainText).toContain('Alex');
  });

  it('stores only what the lyrics schema allows from a Yjs state', async () => {
    const seed = (await readLyrics(contextFor(people.owner), ids.song)).yjsState;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(seed));
    const script = new Y.XmlElement('script');
    script.insert(0, [new Y.XmlText('alert(1)')]);
    doc.getXmlFragment(LYRICS_FRAGMENT).insert(0, [script]);
    await saveLyrics(contextFor(people.owner), ids.song, {
      document: textToLyrics('[Verse]\n'),
      baseVersion: 0,
      yjsState: toBase64(Y.encodeStateAsUpdate(doc)),
    });
    const stored = await readLyrics(contextFor(people.owner), ids.song);
    expect(JSON.stringify(stored.document)).not.toMatch(/script|alert/);
    expect(lyricsToText(stored.document)).toContain('Alex ');
  });

  it('merges the room’s copy from the webhook path, but only into lyrics an editor saved', async () => {
    const seed = (await readLyrics(contextFor(people.owner), ids.song)).yjsState;
    const room = fromBase64(typed(seed, 'From the room: '));
    expect(await mergeRoomState(db, ids.song, room)).toBe('merged');
    expect(await mergeRoomState(db, ids.song, room)).toBe('unchanged');
    expect(lyricsToText((await readLyrics(contextFor(people.owner), ids.song)).document)).toContain(
      'From the room: ',
    );
    expect(await mergeRoomState(db, ids.trashed, room)).toBe('no_lyrics');
    const fresh = await readLyrics(contextFor(people.owner), ids.trashed).catch(() => null);
    expect(fresh).toBeNull();
  });

  it('drops stale Yjs state when a single-player save replaces the document', async () => {
    const { version } = await readLyrics(contextFor(people.owner), ids.song);
    await saveLyrics(contextFor(people.owner), ids.song, {
      document: textToLyrics('[Bridge]\nfresh start'),
      baseVersion: version,
    });
    const after = await readLyrics(contextFor(people.owner), ids.song);
    expect(lyricsToText(after.document)).toBe('[Bridge]\nfresh start');
    // The seed now describes the new document, not the collaborative history before it.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(after.yjsState));
    expect(doc.getXmlFragment(LYRICS_FRAGMENT).toString()).toContain('fresh start');
    expect(doc.getXmlFragment(LYRICS_FRAGMENT).toString()).not.toContain('Sam');
  });
});
