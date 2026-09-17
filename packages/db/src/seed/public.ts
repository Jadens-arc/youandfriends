/**
 * The seed's public surface.
 *
 * Exported so `packages/authz` can assert what the seeded grants actually *resolve* to — the
 * seed claims to make permission behaviour visible, and that claim is only worth something if
 * something checks it. The dependency runs authz → db, which is the direction the graph already
 * goes; db never imports authz.
 *
 * `seed` and `reset` require a {@link SeedPermit}, which only {@link assertSeedAllowed} can
 * produce, so widening this surface does not widen what can be written to. That is the whole
 * reason the permit exists rather than relying on which symbols happen to be exported.
 */

export { seed, reset, type SeedResult } from './index';
export {
  assertSeedAllowed,
  targetHost,
  SeedRefusedError,
  SEED_ALLOW_HOST_VAR,
  SEED_ALLOWED_ENVIRONMENTS,
  SEED_LOCAL_HOSTS,
  type SeedEnvironment,
  type SeedPermit,
} from './guard';
export { deterministicId } from './ids';
export {
  SEED_FOLDERS,
  SEED_GRANTS,
  SEED_PROJECTS,
  SEED_SONGS,
  SEED_USERS,
  SEED_WORKSPACE_ID,
  type SeedFolder,
  type SeedGrant,
  type SeedProject,
  type SeedSong,
  type SeedUser,
} from './data';
export {
  generateAllFixtures,
  generateFixture,
  generateWav,
  encoderAvailable,
  ENCODED_FORMATS,
  MAX_COMMITTED_FIXTURE_BYTES,
  WAV_FORMATS,
  type GeneratedFixture,
  type WavFormat,
} from './fixtures/audio';
