import {
  completeUploadSchema,
  createUploadSchema,
  MAX_PARTS,
  partCountFor,
  partSizeFor,
  signPartsSchema,
  newUlid,
  type CompleteUploadRequest,
  type CreateUploadRequest,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  withAuditedTransaction,
  type AuditContext,
  type Authorizer,
  type Subject,
} from '@youandfriends/authz';
import {
  assets,
  markStorageUsageStale,
  storageObjects,
  uploadParts,
  uploadSessions,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  hintDisagrees,
  sniffContentType,
  SNIFF_PREFIX_BYTES,
  UNKNOWN_CONTENT_TYPE,
} from '@youandfriends/media';
import { newObjectKey, type StorageDriver } from '@youandfriends/storage';
import { and, eq } from 'drizzle-orm';

/**
 * The upload protocol, server side.
 *
 * **Finalize is the security-critical endpoint in this product**, and the shape of this module
 * follows from that. Every property the server promised at session creation is written to a row
 * and compared against the real world at the end: who may finalize, what they may attach it to,
 * which key it goes to, how big it may be, how many parts, and whether the object is actually
 * there. A finalize that trusts the client's claims is an arbitrary-object-attachment
 * vulnerability — point a version at any key in the bucket and it is yours
 * (`docs/THREAT_MODEL.md` T4).
 *
 * Authorization is re-checked at finalize, not only at creation. An upload takes minutes; a
 * permission can be revoked inside that window, and the check that mattered is the one at the
 * moment the version is created.
 *
 * The driver is injected. That is what makes this testable without a bucket, and it is also the
 * boundary `docs/ARCHITECTURE.md` §3 asks for: the routes never touch S3 directly.
 */

export class UploadError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'forbidden'
      | 'expired'
      | 'size_exceeded'
      | 'part_count_exceeded'
      | 'object_missing'
      | 'checksum_mismatch'
      | 'invalid_state',
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadContext {
  readonly db: DirectDatabase;
  readonly driver: StorageDriver;
  readonly authz: Authorizer;
  readonly workspaceId: WorkspaceId;
  readonly subject: Subject;
  readonly userId: string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  /** Joins these audit rows to the structured logs for the same request. */
  readonly correlationId?: string | undefined;
}

/** How long a session stays usable. Long enough for a 5 GB upload on a poor connection. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const clockOf = (context: UploadContext) => context.now ?? (() => new Date());
const idsOf = (context: UploadContext) => context.newId ?? newUlid;

/**
 * The audit context for this request.
 *
 * Every upload is audited (`docs/THREAT_MODEL.md` T4): who put which bytes where, and when. The
 * events are written **in the same transaction as the rows they describe**, so a rolled-back
 * finalize leaves no event claiming a version exists. That is why the driver calls below happen
 * outside these transactions — completing a multipart upload against R2 takes as long as it
 * takes, and holding a database transaction open across it would tie up a connection per
 * in-flight upload.
 */
function auditContextOf(context: UploadContext): AuditContext {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: clockOf(context),
    newId: idsOf(context),
  };
}

/**
 * Open a session.
 *
 * The key is minted here and nowhere else. Note that `input` has no key in it — the client
 * cannot name a destination, so there is no check to forget.
 */
