import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, ManifestEntry, UserId, WorkspaceId } from '@youandfriends/contracts';
import { assetVersions, snapshotEntries, snapshots, type DirectDatabase } from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeProject,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stubDriver } from '@/lib/uploads/__tests__/stub-driver';
import { completeUploadSession, createUploadSession } from '@/lib/uploads/service';
import type { VersionContext } from '@/lib/versions/service';

import { createSnapshot, finalizeSnapshot } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING folder snapshot tests: ${reason}`);

const FIVE_MIB = 5 * 1024 * 1024;

function entry(path: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    path,
    sizeBytes: 10,
    modifiedAt: '2026-09-01T00:00:00.000Z',
    checksumSha256: 'c'.repeat(64),
    ignored: false,
    ignoreReason: null,
    ...overrides,
  };
}

/**
 * Browser folder snapshots (task `054`), server side, against a real database.
 *
 * The client's path check is a courtesy; these tests post manifests the client would never build
 * — traversals, un-normalized paths, duplicates — to prove the server refuses them itself. And a
 * finalized snapshot is tried against the sealing triggers, not just assumed sealed.
 */
describeWithDatabase('folder snapshots', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const driver = stubDriver();
  const people = {} as Record<'owner' | 'commenter' | 'foreigner', string>;
  const ids = {} as Record<'workspace' | 'foreignWorkspace' | 'project' | 'foreignProject', string>;

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

  async function uploadInto(assetId: string) {
    const context = { ...contextFor(people.owner), driver };
    const session = await createUploadSession(context, {
      assetId: assetId as never,
      sizeBytes: FIVE_MIB,
      contentTypeHint: 'application/zip',
      filename: 'Session.zip',
    });
    await completeUploadSession({ ...context, authz: createAuthorizer(db) }, session.id, {
      parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: FIVE_MIB }],
    });
    return session.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase('folder_snapshots');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    people.commenter = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.commenter, 'commenter');
    ids.project = (await makeProject(db, ids.workspace, 'Night Drive')).id;

    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    ids.foreignProject = (await makeProject(db, foreign.workspace.id, 'Theirs')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('records the manifest, ignored entries with their reasons, and seals on finalize', async () => {
    const created = await createSnapshot(contextFor(people.owner), {
      projectId: ids.project as never,
      name: 'Night Drive Session',
      entries: [
        entry('Audio Files/Kick.wav'),
        entry('Audio Files/.DS_Store', {
          ignored: true,
          checksumSha256: null,
          ignoreReason: 'macOS folder settings, not part of the project.',
        }),
      ],
    });
    const rows = await db
      .select()
      .from(snapshotEntries)
      .where(eq(snapshotEntries.snapshotId, created.snapshotId));
    expect(rows.map((row) => [row.relativePath, row.ignored, row.ignoreReason]).sort()).toEqual([
      ['Audio Files/.DS_Store', true, 'macOS folder settings, not part of the project.'],
      ['Audio Files/Kick.wav', false, null],
    ]);

    const sessionId = await uploadInto(created.assetId);
    const sealed = await finalizeSnapshot(contextFor(people.owner), created.snapshotId, sessionId);
    expect(sealed).toEqual({ snapshotId: created.snapshotId, created: true });

    const [snapshot] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.id, created.snapshotId));
    expect(snapshot?.finalizedAt).not.toBeNull();
    expect(snapshot?.storageObjectId).not.toBeNull();
    const versions = await db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.assetId, created.assetId));
    expect(versions).toHaveLength(1);

    // Replayed: the same answer, no second version.
    const replay = await finalizeSnapshot(contextFor(people.owner), created.snapshotId, sessionId);
    expect(replay.created).toBe(false);
    expect(
      await db.select().from(assetVersions).where(eq(assetVersions.assetId, created.assetId)),
    ).toHaveLength(1);

    // Sealed, by the database, not by convention.
    await expect(
      db.update(snapshots).set({ name: 'Renamed' }).where(eq(snapshots.id, created.snapshotId)),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`update snapshot_entries set relative_path = 'x.wav' where snapshot_id = ${created.snapshotId}`,
      ),
    ).rejects.toThrow();
    await expect(
      db.delete(snapshotEntries).where(eq(snapshotEntries.snapshotId, created.snapshotId)),
    ).rejects.toThrow();
  });

  it('judges every path again, refusing what a bypassed client could send', async () => {
    for (const path of [
      '../escape.wav',
      '/abs/olute.wav',
      'a//b.wav',
      'Café.wav',
      '%2e%2e/x.wav',
      'a\\b.wav',
    ]) {
      const error = await refusal(
        createSnapshot(contextFor(people.owner), {
          projectId: ids.project as never,
          name: 'Bad',
          entries: [entry('ok.wav'), entry(path)],
        }),
      );
      expect(error.code).toBe('validation_failed');
      expect(error.fields?.[0]?.path).toBe('entries.1.path');
    }
    const duplicate = await refusal(
      createSnapshot(contextFor(people.owner), {
        projectId: ids.project as never,
        name: 'Dup',
        entries: [entry('a.wav'), entry('a.wav')],
      }),
    );
    expect(duplicate.code).toBe('validation_failed');
    // Nothing was written for any of them.
    const names = await db.select({ name: snapshots.name }).from(snapshots);
    expect(names.map((row) => row.name)).not.toContain('Bad');
  });

  it('refuses a non-editor and another workspace 404-shaped', async () => {
    for (const [userId, workspaceId, projectId] of [
      [people.commenter, ids.workspace, ids.project],
      [people.owner, ids.workspace, ids.foreignProject],
      [people.foreigner, ids.foreignWorkspace, ids.project],
    ] as const) {
      const error = await refusal(
        createSnapshot(contextFor(userId, workspaceId), {
          projectId: projectId as never,
          name: 'X',
          entries: [entry('a.wav')],
        }),
      );
      expect(error.publicCode).toBe('not_found');
    }
  });

  it('refuses to seal a snapshot with an upload that is not its own', async () => {
    const first = await createSnapshot(contextFor(people.owner), {
      projectId: ids.project as never,
      name: 'First',
      entries: [entry('a.wav')],
    });
    const second = await createSnapshot(contextFor(people.owner), {
      projectId: ids.project as never,
      name: 'Second',
      entries: [entry('b.wav')],
    });
    const secondsUpload = await uploadInto(second.assetId);
    const error = await refusal(
      finalizeSnapshot(contextFor(people.owner), first.snapshotId, secondsUpload),
    );
    expect(error.publicCode).toBe('not_found');

    const foreign = await refusal(
      finalizeSnapshot(
        contextFor(people.foreigner, ids.foreignWorkspace),
        second.snapshotId,
        secondsUpload,
      ),
    );
    expect(foreign.publicCode).toBe('not_found');
  });
});
