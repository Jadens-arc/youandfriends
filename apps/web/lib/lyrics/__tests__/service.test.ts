import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, LyricsDocument, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  lyricsDocuments,
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
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readLyrics, saveLyrics, type LyricsContext } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING lyrics storage tests: ${reason}`);

const doc = (...lines: string[]): LyricsDocument => ({
  type: 'doc',
  content: [
    {
      type: 'lyricsSection',
      attrs: { kind: 'chorus' },
      content: lines.map((text) => ({ type: 'lyricsLine', content: [{ type: 'text', text }] })),
    },
  ],
});

/**
 * Lyrics storage (task `080`) against a real database and the real authorizer. The fixture has
 * an editor who is demoted mid-session (so "a revoked user's autosave is refused" has someone to
 * refuse), a viewer, a commenter, a second song whose lyrics must stay apart, and a populated
 * foreign workspace with lyrics of its own.
 */
describeWithDatabase('lyrics storage', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let foreignWorkspaceId: string;
  const people = {} as Record<'owner' | 'editor' | 'commenter' | 'viewer' | 'foreigner', string>;
  let songId: string;
  let otherSongId: string;
  let foreignSongId: string;
  let clock = new Date('2026-09-24T12:00:00Z');

  function contextFor(userId: string, workspace = workspaceId): LyricsContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      now: () => clock,
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
    database = await createTestDatabase('lyrics_storage');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      people[role] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[role], role);
    }
    const project = await makeProject(db, workspaceId, 'Night Drive');
    songId = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    otherSongId = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    foreignWorkspaceId = foreign.workspace.id;
    const foreignProject = await makeProject(db, foreignWorkspaceId, 'Theirs');
    foreignSongId = (await makeSong(db, foreignWorkspaceId, foreignProject.id, 'Unreleased')).id;
    await saveLyrics(contextFor(people.foreigner, foreignWorkspaceId), foreignSongId, {
      document: doc('their secret line'),
      baseVersion: 0,
    });
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('starts empty at version 0, and a first save creates version 1', async () => {
    expect(await readLyrics(contextFor(people.viewer), songId)).toMatchObject({
      document: { type: 'doc', content: [] },
      version: 0,
      canEdit: false,
    });
    const saved = await saveLyrics(contextFor(people.editor), songId, {
      document: doc('Stay, stay', 'Headlights on'),
      baseVersion: 0,
    });
    expect(saved).toEqual({ version: 1 });
    const read = await readLyrics(contextFor(people.editor), songId);
    expect(read).toMatchObject({ version: 1, canEdit: true });
    expect(read.document).toEqual(doc('Stay, stay', 'Headlights on'));
  });

  it('derives the plain text on every save, and search finds it', async () => {
    const { version } = await readLyrics(contextFor(people.owner), songId);
    await saveLyrics(contextFor(people.owner), songId, {
      document: doc('Nobody knows the long road'),
      baseVersion: version,
    });
    const [row] = await db
      .select({ plainText: lyricsDocuments.plainText })
      .from(lyricsDocuments)
      .where(eq(lyricsDocuments.songId, songId));
    expect(row?.plainText).toBe('Chorus\nNobody knows the long road');
    const found = await db
      .select({ songId: lyricsDocuments.songId })
      .from(lyricsDocuments)
      .where(sql`${lyricsDocuments.search} @@ plainto_tsquery('simple', 'long road')`);
    expect(found.map((hit) => hit.songId)).toEqual([songId]);
    // The old words are gone from search — the projection is regenerated, not appended.
    const stale = await db
      .select({ songId: lyricsDocuments.songId })
      .from(lyricsDocuments)
      .where(sql`${lyricsDocuments.search} @@ plainto_tsquery('simple', 'headlights')`);
    expect(stale).toEqual([]);
  });

  it('refuses a save against a stale version, overwriting nothing', async () => {
    const before = await readLyrics(contextFor(people.owner), songId);
    await saveLyrics(contextFor(people.owner), songId, {
      document: doc('mine first'),
      baseVersion: before.version,
    });
    const error = await refusal(
      saveLyrics(contextFor(people.editor), songId, {
        document: doc('stale overwrite'),
        baseVersion: before.version,
      }),
    );
    expect(error.publicCode).toBe('conflict');
    expect((await readLyrics(contextFor(people.owner), songId)).document).toEqual(
      doc('mine first'),
    );
  });

  it('turns two saves on one version into one save and one conflict', async () => {
    const { version } = await readLyrics(contextFor(people.owner), songId);
    const results = await Promise.allSettled([
      saveLyrics(contextFor(people.owner), songId, { document: doc('a'), baseVersion: version }),
      saveLyrics(contextFor(people.editor), songId, { document: doc('b'), baseVersion: version }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await readLyrics(contextFor(people.owner), songId)).version).toBe(version + 1);
  });

  it('lets viewers and commenters read but not write, and keeps songs apart', async () => {
    for (const userId of [people.viewer, people.commenter]) {
      const error = await refusal(
        saveLyrics(contextFor(userId), songId, { document: doc('no'), baseVersion: 0 }),
      );
      expect(error.publicCode).toBe('not_found');
    }
    expect((await readLyrics(contextFor(people.viewer), otherSongId)).version).toBe(0);
  });

  it('refuses an autosave from someone demoted mid-session', async () => {
    const { version } = await readLyrics(contextFor(people.editor), songId);
    await db
      .update(workspaceMemberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(workspaceMemberships.userId, people.editor),
          eq(workspaceMemberships.workspaceId, workspaceId),
        ),
      );
    const error = await refusal(
      saveLyrics(contextFor(people.editor), songId, {
        document: doc('late'),
        baseVersion: version,
      }),
    );
    expect(error.publicCode).toBe('not_found');
    await db
      .update(workspaceMemberships)
      .set({ role: 'editor' })
      .where(eq(workspaceMemberships.userId, people.editor));
  });

  it('never reads or writes across workspaces', async () => {
    for (const attempt of [
      () => readLyrics(contextFor(people.owner), foreignSongId),
      () =>
        saveLyrics(contextFor(people.owner), foreignSongId, { document: doc('x'), baseVersion: 1 }),
      () => readLyrics(contextFor(people.foreigner, foreignWorkspaceId), songId),
    ]) {
      expect((await refusal(attempt())).publicCode).toBe('not_found');
    }
    const [theirs] = await db
      .select({ plainText: lyricsDocuments.plainText })
      .from(lyricsDocuments)
      .where(eq(lyricsDocuments.songId, foreignSongId));
    expect(theirs?.plainText).toBe('Chorus\ntheir secret line');
  });

  it('audits an editing session, not every autosave', async () => {
    const count = async () =>
      (
        await db
          .select()
          .from(auditEvents)
          .where(
            and(eq(auditEvents.action, 'lyrics.updated'), eq(auditEvents.targetId, otherSongId)),
          )
      ).length;
    let version = 0;
    for (const words of ['one', 'two', 'three']) {
      version = (
        await saveLyrics(contextFor(people.owner), otherSongId, {
          document: doc(words),
          baseVersion: version,
        })
      ).version;
      clock = new Date(clock.getTime() + 60_000);
    }
    expect(await count()).toBe(1);
    // Someone else's edit is its own entry; so is the owner's after a long pause.
    version = (
      await saveLyrics(contextFor(people.editor), otherSongId, {
        document: doc('four'),
        baseVersion: version,
      })
    ).version;
    clock = new Date(clock.getTime() + 60 * 60_000);
    await saveLyrics(contextFor(people.editor), otherSongId, {
      document: doc('five'),
      baseVersion: version,
    });
    expect(await count()).toBe(3);
  });

  it('refuses a document that is not lyrics', async () => {
    const error = await refusal(
      saveLyrics(contextFor(people.owner), otherSongId, {
        document: { type: 'doc', content: [{ type: 'html', text: '<script>' }] } as never,
        baseVersion: 0,
      }),
    );
    expect(error.publicCode).toBe('validation_failed');
  });
});