export async function createUploadSession(context: UploadContext, input: CreateUploadRequest) {
  const request = createUploadSchema.parse(input);
  const now = clockOf(context)();

  // The destination must be one this subject may edit. Same question the signing and finalize
  // steps ask later, through the same function, so the three cannot drift apart.
  const asset = await assertMayWriteAsset(context, request.assetId);

  const objectKey = newObjectKey(context.workspaceId, 'original');
  const partSize = partSizeFor(request.sizeBytes);
  // **Not the client's hint.** Whatever this is set to becomes the stored object's own
  // `Content-Type`, which is the header R2 serves the bytes back with — `contentTypeHint` here
  // would let an uploader choose `text/html` for a file we later hand back under a presigned URL,
  // on the bucket's origin. Sniffing at finalize fixes the recorded column but cannot reach the
  // object's metadata, so the object is minted non-renderable and the true type is applied at
  // read time from `storage_objects.content_type` (task `059`). Downloading rather than rendering
  // is the safe direction to be wrong in (`docs/THREAT_MODEL.md` T3, T4).
  const { uploadId } = await context.driver.createMultipart(objectKey, UNKNOWN_CONTENT_TYPE);

  const sessionId = idsOf(context)();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx.insert(uploadSessions).values({
      id: sessionId,
      workspaceId: context.workspaceId,
      ownerUserId: context.userId,
      assetId: asset.id,
      objectKey,
      uploadId,
      maxSizeBytes: request.sizeBytes,
      contentTypeHint: request.contentTypeHint,
      partSizeBytes: partSize,
      expectedChecksumSha256: request.expectedChecksumSha256 ?? null,
      expiresAt,
    });

    await audit({
      action: 'upload.started',
      targetType: 'asset',
      targetId: asset.id,
      // No object key and no upload id. A key is the addressable location of someone's master
      // and the audit log is the one table designed never to be edited (T3).
      metadata: { sessionId, sizeBytes: request.sizeBytes, filename: request.filename },
    });
  });

  return {
    id: sessionId,
    assetId: asset.id,
    partSizeBytes: partSize,
    partCount: partCountFor(request.sizeBytes),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Refuse unless this subject may write to the asset, right now.
 *
 * Shared by creation, signing and finalize so the three cannot drift — the question is the same
 * one each time, and an upload is long enough for the answer to change between them.
 *
 * **Returns the asset** rather than just refusing, so that the only way to get the row is to
 * have asked the question about it. A caller cannot use the asset without the check having run,
 * which is what went wrong before: creation looked the asset up and checked inline, signing and
 * finalize each did their own thing, and one of the three had no test.
 *
 * **The authorizer must be per-request.** It memoizes decisions for its lifetime (by design:
 * one request should not ask twice), so reusing one instance across a session's creation and
 * its finalize would return the creation-time answer and make this check decorative. A test
 * doing that is what first hid it.
 */
async function assertMayWriteAsset(
  context: UploadContext,
  assetId: string,
): Promise<WritableAsset> {
  const [asset] = await context.db
    .select({ id: assets.id, songId: assets.songId, projectId: assets.projectId })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.workspaceId, context.workspaceId)));

  // 404-shaped, never 403: a forbidden answer confirms the asset exists (THREAT_MODEL T1).
  if (!asset) throw new UploadError('not_found', `no asset ${assetId}`);

  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: asset.songId === null ? 'project' : 'song',
    scopeId: (asset.songId ?? asset.projectId) as string,
  });

  return asset;
}

/** An asset this subject has just been confirmed to have edit access to. */
interface WritableAsset {
  readonly id: string;
  readonly songId: string | null;
  readonly projectId: string | null;
}

/**
 * Load a session this subject is entitled to act on, or refuse.
 *
 * Every later step goes through here. A session id is **not** a bearer token: an id can be
 * guessed, logged, or forwarded, so holding one is not enough — the caller must be the person it
 * was issued to, in the workspace it belongs to, and it must not have expired.
 */
async function loadUsableSession(context: UploadContext, sessionId: string) {
  const [session] = await context.db
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, sessionId), eq(uploadSessions.workspaceId, context.workspaceId)),
    );

  if (!session) throw new UploadError('not_found', `no upload session ${sessionId}`);
  if (session.ownerUserId !== context.userId) {
    // 404-shaped for the same reason as above: confirming it exists tells a guesser they hit one.
    throw new UploadError('not_found', `no upload session ${sessionId}`);
  }
  if (session.state !== 'pending') {
    throw new UploadError('invalid_state', `session ${sessionId} is ${session.state}`);
  }
  if (session.expiresAt.getTime() <= clockOf(context)().getTime()) {
    throw new UploadError(
      'expired',
      `session ${sessionId} expired at ${session.expiresAt.toISOString()}`,
    );
  }

  return session;
}

/** Sign a batch of part URLs — always for the session's own key, never one supplied. */
export async function signUploadParts(
  context: UploadContext,
  sessionId: string,
  partNumbers: readonly number[],
) {
  // Validated like its siblings. This was the only entry point taking its input raw, which left
  // `signPartsSchema`'s bounds — at most 100 per call, each an integer within `MAX_PARTS` —
  // enforced nowhere but in the schema's own unit test. A caller passing 50,000 part numbers
  // would have minted 50,000 hour-long write credentials from one authorized request.
  const { partNumbers: requested } = signPartsSchema.parse({ partNumbers });

  const session = await loadUsableSession(context, sessionId);
  if (session.uploadId === null) {
    throw new UploadError('invalid_state', `session ${sessionId} has no multipart upload`);
  }

  // Authorization, again. This is where the bearer credentials are handed out, so a permission
  // revoked since session creation has to stop them: signed URLs outlive the check that
  // produced them, and a window of valid ones is a window someone keeps uploading through.
  await assertMayWriteAsset(context, session.assetId);

  const signed = [];
  for (const partNumber of requested) {
    const url = await context.driver.signPart({
      // From the session row. This is the line that makes a client-supplied key impossible.
      key: session.objectKey,
      uploadId: session.uploadId,
      partNumber,
    });
    signed.push({ partNumber, url: url.url, expiresAt: url.expiresAt.toISOString() });
  }
  return signed;
}

