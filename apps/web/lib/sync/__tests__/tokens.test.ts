import { createAuthorizer, memberSubject, syncTokenSubject } from '@youandfriends/authz';
import {
  newUlid,
  type AssetId,
  type ProjectId,
  type UserId,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  assets,
  auditEvents,
  permissionGrants,
  snapshots,
  syncTokens,
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
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trashAsset } from '@/lib/assets/service';
import { createThread } from '@/lib/comments/service';
import type { LibraryContext } from '@/lib/library/context';
import { readLyrics } from '@/lib/lyrics/service';
import { createSnapshot } from '@/lib/snapshots/service';
import { stubDriver } from '@/lib/uploads/__tests__/stub-driver';
import { createUploadSession } from '@/lib/uploads/service';

import { agentDestinations } from '../destinations';
import { authenticateSyncToken, issueSyncToken, listDevices, revokeDevice } from '../tokens';

vi.mock('server-only', () => ({}));

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING sync token service tests: ${reason}`);

type Person = 'owner' | 'editor' | 'otherEditor' | 'viewer';

/**
 * Pairing, authenticating, and disconnecting Mac devices (task `110`), and what a paired device can
 * reach through the real services. The fixture: two editors (so "someone else's device" exists),
 * a viewer who may not pair, a destination project, a project the device was not given, a song
 * inside the destination, and another workspace.
 */
describeWithDatabase('sync tokens, end to end', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  const people = {} as Record<Person, string>;
  const ids = {} as Record<'destination' | 'other' | 'song' | 'foreignProject', string>;

  function contextFor(userId: string): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
    };
  }

  /** What a request from the paired Mac looks like to the services: the token as the subject. */
  function agentContext(tokenId: string, pairer: string) {
    return { ...contextFor(pairer), subject: syncTokenSubject(tokenId), driver: stubDriver() };
  }

  /** The public code of a refusal, from either error type the services throw. */
  async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      const shaped = error as { publicCode?: string; code?: string };
      return shaped.publicCode ?? shaped.code ?? 'unknown';
    }
    throw new Error('expected a refusal');
  }

  const tokenIdOf = (token: string) => token.slice('yaf_sync_'.length, 'yaf_sync_'.length + 26);

  const manifest = (projectId: string) => ({
    projectId: projectId as ProjectId,
    name: 'Session',
    entries: [
      {
        path: 'Session.logicx/Alternatives/000/ProjectData',
        sizeBytes: 1024,
        modifiedAt: null,
        checksumSha256: null,
        ignored: false,
        ignoreReason: null,
      },
    ],
  });

  beforeAll(async () => {
    database = await createTestDatabase('sync_service');
    db = database.db;
    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id;
    people.owner = tenant.user.id;
    for (const [person, role] of [
      ['editor', 'editor'],
      ['otherEditor', 'editor'],
      ['viewer', 'viewer'],
    ] as const) {
      people[person] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[person], role);
    }
    ids.destination = (await makeProject(db, workspaceId, 'Night Drive')).id;
    ids.other = (await makeProject(db, workspaceId, 'Private')).id;
    ids.song = (await makeSong(db, workspaceId, ids.destination, 'Headlights')).id;
    const foreign = await makeTenant(db);
    ids.foreignProject = (await makeProject(db, foreign.workspace.id, 'Theirs')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('pairs a device with a token in the documented shape, stored nowhere', async () => {
    const issued = await issueSyncToken(contextFor(people.editor), {
      name: 'Studio iMac',
      projectIds: [ids.destination],
    });
    expect(issued.token).toMatch(/^yaf_sync_[0-9A-HJKMNP-TV-Z]{26}_[A-Za-z0-9_-]{43}$/);
    const secret = issued.token.slice('yaf_sync_'.length + 27);
    const [row] = await db
      .select()
      .from(syncTokens)
      .where(eq(syncTokens.id, tokenIdOf(issued.token)));
    expect(row?.secretHash).toMatch(/^scrypt\$/);
    // Neither the token nor its secret is anywhere in the rows written, or in the audit trail.
    const written = JSON.stringify([
      await db.select().from(syncTokens),
      await db.select().from(auditEvents),
      await db.select().from(permissionGrants),
    ]);
    expect(written).not.toContain(secret);
    expect(written).not.toContain(issued.token);
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'sync_token.issued'));
    expect(audit).toMatchObject({ actorId: people.editor, targetId: tokenIdOf(issued.token) });
    // Default lifetime: ninety days.
    expect(issued.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60_000);
  });

  it('pairs only into projects the person can edit, in this workspace — and only a person pairs', async () => {
    for (const [who, projectId] of [
      ['viewer', ids.destination],
      ['editor', ids.foreignProject],
    ] as const) {
      expect(
        await refusal(
          issueSyncToken(contextFor(people[who]), { name: 'Mac', projectIds: [projectId] }),
        ),
        who,
      ).toBe('not_found');
    }
    const { token } = await issueSyncToken(contextFor(people.editor), {
      name: 'Mac',
      projectIds: [ids.destination],
    });
    const asDevice = agentContext(tokenIdOf(token), people.editor);
    expect(
      await refusal(issueSyncToken(asDevice, { name: 'Child', projectIds: [ids.destination] })),
    ).toBe('not_found');
  });

  it('authenticates only the real, live token — and revocation holds on the next request', async () => {
    const issued = await issueSyncToken(contextFor(people.editor), {
      name: 'Laptop',
      projectIds: [ids.destination],
    });
    expect(await authenticateSyncToken(db, issued.token)).toEqual({
      tokenId: tokenIdOf(issued.token),
      workspaceId,
      userId: people.editor,
    });
    const last = issued.token.at(-1) === 'A' ? 'B' : 'A';
    for (const presented of [
      `${issued.token.slice(0, -1)}${last}`,
      issued.token.replace('yaf_sync_', 'yaf_invite_'),
      'yaf_sync_not-a-token',
      `yaf_sync_${newUlid()}_${issued.token.slice(-43)}`,
      '',
    ]) {
      expect(await authenticateSyncToken(db, presented), presented).toBeNull();
    }
    await revokeDevice(contextFor(people.editor), issued.deviceId);
    expect(await authenticateSyncToken(db, issued.token)).toBeNull();
    const [revoked] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'sync_token.revoked'),
          eq(auditEvents.targetId, tokenIdOf(issued.token)),
        ),
      );
    expect(revoked?.actorId).toBe(people.editor);
  });

  it('refuses an expired token, and records use — at most hourly', async () => {
    const issued = await issueSyncToken(contextFor(people.editor), {
      name: 'Old Mac',
      projectIds: [ids.destination],
      expiresInDays: 30,
    });
    const tokenId = tokenIdOf(issued.token);
    const now = Date.now();
    // Every ten minutes for seventy: audited at the start and again after the hour.
    for (let minute = 0; minute <= 70; minute += 10) {
      await authenticateSyncToken(db, issued.token, new Date(now + minute * 60_000));
    }
    const uses = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'sync_token.used'), eq(auditEvents.targetId, tokenId)));
    expect(uses).toHaveLength(2);
    expect(uses[0]).toMatchObject({ actorKind: 'sync_token', actorId: tokenId });
    const [row] = await db.select().from(syncTokens).where(eq(syncTokens.id, tokenId));
    expect(row?.lastUsedAt?.getTime()).toBe(now + 70 * 60_000);
    expect(
      await authenticateSyncToken(db, issued.token, new Date(now + 31 * 24 * 60 * 60_000)),
    ).toBeNull();
  });

  it('lists one’s own devices — every device for an owner — with last use, and never a hash', async () => {
    await issueSyncToken(contextFor(people.otherEditor), {
      name: 'Someone else’s Mac',
      projectIds: [ids.destination],
    });
    const mine = await listDevices(contextFor(people.editor));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((device) => device.mine)).toBe(true);
    expect(mine.map((device) => device.name)).not.toContain('Someone else’s Mac');
    const all = await listDevices(contextFor(people.owner));
    expect(all.map((device) => device.name)).toContain('Someone else’s Mac');
    expect(all.find((device) => device.name === 'Old Mac')?.lastUsedAt).not.toBeNull();
    expect(all.find((device) => device.name === 'Laptop')?.revokedAt).not.toBeNull();
    expect(JSON.stringify(all)).not.toMatch(/scrypt|secret/i);
    expect(all[0]?.destinations).toEqual([{ projectId: ids.destination, name: 'Night Drive' }]);
  });

  it('lets the pairer or an owner disconnect a device, and nobody else', async () => {
    const theirs = await issueSyncToken(contextFor(people.otherEditor), {
      name: 'Their Mac',
      projectIds: [ids.destination],
    });
    expect(await refusal(revokeDevice(contextFor(people.editor), theirs.deviceId))).toBe(
      'not_found',
    );
    expect(await authenticateSyncToken(db, theirs.token)).not.toBeNull();
    await revokeDevice(contextFor(people.owner), theirs.deviceId);
    expect(await authenticateSyncToken(db, theirs.token)).toBeNull();
  });

  it('as the Mac: adds a snapshot to its destination, and reaches nothing else', async () => {
    const { token } = await issueSyncToken(contextFor(people.editor), {
      name: 'Studio Mac',
      projectIds: [ids.destination],
    });
    const mac = agentContext(tokenIdOf(token), people.editor);

    const created = await createSnapshot(mac, manifest(ids.destination));
    const [snapshot] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.id, created.snapshotId));
    expect(snapshot).toMatchObject({ source: 'mac_agent', projectId: ids.destination });
    await createUploadSession(mac, {
      assetId: created.assetId as AssetId,
      sizeBytes: 5 * 1024 * 1024,
      contentTypeHint: 'application/zip',
      filename: 'Session.zip',
    });
    expect(await agentDestinations(mac)).toEqual([
      { projectId: ids.destination, name: 'Night Drive' },
    ]);

    // Not another project; not a song's mix, lyrics, or conversation; not deleting a file.
    expect(await refusal(createSnapshot(mac, manifest(ids.other)))).toBe('not_found');
    const mix = await makeAsset(db, workspaceId, { songId: ids.song }, { kind: 'mix' });
    expect(
      await refusal(
        createUploadSession(mac, {
          assetId: mix.id as AssetId,
          sizeBytes: 1024,
          contentTypeHint: 'audio/wav',
          filename: 'Mix.wav',
        }),
      ),
    ).toBe('not_found');
    expect(await refusal(readLyrics(mac, ids.song))).toBe('not_found');
    expect(
      await refusal(
        createThread(mac, ids.song, { anchor: { kind: 'general' }, body: 'from the Mac' }),
      ),
    ).toBe('not_found');
    expect(await refusal(trashAsset(mac, created.assetId, 30))).toBe('not_found');
    const [zip] = await db.select().from(assets).where(eq(assets.id, created.assetId));
    expect(zip?.deletedAt).toBeNull();
  });

  it('stops uploading the moment its pairer can no longer edit the destination', async () => {
    const { token } = await issueSyncToken(contextFor(people.otherEditor), {
      name: 'Borrowed Mac',
      projectIds: [ids.destination],
    });
    await createSnapshot(
      agentContext(tokenIdOf(token), people.otherEditor),
      manifest(ids.destination),
    );
    await db.insert(permissionGrants).values({
      id: newUlid(),
      workspaceId,
      scopeType: 'project',
      scopeId: ids.destination,
      subjectKind: 'member',
      subjectId: people.otherEditor,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    // The next request — a fresh context, as each request gets — is refused.
    const next = agentContext(tokenIdOf(token), people.otherEditor);
    expect(await refusal(createSnapshot(next, manifest(ids.destination)))).toBe('not_found');
    expect(await agentDestinations(next)).toEqual([]);
  });
});
