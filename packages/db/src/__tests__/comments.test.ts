import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assets, comments, commentThreads, songs } from '../schema/index';
import {
  expectDatabaseError,
  makeAsset,
  makeAssetVersion,
  makeProject,
  makeStorageObject,
  makeSong,
  makeTenant,
  SQLSTATE,
  testId,
} from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING comment schema tests: ${reason}`);
}

/**
 * `comment_threads` and `comments` (task `090`). Each constraint gets the row that makes it fire:
 * an anchor of each kind with a field missing or extra, a tombstone that kept its words, a thread
 * and a comment pointing across workspaces, and a purged song with a conversation on it — one
 * that carries a recorded voice note (task `093`), so the purge meets that reference too.
 */
describeWithDatabase('comment schema', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('comment_schema');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function songIn(workspaceId: string) {
    const project = await makeProject(database.db, workspaceId, 'Night Drive');
    return makeSong(database.db, workspaceId, project.id, 'Headlights');
  }

  async function context() {
    const { workspace } = await makeTenant(database.db);
    const song = await songIn(workspace.id);
    return { workspaceId: workspace.id, songId: song.id };
  }

  const thread = (workspaceId: string, songId: string, anchor: Record<string, unknown>) => ({
    id: testId(),
    workspaceId,
    songId,
    anchorKind: 'general' as const,
    ...anchor,
  });

  it('holds each anchor kind to its own shape', async () => {
    const { workspaceId, songId } = await context();
    const good = [
      {},
      { anchorKind: 'timestamp', anchorVersionId: testId(), anchorMs: 1_000 },
      { anchorKind: 'lyric', anchorLyric: { quote: 'Stay' } },
    ];
    for (const anchor of good) {
      await database.db.insert(commentThreads).values(thread(workspaceId, songId, anchor));
    }
    const bad = [
      { anchorMs: 1_000 },
      { anchorKind: 'timestamp', anchorVersionId: testId() },
      { anchorKind: 'timestamp', anchorVersionId: testId(), anchorMs: -1 },
      { anchorKind: 'lyric' },
      { anchorKind: 'lyric', anchorLyric: {}, anchorMs: 5 },
    ];
    for (const anchor of bad) {
      await expectDatabaseError(
        database.db.insert(commentThreads).values(thread(workspaceId, songId, anchor)),
        SQLSTATE.checkViolation,
        /comment_threads_anchor_shape/,
      );
    }
  });

  it('erases a tombstoned comment’s words, and refuses an empty live one', async () => {
    const { workspaceId, songId } = await context();
    const t = thread(workspaceId, songId, {});
    await database.db.insert(commentThreads).values(t);
    const row = { id: testId(), workspaceId, threadId: t.id };
    await expectDatabaseError(
      database.db.insert(comments).values({ ...row, body: 'still here', tombstonedAt: new Date() }),
      SQLSTATE.checkViolation,
      /comments_tombstone_erases/,
    );
    await expectDatabaseError(
      database.db.insert(comments).values({ ...row, body: '   ' }),
      SQLSTATE.checkViolation,
      /comments_live_has_words/,
    );
    await database.db.insert(comments).values({ ...row, body: '', tombstonedAt: new Date() });
  });

  /** A recorded voice note on `songId`: the asset, and the version its upload left. */
  async function voiceNote(workspaceId: string, songId: string) {
    const asset = await makeAsset(database.db, workspaceId, { songId });
    await database.db.update(assets).set({ kind: 'voice_note' }).where(eq(assets.id, asset.id));
    const object = await makeStorageObject(database.db, workspaceId);
    await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
    return asset.id;
  }

  it('lets a voice note stand in for words, drops it on a tombstone, and uses it once', async () => {
    const { workspaceId, songId } = await context();
    const t = thread(workspaceId, songId, {});
    await database.db.insert(commentThreads).values(t);
    const note = await voiceNote(workspaceId, songId);
    const row = () => ({ id: testId(), workspaceId, threadId: t.id });
    await database.db.insert(comments).values({ ...row(), body: '', voiceNoteAssetId: note });
    await expectDatabaseError(
      database.db.insert(comments).values({ ...row(), body: 'again', voiceNoteAssetId: note }),
      SQLSTATE.uniqueViolation,
      /comments_voice_note_key/,
    );
    const other = await voiceNote(workspaceId, songId);
    await expectDatabaseError(
      database.db.insert(comments).values({
        ...row(),
        body: '',
        voiceNoteAssetId: other,
        tombstonedAt: new Date(),
      }),
      SQLSTATE.checkViolation,
      /comments_tombstone_drops_voice/,
    );
  });

  it('keeps threads and comments inside their own workspace', async () => {
    const mine = await context();
    const theirs = await context();
    await expectDatabaseError(
      database.db.insert(commentThreads).values(thread(mine.workspaceId, theirs.songId, {})),
      SQLSTATE.foreignKeyViolation,
      /comment_threads_song_same_workspace/,
    );
    const theirThread = thread(theirs.workspaceId, theirs.songId, {});
    await database.db.insert(commentThreads).values(theirThread);
    await expectDatabaseError(
      database.db.insert(comments).values({
        id: testId(),
        workspaceId: mine.workspaceId,
        threadId: theirThread.id,
        body: 'x',
      }),
      SQLSTATE.foreignKeyViolation,
      /comments_thread_same_workspace/,
    );
    // A voice note from another workspace, on a comment in mine.
    const myThread = thread(mine.workspaceId, mine.songId, {});
    await database.db.insert(commentThreads).values(myThread);
    await expectDatabaseError(
      database.db.insert(comments).values({
        id: testId(),
        workspaceId: mine.workspaceId,
        threadId: myThread.id,
        body: '',
        voiceNoteAssetId: await voiceNote(theirs.workspaceId, theirs.songId),
      }),
      SQLSTATE.foreignKeyViolation,
      /comments_voice_note_same_workspace/,
    );
  });

  it('goes with its song when the song is purged', async () => {
    const { workspaceId, songId } = await context();
    const t = thread(workspaceId, songId, {});
    await database.db.insert(commentThreads).values(t);
    await database.db
      .insert(comments)
      .values({ id: testId(), workspaceId, threadId: t.id, body: 'x' });
    const note = await voiceNote(workspaceId, songId);
    await database.db
      .insert(comments)
      .values({ id: testId(), workspaceId, threadId: t.id, body: '', voiceNoteAssetId: note });
    await database.db.delete(songs).where(eq(songs.id, songId));
    expect(await database.db.select().from(comments).where(eq(comments.threadId, t.id))).toEqual(
      [],
    );
    expect(await database.db.select().from(assets).where(eq(assets.id, note))).toEqual([]);
  });

  it('refuses to purge a recording a live comment still carries', async () => {
    const { workspaceId, songId } = await context();
    const t = thread(workspaceId, songId, {});
    await database.db.insert(commentThreads).values(t);
    const note = await voiceNote(workspaceId, songId);
    await database.db
      .insert(comments)
      .values({ id: testId(), workspaceId, threadId: t.id, body: '', voiceNoteAssetId: note });
    // Deferred: the refusal comes at commit, so the delete runs in its own transaction.
    await expectDatabaseError(
      database.db.transaction(async (tx) => {
        await tx.delete(assets).where(eq(assets.id, note));
      }),
      SQLSTATE.foreignKeyViolation,
      /comments_voice_note_same_workspace/,
    );
  });
});
