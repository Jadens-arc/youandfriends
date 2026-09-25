import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import { auditEvents, lyricsRevisions, songs, type DirectDatabase } from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
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
import * as Y from 'yjs';

import type { LibraryContext } from '@/lib/library/context';

import { AUTO_FLOOR_MINUTES } from '../revisions-policy';
import { createCheckpoint, listRevisions, readRevision, restoreRevision } from '../revisions';
import { readLyrics, saveLyrics } from '../service';
import { lyricsToText, textToLyrics } from '../text-format';
import { documentFromYjs, fromBase64 } from '../yjs';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING lyric revision tests: ${reason}`);

const DRAFT_ONE = '[Verse]\nHeadlights on the long road home\nNobody knows where the night goes';
const DRAFT_TWO =
  '[Verse]\nTail lights fading into the rain\nEverybody knows it will not come again\n[Chorus]\nStay';

/**
 * Lyric revisions (task `084`) against a real database. The fixture has a viewer and a stranger,
 * a second song whose revision ids are valid but not this song's, a foreign workspace and a
 * trashed song that both hold revisions — so every 404 has a real row behind it to leak.
 */
describeWithDatabase('lyric revisions', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let clock = new Date('2026-09-24T09:00:00Z');
  const people = {} as Record<'owner' | 'editor' | 'viewer' | 'stranger', string>;
  const ids = {} as Record<
    'song' | 'other' | 'otherRevision' | 'foreignRevision' | 'trashed' | 'trashedRevision',
    string
  >;

  function contextFor(userId: string): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      now: () => clock,
    };
  }

  const later = (minutes: number) => {
    clock = new Date(clock.getTime() + minutes * 60_000);
  };

  async function save(userId: string, songId: string, text: string, lifecycle = false) {
    const { version } = await readLyrics(contextFor(userId), songId);
    return saveLyrics(contextFor(userId), songId, {
      document: textToLyrics(text),
      baseVersion: version,
      lifecycle,
    });
  }

  async function refusal(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  const revisionRow = (workspace: string, songId: string, kind: 'automatic' | 'checkpoint') => ({
    id: testId(),
    workspaceId: workspace,
    songId,
    kind,
    name: kind === 'checkpoint' ? 'Secret draft' : null,
    document: textToLyrics('[Verse]\nsecret words'),
    plainText: 'Verse\nsecret words',
    sourceVersion: 1,
  });

  beforeAll(async () => {
    database = await createTestDatabase('lyric_revisions');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    for (const role of ['editor', 'viewer'] as const) {
      people[role] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[role], role);
    }
    people.stranger = (await makeUser(db)).id;
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.other = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    const other = revisionRow(workspaceId, ids.other, 'checkpoint');
    ids.otherRevision = other.id;
    await db.insert(lyricsRevisions).values(other);
    ids.trashed = (await makeSong(db, workspaceId, project.id, 'Thrown Away')).id;
    const trashed = revisionRow(workspaceId, ids.trashed, 'checkpoint');
    ids.trashedRevision = trashed.id;
    await db.insert(lyricsRevisions).values(trashed);
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, ids.trashed));
    const foreign = await makeTenant(db);
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    const foreignSong = await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased');
    const foreignRevision = revisionRow(foreign.workspace.id, foreignSong.id, 'checkpoint');
    ids.foreignRevision = foreignRevision.id;
    await db.insert(lyricsRevisions).values(foreignRevision);
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('snapshots the first words, then only meaningful change past the time floor', async () => {
    await save(people.editor, ids.song, DRAFT_ONE);
    // A real change, but inside the time floor.
    later(1);
    await save(people.editor, ids.song, `${DRAFT_ONE}\nand a new third line, soon after the first`);
    // Past the floor, but back to the first draft with a typo: small against the last revision.
    later(AUTO_FLOOR_MINUTES);
    await save(people.editor, ids.song, DRAFT_ONE.replace('Nobody', 'Nobdy'));
    expect((await listRevisions(contextFor(people.owner), ids.song)).length).toBe(1);

    later(AUTO_FLOOR_MINUTES);
    await save(people.editor, ids.song, DRAFT_TWO);
    const revisions = await listRevisions(contextFor(people.owner), ids.song);
    expect(revisions.map((revision) => revision.kind)).toEqual(['automatic', 'automatic']);
    expect(revisions[0]?.author).not.toBeNull();
  });

  it('keeps named checkpoints for editors, and refuses one without a name or rights', async () => {
    later(1);
    const checkpoint = await createCheckpoint(contextFor(people.editor), ids.song, {
      name: '  Second draft  ',
    });
    expect(checkpoint).toMatchObject({ kind: 'checkpoint', name: 'Second draft' });
    expect(
      (await refusal(createCheckpoint(contextFor(people.editor), ids.song, { name: ' ' })))
        .publicCode,
    ).toBe('validation_failed');
    expect(
      (await refusal(createCheckpoint(contextFor(people.viewer), ids.song, { name: 'x' })))
        .publicCode,
    ).toBe('not_found');
    const [newest] = await listRevisions(contextFor(people.viewer), ids.song);
    expect(newest).toMatchObject({ kind: 'checkpoint', name: 'Second draft' });
  });

  it('shows revisions only of this song, to people who can see it', async () => {
    const owner = contextFor(people.owner);
    for (const revisionId of [ids.otherRevision, ids.foreignRevision, ids.trashedRevision]) {
      expect((await refusal(readRevision(owner, ids.song, revisionId))).publicCode).toBe(
        'not_found',
      );
      expect((await refusal(restoreRevision(owner, ids.song, revisionId))).publicCode).toBe(
        'not_found',
      );
    }
    expect((await refusal(listRevisions(owner, ids.trashed))).publicCode).toBe('not_found');
    expect((await refusal(listRevisions(contextFor(people.stranger), ids.song))).publicCode).toBe(
      'not_found',
    );
    const secret = await db
      .select()
      .from(lyricsRevisions)
      .where(eq(lyricsRevisions.id, ids.foreignRevision));
    expect(secret).toHaveLength(1);
  });

  it('restores without losing current work — the restore itself can be undone', async () => {
    const revisions = await listRevisions(contextFor(people.owner), ids.song);
    const first = revisions.at(-1);
    if (first === undefined) throw new Error('no first revision');
    expect(
      lyricsToText((await readRevision(contextFor(people.owner), ids.song, first.id)).document),
    ).toBe(DRAFT_ONE);

    later(1);
    expect(
      (await refusal(restoreRevision(contextFor(people.viewer), ids.song, first.id))).publicCode,
    ).toBe('not_found');
    const before = await readLyrics(contextFor(people.owner), ids.song);
    const restored = await restoreRevision(contextFor(people.editor), ids.song, first.id);
    expect(lyricsToText(restored.document)).toBe(DRAFT_ONE);
    expect(restored.version).toBe(before.version + 1);
    expect(lyricsToText((await readLyrics(contextFor(people.owner), ids.song)).document)).toBe(
      DRAFT_ONE,
    );

    // What was there is a revision now, and restoring it brings the rewrite back.
    const kept = await readRevision(contextFor(people.owner), ids.song, restored.beforeRevisionId);
    expect(kept.kind).toBe('before_restore');
    expect(lyricsToText(kept.document)).toBe(lyricsToText(before.document));
    later(1);
    await restoreRevision(contextFor(people.editor), ids.song, restored.beforeRevisionId);
    expect(lyricsToText((await readLyrics(contextFor(people.owner), ids.song)).document)).toBe(
      lyricsToText(before.document),
    );

    const audited = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'lyrics.revision_restored'), eq(auditEvents.targetId, ids.song)),
      );
    expect(audited).toHaveLength(2);
    expect(audited[0]?.metadata).toMatchObject({ revisionId: first.id });
  });

  it('hands collaborators the restore as an edit, so their copies land on it too', async () => {
    // A collaborator's editor, holding the shared state as it stands.
    const collaborator = new Y.Doc();
    Y.applyUpdate(
      collaborator,
      fromBase64((await readLyrics(contextFor(people.owner), ids.song)).yjsState),
    );
    const [newest] = (await listRevisions(contextFor(people.owner), ids.song)).filter(
      (revision) => revision.kind === 'checkpoint',
    );
    if (newest === undefined) throw new Error('no checkpoint');
    later(1);
    const restored = await restoreRevision(contextFor(people.editor), ids.song, newest.id);
    Y.applyUpdate(collaborator, fromBase64(restored.yjsUpdate));
    expect(lyricsToText(documentFromYjs(Y.encodeStateAsUpdate(collaborator)))).toBe(
      lyricsToText(restored.document),
    );
  });

  it('thins old automatic revisions, and never checkpoints', async () => {
    const old = (daysAgo: number, minutes: number, kind: 'automatic' | 'checkpoint') => ({
      ...revisionRow(workspaceId, ids.song, kind),
      createdAt: new Date(clock.getTime() - daysAgo * 86_400_000 - minutes * 60_000),
    });
    const sameHour = [old(3, 10, 'automatic'), old(3, 20, 'automatic')];
    const sameDay = [old(20, 60, 'automatic'), old(20, 120, 'automatic')];
    const ancient = [old(40, 0, 'checkpoint'), old(40, 1, 'checkpoint')];
    await db.insert(lyricsRevisions).values([...sameHour, ...sameDay, ...ancient]);

    later(AUTO_FLOOR_MINUTES);
    await save(
      people.editor,
      ids.song,
      `${DRAFT_TWO}\nA whole new closing line for the chorus here\n[Outro]\nthat changes how the song ends\nand how it feels at the very end`,
    );
    const remaining = new Set(
      (await listRevisions(contextFor(people.owner), ids.song)).map((revision) => revision.id),
    );
    expect(remaining.has(sameHour[0]!.id)).toBe(true);
    expect(remaining.has(sameHour[1]!.id)).toBe(false);
    expect(remaining.has(sameDay[0]!.id)).toBe(true);
    expect(remaining.has(sameDay[1]!.id)).toBe(false);
    for (const checkpoint of ancient) expect(remaining.has(checkpoint.id)).toBe(true);
  });
});
