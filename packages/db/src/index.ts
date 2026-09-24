/**
 * `@youandfriends/db`
 *
 * Drizzle schema, migrations, and the typed Neon client. The durable record.
 *
 * The one thing to know before using this package: there are two connection modes and they
 * are not interchangeable. Route handlers take the pooled (HTTP) client; migrations, jobs,
 * and anything transactional take the direct (TCP) one. `withTransaction` accepts only the
 * direct client, so the mistake is a type error rather than a half-applied write. See
 * `client.ts`.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/db' as const;

export {
  createDirectClient,
  createPooledClient,
  type Database,
  type DirectConnection,
  type DirectDatabase,
  type PooledDatabase,
} from './client';
export { dryRunMigrations, type DryRunOutcome } from './dry-run';
export { MIGRATIONS_FOLDER, pendingFiles, runMigrations, type MigrateResult } from './migrate';
export {
  createScratchDatabase,
  databaseOf,
  scratchName,
  withDatabase,
  type ScratchDatabase,
} from './scratch';
/**
 * The tables themselves, so callers name `songs` rather than `schema.songs`. `authz` builds
 * queries against these directly; everything else reaches them through a scoped handle.
 */
export * from './schema/index';
export {
  describePlan,
  executePurge,
  planPurge,
  type ObjectReaper,
  type PurgeCandidate,
  type PurgeOptions,
  type PurgePlan,
  type PurgeRefusal,
  type PurgeResult,
} from './purge';
export {
  describeSweepPlan,
  executeUploadSweep,
  planUploadSweep,
  type ExpiredSession,
  type MultipartAborter,
  type SweepOptions,
  type SweepPlan,
  type SweepResult,
} from './ops/uploads-sweep';
export {
  deleteAsset,
  deleteFolder,
  deleteProject,
  deleteSong,
  excludeDeleted,
  hasSoftDelete,
  purgeAfterFrom,
  restoreBatch,
  RestoreBlockedError,
  type CascadeResult,
  type SoftDeleteOptions,
} from './soft-delete';
export { TransactionError, withTransaction, type Transaction } from './transaction';
export {
  countOwners,
  lockWorkspaceForMembershipWrite,
  membershipRoleOf,
  ensureScopeLimitedMembership,
  markStorageUsageStale,
  membersOf,
  membershipsOf,
  provisionWorkspace,
  refreshStorageUsage,
  removeMembership,
  renameWorkspace,
  storageUsage,
  updateMembershipRole,
  workspaceName,
  STORAGE_USAGE_TTL_MS,
  type MembershipSummary,
  type ProvisionedWorkspace,
  type ProvisionWorkspaceInput,
  type StorageUsage,
  type WorkspaceMember,
} from './queries/workspace';
export {
  createFolder,
  getFolder,
  listWorkspaceFolders,
  moveFolder,
  renameFolder,
  type CreateFolderInput,
  type FolderRow,
  type FolderWriteResult,
} from './queries/folders';
export {
  listContentActivityPage,
  listFavoritesOf,
  listRecentSongsPage,
  listSongsByIds,
  listWorkspaceProjects,
  CONTENT_ACTIVITY_ACTIONS,
  type ActivityRow,
  type ContentActivityAction,
  type FavoriteRow,
  type FavoriteTargetType,
  type ProjectListRow,
  type RecencyCursor,
  type RecencyPage,
  type SongListRow,
} from './queries/projects';
export {
  listRecents,
  recordRecent,
  RECENT_DEBOUNCE_SECONDS,
  RECENTS_CAP,
  setFavorite,
  type RecentRow,
} from './queries/personal';
export {
  ensureMediaJob,
  listRetryableMediaJobs,
  loadMediaJobSource,
  recordMediaJobDispatched,
  recordMediaJobDispatchFailed,
  resetMediaJobForRetry,
  type MediaJobRow,
  type MediaJobSource,
  type RetryCandidateOptions,
} from './queries/media-jobs';
export {
  getLiveAsset,
  listProjectAssets,
  workspaceTags,
  type AssetOwnerRow,
  type ProjectAssetRow,
} from './queries/assets';
export {
  favoritedTargets,
  getProjectHeader,
  getSongHeader,
  listMixVersions,
  listVersionProcessingStates,
  listProjectSongs,
  listSongFiles,
  listWorkspaceSongs,
  type MixVersionRow,
  type ProjectHeaderRow,
  type ProjectSongRow,
  type SongFileRow,
  type SongHeaderRow,
  type WorkspaceSongRow,
} from './queries/songs';
export {
  acceptInvitation,
  createInvitation,
  findInvitationById,
  listPendingInvitations,
  revokeInvitation,
  type CreateInvitationInput,
  type InvitationRow,
} from './queries/invitations';
export {
  deleteAllGrantsForMember,
  deleteGrant,
  findGrant,
  grantCountsByMember,
  grantsForMember,
  upsertGrant,
  type GrantRow,
  type UpsertGrantInput,
  type UpsertGrantResult,
} from './queries/permissions';