export interface CompletedUpload {
  readonly storageObjectId: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string | null;
  /** Derived from the stored bytes, never from what the client claimed. */
  readonly contentType: string;
  /** True when this call did the work; false when it replayed an already-finished session. */
  readonly created: boolean;
}

/**
 * Finish an upload, verifying everything before anything is created.
 *
 * The order matters: every refusal happens before the multipart upload is completed, so a
 * rejected finalize leaves no object behind to reason about.
 */
export async function completeUploadSession(
  context: UploadContext,
  sessionId: string,
  input: CompleteUploadRequest,
): Promise<CompletedUpload> {
  const request = completeUploadSchema.parse(input);

  const [existing] = await context.db
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, sessionId), eq(uploadSessions.workspaceId, context.workspaceId)),
    );

  if (!existing) throw new UploadError('not_found', `no upload session ${sessionId}`);
  if (existing.ownerUserId !== context.userId) {
    throw new UploadError('not_found', `no upload session ${sessionId}`);
  }

  // **Idempotent.** A replay — a retried request, a double-tapped button, a client that lost
  // the response — returns what the first call produced rather than creating a second version
  // of the same bytes (T4).
  if (existing.state === 'completed' && existing.storageObjectId !== null) {
    // Authorization even on the replay. This is the only path in this module that reaches a query
    // without consulting the authorizer, which made the `workspaceId` a caller hands in
    // unverified here and nowhere else. The answer is still idempotent — `created: false` below —
    // but someone whose access was revoked after finishing an upload does not get to keep
    // reading its metadata back (T2: a permission change takes effect on the next request).
    await assertMayWriteAsset(context, existing.assetId);

    const [object] = await context.db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.id, existing.storageObjectId));
    return {
      storageObjectId: existing.storageObjectId,
      sizeBytes: object?.sizeBytes ?? 0,
      checksumSha256: object?.checksumSha256 ?? null,
      contentType: object?.contentType ?? UNKNOWN_CONTENT_TYPE,
      created: false,
    };
  }

  const session = await loadUsableSession(context, sessionId);
  if (session.uploadId === null) {
    throw new UploadError('invalid_state', `session ${sessionId} has no multipart upload`);
  }

  // Re-check authorization. An upload takes minutes and a permission can be revoked inside that
  // window; the check that matters is the one at the moment the version is created.
  await assertMayWriteAsset(context, session.assetId);

  if (request.parts.length > MAX_PARTS) {
    throw new UploadError(
      'part_count_exceeded',
      `${request.parts.length} parts exceeds ${MAX_PARTS}`,
    );
  }

  const claimed = request.parts.reduce((total, part) => total + part.sizeBytes, 0);
  if (claimed > session.maxSizeBytes) {
    throw new UploadError(
      'size_exceeded',
      `claimed ${claimed} bytes against a ceiling of ${session.maxSizeBytes}`,
    );
  }

  // What the store says is there, versus what the client says it sent. The client's list is
  // never the authority — it is the thing being checked.
  const listed = await context.driver.listParts(session.objectKey, session.uploadId);
  const listedByNumber = new Map(listed.map((part) => [part.partNumber, part]));
  for (const part of request.parts) {
    const actual = listedByNumber.get(part.partNumber);
    if (actual === undefined) {
      throw new UploadError('object_missing', `part ${part.partNumber} was never uploaded`);
    }
    if (actual.etag !== part.etag) {
      throw new UploadError(
        'object_missing',
        `part ${part.partNumber} does not match what was stored`,
      );
    }
  }

  await context.driver.completeMultipart(session.objectKey, session.uploadId, request.parts);

  // The object as the store now has it. This, not the client's arithmetic, is what gets recorded.
  const head = await context.driver.head(session.objectKey);
  if (head === null) {
    throw new UploadError(
      'object_missing',
      `${session.objectKey} is not in the bucket after completion`,
    );
  }
  if (head.sizeBytes > session.maxSizeBytes) {
    throw new UploadError(
      'size_exceeded',
      `stored object is ${head.sizeBytes} bytes against a ceiling of ${session.maxSizeBytes}`,
    );
  }
  if (
    session.expectedChecksumSha256 !== null &&
    head.checksumSha256 !== null &&
    head.checksumSha256 !== undefined &&
    head.checksumSha256 !== session.expectedChecksumSha256
  ) {
    throw new UploadError(
      'checksum_mismatch',
      `stored object does not match the declared checksum`,
    );
  }

  // What the bytes actually are, which is not what anyone said they were.
  //
  // `head.contentType` is *the client's own hint handed back*: `createMultipart` set it from
  // `contentTypeHint` at session creation, and R2 stores and returns what it was given. Reading
  // it here and calling it verification was circular — the claim validated itself. The object's
  // first bytes are the only thing in this function the client does not control the labelling of
  // (`docs/THREAT_MODEL.md` T4).
  const prefix = await context.driver.readPrefix(session.objectKey, SNIFF_PREFIX_BYTES);
  const contentType = sniffContentType(prefix);

  const objectId = idsOf(context)();

  // One transaction for the object, the session's new state and the event that says so. If any
  // of the three fails they all roll back, and the multipart upload — already completed against
  // the store above — is reconciled by the sweep rather than left half-recorded here.
  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx.insert(storageObjects).values({
      id: objectId,
      workspaceId: context.workspaceId,
      bucket: 'originals',
      key: session.objectKey,
      sizeBytes: head.sizeBytes,
      checksumSha256: head.checksumSha256 ?? '',
      contentType,
    });

    await tx
      .update(uploadSessions)
      .set({ state: 'completed', storageObjectId: objectId })
      .where(eq(uploadSessions.id, sessionId));

    // The workspace now stores more. Invalidate rather than increment: the next read of the
    // settings page recomputes from `storage_objects`, so the upload shows up then instead of up
    // to a cache lifetime later (task `031`).
    await markStorageUsageStale(tx, context.workspaceId);

    await audit({
      action: 'upload.completed',
      targetType: 'asset',
      targetId: session.assetId,
      metadata: {
        sessionId,
        storageObjectId: objectId,
        sizeBytes: head.sizeBytes,
        contentType,
        // Worth recording: the client said one thing and the bytes said another. Not a refusal
        // — people misname files constantly — but the kind of thing you want in the log when
        // you are working out why a "wav" will not decode.
        ...(hintDisagrees(session.contentTypeHint, contentType)
          ? { claimedContentType: session.contentTypeHint }
          : {}),
      },
    });
  });

  return {
    storageObjectId: objectId,
    sizeBytes: head.sizeBytes,
    checksumSha256: head.checksumSha256 ?? null,
    contentType,
    created: true,
  };
}

