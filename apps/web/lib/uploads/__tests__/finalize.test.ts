import { createAuthorizer } from '@youandfriends/authz';
import { MAX_PARTS, newUlid, type WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  storageObjects,
  uploadSessions,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  createTestDatabase,
  makeAsset,
  makeProject,
  makeSong,
  makeTenant,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  signUploadParts,
  type UploadContext,
} from '../service';
import { stubDriver, type StubDriver } from './stub-driver';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING upload tests: ${reason}`);

/**
 * Finalize is the security-critical endpoint in this product, so every check it makes gets a
 * test that removes exactly one guarantee and watches it refuse.
 *
 * A finalize that trusts the client is an arbitrary-object-attachment vulnerability: point a
 * version at any key in the bucket and it is yours (`docs/THREAT_MODEL.md` T4).
 */
describeWithDatabase('finishing an upload', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('uploads');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function scenario(
    driver: StubDriver = stubDriver(),
    /** Extra fields on the creation request. `expectedChecksumSha256` is the one that matters:
     *  without it the session row holds `null` and finalize's checksum comparison is
     *  unreachable — which is exactly how it went untested (CLAUDE.md §13). */
    creation: Partial<Parameters<typeof createUploadSession>[1]> = {},
  ) {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `P ${newUlid()}`, null);
    const song = await makeSong(db, workspace.id, project.id, 'Track');
    const asset = await makeAsset(db, workspace.id, { songId: song.id });

    const context: UploadContext = {
      db,
      driver,
      authz: createAuthorizer(db),
      workspaceId: workspace.id as WorkspaceId,
      subject: { kind: 'member', userId: user.id as never },
      userId: user.id,
    };

    const session = await createUploadSession(context, {
      assetId: asset.id as never,
      sizeBytes: 5 * 1024 * 1024,
      contentTypeHint: 'audio/wav',
      filename: 'Blue Hour.wav',
      ...creation,
    });

    return { context, driver, session, asset, user, workspace };
  }

  /**
   * The same caller, one HTTP request later.
   *
   * An upload spans several requests — create, sign, sign, finalize — and each gets its own
   * authorizer, because the authorizer memoizes for its lifetime and says so at
   * `packages/authz/src/authorizer.ts`: "Create one per request and throw it away."
   *
   * A test that reuses one instance across those requests is not testing the re-check; it is
   * reading the creation-time answer back out of a cache. That is what made the revocation
   * tests below pass against a `completeUploadSession` with its authorization check deleted.
   */
  function nextRequest(context: UploadContext): UploadContext {
    return { ...context, authz: createAuthorizer(db) };
  }

  /** Revoke this user's access to the workspace, as an admin removing a collaborator would. */
  async function revokeMembership(userId: string, workspaceId: string) {
    await db
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.workspaceId, workspaceId),
        ),
      );
  }

  const goodParts = { parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 5 * 1024 * 1024 }] };

  it('creates a version when everything checks out', async () => {
    const { context, session } = await scenario();
    const result = await completeUploadSession(context, session.id, goodParts);

    expect(result.created).toBe(true);
    expect(result.sizeBytes).toBe(5 * 1024 * 1024);
  }, 60_000);

  it('never lets the client choose the destination', async () => {
    // The key is minted by the server and read from the session row at every later step. The
    // request schema has no field for it, so this asserts the key that was actually used.
    const { context, session, driver } = await scenario();
    await signUploadParts(context, session.id, [1]);

    const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, session.id));
    expect(driver.signed[0]?.key).toBe(row?.objectKey);
    expect(row?.objectKey).toMatch(/^w\/[0-9A-Z]{26}\/o\/[0-9A-Z]{26}$/);
  }, 60_000);

  it('is idempotent: a replay returns the first answer and creates nothing', async () => {
    const { context, session } = await scenario();
    const first = await completeUploadSession(context, session.id, goodParts);
    const second = await completeUploadSession(context, session.id, goodParts);

    expect(second.created).toBe(false);
    expect(second.storageObjectId).toBe(first.storageObjectId);
  }, 60_000);

  it('refuses a part the store never saw', async () => {
    // The client's list is the thing being checked, never the authority.
    const driver = stubDriver();
    driver.parts = [];
    const { context, session } = await scenario(driver);

    await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow(
      /never uploaded/,
    );
  }, 60_000);

  it('refuses a part whose ETag does not match what was stored', async () => {
    const driver = stubDriver();
    driver.parts = [{ partNumber: 1, etag: 'somebody-elses-etag', sizeBytes: 5 * 1024 * 1024 }];
    const { context, session } = await scenario(driver);

    await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow(
      /does not match what was stored/,
    );
  }, 60_000);

  it('refuses when the object is not in the bucket afterwards', async () => {
    const driver = stubDriver();
    driver.head_ = null;
    const { context, session } = await scenario(driver);

    await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow(
      /not in the bucket/,
    );
  }, 60_000);

  it('refuses a stored object larger than the ceiling', async () => {
    // The client under-declared to get a small ceiling, then uploaded more. The recorded size
    // is the store's, not the client's arithmetic.
    const driver = stubDriver();
    driver.head_ = {
      sizeBytes: 900 * 1024 * 1024,
      etag: 'e',
      contentType: 'audio/wav',
      checksumSha256: undefined,
    };
    const { context, session } = await scenario(driver);

    await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow(
      /stored object is .* against a ceiling/,
    );
  }, 60_000);

  it('refuses claimed parts totalling more than the ceiling', async () => {
    const { context, session } = await scenario();
    await expect(
      completeUploadSession(context, session.id, {
        parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 900 * 1024 * 1024 }],
      }),
    ).rejects.toThrow(/against a ceiling/);
  }, 60_000);

  it('refuses a finalize from someone who is not the session owner', async () => {
    // A session id is not a bearer token: it can be guessed, logged, or forwarded.
    const { context, session } = await scenario();
    const stranger = await makeTenant(db);

    await expect(
      completeUploadSession({ ...context, userId: stranger.user.id }, session.id, goodParts),
    ).rejects.toThrow(/no upload session/);
  }, 60_000);

  it('refuses a session from another workspace', async () => {
    const { session } = await scenario();
    const other = await scenario();

    // Same session id, asked for through the other tenant's context.
    await expect(completeUploadSession(other.context, session.id, goodParts)).rejects.toThrow(
      /no upload session/,
    );
  }, 60_000);

  it('refuses an expired session', async () => {
    const { context, session } = await scenario();
    await db
      .update(uploadSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(uploadSessions.id, session.id));

    await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow(/expired/);
  }, 60_000);

  it('refuses to open a session against an asset the subject may only view', async () => {
    // Creating the session is the *first* authorization check, and it had no test at all: a
    // mutation that deleted it outright left all 158 tests green. It was found by removing the
    // check in the shared helper and noticing the wrong thing broke.
    //
    // A downgrade rather than a removal, deliberately. Deleting the membership proves only that
    // a stranger is refused; leaving a `viewer` membership in place proves the check reads the
    // *role*, which is the question an upload actually turns on — a viewer can see the song
    // this asset hangs off, and must still not be able to put bytes on it.
    const { context, asset, user, workspace } = await scenario();

    await db
      .update(workspaceMemberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(workspaceMemberships.userId, user.id),
          eq(workspaceMemberships.workspaceId, workspace.id),
        ),
      );

    await expect(
      createUploadSession(nextRequest(context), {
        assetId: asset.id as never,
        sizeBytes: 5 * 1024 * 1024,
        contentTypeHint: 'audio/wav',
        filename: 'Blue Hour.wav',
      }),
    ).rejects.toThrow();
  }, 60_000);

  it('refuses to open a session against an asset in another workspace', async () => {
    // T1. The foreign side is fully populated — workspace, project, song, asset — because an
    // empty one proves nothing: with no asset to find, a missing tenant filter looks identical
    // to a working one. That is the mistake task `026` shipped (CLAUDE.md §13).
    //
    // Removing the `workspaceId` predicate from the guard's lookup leaves this the only test
    // between a subject and an asset in someone else's workspace.
    const { context, driver } = await scenario();
    const openedBefore = driver.created.length;

    const foreign = await makeTenant(db);
    const foreignProject = await makeProject(db, foreign.workspace.id, `P ${newUlid()}`, null);
    const foreignSong = await makeSong(db, foreign.workspace.id, foreignProject.id, 'Theirs');
    const foreignAsset = await makeAsset(db, foreign.workspace.id, { songId: foreignSong.id });

    await expect(
      createUploadSession(context, {
        assetId: foreignAsset.id as never,
        sizeBytes: 5 * 1024 * 1024,
        contentTypeHint: 'audio/wav',
        filename: 'Theirs.wav',
      }),
      // 404-shaped, never 403: a forbidden answer would confirm the asset exists.
    ).rejects.toThrow(/no asset/);

    // And no multipart upload was opened against their workspace on the way to refusing.
    expect(driver.created).toHaveLength(openedBefore);
  }, 60_000);

  it('re-checks authorization, so a permission revoked mid-upload fails the finalize', async () => {
    // The check that matters is the one at the moment the version is created, not the one at
    // session creation minutes earlier.
    //
    // **The asset must still exist for this to test anything.** The first version of this test
    // deleted it, which made finalize fail on the asset lookup — so it passed identically with
    // the authorization re-check removed entirely. Mutation testing is what found that, in the
    // most security-critical function in the product. What is revoked here is the membership,
    // leaving everything else in place.
    const { context, session, user, workspace } = await scenario();
    await revokeMembership(user.id, workspace.id);

    await expect(
      completeUploadSession(nextRequest(context), session.id, goodParts),
    ).rejects.toThrow();

    // And nothing was created on the way to refusing.
    const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, session.id));
    expect(row?.state).toBe('pending');
    expect(row?.storageObjectId).toBeNull();
  }, 60_000);

  it('re-checks authorization at part signing too', async () => {
    // Signing is where the bearer credentials are handed out. A revoked permission that still
    // yields signed URLs is a window someone can keep uploading through.
    const { context, session, user, workspace } = await scenario();
    await revokeMembership(user.id, workspace.id);

    await expect(signUploadParts(nextRequest(context), session.id, [1])).rejects.toThrow();
  }, 60_000);

  it('refuses to sign more parts than a single request may ask for', async () => {
    // `signPartsSchema` bounds a batch at 100 and each number at `MAX_PARTS`, but nothing applied
    // it: this was the one entry point taking its input raw, so the bound lived only in the
    // schema's own unit test. One request could have minted 50,000 write credentials.
    const { context, session, driver } = await scenario();
    const tooMany = Array.from({ length: 101 }, (_, index) => index + 1);

    await expect(signUploadParts(context, session.id, tooMany)).rejects.toThrow();

    // And nothing was signed on the way to refusing — the parse happens before the driver.
    expect(driver.signed).toHaveLength(0);
  }, 60_000);

  it('refuses a part number that is not a positive integer within the cap', async () => {
    const { context, session } = await scenario();

    await expect(signUploadParts(context, session.id, [0])).rejects.toThrow();
    await expect(signUploadParts(context, session.id, [-1])).rejects.toThrow();
    await expect(signUploadParts(context, session.id, [1.5])).rejects.toThrow();
    await expect(signUploadParts(context, session.id, [MAX_PARTS + 1])).rejects.toThrow();
  }, 60_000);

  it('refuses to replay a finished upload for someone whose access was revoked', async () => {
    // The replay branch returns early, so it used to reach a read having consulted no authorizer
    // at all — the only path in the module that did. The metadata it hands back is the caller's
    // own upload, so the leak is small, but a permission change has to take effect on the next
    // request (T2) and "next request" includes this one.
    const { context, session, user, workspace } = await scenario();

    const first = await completeUploadSession(context, session.id, goodParts);
    expect(first.created).toBe(true);

    await revokeMembership(user.id, workspace.id);

    await expect(
      completeUploadSession(nextRequest(context), session.id, goodParts),
    ).rejects.toThrow();
  }, 60_000);

  it('refuses a replay presented under a workspace the session does not belong to', async () => {
    // The idempotent branch returns the stored object's id, size and checksum **without**
    // re-checking authorization — deliberately, because the point of a cache hit is not to redo
    // the work. That makes the workspace predicate on its session lookup the only thing between
    // a caller and another workspace's storage object, and nothing tested it: removing
    // `eq(uploadSessions.workspaceId, context.workspaceId)` left all 168 tests green.
    //
    // The existing `refuses a session from another workspace` case cannot catch it. It builds
    // two independent tenants, so the *owner* differs too, and the owner check refuses first —
    // the workspace filter is never the thing being tested. The row that makes this bite is one
    // user who legitimately belongs to both workspaces, replaying a completed session from the
    // first while presenting the second (CLAUDE.md §13).
    const { context, session, user } = await scenario();

    // A genuine completed session, so the replay branch is the one that runs.
    const first = await completeUploadSession(context, session.id, goodParts);
    expect(first.created).toBe(true);

    // The same person, in a second workspace they really are a member of.
    const second = await makeTenant(db);
    await db.insert(workspaceMemberships).values({
      id: newUlid(),
      workspaceId: second.workspace.id,
      userId: user.id,
      role: 'editor',
    });

    const elsewhere: UploadContext = {
      ...context,
      authz: createAuthorizer(db),
      workspaceId: second.workspace.id as WorkspaceId,
    };

    // 404-shaped: the session is not theirs to replay, and the refusal says nothing more.
    await expect(completeUploadSession(elsewhere, session.id, goodParts)).rejects.toThrow(
      /no upload session/,
    );
  }, 60_000);

  describe('the declared checksum', () => {
    // A client that computed a SHA-256 before uploading is asserting which bytes it meant to
    // send. Finalize compares that with what the store actually holds, so a truncated or
    // corrupted upload is refused rather than recorded as a version of someone's master.
    //
    // **None of this was covered.** Every `scenario()` omitted `expectedChecksumSha256`, so the
    // session row always held `null` and all three guards were unreachable: the whole comparison
    // could be deleted and 168 tests still passed. Found in review, and it is the same mistake
    // as the two authorization tests above in a third guise — not an empty fixture this time,
    // but a fixture that never sets the one field that makes the rule fire.
    const digest = 'a'.repeat(64);

    it('refuses when the stored object does not match what the client declared', async () => {
      const driver = stubDriver();
      driver.head_ = { ...driver.head_!, checksumSha256: 'b'.repeat(64) };

      const { context, session } = await scenario(driver, { expectedChecksumSha256: digest });

      await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow(
        /checksum/,
      );

      // And nothing was recorded on the way to refusing.
      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, session.id));
      expect(row?.state).toBe('pending');
      expect(row?.storageObjectId).toBeNull();
    });

    it('accepts a matching checksum', async () => {
      // The other half: the guard must not refuse a good upload, or it is just an outage.
      const driver = stubDriver();
      driver.head_ = { ...driver.head_!, checksumSha256: digest };

      const { context, session } = await scenario(driver, { expectedChecksumSha256: digest });
      const result = await completeUploadSession(context, session.id, goodParts);

      expect(result.created).toBe(true);
      expect(result.checksumSha256).toBe(digest);
    });

    it('does not refuse when the store reports no checksum of its own', async () => {
      // R2 only returns a checksum when the upload supplied one per part. A client that declared
      // a digest against a store that cannot confirm it must not have its upload rejected —
      // there is nothing to disagree with.
      const driver = stubDriver();
      driver.head_ = { ...driver.head_!, checksumSha256: undefined };

      const { context, session } = await scenario(driver, { expectedChecksumSha256: digest });
      await expect(completeUploadSession(context, session.id, goodParts)).resolves.toMatchObject({
        created: true,
      });
    });
  });

  describe('content typing', () => {
    it('records what the bytes are, not what the client said they were', async () => {
      // The session is opened claiming `audio/wav`; a ZIP arrives. Storing the claim would let
      // a caller pick the content type of an object we later hand back under a presigned URL.
      //
      // This is the case that exposed the original bug: finalize read `head.contentType`, which
      // R2 returns because `createMultipart` *set* it from the client's hint. The claim was
      // validating itself and the test that "verified content typing" would have passed.
      const driver = stubDriver();
      driver.prefix_ = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // PK\x03\x04
      driver.head_ = { ...driver.head_!, contentType: 'audio/wav' };

      const { context, session } = await scenario(driver);
      const result = await completeUploadSession(context, session.id, goodParts);

      expect(result.contentType).toBe('application/zip');

      const [object] = await db
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, result.storageObjectId));
      expect(object?.contentType).toBe('application/zip');
    });

    it('stores an unrecognized file as an opaque download', async () => {
      const driver = stubDriver();
      driver.prefix_ = new TextEncoder().encode('<!DOCTYPE html><html><script>');
      driver.head_ = { ...driver.head_!, contentType: 'image/svg+xml' };

      const { context, session } = await scenario(driver);
      const result = await completeUploadSession(context, session.id, goodParts);

      // Not `text/html`, and emphatically not the `image/svg+xml` the store was told.
      expect(result.contentType).toBe('application/octet-stream');
    });

    it('never mints the object with the content type the client claimed', async () => {
      // Whatever `createMultipart` is given becomes the stored object's own `Content-Type`, and
      // that is the header R2 serves the bytes back with. Sniffing at finalize fixes the recorded
      // column but cannot reach the object's metadata — so passing the hint here would let an
      // uploader choose `text/html` for a file we later hand back under a presigned URL, on the
      // bucket's origin, no matter what the database says (T3, T4).
      //
      // Found in security review. Every content-typing test passed with the hint being minted,
      // because they all read the column.
      const driver = stubDriver();
      await scenario(driver, { contentTypeHint: 'text/html' });

      expect(driver.createdContentTypes).toEqual(['application/octet-stream']);
      expect(driver.createdContentTypes).not.toContain('text/html');
    });

    it('reads only a prefix, never the whole object', async () => {
      // A master is gigabytes. Pulling one into a serverless function to look at 16 bytes would
      // work in every test and fall over on the first real upload.
      const driver = stubDriver();
      const { context, session } = await scenario(driver);
      await completeUploadSession(context, session.id, goodParts);

      // Read from the database, not from the session response: the response has no key in it,
      // deliberately — the client is never told where its bytes are going.
      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, session.id));
      expect(driver.prefixReads).toEqual([{ key: row?.objectKey, length: 64 }]);
    });
  });

  describe('the audit trail', () => {
    async function eventsFor(workspaceId: string) {
      return db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspaceId))
        .orderBy(auditEvents.occurredAt);
    }

    it('records the start and the completion of an upload', async () => {
      const { context, session, asset, workspace, user } = await scenario();
      await completeUploadSession(context, session.id, goodParts);

      const events = await eventsFor(workspace.id);
      expect(events.map((event) => event.action)).toEqual(['upload.started', 'upload.completed']);

      for (const event of events) {
        expect(event.actorId).toBe(user.id);
        expect(event.targetType).toBe('asset');
        expect(event.targetId).toBe(asset.id);
      }

      expect(events[1]?.metadata).toMatchObject({
        sessionId: session.id,
        sizeBytes: 5 * 1024 * 1024,
        contentType: 'audio/wav',
      });
    });

    it('never writes an object key into the log', async () => {
      // A key is the addressable location of someone's master, and the audit log is the one
      // table designed never to be edited — a key that lands here is there for good (T3).
      const { context, session, workspace } = await scenario();
      await completeUploadSession(context, session.id, goodParts);

      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, session.id));
      const objectKey = row?.objectKey ?? '';
      expect(objectKey).not.toBe('');

      const serialized = JSON.stringify(await eventsFor(workspace.id));
      expect(serialized).not.toContain(objectKey);
      expect(serialized).not.toContain('upload-1'); // the multipart upload id
    });

    it('records that the client misnamed the file', async () => {
      const driver = stubDriver();
      driver.prefix_ = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
      const { context, session, workspace } = await scenario(driver);
      await completeUploadSession(context, session.id, goodParts);

      const events = await eventsFor(workspace.id);
      expect(events[1]?.metadata).toMatchObject({
        contentType: 'application/zip',
        claimedContentType: 'audio/wav',
      });
    });

    it('writes no event for a finalize that refused', async () => {
      // The event and the rows it describes share a transaction, so a log entry cannot outlive
      // the thing it claims happened.
      const driver = stubDriver();
      driver.head_ = null; // the object is not in the bucket
      const { context, session, workspace } = await scenario(driver);

      await expect(completeUploadSession(context, session.id, goodParts)).rejects.toThrow();

      const events = await eventsFor(workspace.id);
      expect(events.map((event) => event.action)).toEqual(['upload.started']);
    });

    it('records an abort', async () => {
      const { context, session, workspace } = await scenario();
      await abortUploadSession(context, session.id);

      const events = await eventsFor(workspace.id);
      expect(events.map((event) => event.action)).toEqual(['upload.started', 'upload.aborted']);
    });
  });

  it('aborts the multipart upload when a session is abandoned', async () => {
    // Otherwise the parts stay in the bucket, billed, referenced by nothing, and invisible to a
    // default listing (docs/OPERATIONS.md §2).
    const { context, session, driver } = await scenario();
    await abortUploadSession(context, session.id);

    const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, session.id));
    expect(row?.state).toBe('aborted');
    expect(driver.aborted).toHaveLength(1);
  }, 60_000);

  it('refuses to act on a session that is already finished', async () => {
    const { context, session } = await scenario();
    await abortUploadSession(context, session.id);

    await expect(signUploadParts(context, session.id, [1])).rejects.toThrow(/aborted/);
  }, 60_000);
});
