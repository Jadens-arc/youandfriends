import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import { loopRegions, type DirectDatabase } from '@youandfriends/db';
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '@/lib/library/context';

import { clearLoop, readLoop, saveLoop } from '../loop-store';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING loop region tests: ${reason}`);

/**
 * Loop regions (task `074`) are one person's, on one song. The fixture has two collaborators on
 * the same song — so "does not leak between collaborators" has someone to leak to — a stranger,
 * and a populated foreign workspace.
 */
describeWithDatabase('loop regions per user per song', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let foreignWorkspaceId: string;
  const people = {} as Record<'owner' | 'collaborator' | 'foreigner', string>;
  let songId: string;
  let otherSongId: string;
  let foreignSongId: string;

  function contextFor(userId: string, workspace = workspaceId): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
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
    database = await createTestDatabase('loop_regions');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    people.collaborator = (await makeUser(db)).id;
    await addMember(db, workspaceId, people.collaborator, 'viewer');
    const project = await makeProject(db, workspaceId, 'Night Drive');
    songId = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    otherSongId = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    foreignWorkspaceId = foreign.workspace.id;
    const foreignProject = await makeProject(db, foreignWorkspaceId, 'Theirs');
    foreignSongId = (await makeSong(db, foreignWorkspaceId, foreignProject.id, 'Unreleased')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('keeps each collaborator’s region on the same song apart', async () => {
    await saveLoop(contextFor(people.owner), songId, { startMs: 10_000, endMs: 14_000 });
    await saveLoop(contextFor(people.collaborator), songId, { startMs: 60_000, endMs: 62_500 });
    expect(await readLoop(contextFor(people.owner), songId)).toEqual({
      startMs: 10_000,
      endMs: 14_000,
    });
    expect(await readLoop(contextFor(people.collaborator), songId)).toEqual({
      startMs: 60_000,
      endMs: 62_500,
    });
    expect(await readLoop(contextFor(people.owner), otherSongId)).toBeNull();

    // Replacing is one row, not a second.
    await saveLoop(contextFor(people.owner), songId, { startMs: 11_000, endMs: 15_000 });
    const rows = await db.select().from(loopRegions);
    expect(rows).toHaveLength(2);

    await clearLoop(contextFor(people.owner), songId);
    expect(await readLoop(contextFor(people.owner), songId)).toBeNull();
    expect(await readLoop(contextFor(people.collaborator), songId)).not.toBeNull();
  });

  it('refuses a song the viewer cannot open, or another workspace’s, 404-shaped', async () => {
    for (const [userId, workspace, song] of [
      [people.foreigner, foreignWorkspaceId, songId],
      [people.owner, workspaceId, foreignSongId],
    ] as const) {
      // Thunks, awaited one at a time: a promise created early rejects before anyone listens.
      for (const attempt of [
        () => readLoop(contextFor(userId, workspace), song),
        () => saveLoop(contextFor(userId, workspace), song, { startMs: 0, endMs: 1000 }),
        () => clearLoop(contextFor(userId, workspace), song),
      ]) {
        expect((await refusal(attempt())).publicCode).toBe('not_found');
      }
    }
  });

  it('refuses a region that ends before it starts, or runs past six hours', async () => {
    for (const region of [
      { startMs: 5000, endMs: 5000 },
      { startMs: -1, endMs: 10 },
      { startMs: 0, endMs: 7 * 60 * 60 * 1000 },
    ]) {
      expect((await refusal(saveLoop(contextFor(people.owner), songId, region))).publicCode).toBe(
        'validation_failed',
      );
    }
  });
});
