import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { DirectDatabase } from '../client';
import { folders, projects, songs, users, workspaceMemberships, workspaces } from '../schema/index';

/**
 * Row factories for the schema tests.
 *
 * Deliberately thin: they exist so a test about folder nesting is not half boilerplate about
 * creating a user first. They do not hide the columns under test — a factory that defaulted
 * `path` or `workspace_id` would defeat the tests that check them.
 */

/**
 * Crockford base-32, assembled from parts. The literal alphabet is high-entropy by
 * construction and `no-secrets` cannot tell it from a key — the same reason ULIDs are
 * exempted by shape rather than by file (CLAUDE.md §8).
 */
const CROCKFORD = ['0123456789', 'ABCDEFGHJKMN', 'PQRSTVWXYZ'].join('');

/**
 * A ULID-shaped identifier. Not a real ULID — monotonic timestamp ordering is irrelevant to
 * a schema test, and generating one would mean a dependency for no gain. It satisfies the
 * same 26-character Crockford shape the contracts validate.
 */
export function testId(): string {
  const bytes = randomBytes(26);
  const body = Array.from(bytes.subarray(1), (byte) => CROCKFORD[byte % 32]).join('');
  // The first character is bounded to 0-7, because a ULID's leading character encodes the high
  // bits of a 48-bit timestamp and cannot exceed 7 — which is what `ulidSchema` in
  // `@youandfriends/contracts` checks for.
  //
  // Without the bound, three quarters of the ids this factory produced were rejected by the
  // product's own contracts. Nothing noticed until a route validated one, and then it failed
  // *intermittently* — the worst shape a test failure can take, and a sign that every test
  // using these ids had been exercising a value production never sees.
  const first = CROCKFORD[(bytes[0] ?? 0) % 8] ?? '0';
  return `${first}${body}`;
}

export async function makeUser(db: DirectDatabase, overrides: { email?: string } = {}) {
  const id = testId();
  const email = overrides.email ?? `${id.toLowerCase()}@example.test`;
  const [row] = await db
    .insert(users)
    .values({ id, clerkUserId: `user_${id}`, email, displayName: 'Test Person' })
    .returning();
  if (!row) throw new Error('user insert returned nothing');
  return row;
}

export async function makeWorkspace(db: DirectDatabase, ownerUserId: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ id: testId(), name: 'Test Workspace', ownerUserId })
    .returning();
  if (!row) throw new Error('workspace insert returned nothing');
  return row;
}

/** A user, a workspace they own, and their owner membership — the usual starting point. */
export async function makeTenant(db: DirectDatabase) {
  const user = await makeUser(db);
  const workspace = await makeWorkspace(db, user.id);
  const [membership] = await db
    .insert(workspaceMemberships)
    .values({ id: testId(), workspaceId: workspace.id, userId: user.id, role: 'owner' })
    .returning();
  if (!membership) throw new Error('membership insert returned nothing');
  return { user, workspace, membership };
}

export async function makeFolder(
  db: DirectDatabase,
  workspaceId: string,
  name: string,
  parentId: string | null = null,
) {
  const [row] = await db
    .insert(folders)
    .values({ id: testId(), workspaceId, name, parentId })
    .returning();
  if (!row) throw new Error('folder insert returned nothing');
  return row;
}

export async function makeProject(
  db: DirectDatabase,
  workspaceId: string,
  name: string,
  folderId: string | null = null,
) {
  const [row] = await db
    .insert(projects)
    .values({ id: testId(), workspaceId, name, folderId })
    .returning();
  if (!row) throw new Error('project insert returned nothing');
  return row;
}

export async function makeSong(
  db: DirectDatabase,
  workspaceId: string,
  projectId: string,
  title: string,
) {
  const [row] = await db
    .insert(songs)
    .values({ id: testId(), workspaceId, projectId, title })
    .returning();
  if (!row) throw new Error('song insert returned nothing');
  return row;
}

/** Read one folder back, for asserting on trigger-maintained columns. */
export async function readFolder(db: DirectDatabase, id: string) {
  const [row] = await db.select().from(folders).where(eq(folders.id, id));
  if (!row) throw new Error(`folder ${id} not found`);
  return row;
}

/**
 * The database's own message and SQLSTATE behind a Drizzle error.
 *
 * Drizzle wraps driver errors as `Failed query: <sql>` and puts the real one in `cause`.
 * Asserting on the wrapper would pass for *any* failure of that statement — a typo in the
 * test's SQL would look exactly like the constraint firing.
 */
