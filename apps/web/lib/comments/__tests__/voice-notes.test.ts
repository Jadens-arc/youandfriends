import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, AssetId, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  comments,
  derivatives,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { recordAssetVersion, trashAsset, updateAsset } from '@/lib/assets/service';
import type { LibraryContext } from '@/lib/library/context';
import { search } from '@/lib/search/service';
import { stubDriver } from '@/lib/uploads/__tests__/stub-driver';
import { completeUploadSession, createUploadSession, UploadError } from '@/lib/uploads/service';

import { createThread, deleteComment, listThreads, reply } from '../service';
import {
  createVoiceNoteAsset,
  VOICE_NOTE_MAX_BYTES,
  voiceNotePeaks,
  voiceNoteStream,
} from '../voice-notes';

vi.mock('server-only', () => ({}));

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING voice note tests: ${reason}`);

/**
 * Voice notes (task `093`) against a real database and the real resolver. The fixture holds what
 * makes each rule bite: a second commenter whose recording Sam must not attach, a recording on
 * another song, a foreign workspace with a recorded voice note of its own, a voice note already
 * on a comment, and one whose upload never finished.
 */
describeWithDatabase('voice notes', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let foreignWorkspace: string;
  const people = {} as Record<'owner' | 'sam' | 'alex' | 'viewer' | 'foreigner', string>;
  const ids = {} as Record<'song' | 'otherSong' | 'foreignSong' | 'foreignNote', string>;
  // The store answers as it would for a finished WebM recording — the bytes the sniffer sees
  // are a real EBML header, so finalize takes the path a browser's recording does.
  const RECORDING_BYTES = 200_000;
  const driver = stubDriver({
    parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: RECORDING_BYTES }],
    head_: {
      sizeBytes: RECORDING_BYTES,
      etag: 'etag-final',
      contentType: 'audio/webm',
      checksumSha256: undefined,
    },
    prefix_: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42]),
  });

  function contextFor(userId: string, workspace = workspaceId) {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      driver,
      derivativesDriver: () => driver,
    } satisfies LibraryContext & Record<string, unknown>;
  }

  async function refusal(promise: Promise<unknown>): Promise<AppError | UploadError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  const code = (error: AppError | UploadError) =>
    error instanceof UploadError ? error.code : error.publicCode;

  /** Upload a recording into a voice note, as the browser does: open, complete. */
  async function uploadInto(userId: string, assetId: string, workspace = workspaceId) {
    const context = contextFor(userId, workspace);
    const session = await createUploadSession(context, {
      assetId: assetId as AssetId,
      sizeBytes: RECORDING_BYTES,
      contentTypeHint: 'audio/webm',
      filename: 'Voice note.webm',
    });
    await completeUploadSession(context, session.id, {
      parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: RECORDING_BYTES }],
    });
    return session.id;
  }

  /**
   * A voice note by `userId` on `songId` whose recording has landed — through the same three
   * steps the browser takes: make the asset, upload, record the upload as its version.
   */
  async function recorded(userId: string, songId: string, workspace = workspaceId) {
    const { assetId } = await createVoiceNoteAsset(contextFor(userId, workspace), songId);
    const sessionId = await uploadInto(userId, assetId, workspace);
    const version = await recordAssetVersion(contextFor(userId, workspace), assetId, sessionId);
    return { assetId, versionId: version.assetVersionId };
  }

  /** What the media pipeline leaves: streaming and waveform derivatives, a measured duration. */
  async function processed(versionId: string, workspace = workspaceId) {
    await db
      .update(assetVersions)
      .set({ processingState: 'complete', durationMs: 4_200 })
      .where(eq(assetVersions.id, versionId));
    for (const kind of ['streaming_audio', 'waveform_peaks'] as const) {
      const object = await makeStorageObject(db, workspace, {
        contentType: kind === 'streaming_audio' ? 'audio/mp4' : 'application/octet-stream',
        sizeBytes: 8,
      });
      await db.insert(derivatives).values({
        id: testId(),
        workspaceId: workspace,
        assetVersionId: versionId,
        kind,
        storageObjectId: object.id,
        processingState: 'complete',
      });
    }
  }

  const voiceOnly = (voiceNoteAssetId: string) => ({
    anchor: { kind: 'general' as const },
    voiceNoteAssetId,
  });

  beforeAll(async () => {
    database = await createTestDatabase('voice_notes');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    for (const [person, role] of [
      ['sam', 'commenter'],
      ['alex', 'commenter'],
      ['viewer', 'viewer'],
    ] as const) {
      people[person] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[person], role);
    }
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.otherSong = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    const foreign = await makeTenant(db);
    foreignWorkspace = foreign.workspace.id;
    people.foreigner = foreign.user.id;
    const foreignProject = await makeProject(db, foreignWorkspace, 'Theirs');
    ids.foreignSong = (await makeSong(db, foreignWorkspace, foreignProject.id, 'Unreleased')).id;
    const foreignNote = await recorded(people.foreigner, ids.foreignSong, foreignWorkspace);
    ids.foreignNote = foreignNote.assetId;
    await processed(foreignNote.versionId, foreignWorkspace);
    await createThread(
      contextFor(people.foreigner, foreignWorkspace),
      ids.foreignSong,
      voiceOnly(ids.foreignNote),
    );
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('lets commenters make a voice note, and not viewers', async () => {
    const { assetId } = await createVoiceNoteAsset(contextFor(people.sam), ids.song);
    const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
    expect(row).toMatchObject({ kind: 'voice_note', songId: ids.song, createdBy: people.sam });
    expect(code(await refusal(createVoiceNoteAsset(contextFor(people.viewer), ids.song)))).toBe(
      'not_found',
    );
    expect(code(await refusal(createVoiceNoteAsset(contextFor(people.sam), ids.foreignSong)))).toBe(
      'not_found',
    );
  });

  it('takes one recording, from its maker only, under the size limit', async () => {
    const { assetId } = await createVoiceNoteAsset(contextFor(people.sam), ids.song);
    const upload = (userId: string, sizeBytes = 200_000) =>
      createUploadSession(contextFor(userId), {
        assetId: assetId as AssetId,
        sizeBytes,
        contentTypeHint: 'audio/webm',
        filename: 'Voice note.webm',
      });
    // Alex may comment on this song too — but it is not Alex's recording. Nor the owner's.
    expect((await refusal(upload(people.alex))) instanceof UploadError).toBe(true);
    expect(code(await refusal(upload(people.alex)))).toBe('not_found');
    expect(code(await refusal(upload(people.owner)))).toBe('not_found');
    expect(code(await refusal(upload(people.sam, VOICE_NOTE_MAX_BYTES + 1)))).toBe('size_exceeded');
    await upload(people.sam);
    expect(code(await refusal(upload(people.sam)))).toBe('invalid_state');
  });

  it('records the upload as the voice note’s version — for its maker, a commenter, only', async () => {
    const { assetId } = await createVoiceNoteAsset(contextFor(people.sam), ids.song);
    const sessionId = await uploadInto(people.sam, assetId);
    // The owner could edit the song; it is still not their recording to record.
    for (const who of [people.alex, people.owner, people.viewer]) {
      expect(code(await refusal(recordAssetVersion(contextFor(who), assetId, sessionId)))).toBe(
        'not_found',
      );
    }
    const version = await recordAssetVersion(contextFor(people.sam), assetId, sessionId);
    expect(version).toMatchObject({ assetId, versionNumber: 1, created: true });
  });

  it('is not a file: no renaming, re-tagging, trashing, or finding it in search', async () => {
    const { assetId } = await recorded(people.sam, ids.song);
    expect(code(await refusal(trashAsset(contextFor(people.owner), assetId, 30)))).toBe(
      'not_found',
    );
    expect(
      code(await refusal(updateAsset(contextFor(people.owner), assetId, { name: 'Renamed' }))),
    ).toBe('not_found');
    const results = await search(contextFor(people.owner), 'voice');
    expect(results.files.map((hit) => hit.id)).not.toContain(assetId);
  });

  it('refuses a second recording once one has landed', async () => {
    const { assetId } = await recorded(people.sam, ids.song);
    const error = await refusal(
      createUploadSession(contextFor(people.sam), {
        assetId: assetId as AssetId,
        sizeBytes: 1_000,
        contentTypeHint: 'audio/webm',
        filename: 'Voice note.webm',
      }),
    );
    expect(code(error)).toBe('invalid_state');
  });

  it('posts a voice note as a thread or a reply, and lists its state', async () => {
    const first = await recorded(people.sam, ids.song);
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.song,
      voiceOnly(first.assetId),
    );
    const second = await recorded(people.alex, ids.song);
    await processed(second.versionId);
    await reply(contextFor(people.alex), ids.song, threadId, {
      body: 'Hum it like this',
      voiceNoteAssetId: second.assetId,
    });
    const thread = (await listThreads(contextFor(people.viewer), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.comments.map((comment) => [comment.body, comment.voiceNote])).toEqual([
      ['', { assetId: first.assetId, durationMs: null, state: 'processing' }],
      ['Hum it like this', { assetId: second.assetId, durationMs: 4_200, state: 'ready' }],
    ]);
  });

  it('attaches only a finished recording of one’s own, on this song, once', async () => {
    const alexs = await recorded(people.alex, ids.song);
    const elsewhere = await recorded(people.sam, ids.otherSong);
    const { assetId: unrecorded } = await createVoiceNoteAsset(contextFor(people.sam), ids.song);
    const used = await recorded(people.sam, ids.song);
    await createThread(contextFor(people.sam), ids.song, voiceOnly(used.assetId));
    for (const assetId of [
      alexs.assetId,
      elsewhere.assetId,
      unrecorded,
      used.assetId,
      ids.foreignNote,
      testId(),
    ]) {
      const error = await refusal(
        createThread(contextFor(people.sam), ids.song, voiceOnly(assetId)),
      );
      expect(code(error), assetId).toBe('not_found');
    }
    // Neither words nor a voice note: nothing to post.
    const empty = await refusal(
      createThread(contextFor(people.sam), ids.song, { anchor: { kind: 'general' } }),
    );
    expect(code(empty)).toBe('validation_failed');
  });

  it('streams to anyone who can view the song, only once processed', async () => {
    const note = await recorded(people.sam, ids.song);
    await createThread(contextFor(people.sam), ids.song, voiceOnly(note.assetId));
    expect(
      code(await refusal(voiceNoteStream(contextFor(people.viewer), ids.song, note.assetId))),
    ).toBe('conflict');
    await processed(note.versionId);
    const stream = await voiceNoteStream(contextFor(people.viewer), ids.song, note.assetId);
    expect(stream.url).toMatch(/^https?:/);
    const peaks = await voiceNotePeaks(contextFor(people.viewer), ids.song, note.assetId);
    expect(peaks.byteLength).toBe(8);
  });

  it('never streams a voice note across songs, workspaces, or before it is posted', async () => {
    const unposted = await recorded(people.sam, ids.song);
    await processed(unposted.versionId);
    const posted = await recorded(people.sam, ids.song);
    await processed(posted.versionId);
    await createThread(contextFor(people.sam), ids.song, voiceOnly(posted.assetId));
    const attempts: [string, string, string][] = [
      [people.viewer, ids.song, unposted.assetId],
      [people.viewer, ids.otherSong, posted.assetId],
      [people.viewer, ids.song, ids.foreignNote],
      [people.viewer, ids.foreignSong, ids.foreignNote],
    ];
    for (const [who, songId, assetId] of attempts) {
      expect(code(await refusal(voiceNoteStream(contextFor(who), songId, assetId)))).toBe(
        'not_found',
      );
      expect(code(await refusal(voiceNotePeaks(contextFor(who), songId, assetId)))).toBe(
        'not_found',
      );
    }
  });

  it('deleting the comment takes its voice note with it: detached, trashed, unplayable', async () => {
    const note = await recorded(people.sam, ids.song);
    await processed(note.versionId);
    const { threadId, commentId } = await createThread(contextFor(people.sam), ids.song, {
      anchor: { kind: 'general' },
      body: 'Listen',
      voiceNoteAssetId: note.assetId,
    });
    await deleteComment(contextFor(people.sam), ids.song, threadId, commentId);
    const [row] = await db.select().from(comments).where(eq(comments.id, commentId));
    expect(row).toMatchObject({ body: '', voiceNoteAssetId: null });
    const [asset] = await db.select().from(assets).where(eq(assets.id, note.assetId));
    expect(asset?.deletedAt).not.toBeNull();
    expect(asset?.deletedBy).toBe(people.sam);
    expect(
      code(await refusal(voiceNoteStream(contextFor(people.viewer), ids.song, note.assetId))),
    ).toBe('not_found');
    const thread = (await listThreads(contextFor(people.viewer), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.comments[0]).toMatchObject({ deleted: true, voiceNote: null });
  });
});