/** Abandon an upload and stop paying for its parts. */
/**
 * Give up on an upload and reclaim its parts.
 *
 * **Deliberately asymmetric: no `assertMayWriteAsset` here**, unlike creation, signing and
 * finalize. Abort destroys nothing that belongs to the workspace — the parts are unattached
 * bytes this same caller uploaded, and the session is not a version of anything yet. Requiring
 * current edit access would mean a revoked collaborator's abandoned 2 GB stays billed until the
 * sweep catches it, which is the worse outcome. `loadUsableSession` still pins it to the
 * session's own owner, so nobody can abort anyone else's upload.
 *
 * The residue is that a revoked user can append `upload.aborted` rows to a workspace's audit log
 * for an asset they can no longer see. That is noise, not a leak. Written down so the next
 * reader neither "fixes" this nor assumes the check is here.
 */
export async function abortUploadSession(context: UploadContext, sessionId: string) {
  const session = await loadUsableSession(context, sessionId);
  if (session.uploadId !== null) {
    await context.driver.abortMultipart(session.objectKey, session.uploadId);
  }
  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(uploadSessions)
      .set({ state: 'aborted' })
      .where(eq(uploadSessions.id, sessionId));
    await tx.delete(uploadParts).where(eq(uploadParts.sessionId, sessionId));

    await audit({
      action: 'upload.aborted',
      targetType: 'asset',
      targetId: session.assetId,
      metadata: { sessionId, reason: 'client' },
    });
  });
}
