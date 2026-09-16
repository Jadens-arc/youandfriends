import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assetVersions,
  assets,
  derivatives,
  mixVersions,
  snapshots,
  songs,
  storageObjects,
} from '../schema/index';
import {
  expectDatabaseError,
  makeAsset,
  makeAssetVersion,
  makeMixVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  SQLSTATE,
  testId,
} from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING file-layer tests: ${reason}`);
}

describeWithDatabase('the file layer', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('file_layer');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function makeContext() {
    const { workspace } = await makeTenant(database.db);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`);
    const song = await makeSong(database.db, workspace.id, project.id, 'Blue Hour');
    const object = await makeStorageObject(database.db, workspace.id);
    const asset = await makeAsset(database.db, workspace.id, { songId: song.id });
    return { workspaceId: workspace.id, project, song, object, asset };
  }

  describe('originals are sacred (THREAT_MODEL T8)', () => {
    it('refuses to repoint a version at different bytes', async () => {
      const { workspaceId, asset, object } = await makeContext();
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      const other = await makeStorageObject(database.db, workspaceId);

      // The single most important property in the schema: a new upload creates a version,
      // never an overwrite. Enforced by the database, not by the upload path.
      await expectDatabaseError(
        database.db
          .update(assetVersions)
          .set({ storageObjectId: other.id })
          .where(eq(assetVersions.id, version.id)),
        SQLSTATE.insufficientPrivilege,
        /immutable.*storage_object_id/,
      );
    });

    it('refuses to move a version to another asset, or renumber it', async () => {
      const { workspaceId, asset, object, song } = await makeContext();
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      const otherAsset = await makeAsset(
        database.db,
        workspaceId,
        { songId: song.id },
        { name: 'Other' },
      );

      await expectDatabaseError(
        database.db
          .update(assetVersions)
          .set({ assetId: otherAsset.id })
          .where(eq(assetVersions.id, version.id)),
        SQLSTATE.insufficientPrivilege,
        /asset_id/,
      );
      await expectDatabaseError(
        database.db
          .update(assetVersions)
          .set({ versionNumber: 9 })
          .where(eq(assetVersions.id, version.id)),
        SQLSTATE.insufficientPrivilege,
        /version_number/,
      );
    });

    it('guards every byte-identifying column, not only the obvious ones', async () => {
      const { workspaceId, asset, object } = await makeContext();
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      const other = await makeTenant(database.db);

      // A review pointed out that only three of the six guarded columns were tested; the
      // other three CASE arms could have broken silently.
      await expectDatabaseError(
        database.db
          .update(assetVersions)
          .set({ workspaceId: other.workspace.id })
          .where(eq(assetVersions.id, version.id)),
        SQLSTATE.insufficientPrivilege,
        /immutable.*workspace_id/,
      );
      await expectDatabaseError(
        database.db
          .update(assetVersions)
          .set({ uploadedBy: testId() })
          .where(eq(assetVersions.id, version.id)),
        SQLSTATE.insufficientPrivilege,
        /immutable.*uploaded_by/,
      );
      await expectDatabaseError(
        database.db
          .update(assetVersions)
          .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
          .where(eq(assetVersions.id, version.id)),
        SQLSTATE.insufficientPrivilege,
        /immutable.*created_at/,
      );
    });

    it('still lets the media pipeline write what it learned', async () => {
      const { workspaceId, asset, object } = await makeContext();
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);

      // Analysis columns describe the bytes; they are not the bytes. An ffprobe pass that
      // failed and was retried has to be able to write its answer.
      await expect(
        database.db
          .update(assetVersions)
          .set({
            durationMs: 214_000,
            codec: 'pcm_s24le',
            sampleRateHz: 48_000,
            integratedLufs: -14.2,
            processingState: 'complete',
          })
          .where(eq(assetVersions.id, version.id)),
      ).resolves.toBeDefined();

      const [row] = await database.db
        .select()
        .from(assetVersions)
        .where(eq(assetVersions.id, version.id));
      expect(row?.durationMs).toBe(214_000);
      expect(row?.processingState).toBe('complete');
    });

    it('refuses to change a storage object\u2019s checksum or key', async () => {
      const { object } = await makeContext();

      // A row whose checksum no longer matches its object makes reconciliation compare
      // against a fiction.
      await expectDatabaseError(
        database.db
          .update(storageObjects)
          .set({ checksumSha256: Array.from({ length: 8 }, () => 'cafebabe').join('') })
          .where(eq(storageObjects.id, object.id)),
        SQLSTATE.insufficientPrivilege,
        /immutable/,
      );
      await expectDatabaseError(
        database.db
          .update(storageObjects)
          .set({ key: 'somewhere/else' })
          .where(eq(storageObjects.id, object.id)),
        SQLSTATE.insufficientPrivilege,
        /immutable/,
      );
    });

    it('refuses to delete an object a version still claims', async () => {
      const { workspaceId, asset, object } = await makeContext();
      await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);

      await expectDatabaseError(
        database.db.delete(storageObjects).where(eq(storageObjects.id, object.id)),
        SQLSTATE.foreignKeyViolation,
        /asset_versions/,
      );
    });
  });

  describe('the version stack and its current pointer', () => {
    it('makes the newest mix current automatically', async () => {
      const { workspaceId, song, asset } = await makeContext();

      const ids: string[] = [];
      for (let number = 1; number <= 3; number += 1) {
        const object = await makeStorageObject(database.db, workspaceId);
        const version = await makeAssetVersion(
          database.db,
          workspaceId,
          asset.id,
          object.id,
          number,
        );
        const mix = await makeMixVersion(database.db, workspaceId, song.id, version.id, number);
        ids.push(mix.id);
      }

      // docs/DESIGN.md §2: the latest upload becomes current automatically while all earlier
      // versions remain available.
      const [row] = await database.db.select().from(songs).where(eq(songs.id, song.id));
      expect(row?.currentVersionId).toBe(ids[2]);

      const stack = await database.db
        .select({ id: mixVersions.id })
        .from(mixVersions)
        .where(eq(mixVersions.songId, song.id));
      expect(stack).toHaveLength(3);
    });

    it('does not move the pointer backwards for a back-filled version', async () => {
      const { workspaceId, song, asset } = await makeContext();

      const makeMix = async (number: number) => {
        const object = await makeStorageObject(database.db, workspaceId);
        const version = await makeAssetVersion(
          database.db,
          workspaceId,
          asset.id,
          object.id,
          number,
        );
        return makeMixVersion(database.db, workspaceId, song.id, version.id, number);
      };

      await makeMix(1);
      const newest = await makeMix(3);
      await makeMix(2);

      // A repair or an out-of-order import must not silently move the pointer past a newer
      // mix someone is already listening to.
      const [row] = await database.db.select().from(songs).where(eq(songs.id, song.id));
      expect(row?.currentVersionId).toBe(newest.id);
    });

    it('clears the pointer when the current mix is deleted', async () => {
      const { workspaceId, song, asset } = await makeContext();
      const object = await makeStorageObject(database.db, workspaceId);
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      const mix = await makeMixVersion(database.db, workspaceId, song.id, version.id, 1);

      // A bare `ON DELETE SET NULL` on this composite key nulls *every* referencing column —
      // including `songs.id` — so the delete failed with a not-null violation naming the
      // wrong problem entirely. The column list confines it to the pointer. Found in review.
      await expect(
        database.db.delete(mixVersions).where(eq(mixVersions.id, mix.id)),
      ).resolves.toBeDefined();

      const [row] = await database.db.select().from(songs).where(eq(songs.id, song.id));
      expect(row?.currentVersionId).toBeNull();
    });

    it('leaves the pointer alone when an older mix is deleted', async () => {
      const { workspaceId, song, asset } = await makeContext();
      const makeMix = async (number: number) => {
        const object = await makeStorageObject(database.db, workspaceId);
        const version = await makeAssetVersion(
          database.db,
          workspaceId,
          asset.id,
          object.id,
          number,
        );
        return makeMixVersion(database.db, workspaceId, song.id, version.id, number);
      };

      const older = await makeMix(1);
      const current = await makeMix(2);

      await database.db.delete(mixVersions).where(eq(mixVersions.id, older.id));

      const [row] = await database.db.select().from(songs).where(eq(songs.id, song.id));
      expect(row?.currentVersionId).toBe(current.id);
    });

    it('refuses to point a song at another song\u2019s version', async () => {
      const { workspaceId, song, asset, project } = await makeContext();
      const other = await makeSong(database.db, workspaceId, project.id, 'Different');
      const object = await makeStorageObject(database.db, workspaceId);
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      const mix = await makeMixVersion(database.db, workspaceId, song.id, version.id, 1);

      // The composite foreign key, not a trigger: a trigger is one more thing that can be
      // dropped, disabled, or raced.
      await expectDatabaseError(
        database.db.update(songs).set({ currentVersionId: mix.id }).where(eq(songs.id, other.id)),
        SQLSTATE.foreignKeyViolation,
        /songs_current_version_belongs_to_song/,
      );
    });

    it('numbers versions uniquely per song', async () => {
      const { workspaceId, song, asset } = await makeContext();
      const object = await makeStorageObject(database.db, workspaceId);
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      await makeMixVersion(database.db, workspaceId, song.id, version.id, 1);

      await expectDatabaseError(
        makeMixVersion(database.db, workspaceId, song.id, version.id, 1),
        SQLSTATE.uniqueViolation,
        /mix_versions_song_number_key/,
      );
    });
  });

  describe('derivatives', () => {
    it('allows several per version, so Opus and HLS are rows rather than migrations', async () => {
      const { workspaceId, asset, object } = await makeContext();
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);

      for (const [kind, variant] of [
        ['streaming_audio', 'aac-192k'],
        ['streaming_audio', 'opus-96k'],
        ['waveform_peaks', 'default'],
        ['thumbnail', 'default'],
      ] as const) {
        await expect(
          database.db.insert(derivatives).values({
            id: testId(),
            workspaceId,
            assetVersionId: version.id,
            kind,
            variant,
          }),
        ).resolves.toBeDefined();
      }

      const rows = await database.db
        .select()
        .from(derivatives)
        .where(eq(derivatives.assetVersionId, version.id));
      expect(rows).toHaveLength(4);
    });

    it('refuses a duplicate of the same kind and variant', async () => {
      const { workspaceId, asset, object } = await makeContext();
      const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
      const row = { workspaceId, assetVersionId: version.id, kind: 'waveform_peaks' as const };

      await database.db.insert(derivatives).values({ id: testId(), ...row });
      await expectDatabaseError(
        database.db.insert(derivatives).values({ id: testId(), ...row }),
        SQLSTATE.uniqueViolation,
        /derivatives_version_kind_variant_key/,
      );
    });
  });

  describe('one Project Files area', () => {
    it('organizes by folder path and tags, with no DAW anywhere in the schema', async () => {
      const { workspaceId, song } = await makeContext();

      const [row] = await database.db
        .insert(assets)
        .values({
          id: testId(),
          workspaceId,
          songId: song.id,
          kind: 'project_file',
          name: 'Blue Hour.logicx.zip',
          folderPath: '/Sessions/2026/',
          tags: ['logic', 'mixdown'],
        })
        .returning();

      expect(row?.folderPath).toBe('/Sessions/2026/');
      expect(row?.tags).toEqual(['logic', 'mixdown']);

      // The moment the schema names a DAW, the product has an opinion about which DAWs exist.
      const { rows: columns } = await database.db.execute(sql`
        select column_name from information_schema.columns where table_name = 'assets'
      `);
      const names = columns.map((column) => (column as { column_name: string }).column_name);
      expect(names.some((name) => /logic|mpc|ableton|daw/i.test(name))).toBe(false);
    });

    it('rejects a folder path that escapes the area', async () => {
      const { workspaceId, song } = await makeContext();

      for (const folderPath of ['/../', '/a/../b/', 'no-leading-slash/', '/missing-trailing']) {
        await expectDatabaseError(
          database.db.insert(assets).values({
            id: testId(),
            workspaceId,
            songId: song.id,
            kind: 'project_file',
            name: 'x',
            folderPath,
          }),
          SQLSTATE.checkViolation,
          /assets_folder_path_normalized/,
        );
      }
    });

    it('requires exactly one owner', async () => {
      const { workspaceId, song, project } = await makeContext();

      // Neither leaves the asset unreachable from any surface; both makes "where does this
      // live" a question with two answers.
      for (const owner of [
        { songId: null, projectId: null },
        { songId: song.id, projectId: project.id },
      ]) {
        await expectDatabaseError(
          database.db
            .insert(assets)
            .values({ id: testId(), workspaceId, kind: 'stem', name: 'x', ...owner }),
          SQLSTATE.checkViolation,
          /assets_one_owner/,
        );
      }
    });
  });

  describe('snapshot paths are untrusted input (THREAT_MODEL T4)', () => {
    async function makeSnapshot(workspaceId: string, projectId: string) {
      const [row] = await database.db
        .insert(snapshots)
        .values({ id: testId(), workspaceId, projectId, source: 'mac_agent', name: 'Session' })
        .returning();
      if (!row) throw new Error('snapshot insert returned nothing');
      return row;
    }

    const insertEntry = async (workspaceId: string, snapshotId: string, relativePath: string) =>
      database.db.execute(sql`
        insert into snapshot_entries (id, workspace_id, snapshot_id, relative_path, size_bytes)
        values (${testId()}, ${workspaceId}, ${snapshotId}, ${relativePath}, 10)
      `);

    it('rejects traversal, absolute paths, and every way of writing one twice', async () => {
      const { workspaceId, project } = await makeContext();
      const snapshot = await makeSnapshot(workspaceId, project.id);

      const rejected = [
        '../escape.wav',
        'a/../../escape.wav',
        'a/../b.wav',
        '/absolute.wav',
        'C:/windows.wav',
        'a\\b.wav',
        './here.wav',
        'a//b.wav',
        'trailing/',
        '',

        // Every one of these passed the first version of this constraint. A security review
        // found them; each normalizes, decodes, or splits into a traversal downstream.
        '..\uFF0F..\uFF0Fetc\uFF0Fpasswd', // fullwidth solidus, NFKC → ../../
        '\uFF0E\uFF0E/etc/passwd', // fullwidth full stop → ..
        '\u2024\u2024/etc/passwd', // one-dot leader → ..
        '%2e%2e/%2e%2e/etc/passwd', // one decodeURIComponent away
        'a/..%2f..%2fetc/passwd',
        'a.wav\n../secret.wav', // a line-wise reader sees ../
        'a.wav\n..',
        '~/.ssh/id_rsa',
        'a/ .. /b.wav',
        'cafe\u0301.wav', // NFD: the same file as café.wav, spelled twice
        'a'.repeat(1025),
        `${'a/'.repeat(600)}b.wav`,
      ];

      // Rejected at the schema boundary, not only where the upload is parsed: there will be
      // more than one writer — the browser path, the Mac agent, a future import — and this is
      // the one place all of them pass through.
      for (const path of rejected) {
        await expectDatabaseError(
          insertEntry(workspaceId, snapshot.id, path),
          SQLSTATE.checkViolation,
          /relative_path_safe/,
        );
      }
    });

    it('accepts ordinary nested paths, including dots inside a name', async () => {
      const { workspaceId, project } = await makeContext();
      const snapshot = await makeSnapshot(workspaceId, project.id);

      // Over-rejection is its own failure: `..` inside a filename is not traversal.
      for (const path of ['Audio Files/Take 1.wav', 'a/b/c/d.logicx', 'my..file.wav', 'x.wav']) {
        await expect(insertEntry(workspaceId, snapshot.id, path)).resolves.toBeDefined();
      }
    });

    it('seals a snapshot once it is finalized', async () => {
      const { workspaceId, project } = await makeContext();
      const snapshot = await makeSnapshot(workspaceId, project.id);
      await insertEntry(workspaceId, snapshot.id, 'a.wav');

      await database.db
        .update(snapshots)
        .set({ finalizedAt: new Date() })
        .where(eq(snapshots.id, snapshot.id));

      // A snapshot that can be edited afterwards records what someone later wished had been
      // there, which is a different and much less useful thing.
      await expectDatabaseError(
        database.db.update(snapshots).set({ name: 'Renamed' }).where(eq(snapshots.id, snapshot.id)),
        SQLSTATE.insufficientPrivilege,
        /finalized/,
      );
      await expectDatabaseError(
        insertEntry(workspaceId, snapshot.id, 'b.wav'),
        SQLSTATE.insufficientPrivilege,
        /finalized/,
      );
    });

    it('still allows a finalized snapshot to be trashed', async () => {
      const { workspaceId, project } = await makeContext();
      const snapshot = await makeSnapshot(workspaceId, project.id);
      await database.db
        .update(snapshots)
        .set({ finalizedAt: new Date() })
        .where(eq(snapshots.id, snapshot.id));

      // Trashing a snapshot is not editing it. Read back rather than trusting the update to
      // resolve: a zero-row update resolves too, which is what this test used to prove.
      const deletedAt = new Date();
      await database.db
        .update(snapshots)
        .set({ deletedAt, purgeAfter: deletedAt, deletedBatch: testId() })
        .where(eq(snapshots.id, snapshot.id));

      const [row] = await database.db.select().from(snapshots).where(eq(snapshots.id, snapshot.id));
      expect(row?.deletedAt).toEqual(deletedAt);
    });
  });
});

