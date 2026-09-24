import { createAuthorizer, memberSubject, restoreEntity } from '@youandfriends/authz';
import { newUlid, type AppError, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import { assets, assetVersions, auditEvents, type DirectDatabase } from '@youandfriends/db';
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

import { createSnapshot, finalizeSnapshot } from '@/lib/snapshots/service';
import { stubDriver } from '@/lib/uploads/__tests__/stub-driver';
import { completeUploadSession, createUploadSession } from '@/lib/uploads/service';
import type { VersionContext } from '@/lib/versions/service';

import { createAsset, listTags, trashAsset, updateAsset } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING Project Files tests: ${reason}`);

/**
 * Project Files (task `057`) against a real database: renaming, moving, and tagging a file, each
 * audited with before and after; trashing it recoverably; the workspace's shared tag vocabulary;
 * and a folder uploaded twice landing as two versions of one entry.
 */
describeWithDatabase('Project Files', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const driver = stubDriver();
  const people = {} as Record<'owner' | 'viewer' | 'foreigner', string>;
  const ids = {} as Record<
    'workspace' | 'foreignWorkspace' | 'project' | 'song' | 'otherSong',
    string
  >;

  function contextFor(userId: string, workspaceId = ids.workspace): VersionContext {
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
    database = await createTestDatabase('project_files');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    people.viewer = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.viewer, 'viewer');
    ids.project = (await makeProject(db, ids.workspace, 'Night Drive')).id;
    ids.song = (await makeSong(db, ids.workspace, ids.project, 'Headlights')).id;
    ids.otherSong = (await makeSong(db, ids.workspace, ids.project, 'Tail Lights')).id;
    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    // The foreign tenant uses a tag of its own, which must never appear in this vocabulary.
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    await db.insert(assets).values({
      id: newUlid(),
      workspaceId: foreign.workspace.id,
      projectId: foreignProject.id,
      kind: 'project_file',
      name: 'x',
      tags: ['secret-label'],
    });
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('renames, moves, and re-tags, auditing before and after', async () => {
    const { assetId } = await createAsset(contextFor(people.owner), {
      songId: ids.song as never,
      kind: 'project_file',
      name: 'Session.zip',
    });
    await updateAsset(contextFor(people.owner), assetId, {
      name: 'Headlights Session.zip',
      folder: 'Logic/2026',
      tags: ['Logic', 'logic', ' final '],
    });
    const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
    expect(row).toMatchObject({
      name: 'Headlights Session.zip',
      folderPath: '/Logic/2026/',
      tags: ['Logic', 'final'],
    });
    const [event] = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'asset.updated'), eq(auditEvents.targetId, assetId)));
    expect(event?.metadata).toEqual({
      before: { name: 'Session.zip', folderPath: '', tags: [] },
      after: {
        name: 'Headlights Session.zip',
        folderPath: '/Logic/2026/',
        tags: ['Logic', 'final'],
      },
    });

    // No change is no event.
    const before = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'asset.updated'));
    await updateAsset(contextFor(people.owner), assetId, { name: 'Headlights Session.zip' });
    const after = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'asset.updated'));
    expect(after).toHaveLength(before.length);
  });

  it('keeps folders to Project Files, and refuses a viewer and another workspace', async () => {
    const { assetId } = await createAsset(contextFor(people.owner), {
      songId: ids.song as never,
      kind: 'stem',
      name: 'Bass.wav',
    });
    const stemMove = await refusal(
      updateAsset(contextFor(people.owner), assetId, { folder: 'Stems' }),
    );
    expect(stemMove.code).toBe('validation_failed');
    for (const [userId, workspaceId] of [
      [people.viewer, ids.workspace],
      [people.foreigner, ids.foreignWorkspace],
    ] as const) {
      const error = await refusal(
        updateAsset(contextFor(userId, workspaceId), assetId, { name: 'x' }),
      );
      expect(error.publicCode).toBe('not_found');
    }
  });

  it('trashes softly and restores', async () => {
    const { assetId } = await createAsset(contextFor(people.owner), {
      projectId: ids.project as never,
      kind: 'project_file',
      name: 'Old notes.txt',
    });
    await trashAsset(contextFor(people.owner), assetId, 30);
    const [trashed] = await db.select().from(assets).where(eq(assets.id, assetId));
    expect(trashed?.deletedAt).not.toBeNull();
    expect(trashed?.purgeAfter).not.toBeNull();
    const second = await refusal(trashAsset(contextFor(people.owner), assetId, 30));
    expect(second.publicCode).toBe('not_found');

    await restoreEntity(
      db,
      {
        workspaceId: ids.workspace as WorkspaceId,
        actor: memberSubject(people.owner as UserId),
        recoveryWindowDays: 30,
        newId: newUlid,
      },
      trashed?.deletedBatch as string,
    );
    const [restored] = await db.select().from(assets).where(eq(assets.id, assetId));
    expect(restored?.deletedAt).toBeNull();
  });

  it('shares one tag vocabulary across the workspace, never across workspaces', async () => {
    await createAsset(contextFor(people.owner), {
      songId: ids.otherSong as never,
      kind: 'project_file',
      name: 'Tail.logicx.zip',
      tags: ['LOGIC', 'bounce'],
    });
    const tags = await listTags(contextFor(people.viewer));
    expect(tags[0]?.toLowerCase()).toBe('logic');
    expect(tags.map((tag) => tag.toLowerCase())).toEqual(
      expect.arrayContaining(['logic', 'final', 'bounce']),
    );
    expect(tags.filter((tag) => tag.toLowerCase() === 'logic')).toHaveLength(1);
    expect(tags).not.toContain('secret-label');
    const foreign = await refusal(listTags(contextFor(people.foreigner, ids.workspace)));
    expect(foreign.publicCode).toBe('not_found');
  });

  it('lands a folder uploaded twice as two versions of one entry', async () => {
    const snapshot = async () => {
      const created = await createSnapshot(contextFor(people.owner), {
        projectId: ids.project as never,
        name: 'Night Drive Session',
        entries: [
          {
            path: 'a.wav',
            sizeBytes: 1,
            modifiedAt: null,
            checksumSha256: null,
            ignored: false,
            ignoreReason: null,
          },
        ],
      });
      const context = { ...contextFor(people.owner), driver };
      const session = await createUploadSession(context, {
        assetId: created.assetId as never,
        sizeBytes: 5 * 1024 * 1024,
        contentTypeHint: 'application/zip',
        filename: 'Night Drive Session.zip',
      });
      await completeUploadSession({ ...context, authz: createAuthorizer(db) }, session.id, {
        parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 5 * 1024 * 1024 }],
      });
      await finalizeSnapshot(contextFor(people.owner), created.snapshotId, session.id);
      return created.assetId;
    };
    const first = await snapshot();
    const second = await snapshot();
    expect(second).toBe(first);
    const versions = await db.select().from(assetVersions).where(eq(assetVersions.assetId, first));
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2]);
  });
});
