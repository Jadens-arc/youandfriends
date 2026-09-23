import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import { auditEvents, projects, songs, type DirectDatabase } from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAsset,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { updateProject, updateSong, type MetadataContext } from '../metadata';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING metadata editing tests: ${reason}`);

/**
 * Metadata editing (task `043`) against a real database: validation, authorization, the
 * before/after audit, the notification raised, and a cover that must be this project's own
 * artwork — with another project's artwork and a stem on the far side of that rule.
 */
describeWithDatabase('metadata editing', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const people = {} as Record<'owner' | 'commenter' | 'foreigner', string>;
  const ids = {} as Record<'workspace' | 'foreignWorkspace' | 'project' | 'other' | 'song', string>;
  const raised: unknown[] = [];

  function contextFor(userId: string, workspaceId = ids.workspace): MetadataContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      notify: async (event) => {
        raised.push(event);
      },
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
    database = await createTestDatabase('metadata');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    people.commenter = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.commenter, 'commenter');
    ids.project = (await makeProject(db, ids.workspace, 'Night Drive')).id;
    ids.other = (await makeProject(db, ids.workspace, 'Other')).id;
    ids.song = (await makeSong(db, ids.workspace, ids.project, 'Headlights')).id;
    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('updates a song, audits before and after, and raises metadata.changed', async () => {
    await updateSong(contextFor(people.owner), ids.song, {
      title: ' Headlights (Night Mix) ',
      artist: 'Featuring Sam',
      status: 'mixing',
      notes: 'Bridge needs a new take.',
    });
    const [row] = await db.select().from(songs).where(eq(songs.id, ids.song));
    expect(row).toMatchObject({
      title: 'Headlights (Night Mix)',
      artist: 'Featuring Sam',
      status: 'mixing',
      notes: 'Bridge needs a new take.',
    });
    const [event] = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'song.updated'), eq(auditEvents.targetId, ids.song)));
    expect(event?.metadata).toMatchObject({
      before: { title: 'Headlights', artist: null, status: 'idea', notes: null },
      after: { title: 'Headlights (Night Mix)', status: 'mixing' },
    });
    expect(raised).toContainEqual(
      expect.objectContaining({
        event: 'metadata.changed',
        targetType: 'song',
        targetId: ids.song,
      }),
    );

    // An empty artist clears the song's own, falling back to the project's.
    await updateSong(contextFor(people.owner), ids.song, { artist: '' });
    const [cleared] = await db
      .select({ artist: songs.artist })
      .from(songs)
      .where(eq(songs.id, ids.song));
    expect(cleared?.artist).toBeNull();
  });

  it('refuses a commenter and another workspace 404-shaped, and bad input by the shared rule', async () => {
    for (const [userId, workspaceId] of [
      [people.commenter, ids.workspace],
      [people.foreigner, ids.foreignWorkspace],
    ] as const) {
      const error = await refusal(
        updateSong(contextFor(userId, workspaceId), ids.song, { title: 'x' }),
      );
      expect(error.publicCode).toBe('not_found');
    }
    const empty = await refusal(updateSong(contextFor(people.owner), ids.song, { title: '  ' }));
    expect(empty.fields?.[0]?.message).toBe('Give the song a name.');
    const bogus = await refusal(
      updateSong(contextFor(people.owner), ids.song, { status: 'released' as never }),
    );
    expect(bogus.code).toBe('validation_failed');
  });

  it('sets a cover only from this project’s own artwork', async () => {
    const art = await makeAsset(db, ids.workspace, { projectId: ids.project }, { kind: 'artwork' });
    const otherArt = await makeAsset(
      db,
      ids.workspace,
      { projectId: ids.other },
      { kind: 'artwork' },
    );
    const notArt = await makeAsset(
      db,
      ids.workspace,
      { projectId: ids.project },
      { kind: 'project_file' },
    );

    for (const assetId of [otherArt.id, notArt.id]) {
      const error = await refusal(
        updateProject(contextFor(people.owner), ids.project, { coverAssetId: assetId as never }),
      );
      expect(error.publicCode).toBe('not_found');
    }
    await updateProject(contextFor(people.owner), ids.project, {
      name: 'Night Drive (Deluxe)',
      coverAssetId: art.id as never,
    });
    const [row] = await db.select().from(projects).where(eq(projects.id, ids.project));
    expect(row).toMatchObject({ name: 'Night Drive (Deluxe)', coverAssetId: art.id });

    await updateProject(contextFor(people.owner), ids.project, { coverAssetId: null });
    const [cleared] = await db.select().from(projects).where(eq(projects.id, ids.project));
    expect(cleared?.coverAssetId).toBeNull();
  });

  it('writes nothing for a change that changes nothing', async () => {
    const before = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.updated'));
    await updateProject(contextFor(people.owner), ids.project, { name: 'Night Drive (Deluxe)' });
    const after = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.updated'));
    expect(after).toHaveLength(before.length);
  });
});