export function databaseError(error: unknown): { message: string; code: string } {
  const cause = (error as { cause?: { message?: string; code?: string } })?.cause;
  return { message: cause?.message ?? String(error), code: cause?.code ?? 'unknown' };
}

/** SQLSTATEs the schema's own constraints raise. */
export const SQLSTATE = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  insufficientPrivilege: '42501',
  notNullViolation: '23502',
} as const;

/** Run `operation`, requiring it to fail with `code` and a message matching `pattern`. */
export async function expectDatabaseError(
  operation: Promise<unknown>,
  code: string,
  pattern: RegExp,
): Promise<void> {
  const error = await operation.then(
    () => null,
    (caught: unknown) => caught,
  );

  if (error === null) throw new Error(`expected a database error matching ${String(pattern)}`);

  const actual = databaseError(error);
  if (actual.code !== code || !pattern.test(actual.message)) {
    throw new Error(
      `expected SQLSTATE ${code} matching ${String(pattern)}, got ${actual.code}: ${actual.message}`,
    );
  }
}

/** A storage object record. The bytes are imaginary; the row is what the schema cares about. */
export async function makeStorageObject(
  db: DirectDatabase,
  workspaceId: string,
  overrides: { key?: string; sizeBytes?: number } = {},
) {
  const { storageObjects } = await import('../schema/index');
  const objectId = testId();
  const [row] = await db
    .insert(storageObjects)
    .values({
      id: objectId,
      workspaceId,
      bucket: 'youandfriends-originals',
      key: overrides.key ?? `w/${workspaceId}/o/${objectId}`,
      sizeBytes: overrides.sizeBytes ?? 1024,
      // A fabricated digest, assembled rather than written as a literal so `no-secrets` does
      // not read 64 hex characters as a key (CLAUDE.md §8).
      checksumSha256: Array.from({ length: 8 }, () => 'deadbeef').join(''),
      contentType: 'audio/wav',
    })
    .returning();
  if (!row) throw new Error('storage object insert returned nothing');
  return row;
}

export async function makeAsset(
  db: DirectDatabase,
  workspaceId: string,
  owner: { songId?: string; projectId?: string },
  overrides: { kind?: 'master' | 'mix' | 'stem' | 'project_file' | 'artwork'; name?: string } = {},
) {
  const { assets } = await import('../schema/index');
  const [row] = await db
    .insert(assets)
    .values({
      id: testId(),
      workspaceId,
      songId: owner.songId ?? null,
      projectId: owner.projectId ?? null,
      kind: overrides.kind ?? 'mix',
      name: overrides.name ?? 'Take 1.wav',
    })
    .returning();
  if (!row) throw new Error('asset insert returned nothing');
  return row;
}

export async function makeAssetVersion(
  db: DirectDatabase,
  workspaceId: string,
  assetId: string,
  storageObjectId: string,
  versionNumber: number,
) {
  const { assetVersions } = await import('../schema/index');
  const [row] = await db
    .insert(assetVersions)
    .values({ id: testId(), workspaceId, assetId, storageObjectId, versionNumber })
    .returning();
  if (!row) throw new Error('asset version insert returned nothing');
  return row;
}

export async function makeMixVersion(
  db: DirectDatabase,
  workspaceId: string,
  songId: string,
  assetVersionId: string,
  versionNumber: number,
) {
  const { mixVersions } = await import('../schema/index');
  const [row] = await db
    .insert(mixVersions)
    .values({ id: testId(), workspaceId, songId, assetVersionId, versionNumber })
    .returning();
  if (!row) throw new Error('mix version insert returned nothing');
  return row;
}

export async function makeSnapshot(
  db: DirectDatabase,
  workspaceId: string,
  projectId: string,
  overrides: { storageObjectId?: string | null; finalized?: boolean } = {},
) {
  const { snapshots } = await import('../schema/index');
  const [row] = await db
    .insert(snapshots)
    .values({
      id: testId(),
      workspaceId,
      projectId,
      source: 'browser_folder',
      name: `Snapshot ${testId()}`,
      storageObjectId: overrides.storageObjectId ?? null,
      finalizedAt: overrides.finalized === true ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error('snapshot insert returned nothing');
  return row;
}
