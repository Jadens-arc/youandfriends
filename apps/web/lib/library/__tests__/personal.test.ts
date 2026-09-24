import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  ensureScopeLimitedMembership,
  favorites,
  permissionGrants,
  recents,
  RECENTS_CAP,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAuditEvent,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '../context';
import { noteRecent, readActivity, readFavorites, readRecents, toggleFavorite } from '../personal';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING favorites, recents, and activity: ${reason}`);

/**
 * Favourites, recents, and activity (task `044`) against a real database.
 *
 * The collaborator in this fixture can see exactly one song in a project of three — the case the
 * task's security note names — and there is activity on all three, by several people, so a feed
 * filtered by project or by membership would show the siblings and fail.
 */
describeWithDatabase('favorites, recents, and activity', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const people = {} as Record<'owner' | 'editor' | 'collab' | 'foreigner', string>;
  const ids = {} as Record<
    | 'workspace'
    | 'foreignWorkspace'
    | 'project'
    | 'shared'
    | 'sibling'
    | 'sibling2'
    | 'foreignSong',
    string
  >;

  function contextFor(userId: string, now?: Date, workspaceId = ids.workspace): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      ...(now === undefined ? {} : { now: () => now }),
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
    database = await createTestDatabase('personal_library');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    people.editor = (await makeUser(db)).id;
    people.collab = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.editor, 'editor');
    ids.project = (await makeProject(db, ids.workspace, 'Night Drive')).id;
    ids.shared = (await makeSong(db, ids.workspace, ids.project, 'Headlights')).id;
    ids.sibling = (await makeSong(db, ids.workspace, ids.project, 'Tail Lights')).id;
    ids.sibling2 = (await makeSong(db, ids.workspace, ids.project, 'Streetlights')).id;
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, ids.workspace, people.collab, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId: ids.workspace,
        scopeType: 'song',
        scopeId: ids.shared,
        subjectKind: 'member',
        subjectId: people.collab,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: people.owner,
      });
    });

    // Activity on every song, by the owner and the editor, plus a project-level change.
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 12, minute));
    let minute = 0;
    for (const songId of [ids.shared, ids.sibling, ids.sibling2]) {
      for (const actorId of [people.owner, people.editor]) {
        await makeAuditEvent(db, {
          workspaceId: ids.workspace,
          actorId,
          action: 'song.updated',
          targetType: 'song',
          targetId: songId,
          occurredAt: at((minute += 1)),
        });
      }
    }
    await makeAuditEvent(db, {
      workspaceId: ids.workspace,
      actorId: people.owner,
      action: 'project.updated',
      targetType: 'project',
      targetId: ids.project,
      occurredAt: at(30),
    });

    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    ids.foreignSong = (
      await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased')
    ).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('shows a narrowly scoped collaborator no activity about the songs beside theirs', async () => {
    const feed = await readActivity(contextFor(people.collab));
    expect(feed.length).toBeGreaterThan(0);
    expect(new Set(feed.map((item) => item.targetId))).toEqual(new Set([ids.shared]));
    // The project-level change is about something they cannot open.
    expect(feed.some((item) => item.targetType === 'project')).toBe(false);

    const editorFeed = await readActivity(contextFor(people.editor));
    expect(new Set(editorFeed.map((item) => item.targetId))).toEqual(
      new Set([ids.shared, ids.sibling, ids.sibling2, ids.project]),
    );
    // Collaborator activity is other people's.
    expect(editorFeed.some((item) => item.actorName === 'Test Person' && item.id === '')).toBe(
      false,
    );
  });

  it('gives a song its own feed, including the viewer’s own changes', async () => {
    const feed = await readActivity(contextFor(people.owner), { songId: ids.shared });
    expect(feed).toHaveLength(2);
    expect(new Set(feed.map((item) => item.targetId))).toEqual(new Set([ids.shared]));
  });

  it('keeps favourites per person, idempotent, and only for what they can see', async () => {
    await toggleFavorite(contextFor(people.collab), {
      targetType: 'song',
      targetId: ids.shared,
      favorite: true,
    });
    await toggleFavorite(contextFor(people.collab), {
      targetType: 'song',
      targetId: ids.shared,
      favorite: true,
    });
    await toggleFavorite(contextFor(people.editor), {
      targetType: 'project',
      targetId: ids.project,
      favorite: true,
    });
    expect((await readFavorites(contextFor(people.collab))).map((item) => item.name)).toEqual([
      'Headlights',
    ]);
    expect((await readFavorites(contextFor(people.editor))).map((item) => item.name)).toEqual([
      'Night Drive',
    ]);
    const rows = await db.select().from(favorites).where(eq(favorites.userId, people.collab));
    expect(rows).toHaveLength(1);

    for (const attempt of [
      () =>
        toggleFavorite(contextFor(people.collab), {
          targetType: 'song',
          targetId: ids.sibling,
          favorite: true,
        }),
      () =>
        toggleFavorite(contextFor(people.owner), {
          targetType: 'song',
          targetId: ids.foreignSong,
          favorite: true,
        }),
    ]) {
      expect((await refusal(attempt())).publicCode).toBe('not_found');
    }

    await toggleFavorite(contextFor(people.collab), {
      targetType: 'song',
      targetId: ids.shared,
      favorite: false,
    });
    expect(await readFavorites(contextFor(people.collab))).toEqual([]);
  });

  it('debounces a revisit instead of writing on every view', async () => {
    const start = new Date('2026-09-23T12:00:00Z');
    const request = { kind: 'viewed', targetType: 'song', targetId: ids.shared } as const;
    await noteRecent(contextFor(people.owner, start), request);
    await noteRecent(contextFor(people.owner, new Date(start.getTime() + 60_000)), request);
    const [row] = await db
      .select()
      .from(recents)
      .where(and(eq(recents.userId, people.owner), eq(recents.targetId, ids.shared)));
    expect(row?.occurredAt).toEqual(start);

    const later = new Date(start.getTime() + 10 * 60_000);
    await noteRecent(contextFor(people.owner, later), request);
    const [moved] = await db
      .select()
      .from(recents)
      .where(and(eq(recents.userId, people.owner), eq(recents.targetId, ids.shared)));
    expect(moved?.occurredAt).toEqual(later);
  });

  it('caps recents per person and prunes the oldest', async () => {
    const project = await makeProject(db, ids.workspace, 'Many');
    const base = new Date('2026-09-01T00:00:00Z').getTime();
    for (let index = 0; index < RECENTS_CAP + 5; index += 1) {
      const song = await makeSong(db, ids.workspace, project.id, `Song ${index}`);
      await noteRecent(contextFor(people.editor, new Date(base + index * 60_000)), {
        kind: 'played',
        targetType: 'song',
        targetId: song.id,
      });
    }
    const rows = await db
      .select()
      .from(recents)
      .where(and(eq(recents.userId, people.editor), eq(recents.kind, 'played')));
    expect(rows).toHaveLength(RECENTS_CAP);
    const { played } = await readRecents(contextFor(people.editor));
    expect(played[0]?.name).toBe(`Song ${RECENTS_CAP + 4}`);
    expect(played.some((item) => item.name === 'Song 0')).toBe(false);
  });

  it('refuses to record what the person cannot see, and drops what they no longer can', async () => {
    const error = await refusal(
      noteRecent(contextFor(people.collab), {
        kind: 'viewed',
        targetType: 'song',
        targetId: ids.sibling,
      }),
    );
    expect(error.publicCode).toBe('not_found');

    await noteRecent(contextFor(people.editor), {
      kind: 'viewed',
      targetType: 'song',
      targetId: ids.sibling2,
    });
    expect(
      (await readRecents(contextFor(people.editor))).viewed.map((item) => item.name),
    ).toContain('Streetlights');
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: ids.workspace,
      scopeType: 'song',
      scopeId: ids.sibling2,
      subjectKind: 'member',
      subjectId: people.editor,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    expect(
      (await readRecents(contextFor(people.editor))).viewed.map((item) => item.name),
    ).not.toContain('Streetlights');
  });
});
