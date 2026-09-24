import { createHmac, randomBytes } from 'node:crypto';

import type * as LiveblocksNode from '@liveblocks/node';
import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import { type DirectDatabase } from '@youandfriends/db';
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lyricsToText, textToLyrics } from '../text-format';
import { yjsFromDocument } from '../yjs';

vi.mock('server-only', () => ({}));

/**
 * The collaboration HTTP surface (task `082`) through the real services and a real database.
 *
 * Substituted: the session (no Clerk here), the database handle, and the `Liveblocks` REST client
 * — there are no Liveblocks credentials in this environment, so the test records what the route
 * asks it for instead. The webhook's signature check is the real `WebhookHandler`, verifying a
 * delivery signed here the way Liveblocks signs one.
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  workspace: null as unknown,
  sessions: [] as { secret: string; userId: string; info: unknown; allowed: unknown[] }[],
  roomState: null as Uint8Array | null,
}));

vi.mock('@/lib/database', () => ({ transactionalDatabase: () => state.db }));
vi.mock('@/lib/workspace/current', () => ({ currentWorkspace: async () => state.workspace }));
vi.mock('@liveblocks/node', async (original) => {
  const actual = await original<typeof LiveblocksNode>();
  class Liveblocks {
    readonly #secret: string;
    constructor({ secret }: { secret: string }) {
      this.#secret = secret;
    }
    prepareSession(userId: string, { userInfo }: { userInfo: unknown }) {
      const session = { secret: this.#secret, userId, info: userInfo, allowed: [] as unknown[] };
      state.sessions.push(session);
      return {
        allow: (room: string, permissions: readonly string[]) => {
          session.allowed.push([room, permissions]);
        },
        authorize: async () => ({ status: 200, body: JSON.stringify({ token: 'minted' }) }),
      };
    }
    async getYjsDocumentAsBinaryUpdate() {
      return (state.roomState ?? new Uint8Array()).buffer;
    }
  }
  return { ...actual, Liveblocks };
});

const { POST: auth } = await import('@/app/api/liveblocks/auth/route');
const { POST: webhook } = await import('@/app/api/webhooks/liveblocks/route');
const lyricsRoute = await import('@/app/api/songs/[songId]/lyrics/route');

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING lyrics collaboration route tests: ${reason}`);

// Credential-shaped values are assembled, never written literally (CLAUDE.md §8).
const SECRET = ['sk', 'dev', 'EXAMPLENOTAREALKEY'].join('_');
const SIGNING_KEY = randomBytes(24);
const WEBHOOK_SECRET = ['whsec', SIGNING_KEY.toString('base64')].join('_');

function signedDelivery(body: string, key = SIGNING_KEY): Request {
  const id = `msg_${randomBytes(6).toString('hex')}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return new Request('http://localhost/api/webhooks/liveblocks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    },
    body,
  });
}

describeWithDatabase('lyrics collaboration routes', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const who = {} as Record<
    'owner' | 'viewer' | 'foreigner',
    { userId: string; workspaceId: string }
  >;
  let songId: string;
  let foreignSongId: string;

  function signedInAs(person: { userId: string; workspaceId: string }) {
    state.workspace = {
      subject: { kind: 'member', userId: person.userId as UserId },
      userId: person.userId,
      workspace: { workspaceId: person.workspaceId as WorkspaceId, name: 'W', role: 'owner' },
      correlationId: undefined,
    };
  }

  const authFor = (room: string) =>
    auth(
      new Request('http://localhost/api/liveblocks/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room }),
      }),
    );

  beforeAll(async () => {
    database = await createTestDatabase('lyrics_collaboration_routes');
    db = database.db;
    state.db = db;
    const tenant = await makeTenant(db);
    who.owner = { userId: tenant.user.id, workspaceId: tenant.workspace.id };
    const viewer = await makeUser(db);
    await addMember(db, tenant.workspace.id, viewer.id, 'viewer');
    who.viewer = { userId: viewer.id, workspaceId: tenant.workspace.id };
    const project = await makeProject(db, tenant.workspace.id, 'Night Drive');
    songId = (await makeSong(db, tenant.workspace.id, project.id, 'Headlights')).id;
    const foreign = await makeTenant(db);
    who.foreigner = { userId: foreign.user.id, workspaceId: foreign.workspace.id };
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    foreignSongId = (await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  beforeEach(() => {
    state.sessions = [];
    signedInAs(who.owner);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('says collaboration is unavailable, rather than failing, without a secret key', async () => {
    vi.stubEnv('LIVEBLOCKS_SECRET_KEY', undefined);
    const response = await authFor(`lyrics:${songId}`);
    expect(response.status).toBe(503);
    expect(state.sessions).toEqual([]);
    const lyrics = await lyricsRoute.GET(new Request('http://localhost'), {
      params: Promise.resolve({ songId }),
    });
    expect((await lyrics.json()) as { collaboration: unknown }).toMatchObject({
      collaboration: null,
    });
  });

  it('mints a token for one room, at the signed-in person’s access', async () => {
    vi.stubEnv('LIVEBLOCKS_SECRET_KEY', SECRET);
    expect((await authFor(`lyrics:${songId}`)).status).toBe(200);
    signedInAs(who.viewer);
    const response = await authFor(`lyrics:${songId}`);
    expect(await response.json()).toEqual({ token: 'minted' });
    expect(state.sessions.map((session) => [session.userId, session.allowed])).toEqual([
      [who.owner.userId, [[`lyrics:${songId}`, ['room:write']]]],
      [who.viewer.userId, [[`lyrics:${songId}`, ['room:read', 'room:presence:write']]]],
    ]);
  });

  it('refuses a room in another workspace, or no room at all, 404-shaped and without a token', async () => {
    vi.stubEnv('LIVEBLOCKS_SECRET_KEY', SECRET);
    expect((await authFor(`lyrics:${foreignSongId}`)).status).toBe(404);
    expect((await authFor('lyrics:*')).status).toBe(404);
    signedInAs(who.foreigner);
    expect((await authFor(`lyrics:${songId}`)).status).toBe(404);
    expect(state.sessions).toEqual([]);
  });

  it('tells the editor its room and identity when collaboration is on', async () => {
    vi.stubEnv('LIVEBLOCKS_SECRET_KEY', SECRET);
    const response = await lyricsRoute.GET(new Request('http://localhost'), {
      params: Promise.resolve({ songId }),
    });
    expect(await response.json()).toMatchObject({
      collaboration: { room: `lyrics:${songId}`, self: { color: expect.stringMatching(/^var\(/) } },
    });
  });

  it('webhook: refuses a delivery it cannot verify, and merges one it can', async () => {
    vi.stubEnv('LIVEBLOCKS_SECRET_KEY', SECRET);
    vi.stubEnv('LIVEBLOCKS_WEBHOOK_SECRET', WEBHOOK_SECRET);
    const body = JSON.stringify({
      type: 'ydocUpdated',
      data: { projectId: 'p', roomId: `lyrics:${songId}`, updatedAt: new Date().toISOString() },
    });
    expect((await webhook(signedDelivery(body, randomBytes(24)))).status).toBe(400);

    // An editor saved first; the room then carries newer words.
    const saved = await lyricsRoute.PUT(
      new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: textToLyrics('[Verse]\nfirst'), baseVersion: 0 }),
      }),
      { params: Promise.resolve({ songId }) },
    );
    expect(saved.status).toBe(200);
    state.roomState = yjsFromDocument(textToLyrics('[Verse]\nfirst\n[Chorus]\nfrom the room'));
    expect((await webhook(signedDelivery(body))).status).toBe(200);
    const after = await lyricsRoute.GET(new Request('http://localhost'), {
      params: Promise.resolve({ songId }),
    });
    const { document } = (await after.json()) as { document: Parameters<typeof lyricsToText>[0] };
    expect(lyricsToText(document)).toContain('from the room');
  });

  it('webhook: 503 when unconfigured, so deliveries are retried rather than lost', async () => {
    vi.stubEnv('LIVEBLOCKS_WEBHOOK_SECRET', undefined);
    expect((await webhook(signedDelivery('{}'))).status).toBe(503);
  });
});
