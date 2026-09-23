import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  auditEvents,
  mixVersions,
  permissionGrants,
  songs,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAsset,
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

import { stubDriver, type StubDriver } from '@/lib/uploads/__tests__/stub-driver';
import { completeUploadSession, createUploadSession } from '@/lib/uploads/service';

import {
  prepareMixUpload,
  recordMixVersion,
  recordUploadedVersion,
  setCurrentVersion,
  updateVersionNote,
  versionDownloadUrl,
  type VersionContext,
} from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING version stack tests: ${reason}`);

const FIVE_MIB = 5 * 1024 * 1024;

/**
 * The mix version stack (task `056`), through the real upload service, a real database, and the
 * real `authz`.
 *
 * The fixture has a row on the far side of each rule (CLAUDE.md §13): a second song whose mix
 * asset a session could be pointed at, a stem upload that must not become a mix, a commenter who
 * uploaded a version while an editor (so the "uploader may edit their note" rule has someone to
 * apply to), a commenter who did not, a viewer without `can_download`, and a populated foreign
 * tenant.
 */
describeWithDatabase('the mix version stack', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let driver: StubDriver;

  const people = {} as Record<'owner' | 'uploader' | 'commenter' | 'viewer' | 'foreigner', string>;
  const ids = {} as Record<
    'workspace' | 'foreignWorkspace' | 'song' | 'otherSong' | 'foreignSong',
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

  /** Upload one file into an asset, as a person, through the real session protocol. */
  async function upload(userId: string, assetId: string, filename = 'Mix.wav') {
    const context = { ...contextFor(userId), driver };
    const session = await createUploadSession(context, {
      assetId: assetId as never,
      sizeBytes: FIVE_MIB,
      contentTypeHint: 'audio/wav',
      filename,
    });
    await completeUploadSession({ ...context, authz: createAuthorizer(db) }, session.id, {
      parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: FIVE_MIB }],
    });
    return session.id;
  }

  async function newMix(userId: string, songId = ids.song, filename = 'Mix.wav', note?: string) {
    const { assetId } = await prepareMixUpload(contextFor(userId), songId);
    const sessionId = await upload(userId, assetId, filename);
    return recordMixVersion(contextFor(userId), songId, {
      sessionId: sessionId as never,
      ...(note === undefined ? {} : { note }),
    });
  }

  async function currentOf(songId: string) {
    const [row] = await db
      .select({ current: songs.currentVersionId })
      .from(songs)
      .where(eq(songs.id, songId));
    return row?.current ?? null;
  }

  beforeAll(async () => {
    database = await createTestDatabase('version_stack');
    db = database.db;
    driver = stubDriver();

    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    people.uploader = (await makeUser(db)).id;
    people.commenter = (await makeUser(db)).id;
    people.viewer = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.uploader, 'editor');
    await addMember(db, ids.workspace, people.commenter, 'commenter');
    await addMember(db, ids.workspace, people.viewer, 'viewer');
    // Download is independent of role (`docs/DESIGN.md` §3): this viewer is explicitly without it.
    await db
      .update(workspaceMemberships)
      .set({ canDownload: false })
      .where(eq(workspaceMemberships.userId, people.viewer));

    const project = await makeProject(db, ids.workspace, 'Night Drive');
    ids.song = (await makeSong(db, ids.workspace, project.id, 'Headlights')).id;
    ids.otherSong = (await makeSong(db, ids.workspace, project.id, 'Tail Lights')).id;

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

  it('creates one mix asset per song, however often an upload is prepared', async () => {
    const first = await prepareMixUpload(contextFor(people.owner), ids.song);
    const second = await prepareMixUpload(contextFor(people.uploader), ids.song);
    expect(second.assetId).toBe(first.assetId);
    const other = await prepareMixUpload(contextFor(people.owner), ids.otherSong);
    expect(other.assetId).not.toBe(first.assetId);
  });

  it('refuses to prepare an upload for anyone below editor, or across workspaces', async () => {
    for (const [userId, workspaceId, songId] of [
      [people.commenter, ids.workspace, ids.song],
      [people.viewer, ids.workspace, ids.song],
      [people.owner, ids.workspace, ids.foreignSong],
      [people.foreigner, ids.foreignWorkspace, ids.song],
    ] as const) {
      const error = await refusal(prepareMixUpload(contextFor(userId, workspaceId), songId));
      expect(error.publicCode).toBe('not_found');
    }
  });

  it('records each upload as an immutable version that becomes current, numbered in order', async () => {
    const v1 = await newMix(people.owner, ids.song, 'Headlights v1.wav', 'First bounce');
    expect(v1).toMatchObject({ mixVersionNumber: 1, versionNumber: 1, created: true });
    expect(await currentOf(ids.song)).toBe(v1.mixVersionId);

    const v2 = await newMix(people.uploader, ids.song, 'Headlights v2.wav');
    expect(v2).toMatchObject({ mixVersionNumber: 2, versionNumber: 2, created: true });
    expect(await currentOf(ids.song)).toBe(v2.mixVersionId);

    const [row] = await db
      .select({ name: assetVersions.originalFilename, by: assetVersions.uploadedBy })
      .from(assetVersions)
      .where(eq(assetVersions.id, v2.assetVersionId));
    expect(row).toEqual({ name: 'Headlights v2.wav', by: people.uploader });

    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.workspaceId, ids.workspace), eq(auditEvents.action, 'version.created')),
      );
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent: a replayed record returns the same version and creates nothing', async () => {
    const { assetId } = await prepareMixUpload(contextFor(people.owner), ids.song);
    const sessionId = await upload(people.owner, assetId);
    const first = await recordMixVersion(contextFor(people.owner), ids.song, {
      sessionId: sessionId as never,
    });
    const before = await db.select().from(mixVersions).where(eq(mixVersions.songId, ids.song));
    const replay = await recordMixVersion(contextFor(people.owner), ids.song, {
      sessionId: sessionId as never,
    });
    const after = await db.select().from(mixVersions).where(eq(mixVersions.songId, ids.song));

    expect(replay).toMatchObject({
      created: false,
      mixVersionId: first.mixVersionId,
      assetVersionId: first.assetVersionId,
    });
    expect(after).toHaveLength(before.length);
  });

  it('numbers concurrent uploads distinctly rather than colliding', async () => {
    const { assetId } = await prepareMixUpload(contextFor(people.owner), ids.otherSong);
    const sessions = await Promise.all([
      upload(people.owner, assetId, 'a.wav'),
      upload(people.owner, assetId, 'b.wav'),
      upload(people.owner, assetId, 'c.wav'),
    ]);
    const recorded = await Promise.all(
      sessions.map((sessionId) =>
        recordMixVersion(contextFor(people.owner), ids.otherSong, {
          sessionId: sessionId as never,
        }),
      ),
    );
    expect(recorded.map((version) => version.mixVersionNumber).sort()).toEqual([1, 2, 3]);
  });

  it('refuses to record a stem upload, or another song’s mix, as this song’s version', async () => {
    const stem = await makeAsset(db, ids.workspace, { songId: ids.song }, { kind: 'stem' });
    const stemSession = await upload(people.owner, stem.id);
    const asMix = await refusal(
      recordMixVersion(contextFor(people.owner), ids.song, { sessionId: stemSession as never }),
    );
    expect(asMix.publicCode).toBe('not_found');
    // As a version of its own asset it is fine.
    const asStem = await recordUploadedVersion(contextFor(people.owner), stemSession);
    expect(asStem).toMatchObject({ assetId: stem.id, versionNumber: 1, created: true });

    const { assetId } = await prepareMixUpload(contextFor(people.owner), ids.otherSong);
    const otherSession = await upload(people.owner, assetId);
    const wrongSong = await refusal(
      recordMixVersion(contextFor(people.owner), ids.song, { sessionId: otherSession as never }),
    );
    expect(wrongSong.publicCode).toBe('not_found');
  });

  it('refuses to record someone else’s finished upload', async () => {
    const { assetId } = await prepareMixUpload(contextFor(people.owner), ids.song);
    const ownersSession = await upload(people.owner, assetId);
    const error = await refusal(
      recordMixVersion(contextFor(people.uploader), ids.song, {
        sessionId: ownersSession as never,
      }),
    );
    expect(error.publicCode).toBe('not_found');
  });

  it('makes an earlier version current by moving the pointer, deleting nothing', async () => {
    const versions = await db
      .select({ id: mixVersions.id, number: mixVersions.versionNumber })
      .from(mixVersions)
      .where(eq(mixVersions.songId, ids.song));
    const first = versions.find((version) => version.number === 1);
    await setCurrentVersion(contextFor(people.owner), ids.song, first?.id as string);
    expect(await currentOf(ids.song)).toBe(first?.id);
    const after = await db.select().from(mixVersions).where(eq(mixVersions.songId, ids.song));
    expect(after).toHaveLength(versions.length);

    // Another song's version id is not this song's to point at.
    const [foreignToSong] = await db
      .select({ id: mixVersions.id })
      .from(mixVersions)
      .where(eq(mixVersions.songId, ids.otherSong));
    const error = await refusal(
      setCurrentVersion(contextFor(people.owner), ids.song, foreignToSong?.id as string),
    );
    expect(error.publicCode).toBe('not_found');
    const byCommenter = await refusal(
      setCurrentVersion(contextFor(people.commenter), ids.song, first?.id as string),
    );
    expect(byCommenter.publicCode).toBe('not_found');
  });

  it('lets editors, and the uploader while they can comment, edit a version’s note', async () => {
    const [byUploader] = await db
      .select({ id: mixVersions.id })
      .from(mixVersions)
      .where(and(eq(mixVersions.songId, ids.song), eq(mixVersions.uploadedBy, people.uploader)));
    const versionId = byUploader?.id as string;

    // The uploader is demoted to commenter: still their note to edit.
    await db
      .update(workspaceMemberships)
      .set({ role: 'commenter' })
      .where(eq(workspaceMemberships.userId, people.uploader));
    await updateVersionNote(contextFor(people.uploader), ids.song, versionId, {
      note: 'Vocal up 1 dB',
    });
    // A commenter who did not upload it may not.
    const error = await refusal(
      updateVersionNote(contextFor(people.commenter), ids.song, versionId, { note: 'nope' }),
    );
    expect(error.publicCode).toBe('not_found');
    // An editor may, and an empty note clears it.
    await updateVersionNote(contextFor(people.owner), ids.song, versionId, { note: '  ' });
    const [row] = await db
      .select({ note: mixVersions.note })
      .from(mixVersions)
      .where(eq(mixVersions.id, versionId));
    expect(row?.note).toBeNull();

    // Denied on the song outright: not even their own upload's note.
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: ids.workspace,
      scopeType: 'song',
      scopeId: ids.song,
      subjectKind: 'member',
      subjectId: people.uploader,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    const denied = await refusal(
      updateVersionNote(contextFor(people.uploader), ids.song, versionId, { note: 'x' }),
    );
    expect(denied.publicCode).toBe('not_found');
  });

  it('signs a download of the untouched original only with can_download, and audits it', async () => {
    const [version] = await db
      .select({ id: mixVersions.id })
      .from(mixVersions)
      .where(and(eq(mixVersions.songId, ids.song), eq(mixVersions.versionNumber, 1)));
    const versionId = version?.id as string;
    const signedBefore = driver.signedDownloads.length;

    const url = await versionDownloadUrl(
      { ...contextFor(people.owner), driver },
      ids.song,
      versionId,
    );
    expect(url).toMatch(/^https:/);
    expect(driver.signedDownloads.at(-1)?.filename).toBe('Headlights v1.wav');
    expect(driver.signedDownloads.length).toBe(signedBefore + 1);

    const events = await db
      .select({ targetId: auditEvents.targetId, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'version.downloaded'));
    expect(events.map((event) => event.targetId)).toContain(versionId);
    // The bearer URL never reaches the durable record.
    expect(JSON.stringify(events)).not.toContain(url);

    // Viewer role, no download capability.
    const error = await refusal(
      versionDownloadUrl({ ...contextFor(people.viewer), driver }, ids.song, versionId),
    );
    expect(error.publicCode).toBe('not_found');
    expect(driver.signedDownloads.length).toBe(signedBefore + 1);

    const foreign = await refusal(
      versionDownloadUrl(
        { ...contextFor(people.foreigner, ids.foreignWorkspace), driver },
        ids.song,
        versionId,
      ),
    );
    expect(foreign.publicCode).toBe('not_found');
  });

  it('never alters a version’s bytes: the stored identity is immutable', async () => {
    const [version] = await db.select().from(assetVersions).limit(1);
    await expect(
      db
        .update(assetVersions)
        .set({ storageObjectId: testId() })
        .where(eq(assetVersions.id, version?.id as string)),
    ).rejects.toThrow();
    // The asset list is untouched by all of the above: one mix asset per song.
    const mixAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.songId, ids.song), eq(assets.kind, 'mix')));
    expect(mixAssets).toHaveLength(1);
  });
});
