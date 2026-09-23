/**
 * Test utilities, exported as `@youandfriends/db/testing`.
 *
 * `authz` and every later package that touches data needs the same thing this package needs:
 * a real, isolated Postgres database with the real migrations applied. Re-implementing that
 * per package is how two harnesses end up disagreeing about what "migrated" means.
 *
 * Nothing here is imported by production code, and the subpath keeps it out of the main
 * entry point so it cannot be reached by accident.
 */

export {
  addMember,
  databaseError,
  makeAsset,
  makeAuditEvent,
  makeFavorite,
  makeAssetVersion,
  makeSnapshot,
  makeMixVersion,
  makeStorageObject,
  expectDatabaseError,
  makeFolder,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  makeWorkspace,
  readFolder,
  SQLSTATE,
  setUpdatedAt,
  testId,
} from './factories';
export { createTestDatabase, unavailableReason, type TestDatabase } from './harness';
