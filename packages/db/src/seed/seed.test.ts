import { spawnSync } from 'node:child_process';
import { databaseUrl } from '@youandfriends/config/fixtures';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeFolder, makeTenant } from '../__tests__/factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from '../__tests__/harness';
import {
  assetVersions,
  assets,
  folders,
  mixVersions,
  permissionGrants,
  projects,
  favorites,
  songs,
  storageObjects,
  users,
  workspaceMemberships,
  workspaces,
} from '../schema/index';
import {
  SEED_FOLDERS,
  SEED_GRANTS,
  SEED_PROJECTS,
  SEED_SONGS,
  SEED_USERS,
  SEED_WORKSPACE_ID,
} from './data';
import {
  ENCODED_FORMATS,
  encoderAvailable,
  generateAllFixtures,
  generateWav,
  MAX_COMMITTED_FIXTURE_BYTES,
  WAV_FORMATS,
} from './fixtures/audio';
import { assertSeedAllowed, SEED_ALLOW_HOST_VAR, SeedRefusedError } from './guard';
import { deterministicId } from './ids';
import { reset, seed } from './index';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING seed tests: ${reason}`);
}

describe('the production guard fails closed', () => {
  // Assembled from parts, never a literal (CLAUDE.md §8). `no-secrets` runs on test files, and
  // a scanner cannot tell a fabricated connection string from a live one.
  const localUrl = ['postgres', '://', 'localhost', ':5433/', 'yaf'].join('');
  const base = { DATABASE_URL_UNPOOLED: localUrl };

  it('refuses when NODE_ENV is unset', () => {
    // Not "assume development". An unset NODE_ENV is the state of a shell someone opened to
    // run one command against a connection string they pasted.
    expect(() => assertSeedAllowed(base)).toThrow(SeedRefusedError);
    expect(() => assertSeedAllowed({ ...base, NODE_ENV: '' })).toThrow(/not set/);
  });

  it('refuses in production', () => {
    expect(() => assertSeedAllowed({ ...base, NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('refuses a Vercel production deployment even when NODE_ENV looks fine', () => {
    // Vercel builds previews with NODE_ENV=production, and the two variables mean different
    // things — a preview's database may be the real one.
    expect(() =>
      assertSeedAllowed({ ...base, NODE_ENV: 'development', VERCEL_ENV: 'production' }),
    ).toThrow(/VERCEL_ENV/);
  });

  it('refuses an unrecognised environment name', () => {
    expect(() => assertSeedAllowed({ ...base, NODE_ENV: 'staging' })).toThrow(/staging/);
  });

  it('refuses when there is no database configured', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it('refuses a remote database even when the environment says development', () => {
    // The criterion is "refuses to run against a production database", not "refuses to run in a
    // production environment". `.env.local` is exactly where a developer debugging an incident
    // puts a production connection string, and `NODE_ENV=development` is the ordinary dev
    // shell — so the label alone would have let the seed write to production.
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'development', DATABASE_URL_UNPOOLED: databaseUrl }),
    ).toThrow(/not local and is not named/);
  });

  it('refuses a URL whose host cannot be read', () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'development', DATABASE_URL_UNPOOLED: 'not a url' }),
    ).toThrow(/host can be read/);
  });

  it('allows a remote host only when that exact host is named', () => {
    const host = new URL(databaseUrl).hostname;
    const env = { NODE_ENV: 'development', DATABASE_URL_UNPOOLED: databaseUrl };

    expect(() => assertSeedAllowed({ ...env, [SEED_ALLOW_HOST_VAR]: host })).not.toThrow();

    // A suffix must not open the gate: `example.com` cannot vouch for `prod.example.com`.
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: 'development',
        DATABASE_URL_UNPOOLED: ['postgres', '://u:p@prod.', 'example.com/db'].join(''),
        [SEED_ALLOW_HOST_VAR]: 'example.com',
      }),
    ).toThrow(/not local and is not named/);
  });

  it('allows development and test against a local database', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() => assertSeedAllowed({ ...base, NODE_ENV })).not.toThrow();
    }
    expect(assertSeedAllowed({ ...base, NODE_ENV: 'test' }).host).toBe('localhost');
  });
});

describe('generated audio fixtures', () => {
  it('produces a valid RIFF/WAVE header', () => {
    const format = WAV_FORMATS[0];
    if (!format) throw new Error('no formats');
    const wav = generateWav(format);

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt16LE(22)).toBe(format.channels);
    expect(wav.readUInt32LE(24)).toBe(format.sampleRateHz);
    expect(wav.readUInt16LE(34)).toBe(format.bitDepth);
  });

  it('declares a data length that matches the bytes it wrote', () => {
    // A header that disagrees with its payload is the kind of file a decoder accepts and a
    // seek does not, which would make task `066` chase a ghost.
    for (const format of WAV_FORMATS) {
      const wav = generateWav(format);
      expect(wav.readUInt32LE(40)).toBe(wav.byteLength - 44);
      expect(wav.readUInt32LE(4)).toBe(wav.byteLength - 8);
    }
  });

  it('is deterministic, so a re-seed does not change a checksum', () => {
    const first = generateAllFixtures();
    const second = generateAllFixtures();
    expect(first.map((f) => f.checksumSha256)).toEqual(second.map((f) => f.checksumSha256));
  });

  it('stays under the documented size limit', () => {
    for (const fixture of generateAllFixtures()) {
      expect(fixture.sizeBytes).toBeLessThan(MAX_COMMITTED_FIXTURE_BYTES);
    }
  });

  it('reports encoder availability from the real ffmpeg, not a constant', () => {
    // A fixture that claimed to be a FLAC and was not would make task `066`'s media tests
    // pass against something that was never encoded — so this asks the binary.
    const ffmpeg = spawnSync(process.env.YOUANDFRIENDS_FFMPEG_PATH ?? 'ffmpeg', ['-version'], {
      stdio: 'ignore',
    });
    if (ffmpeg.status === 0) expect(typeof encoderAvailable()).toBe('boolean');
    else expect(encoderAvailable()).toBe(false);
    // Pointed at something that is not ffmpeg, it must say no rather than guess.
    const saved = process.env.YOUANDFRIENDS_FFMPEG_PATH;
    process.env.YOUANDFRIENDS_FFMPEG_PATH = '/nonexistent/ffmpeg';
    try {
      expect(encoderAvailable()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.YOUANDFRIENDS_FFMPEG_PATH;
      else process.env.YOUANDFRIENDS_FFMPEG_PATH = saved;
    }
    expect(ENCODED_FORMATS).toEqual(['flac', 'mp3', 'm4a']);
  });

  it('fades in and out, so the tone does not start on a discontinuity', () => {
    const format = WAV_FORMATS[0];
    if (!format) throw new Error('no formats');
    const wav = generateWav(format);

    // Without the fade the file starts and stops on a discontinuity, which is a click — and a
    // spurious true-peak reading in the loudness analysis task `062` runs over exactly these
    // fixtures.
    //
    // Stated independently of the generator: the fade is 50 ms, so a 20 ms window at either end
    // sits entirely inside it and can never reach more than 40% of full amplitude, while the
    // middle of the file is at full amplitude. Peaks are measured over a window rather than at a
    // single sample because the midpoint of a 440 Hz tone at 44.1 kHz lands exactly on a zero
    // crossing — one sample there proves nothing either way. With the fade removed every window
    // reads the same peak and the two ratio assertions below fail.
    const frameBytes = (format.bitDepth / 8) * format.channels;
    const peakOver = (startFrame: number, frames: number): number => {
      let peak = 0;
      for (let frame = startFrame; frame < startFrame + frames; frame += 1) {
        peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + frame * frameBytes)));
      }
      return peak;
    };

    const window = Math.floor(format.sampleRateHz * 0.02);
    const totalFrames = (wav.byteLength - 44) / frameBytes;
    const middlePeak = peakOver(Math.floor(totalFrames / 2) - window, window * 2);

    // The very first sample is silent, and the middle of the file is at the -6 dBFS the
    // generator documents.
    expect(wav.readInt16LE(44)).toBe(0);
    expect(middlePeak).toBeGreaterThan(15_000);

    // Both ends are still ramping, so neither can approach the middle.
    expect(peakOver(0, window)).toBeLessThan(middlePeak * 0.5);
    expect(peakOver(totalFrames - window, window)).toBeLessThan(middlePeak * 0.5);
  });
});

describe('deterministic ids', () => {
  it('gives the same label the same id, every time', () => {
    expect(deterministicId('song:blue-hour-1')).toBe(deterministicId('song:blue-hour-1'));
  });

  it('gives different labels different ids', () => {
    const ids = new Set(['a', 'b', 'c', 'song:x', 'user:x'].map((label) => deterministicId(label)));
    expect(ids.size).toBe(5);
  });

  it('is ULID-shaped, so the contracts accept it', async () => {
    const { isUlid } = await import('@youandfriends/contracts');
    for (const label of ['workspace', 'user:avery', 'song:blue-hour-1']) {
      expect(isUlid(deterministicId(label)), label).toBe(true);
    }
  });
});

describe('the seeded content includes the awkward cases', () => {
  it('has a title long enough to break a column', () => {
    const longest = SEED_SONGS.map((song) => song.title.length).sort((a, b) => b - a)[0] ?? 0;
    expect(longest).toBeGreaterThan(80);
  });

  it('has a project with no cover art and one with no folder', () => {
    expect(SEED_PROJECTS.some((project) => !project.hasCoverArt)).toBe(true);
    expect(SEED_PROJECTS.some((project) => project.folderKey === null)).toBe(true);
  });

  it('has a song with no versions and one with a failed job', () => {
    expect(SEED_SONGS.some((song) => song.versions === 0)).toBe(true);
    expect(SEED_SONGS.some((song) => song.failedJob === true)).toBe(true);
  });

  it('has an empty folder', () => {
    const withProjects = new Set(SEED_PROJECTS.map((project) => project.folderKey));
    const parents = new Set(SEED_FOLDERS.map((folder) => folder.parentKey));
    expect(
      SEED_FOLDERS.some((folder) => !withProjects.has(folder.key) && !parents.has(folder.key)),
    ).toBe(true);
  });

  it('covers every role and includes a deny override', () => {
    expect(new Set(SEED_USERS.map((user) => user.role))).toEqual(
      new Set(['owner', 'editor', 'commenter', 'viewer']),
    );
    expect(SEED_GRANTS.some((grant) => grant.isDeny === true)).toBe(true);
  });

  it('points every grant at a scope that exists', () => {
    // `permission_grants.scope_id` has no foreign key by design, so a typo produces a grant
    // pointing at nothing. `resolve()` drops a grant whose scope is not on the chain, which
    // makes the mistake silent: the seed would look fine and demonstrate nothing.
    const keys = {
      folder: new Set(SEED_FOLDERS.map((folder) => folder.key)),
      project: new Set(SEED_PROJECTS.map((project) => project.key)),
      song: new Set(SEED_SONGS.map((song) => song.key)),
    };

    for (const grant of SEED_GRANTS) {
      expect(keys[grant.scopeType].has(grant.scopeKey), `${grant.key} -> ${grant.scopeKey}`).toBe(
        true,
      );
      expect(
        SEED_USERS.some((user) => user.key === grant.userKey),
        `${grant.key} -> ${grant.userKey}`,
      ).toBe(true);
    }
  });

  it('gives every grant something to say that the membership does not', () => {
    // A grant that restates its grantee's workspace membership resolves to the same answer as
    // no grant at all. The seed would then show nothing about inheritance, and a resolver that
    // dropped scoped grants entirely would look correct in it. An earlier version of this seed
    // had three such grants; this is the check that caught them.
    for (const grant of SEED_GRANTS) {
      const membership = SEED_USERS.find((user) => user.key === grant.userKey);
      if (!membership) throw new Error(`no membership for ${grant.userKey}`);

      const changesRole = grant.isDeny === true || grant.role !== membership.role;
      const changesDownload =
        grant.canDownload !== undefined &&
        grant.canDownload !== null &&
        grant.canDownload !== membership.canDownload;

      expect(changesRole || changesDownload, `${grant.key} restates the membership`).toBe(true);
    }
  });

  it('separates download from role in both directions', () => {
    // `docs/DESIGN.md` §3's independence is invisible in a seed where download tracks role.
    // One direction is a membership (an editor who may not download); the other is a grant (a
    // viewer who may download, inside one project only), which also makes the grant visible.
    expect(SEED_USERS.some((user) => user.role === 'editor' && !user.canDownload)).toBe(true);

    const raised = SEED_GRANTS.find((grant) => grant.canDownload === true);
    expect(raised, 'a grant that raises canDownload').toBeDefined();
    const grantee = SEED_USERS.find((user) => user.key === raised?.userKey);
    expect(grantee?.canDownload, 'raised from a membership that says no').toBe(false);
  });
});

describeWithDatabase('running the seed', () => {
  let database: TestDatabase;

  // A real permit from the real guard. The tests run with NODE_ENV=test against the local
  // Postgres the harness uses, which is exactly what the guard is there to allow — so this is
  // the guard passing, not a fixture standing in for it.
  const permit = assertSeedAllowed({
    NODE_ENV: 'test',
    DATABASE_URL_UNPOOLED: ['postgres', '://', 'localhost', '/yaf'].join(''),
  });

  beforeAll(async () => {
    database = await createTestDatabase('seed');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('builds the workspace', async () => {
    const result = await seed(database.db, permit);

    expect(result.workspaceId).toBe(SEED_WORKSPACE_ID);
    expect(await database.db.select().from(folders)).toHaveLength(SEED_FOLDERS.length);
    expect(await database.db.select().from(projects)).toHaveLength(SEED_PROJECTS.length);
    expect(await database.db.select().from(songs)).toHaveLength(SEED_SONGS.length);
    expect(await database.db.select().from(users)).toHaveLength(SEED_USERS.length);
    expect(await database.db.select().from(permissionGrants)).toHaveLength(SEED_GRANTS.length);
  }, 60_000);

  it('is idempotent', async () => {
    await seed(database.db, permit);
    const before = (await database.db.select().from(mixVersions)).length;

    await seed(database.db, permit);

    // A seed that duplicates teaches people to reset reflexively, and resetting reflexively is
    // how someone eventually resets the wrong database.
    expect((await database.db.select().from(mixVersions)).length).toBe(before);
    expect(await database.db.select().from(folders)).toHaveLength(SEED_FOLDERS.length);
    expect(await database.db.select().from(storageObjects)).toHaveLength(before);
  }, 60_000);

  it('stacks versions and makes the newest current', async () => {
    await seed(database.db, permit);
    const song = SEED_SONGS.find((candidate) => candidate.versions === 4);
    if (!song) throw new Error('expected a four-version song');

    const songId = deterministicId(`song:${song.key}`);
    const stack = await database.db
      .select()
      .from(mixVersions)
      .where(eq(mixVersions.songId, songId));
    expect(stack).toHaveLength(4);

    const [row] = await database.db.select().from(songs).where(eq(songs.id, songId));
    expect(row?.currentVersionId).toBe(deterministicId(`mix:${song.key}:4`));
  }, 60_000);

  it('leaves a failed job honestly empty', async () => {
    await seed(database.db, permit);
    const song = SEED_SONGS.find((candidate) => candidate.failedJob === true);
    if (!song) throw new Error('expected a failed-job song');

    const [version] = await database.db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.id, deterministicId(`version:${song.key}:${song.versions}`)));

    // We do not know the duration of a file we could not read, and saying so is the point.
    expect(version?.processingState).toBe('failed');
    expect(version?.durationMs).toBeNull();
    expect(version?.processingError).toBeTruthy();
  }, 60_000);

  it('nests the folders, three deep', async () => {
    await seed(database.db, permit);

    // The tree is the point of the seed: a flat list of five folders would render fine and
    // prove nothing about the navigation this data exists to exercise.
    const rows = await database.db.select().from(folders);
    const byId = new Map(rows.map((row) => [row.id, row]));

    const leaf = byId.get(deterministicId('folder:albums-2026-blue'));
    const middle = byId.get(deterministicId('folder:albums-2026'));
    const root = byId.get(deterministicId('folder:albums'));

    expect(root?.depth).toBe(0);
    expect(middle?.depth).toBe(1);
    expect(leaf?.depth).toBe(2);
    // The trigger computes `path` from the parent's, so an ancestor chain that does not
    // contain its ancestors would mean the parents were written wrong.
    expect(leaf?.path).toContain(middle?.id ?? 'no middle folder');
    expect(leaf?.path).toContain(root?.id ?? 'no root folder');
  }, 60_000);

  it('lands the awkward cases in the database, not just in the constants', async () => {
    await seed(database.db, permit);

    // These assertions deliberately read rows rather than `SEED_SONGS`. Asserting the
    // constants proves the constants; the layouts these states break are rendered from the
    // database.
    const songRows = await database.db.select().from(songs);
    expect(Math.max(...songRows.map((row) => row.title.length))).toBeGreaterThan(80);

    const noVersions = SEED_SONGS.find((candidate) => candidate.versions === 0);
    if (!noVersions) throw new Error('expected a song with no versions');
    expect(
      await database.db
        .select()
        .from(mixVersions)
        .where(eq(mixVersions.songId, deterministicId(`song:${noVersions.key}`))),
    ).toEqual([]);

    const uncovered = SEED_PROJECTS.find((candidate) => !candidate.hasCoverArt);
    if (!uncovered) throw new Error('expected a project with no cover art');
    expect(
      await database.db
        .select()
        .from(assets)
        .where(eq(assets.id, deterministicId(`asset:cover:${uncovered.key}`))),
    ).toEqual([]);

    const unfiled = SEED_PROJECTS.find((candidate) => candidate.folderKey === null);
    if (!unfiled) throw new Error('expected an unfiled project');
    const [unfiledRow] = await database.db
      .select()
      .from(projects)
      .where(eq(projects.id, deterministicId(`project:${unfiled.key}`)));
    expect(unfiledRow?.folderId).toBeNull();
  }, 60_000);

  it('describes each version as the file it actually points at', async () => {
    await seed(database.db, permit);

    // The stack alternates the two WAV formats, so a version whose metadata is copied from the
    // wrong fixture — or hard-coded to one of them — would make task `066` assert 16-bit
    // properties against 24-bit bytes.
    const fixtures = generateAllFixtures();
    const song = SEED_SONGS.find((candidate) => candidate.versions === 4);
    if (!song) throw new Error('expected a four-version song');

    for (let number = 1; number <= song.versions; number += 1) {
      const fixture = fixtures[(number - 1) % fixtures.length];
      if (!fixture) throw new Error('expected a fixture');
      if (song.failedJob === true && number === song.versions) continue;

      const [version] = await database.db
        .select()
        .from(assetVersions)
        .where(eq(assetVersions.id, deterministicId(`version:${song.key}:${number}`)));

      expect(version?.sampleRateHz, `version ${number} sample rate`).toBe(fixture.sampleRateHz);
      expect(version?.bitDepth, `version ${number} bit depth`).toBe(fixture.bitDepth);
      expect(version?.channels, `version ${number} channels`).toBe(fixture.channels);
      expect(version?.codec, `version ${number} codec`).toBe(fixture.codec);

      const [object] = await database.db
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, deterministicId(`object:${song.key}:${number}`)));
      expect(object?.sizeBytes, `version ${number} size`).toBe(fixture.sizeBytes);
      expect(object?.checksumSha256, `version ${number} checksum`).toBe(fixture.checksumSha256);
    }
  }, 60_000);

  it('writes each collaborator the membership the seed says they have', async () => {
    await seed(database.db, permit);

    // Read back from `workspace_memberships`, not from `SEED_USERS`. Asserting the constant
    // proves the constant: the seed could write every collaborator as a no-download viewer and
    // a test over the constants would not notice.
    const rows = await database.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, SEED_WORKSPACE_ID));

    const written = rows
      .map((row) => `${row.userId}:${row.role}:${row.canDownload}:${row.canInvite}`)
      .sort();
    const expected = SEED_USERS.map(
      (user) =>
        `${deterministicId(`user:${user.key}`)}:${user.role}:${user.canDownload}:${user.canInvite}`,
    ).sort();

    expect(written).toEqual(expected);
    // Stated independently: all four roles are present in the database, not just in the array.
    expect(new Set(rows.map((row) => row.role))).toEqual(
      new Set(['owner', 'editor', 'commenter', 'viewer']),
    );
  }, 60_000);

  it('writes the deny override as a deny, pointed at the right song', async () => {
    await seed(database.db, permit);

    // CLAUDE.md §9's negative case, read from the row. A deny written as a benign allow would
    // leave the seeded workspace looking correct — every grantee also has a membership
    // underneath, so the answer simply falls through.
    const [deny] = await database.db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.id, deterministicId('grant:tom-denied-on-careless')));

    expect(deny?.isDeny).toBe(true);
    expect(deny?.role).toBeNull();
    expect(deny?.scopeType).toBe('song');
    expect(deny?.scopeId).toBe(deterministicId('song:blue-hour-2'));
    expect(deny?.subjectId).toBe(deterministicId('user:tom'));

    // And every other seeded grant landed with the role and capability it declares.
    for (const grant of SEED_GRANTS.filter((candidate) => candidate.isDeny !== true)) {
      const [row] = await database.db
        .select()
        .from(permissionGrants)
        .where(eq(permissionGrants.id, deterministicId(`grant:${grant.key}`)));

      expect(row?.role, grant.key).toBe(grant.role);
      expect(row?.isDeny, grant.key).toBe(false);
      expect(row?.canDownload, grant.key).toBe(grant.canDownload ?? null);
      expect(row?.scopeId, grant.key).toBe(deterministicId(`${grant.scopeType}:${grant.scopeKey}`));
    }
  }, 60_000);

  it('builds every version the data asks for', async () => {
    await seed(database.db, permit);

    // Against a model-derived total, not against whatever the last run happened to write.
    const expected = SEED_SONGS.reduce((total, song) => total + song.versions, 0);
    expect(await database.db.select().from(mixVersions)).toHaveLength(expected);
    expect(await database.db.select().from(assetVersions)).toHaveLength(expected);
    expect(await database.db.select().from(storageObjects)).toHaveLength(expected);
  }, 60_000);

  it('clears its content on reset, and rebuilds it', async () => {
    await seed(database.db, permit);
    await reset(database.db, permit);

    // Every table the seed writes content into, not a sample of three. A reset that silently
    // stopped deleting one of them would otherwise leave rows behind for the next run to
    // collide with, and nothing would say so.
    for (const [name, table] of [
      ['folders', folders],
      ['projects', projects],
      ['songs', songs],
      ['mixVersions', mixVersions],
      ['assets', assets],
      ['assetVersions', assetVersions],
      ['storageObjects', storageObjects],
      ['permissionGrants', permissionGrants],
      ['favorites', favorites],
    ] as const) {
      expect(await database.db.select().from(table), name).toEqual([]);
    }

    // The workspace and its people survive, and re-seeding rebuilds on top of them.
    expect(await database.db.select().from(workspaces)).toHaveLength(1);
    expect(await database.db.select().from(users)).toHaveLength(SEED_USERS.length);
    expect(await database.db.select().from(workspaceMemberships)).toHaveLength(SEED_USERS.length);

    await seed(database.db, permit);
    expect(await database.db.select().from(songs)).toHaveLength(SEED_SONGS.length);
  }, 60_000);

  it('leaves everything it did not create alone', async () => {
    await seed(database.db, permit);

    // "Clears seeded data without touching anything else" is the task's wording, and it is
    // currently true by construction — every delete is by id. Construction changes. A reset
    // that regressed to a workspace-wide sweep would pass every assertion above and destroy a
    // developer's own work, so the claim gets its own test.
    const foreign = await makeTenant(database.db);
    const foreignFolder = await makeFolder(database.db, foreign.workspace.id, 'Not mine');
    const handMade = await makeFolder(
      database.db,
      SEED_WORKSPACE_ID,
      'Hand-made, inside the seeded workspace',
    );

    await reset(database.db, permit);

    const surviving = await database.db.select().from(folders);
    expect(surviving.map((row) => row.id).sort()).toEqual([foreignFolder.id, handMade.id].sort());
    expect(await database.db.select().from(workspaces)).toHaveLength(2);
  }, 60_000);
});
