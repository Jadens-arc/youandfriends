import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lyricsDocuments, lyricsRevisions, songs } from '../schema/index';
import {
  expectDatabaseError,
  makeProject,
  makeSong,
  makeTenant,
  SQLSTATE,
  testId,
} from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING lyrics schema tests: ${reason}`);
}

/**
 * `lyrics_documents` (task `080`). Each constraint has the row that makes it fire: a second
 * document for the same song, a song in another workspace, a version below one, and a purged
 * song with lyrics on the far end of the cascade.
 */
describeWithDatabase('lyrics documents', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('lyrics_schema');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function songIn(workspaceId: string) {
    const project = await makeProject(database.db, workspaceId, 'Night Drive');
    return makeSong(database.db, workspaceId, project.id, 'Headlights');
  }

  function row(workspaceId: string, songId: string, plainText = 'Chorus\nStay, stay') {
    return {
      id: testId(),
      workspaceId,
      songId,
      document: { type: 'doc', content: [] },
      plainText,
    };
  }

  it('stores the document, its plain text, and Yjs state, starting at version 1', async () => {
    const { workspace } = await makeTenant(database.db);
    const song = await songIn(workspace.id);
    await database.db.insert(lyricsDocuments).values({
      ...row(workspace.id, song.id),
      yjsState: Uint8Array.from([1, 2, 3]),
    });
    const [stored] = await database.db
      .select()
      .from(lyricsDocuments)
      .where(eq(lyricsDocuments.songId, song.id));
    expect(stored?.version).toBe(1);
    expect(stored?.plainText).toBe('Chorus\nStay, stay');
    expect(Array.from(stored?.yjsState ?? [])).toEqual([1, 2, 3]);
  });

  it('keeps one document per song', async () => {
    const { workspace } = await makeTenant(database.db);
    const song = await songIn(workspace.id);
    await database.db.insert(lyricsDocuments).values(row(workspace.id, song.id));
    await expectDatabaseError(
      database.db.insert(lyricsDocuments).values(row(workspace.id, song.id)),
      SQLSTATE.uniqueViolation,
      /lyrics_documents/,
    );
  });

  it('refuses lyrics filed under a workspace the song is not in', async () => {
    const { workspace } = await makeTenant(database.db);
    const foreign = await makeTenant(database.db);
    const theirSong = await songIn(foreign.workspace.id);
    await expectDatabaseError(
      database.db.insert(lyricsDocuments).values(row(workspace.id, theirSong.id)),
      SQLSTATE.foreignKeyViolation,
      /lyrics_documents_song_same_workspace/,
    );
  });

  it('refuses a version below one', async () => {
    const { workspace } = await makeTenant(database.db);
    const song = await songIn(workspace.id);
    await expectDatabaseError(
      database.db.insert(lyricsDocuments).values({ ...row(workspace.id, song.id), version: 0 }),
      SQLSTATE.checkViolation,
      /version/,
    );
  });

  it('derives the search vector from the plain text, and a GIN index serves it', async () => {
    const { workspace } = await makeTenant(database.db);
    const song = await songIn(workspace.id);
    await database.db
      .insert(lyricsDocuments)
      .values(row(workspace.id, song.id, 'Verse\nNobody knows the long road home'));
    const hits = await database.db
      .select({ songId: lyricsDocuments.songId })
      .from(lyricsDocuments)
      .where(sql`${lyricsDocuments.search} @@ plainto_tsquery('simple', 'road home')`);
    expect(hits.map((hit) => hit.songId)).toContain(song.id);
    const indexes = await database.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'lyrics_documents'`,
    );
    expect(indexes.rows.some((index) => /USING gin \(search\)/.test(index.indexdef))).toBe(true);
  });

  it('goes with its song when the song is purged', async () => {
    const { workspace } = await makeTenant(database.db);
    const song = await songIn(workspace.id);
    await database.db.insert(lyricsDocuments).values(row(workspace.id, song.id));
    await database.db.delete(songs).where(eq(songs.id, song.id));
    const left = await database.db
      .select()
      .from(lyricsDocuments)
      .where(eq(lyricsDocuments.songId, song.id));
    expect(left).toEqual([]);
  });

  describe('revisions (task 084)', () => {
    function revision(
      workspaceId: string,
      songId: string,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        id: testId(),
        workspaceId,
        songId,
        kind: 'automatic' as const,
        document: { type: 'doc', content: [] },
        plainText: 'Verse\nearlier',
        sourceVersion: 1,
        ...overrides,
      };
    }

    it('requires a checkpoint to be named', async () => {
      const { workspace } = await makeTenant(database.db);
      const song = await songIn(workspace.id);
      await expectDatabaseError(
        database.db
          .insert(lyricsRevisions)
          .values(revision(workspace.id, song.id, { kind: 'checkpoint' })),
        SQLSTATE.checkViolation,
        /lyrics_revisions_checkpoint_named/,
      );
      await expectDatabaseError(
        database.db
          .insert(lyricsRevisions)
          .values(revision(workspace.id, song.id, { kind: 'checkpoint', name: '   ' })),
        SQLSTATE.checkViolation,
        /lyrics_revisions_checkpoint_named/,
      );
      await database.db
        .insert(lyricsRevisions)
        .values(revision(workspace.id, song.id, { kind: 'checkpoint', name: 'Demo' }));
    });

    it('refuses a revision filed under another workspace’s song', async () => {
      const { workspace } = await makeTenant(database.db);
      const foreign = await makeTenant(database.db);
      const theirSong = await songIn(foreign.workspace.id);
      await expectDatabaseError(
        database.db.insert(lyricsRevisions).values(revision(workspace.id, theirSong.id)),
        SQLSTATE.foreignKeyViolation,
        /lyrics_revisions_song_same_workspace/,
      );
    });

    it('goes with its song when the song is purged', async () => {
      const { workspace } = await makeTenant(database.db);
      const song = await songIn(workspace.id);
      await database.db.insert(lyricsRevisions).values(revision(workspace.id, song.id));
      await database.db.delete(songs).where(eq(songs.id, song.id));
      const left = await database.db
        .select()
        .from(lyricsRevisions)
        .where(eq(lyricsRevisions.songId, song.id));
      expect(left).toEqual([]);
    });
  });
});
