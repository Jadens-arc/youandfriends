import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import { coverVariant, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import {
  assets,
  derivatives,
  ensureScopeLimitedMembership,
  projects,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  createTestDatabase,
  makeAsset,
  makeAssetVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { derivativeObjectKey } from '@youandfriends/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '../context';
import { resolveCovers } from '../covers';
import { readProjectLibrary } from '../projects';
import { readProjectWorkspace, readSongWorkspace } from '@/lib/songs/workspace';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING cover resolution tests: ${reason}`);

const signed = (key: string, contentType: string) =>
  `https://signed.example/${key}?type=${encodeURIComponent(contentType)}`;

/**
 * Cover art reaching cards and headers (task `069`), against a real database.
 *
 * The fixture has a row on the far side of each rule (CLAUDE.md §13): a project with a finished
 * cover, one with a cover chosen but not yet rendered, one with a *trashed* cover asset, one
 * whose cover has an older version with renditions and a newer one without, and a project with a
 * cover the collaborator **cannot see** — so a leak has something to leak. A populated foreign
 * workspace uses the same shapes.
 */
describeWithDatabase('cover resolution', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let owner: string;
  let collaborator: string;
  let workspaceId: string;
  const ids = {} as Record<
    | 'rendered'
    | 'unrendered'
    | 'trashed'
    | 'newerVersion'
    | 'hidden'
    | 'hiddenSong'
    | 'renderedSong'
    | 'foreign',
    string
  >;
  const hiddenKeys: string[] = [];

  function contextFor(userId: string, overrides: Partial<LibraryContext> = {}): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      coverSigner: async (key, contentType) => signed(key, contentType),
      ...overrides,
    };
  }

  /** A project whose cover asset has `versions` versions, the listed ones rendered. */
  async function projectWithCover(
    name: string,
    options: { rendered: readonly number[]; versions?: number; trashed?: boolean },
  ) {
    const project = await makeProject(db, workspaceId, name);
    const asset = await makeAsset(db, workspaceId, { projectId: project.id }, { kind: 'artwork' });
    const keys: string[] = [];
    for (let number = 1; number <= (options.versions ?? 1); number += 1) {
      const object = await makeStorageObject(db, workspaceId);
      const version = await makeAssetVersion(db, workspaceId, asset.id, object.id, number);
      if (!options.rendered.includes(number)) continue;
      for (const width of [512, 128, 256]) {
        const id = testId();
        const key = derivativeObjectKey(workspaceId, id);
        const rendition = await makeStorageObject(db, workspaceId, {
          key,
          contentType: 'image/jpeg',
        });
        await db.insert(derivatives).values({
          id,
          workspaceId,
          assetVersionId: version.id,
          kind: 'thumbnail',
          variant: coverVariant(width),
          storageObjectId: rendition.id,
          processingState: 'complete',
        });
        keys.push(key);
      }
    }
    await db.update(projects).set({ coverAssetId: asset.id }).where(eq(projects.id, project.id));
    if (options.trashed === true) {
      await db
        .update(assets)
        .set({ deletedAt: new Date(), deletedBy: owner })
        .where(eq(assets.id, asset.id));
    }
    return { id: project.id, keys };
  }

  beforeAll(async () => {
    database = await createTestDatabase('library_covers');
    db = database.db;
    const tenant = await makeTenant(db);
    owner = tenant.user.id;
    workspaceId = tenant.workspace.id;

    const rendered = await projectWithCover('Rendered', { rendered: [1] });
    ids.rendered = rendered.id;
    ids.renderedSong = (await makeSong(db, workspaceId, rendered.id, 'Visible song')).id;
    ids.unrendered = (await projectWithCover('Unrendered', { rendered: [] })).id;
    ids.trashed = (await projectWithCover('Trashed', { rendered: [1], trashed: true })).id;
    ids.newerVersion = (await projectWithCover('Newer', { rendered: [1], versions: 2 })).id;
    const hidden = await projectWithCover('Hidden', { rendered: [1] });
    ids.hidden = hidden.id;
    hiddenKeys.push(...hidden.keys);
    ids.hiddenSong = (await makeSong(db, workspaceId, hidden.id, 'Hidden song')).id;

    // A collaborator who can open "Rendered" and nothing else.
    collaborator = (await makeUser(db)).id;
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspaceId, collaborator, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId,
        scopeType: 'project',
        scopeId: ids.rendered,
        subjectKind: 'member',
        subjectId: collaborator,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner,
      });
      // …and one song inside "Hidden", shared on its own: the song opens, its project does not.
      await upsertGrant(tx, {
        id: testId(),
        workspaceId,
        scopeType: 'song',
        scopeId: ids.hiddenSong,
        subjectKind: 'member',
        subjectId: collaborator,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner,
      });
    });

    // A foreign workspace with a rendered cover of its own, which must never be resolved here.
    const foreign = await makeTenant(db);
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    const foreignAsset = await makeAsset(
      db,
      foreign.workspace.id,
      { projectId: foreignProject.id },
      { kind: 'artwork' },
    );
    const foreignObject = await makeStorageObject(db, foreign.workspace.id);
    const foreignVersion = await makeAssetVersion(
      db,
      foreign.workspace.id,
      foreignAsset.id,
      foreignObject.id,
      1,
    );
    const foreignId = testId();
    await db.insert(derivatives).values({
      id: foreignId,
      workspaceId: foreign.workspace.id,
      assetVersionId: foreignVersion.id,
      kind: 'thumbnail',
      variant: coverVariant(128),
      storageObjectId: (
        await makeStorageObject(db, foreign.workspace.id, {
          key: derivativeObjectKey(foreign.workspace.id, foreignId),
        })
      ).id,
      processingState: 'complete',
    });
    await db
      .update(projects)
      .set({ coverAssetId: foreignAsset.id })
      .where(eq(projects.id, foreignProject.id));
    ids.foreign = foreignProject.id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('gives a rendered project a src and srcSet of its renditions, smallest first', async () => {
    const library = await readProjectLibrary(contextFor(owner), { folderId: null, quotaBytes: 1 });
    const card = library.projects.find((project) => project.id === ids.rendered);
    expect(card?.cover?.src).toMatch(
      /^https:\/\/signed\.example\/w\/.+\/d\/.+\?type=image%2Fjpeg$/,
    );
    expect(card?.cover?.srcSet.split(', ').map((entry) => entry.split(' ')[1])).toEqual([
      '128w',
      '256w',
      '512w',
    ]);
    expect(card?.cover?.src).toBe(card?.cover?.srcSet.split(' ')[0]);
  });

  it('shows the placeholder for no renditions, a trashed cover, or a newer unrendered version', async () => {
    const library = await readProjectLibrary(contextFor(owner), { folderId: null, quotaBytes: 1 });
    for (const id of [ids.unrendered, ids.trashed, ids.newerVersion]) {
      expect(library.projects.find((project) => project.id === id)?.cover).toBeNull();
    }
  });

  it('never puts a cover URL for a project the viewer cannot see into their payload', async () => {
    const library = await readProjectLibrary(contextFor(collaborator), {
      folderId: null,
      quotaBytes: 1,
    });
    expect(library.projects.map((project) => project.id)).toEqual([ids.rendered]);
    expect(library.projects[0]?.cover).not.toBeNull();
    const payload = JSON.stringify(library);
    for (const key of hiddenKeys) expect(payload).not.toContain(key);
  });

  it('resolves every card’s cover in one query, however many cards there are', async () => {
    let executes = 0;
    const counting = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return (...args: unknown[]) => {
            executes += 1;
            return (target.execute as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const covers = await resolveCovers(contextFor(owner, { db: counting }), [
      ids.rendered,
      ids.hidden,
      ids.unrendered,
      ids.trashed,
      ids.newerVersion,
    ]);
    expect(executes).toBe(1);
    expect([...covers.keys()].sort()).toEqual([ids.rendered, ids.hidden].sort());
  });

  it('never resolves another workspace’s cover, even when asked for its id', async () => {
    const covers = await resolveCovers(contextFor(owner), [ids.foreign]);
    expect(covers.size).toBe(0);
  });

  it('keeps every card on its placeholder when no derivatives bucket is configured', async () => {
    const library = await readProjectLibrary(contextFor(owner, { coverSigner: undefined }), {
      folderId: null,
      quotaBytes: 1,
    });
    expect(library.projects.every((project) => project.cover === null)).toBe(true);
  });

  it('shows the cover in the song and project headers, only where the project is visible', async () => {
    const song = await readSongWorkspace(contextFor(collaborator), ids.renderedSong);
    expect(song.cover?.srcSet).toContain('512w');
    const project = await readProjectWorkspace(contextFor(owner), ids.hidden);
    expect(project.cover).not.toBeNull();
    // A song shared on its own, inside a project this viewer cannot open: no project cover.
    const shared = await readSongWorkspace(contextFor(collaborator), ids.hiddenSong);
    expect(shared.cover).toBeNull();
    for (const key of hiddenKeys) expect(JSON.stringify(shared)).not.toContain(key);
  });
});
