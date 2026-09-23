import { newUlid, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import { storageObjects, uploadSessions, type DirectDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  makeAsset,
  makeProject,
  makeSong,
  makeTenant,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Storage from '@youandfriends/storage';

import { stubDriver, type StubDriver } from './stub-driver';

vi.mock('server-only', () => ({}));

/**
 * The upload HTTP surface (task `058`), end to end through the real service and a real database.
 *
 * What is substituted, and why: the session (`currentWorkspace`) — there is no Clerk here, so
 * the test says who is asking; the database handle, pointed at a scratch database; and the
 * storage driver, with the recording stub `lib/uploads/__tests__/stub-driver.ts` documents. The
 * R2 driver itself is exercised against a real server by task `052`.
 */

const state = vi.hoisted(() => ({
  db: null as unknown,
  driver: null as unknown,
  workspace: null as unknown,
  storageConfigured: true,
  workspaceCalls: 0,
}));

vi.mock('@/lib/database', () => ({ transactionalDatabase: () => state.db }));
vi.mock('@/lib/workspace/current', () => ({
  currentWorkspace: async () => {
    state.workspaceCalls += 1;
    return state.workspace;
  },
}));
vi.mock('@youandfriends/storage', async (original) => {
  const actual = await original<typeof Storage>();
  return {
    ...actual,
    r2ConfigFrom: () => {
      if (!state.storageConfigured) throw new actual.StorageNotConfiguredError(['R2_ENDPOINT']);
      return { endpoint: 'http://unused', accessKeyId: 'x', secretAccessKey: 'x', bucket: 'x' };
    },
    createR2Driver: () => state.driver,
  };
});

const { POST: create } = await import('@/app/api/uploads/route');
const { POST: sign } = await import('@/app/api/uploads/[id]/parts/route');
const { POST: complete } = await import('@/app/api/uploads/[id]/complete/route');
const { POST: abort } = await import('@/app/api/uploads/[id]/abort/route');

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING upload route tests: ${reason}`);

function post(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeWithDatabase('upload routes', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let driver: StubDriver;

  const me = {} as { userId: string; workspaceId: string; assetId: string };
  const them = {} as { userId: string; workspaceId: string; assetId: string };

  function signedInAs(who: { userId: string; workspaceId: string }) {
    state.workspace = {
      subject: { kind: 'member', userId: who.userId as UserId },
      userId: who.userId,
      workspace: { workspaceId: who.workspaceId as WorkspaceId, name: 'W', role: 'owner' },
      correlationId: undefined,
    };
  }

  async function tenantWithAsset() {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `P ${newUlid()}`);
    const song = await makeSong(db, workspace.id, project.id, 'Track');
    const asset = await makeAsset(db, workspace.id, { songId: song.id });
    return { userId: user.id, workspaceId: workspace.id, assetId: asset.id };
  }

  const createBody = () => ({
    assetId: me.assetId,
    sizeBytes: 5 * 1024 * 1024,
    contentTypeHint: 'audio/wav',
    filename: 'Blue Hour.wav',
  });

  beforeAll(async () => {
    database = await createTestDatabase('upload_routes');
    db = database.db;
    state.db = db;
    // The route memoizes its driver per warm instance, as production does. Hand it one stable
    // object that forwards to whichever stub the current test installed.
    state.driver = new Proxy({} as StubDriver, {
      get: (_target, key: keyof StubDriver) => driver[key],
    });
    Object.assign(me, await tenantWithAsset());
    Object.assign(them, await tenantWithAsset());
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  beforeEach(() => {
    driver = stubDriver();
    state.storageConfigured = true;
    state.workspaceCalls = 0;
    signedInAs(me);
  });

  it('runs a whole upload: create, sign, complete, and a replayed complete', async () => {
    const created = await create(post('/api/uploads', createBody()));
    expect(created.status).toBe(201);
    const session = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(session).sort()).toEqual(['expiresAt', 'id', 'partCount', 'partSizeBytes']);

    const signed = await sign(
      post(`/api/uploads/${String(session.id)}/parts`, { partNumbers: [1] }),
      params(String(session.id)),
    );
    expect(signed.status).toBe(200);
    expect(signed.headers.get('cache-control')).toBe('no-store');
    const { parts } = (await signed.json()) as { parts: { partNumber: number; url: string }[] };
    expect(parts.map((part) => part.partNumber)).toEqual([1]);

    const body = { parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 5 * 1024 * 1024 }] };
    const first = await complete(
      post(`/api/uploads/${String(session.id)}/complete`, body),
      params(String(session.id)),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody).toMatchObject({ created: true, contentType: 'audio/wav' });

    const replay = await complete(
      post(`/api/uploads/${String(session.id)}/complete`, body),
      params(String(session.id)),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ created: false, sizeBytes: firstBody.sizeBytes });
    const objects = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.workspaceId, me.workspaceId));
    expect(objects).toHaveLength(1);
  });

  it('never returns the object key or the provider upload id', async () => {
    const created = await create(post('/api/uploads', createBody()));
    const text = await created.clone().text();
    const { id } = (await created.json()) as { id: string };
    const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, id));
    expect(row).toBeDefined();
    expect(text).not.toContain(row?.objectKey ?? 'missing');
    expect(text).not.toContain(row?.uploadId ?? 'missing');

    const done = await complete(
      post(`/api/uploads/${id}/complete`, {
        parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 5 * 1024 * 1024 }],
      }),
      params(id),
    );
    const doneText = await done.text();
    expect(doneText).not.toContain(row?.objectKey ?? 'missing');
    expect(doneText).not.toMatch(/storageObjectId|https?:/);
  });

  it('refuses a signed-out caller', async () => {
    state.workspace = null;
    const response = await create(post('/api/uploads', createBody()));
    expect(response.status).toBe(401);
    expect(driver.created).toEqual([]);
  });

  it('rejects a malformed body before any database or storage call', async () => {
    for (const body of ['{not json', { ...createBody(), sizeBytes: -1 }, { assetId: 'x' }]) {
      const response = await create(post('/api/uploads', body));
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe('validation_failed');
    }
    const badParts = await sign(
      post(`/api/uploads/${newUlid()}/parts`, { partNumbers: [0] }),
      params(newUlid()),
    );
    expect(badParts.status).toBe(422);
    // Neither the session lookup nor the driver was reached.
    expect(state.workspaceCalls).toBe(0);
    expect(driver.created).toEqual([]);
  });

  it('refuses another workspace’s asset and session 404-shaped, never 403', async () => {
    // Their asset, named from my workspace.
    const foreignAsset = await create(
      post('/api/uploads', { ...createBody(), assetId: them.assetId }),
    );
    expect(foreignAsset.status).toBe(404);

    // Their session, named from my workspace.
    signedInAs(them);
    const theirs = await create(post('/api/uploads', { ...createBody(), assetId: them.assetId }));
    const { id } = (await theirs.json()) as { id: string };
    signedInAs(me);
    for (const [route, body] of [
      [sign, { partNumbers: [1] }],
      [complete, { parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 1 }] }],
      [abort, undefined],
    ] as const) {
      const response = await route(post(`/api/uploads/${id}/x`, body), params(id));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'not_found', message: 'Not found.' });
    }
  });

  it('treats a malformed session id exactly like an unknown one', async () => {
    const response = await abort(post('/api/uploads/not-an-id/abort'), params('not-an-id'));
    expect(response.status).toBe(404);
  });

  it('maps an expired or finished session to its documented status', async () => {
    const created = await create(post('/api/uploads', createBody()));
    const { id } = (await created.json()) as { id: string };
    const aborted = await abort(post(`/api/uploads/${id}/abort`), params(id));
    expect(aborted.status).toBe(204);
    expect(driver.aborted).toHaveLength(1);

    const again = await sign(post(`/api/uploads/${id}/parts`, { partNumbers: [1] }), params(id));
    expect(again.status).toBe(409);

    const fresh = await create(post('/api/uploads', createBody()));
    const { id: expiredId } = (await fresh.json()) as { id: string };
    await db
      .update(uploadSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(uploadSessions.id, expiredId));
    const expired = await sign(
      post(`/api/uploads/${expiredId}/parts`, { partNumbers: [1] }),
      params(expiredId),
    );
    expect(expired.status).toBe(410);
  });

  it('says honestly when storage is not configured', async () => {
    state.storageConfigured = false;
    // A fresh module instance, since the driver is memoized per warm instance.
    vi.resetModules();
    const { POST: freshCreate } = await import('@/app/api/uploads/route');
    const response = await freshCreate(post('/api/uploads', createBody()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ message: 'File storage is not configured.' });
  });
});