describeWithDatabase('a parent is always in the same workspace (THREAT_MODEL T1)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('file_layer_tenancy');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function twoWorkspaces() {
    const mine = await makeTenant(database.db);
    const theirs = await makeTenant(database.db);
    const theirProject = await makeProject(database.db, theirs.workspace.id, `Theirs ${testId()}`);
    const theirSong = await makeSong(database.db, theirs.workspace.id, theirProject.id, 'Theirs');
    const theirObject = await makeStorageObject(database.db, theirs.workspace.id);
    const theirAsset = await makeAsset(database.db, theirs.workspace.id, { songId: theirSong.id });

    return {
      mine: mine.workspace.id,
      theirs: theirs.workspace.id,
      theirProject,
      theirSong,
      theirObject,
      theirAsset,
    };
  }

  it('refuses an asset in one workspace pointing at another’s song', async () => {
    const { mine, theirSong } = await twoWorkspaces();

    // Nothing in the product would write this. But "nothing would write that" is a claim
    // about code, and T1 asks for a claim about the database.
    await expectDatabaseError(
      makeAsset(database.db, mine, { songId: theirSong.id }),
      SQLSTATE.foreignKeyViolation,
      /assets_song_same_workspace/,
    );
  });

  it('refuses an asset pointing at another workspace’s project', async () => {
    const { mine, theirProject } = await twoWorkspaces();

    await expectDatabaseError(
      makeAsset(database.db, mine, { projectId: theirProject.id }),
      SQLSTATE.foreignKeyViolation,
      /assets_project_same_workspace/,
    );
  });

  it('refuses a version claiming another workspace’s storage object', async () => {
    const { mine, theirObject } = await twoWorkspaces();
    const project = await makeProject(database.db, mine, `Mine ${testId()}`);
    const song = await makeSong(database.db, mine, project.id, 'Mine');
    const asset = await makeAsset(database.db, mine, { songId: song.id });

    // The sharpest one: a version pointing at a storage object in another tenant would make a
    // presigned URL for someone else's bytes reachable through my own workspace.
    await expectDatabaseError(
      makeAssetVersion(database.db, mine, asset.id, theirObject.id, 1),
      SQLSTATE.foreignKeyViolation,
      /asset_versions_object_same_workspace/,
    );
  });

  it('refuses a version belonging to another workspace’s asset', async () => {
    const { mine, theirAsset } = await twoWorkspaces();
    const object = await makeStorageObject(database.db, mine);

    await expectDatabaseError(
      makeAssetVersion(database.db, mine, theirAsset.id, object.id, 1),
      SQLSTATE.foreignKeyViolation,
      /asset_versions_asset_same_workspace/,
    );
  });

  it('refuses a mix version in one workspace for another’s song', async () => {
    const { mine, theirSong } = await twoWorkspaces();
    const project = await makeProject(database.db, mine, `Mine ${testId()}`);
    const song = await makeSong(database.db, mine, project.id, 'Mine');
    const asset = await makeAsset(database.db, mine, { songId: song.id });
    const object = await makeStorageObject(database.db, mine);
    const version = await makeAssetVersion(database.db, mine, asset.id, object.id, 1);

    await expectDatabaseError(
      makeMixVersion(database.db, mine, theirSong.id, version.id, 1),
      SQLSTATE.foreignKeyViolation,
      /mix_versions_song_same_workspace/,
    );
  });

  it('refuses a derivative claiming another workspace\u2019s storage object', async () => {
    const { mine, theirObject } = await twoWorkspaces();
    const project = await makeProject(database.db, mine, `Mine ${testId()}`);
    const song = await makeSong(database.db, mine, project.id, 'Mine');
    const asset = await makeAsset(database.db, mine, { songId: song.id });
    const object = await makeStorageObject(database.db, mine);
    const version = await makeAssetVersion(database.db, mine, asset.id, object.id, 1);

    // The first pass paired `asset_versions` and missed this one and `snapshots`, which made
    // the class *look* closed. A derivative is the streamable audio: a row in my workspace
    // pointing at their object is a stream endpoint handing me their music.
    await expectDatabaseError(
      database.db.insert(derivatives).values({
        id: testId(),
        workspaceId: mine,
        assetVersionId: version.id,
        kind: 'streaming_audio',
        storageObjectId: theirObject.id,
      }),
      SQLSTATE.foreignKeyViolation,
      /derivatives_object_same_workspace/,
    );
  });

  it('refuses a snapshot claiming another workspace\u2019s storage object', async () => {
    const { mine, theirObject } = await twoWorkspaces();
    const project = await makeProject(database.db, mine, `Mine ${testId()}`);

    // A snapshot's object is the ZIP of an entire project folder.
    await expectDatabaseError(
      database.db.insert(snapshots).values({
        id: testId(),
        workspaceId: mine,
        projectId: project.id,
        source: 'mac_agent',
        name: 'Theirs',
        storageObjectId: theirObject.id,
      }),
      SQLSTATE.foreignKeyViolation,
      /snapshots_object_same_workspace/,
    );
  });

  it('nulls a derivative\u2019s object when the object is deleted', async () => {
    const { mine } = await twoWorkspaces();
    const project = await makeProject(database.db, mine, `Mine ${testId()}`);
    const song = await makeSong(database.db, mine, project.id, 'Mine');
    const asset = await makeAsset(database.db, mine, { songId: song.id });
    const object = await makeStorageObject(database.db, mine);
    const version = await makeAssetVersion(database.db, mine, asset.id, object.id, 1);
    const derivativeObject = await makeStorageObject(database.db, mine);
    const derivativeId = testId();

    await database.db.insert(derivatives).values({
      id: derivativeId,
      workspaceId: mine,
      assetVersionId: version.id,
      kind: 'waveform_peaks',
      storageObjectId: derivativeObject.id,
    });

    // Derivatives are regenerable, so losing the object is survivable — the row stays and
    // says what is missing. An original in the same position is refused instead.
    await database.db.delete(storageObjects).where(eq(storageObjects.id, derivativeObject.id));

    const [row] = await database.db
      .select()
      .from(derivatives)
      .where(eq(derivatives.id, derivativeId));
    expect(row?.storageObjectId).toBeNull();
  });

  it('still allows every reference within one workspace', async () => {
    const { mine } = await twoWorkspaces();
    const project = await makeProject(database.db, mine, `Mine ${testId()}`);
    const song = await makeSong(database.db, mine, project.id, 'Mine');
    const asset = await makeAsset(database.db, mine, { songId: song.id });
    const object = await makeStorageObject(database.db, mine);
    const version = await makeAssetVersion(database.db, mine, asset.id, object.id, 1);

    // Over-constraining would be its own failure: the ordinary case has to keep working.
    await expect(makeMixVersion(database.db, mine, song.id, version.id, 1)).resolves.toBeDefined();
  });
});
