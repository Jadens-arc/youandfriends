import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  ensureScopeLimitedMembership,
  lyricsDocuments,
  permissionGrants,
  songs,
  upsertGrant,
  withTransaction,
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
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '@/lib/library/context';

import { search, type SearchResults } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING search tests: ${reason}`);

/**
 * Search (task `045`) against a real database and the real resolver.
 *
 * The fixture has something on the far side of every boundary (CLAUDE.md §13):
 * - "Secret Sessions", a project whose song, lyrics, and files all carry words that appear
 *   **nowhere else** — `moonlight`, `whisper` — so any leak is a hit, not a coincidence;
 * - a collaborator who holds one song only (not its project), and a full member denied
 *   "Secret Sessions" — the two ways access is narrower than the workspace;
 * - a trashed song with a unique word;
 * - a foreign workspace whose song shares the owner's lyric phrase, so a missing tenant filter
 *   returns two hits where there should be one.
 */
describeWithDatabase('workspace search', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  const people = {} as Record<'owner' | 'songOnly' | 'denied', string>;
  const ids = {} as Record<'nightDrive' | 'headlights' | 'secret' | 'hidden' | 'percent', string>;

  function contextFor(userId: string): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
    };
  }

  async function lyrics(workspace: string, songId: string, plainText: string) {
    await db.insert(lyricsDocuments).values({
      id: testId(),
      workspaceId: workspace,
      songId,
      document: { type: 'doc', content: [] },
      plainText,
      updatedBy: people.owner,
    });
  }

  const everything = (results: SearchResults) => [
    ...results.projects,
    ...results.songs,
    ...results.lyrics,
    ...results.files,
  ];

  beforeAll(async () => {
    database = await createTestDatabase('workspace_search');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;

    const nightDrive = await makeProject(db, workspaceId, 'Night Drive');
    ids.nightDrive = nightDrive.id;
    const headlights = await makeSong(db, workspaceId, nightDrive.id, 'Headlights');
    ids.headlights = headlights.id;
    await lyrics(workspaceId, headlights.id, 'Verse\nNobody knows the long road home');
    await makeAsset(
      db,
      workspaceId,
      { songId: headlights.id },
      { kind: 'stem', name: 'Headlights drums.wav' },
    );
    await makeAsset(
      db,
      workspaceId,
      { projectId: nightDrive.id },
      { kind: 'artwork', name: 'Night drive cover.png' },
    );

    const secret = await makeProject(db, workspaceId, 'Secret Sessions');
    ids.secret = secret.id;
    const hidden = await makeSong(db, workspaceId, secret.id, 'Hidden Track');
    ids.hidden = hidden.id;
    await lyrics(workspaceId, hidden.id, 'Chorus\nMoonlight serenade, a whisper on the long road');
    await makeAsset(
      db,
      workspaceId,
      { songId: hidden.id },
      { kind: 'stem', name: 'Whisper vocal.wav' },
    );
    await makeAsset(
      db,
      workspaceId,
      { projectId: secret.id },
      { kind: 'project_file', name: 'Secret Headlights session.logicx' },
    );

    const trashed = await makeSong(db, workspaceId, nightDrive.id, 'Thrown Away');
    await lyrics(workspaceId, trashed.id, 'Verse\nquicksilver');
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, trashed.id));

    ids.percent = (await makeProject(db, workspaceId, '100% Real')).id;

    people.songOnly = (await makeUser(db)).id;
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspaceId, people.songOnly, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId,
        scopeType: 'song',
        scopeId: headlights.id,
        subjectKind: 'member',
        subjectId: people.songOnly,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: people.owner,
      });
    });

    people.denied = (await makeUser(db)).id;
    await addMember(db, workspaceId, people.denied, 'editor');
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId,
      scopeType: 'project',
      scopeId: secret.id,
      subjectKind: 'member',
      subjectId: people.denied,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });

    const foreign = await makeTenant(db);
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Night Drive (theirs)');
    const foreignSong = await makeSong(db, foreign.workspace.id, foreignProject.id, 'Headlights');
    await lyrics(foreign.workspace.id, foreignSong.id, 'Verse\nthe long road home, theirs');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('finds a song by a lyric phrase, with the words that matched marked', async () => {
    const results = await search(contextFor(people.owner), 'long road home');
    expect(results.lyrics.map((hit) => hit.id)).toEqual([ids.headlights]);
    const hit = results.lyrics[0];
    expect(hit?.href).toBe(`/songs/${ids.headlights}?tab=lyrics`);
    expect(hit?.detail).toBe('Night Drive');
    expect(hit?.snippet.filter((run) => run.match).map((run) => run.text.toLowerCase())).toEqual([
      'long',
      'road',
      'home',
    ]);
  });

  it('matches words still being typed, and survives tsquery syntax', async () => {
    expect((await search(contextFor(people.owner), 'moonli')).lyrics.map((hit) => hit.id)).toEqual([
      ids.hidden,
    ]);
    await expect(
      search(contextFor(people.owner), "long | !road & ( 'home:"),
    ).resolves.toBeDefined();
    expect((await search(contextFor(people.owner), '!!!')).lyrics).toEqual([]);
  });

  it('searches project names, song titles, and file names', async () => {
    const results = await search(contextFor(people.owner), 'headlights');
    expect(results.songs.map((hit) => hit.title)).toEqual(['Headlights']);
    expect(results.files.map((hit) => hit.title).sort()).toEqual([
      'Headlights drums.wav',
      'Secret Headlights session.logicx',
    ]);
    expect(results.files.find((hit) => hit.title === 'Headlights drums.wav')).toMatchObject({
      detail: 'Stem · Headlights',
      href: `/songs/${ids.headlights}?tab=files`,
    });
    expect((await search(contextFor(people.owner), 'night')).projects.map((hit) => hit.id)).toEqual(
      [ids.nightDrive],
    );
  });

  it('treats % and _ as characters, not wildcards', async () => {
    expect((await search(contextFor(people.owner), '100%')).projects.map((hit) => hit.id)).toEqual([
      ids.percent,
    ]);
    expect(everything(await search(contextFor(people.owner), '_'))).toEqual([]);
  });

  it('never finds a trashed song', async () => {
    expect(everything(await search(contextFor(people.owner), 'quicksilver'))).toEqual([]);
    expect(everything(await search(contextFor(people.owner), 'thrown away'))).toEqual([]);
  });

  it('gives a one-song collaborator nothing from anywhere else — not even a count', async () => {
    const context = contextFor(people.songOnly);
    for (const term of ['moonlight', 'whisper', 'secret', 'hidden', 'night drive cover']) {
      expect(everything(await search(context, term))).toEqual([]);
    }
    const road = await search(context, 'long road');
    expect(road.lyrics.map((hit) => hit.id)).toEqual([ids.headlights]);
    // Their song is shared on its own: the project around it stays unnamed.
    expect(road.lyrics[0]?.detail).toBeNull();
    const titles = await search(context, 'headlights');
    expect(titles.songs.map((hit) => [hit.id, hit.detail])).toEqual([[ids.headlights, null]]);
    expect(titles.files.map((hit) => hit.title)).toEqual(['Headlights drums.wav']);
    expect(titles.projects).toEqual([]);
  });

  it('honours a deny on one project for an otherwise full member', async () => {
    const context = contextFor(people.denied);
    for (const term of ['moonlight', 'whisper', 'secret', 'hidden track']) {
      expect(everything(await search(context, term))).toEqual([]);
    }
    expect((await search(context, 'long road')).lyrics.map((hit) => hit.id)).toEqual([
      ids.headlights,
    ]);
    expect((await search(context, 'night')).projects.map((hit) => hit.id)).toEqual([
      ids.nightDrive,
    ]);
  });

  it('with no query, offers what this person opened lately', async () => {
    const results = await search(contextFor(people.owner), '   ');
    expect(results.query).toBe('');
    expect(results.recent).toEqual([]);
    expect(everything(results)).toEqual([]);
  });
});
