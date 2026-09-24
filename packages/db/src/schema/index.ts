/**
 * The database schema.
 *
 * Tenancy is structural here, not a convention. Every tenant-owned table carries
 * `workspace_id` as a not-null column and leads its composite indexes with it, because every
 * query in the product is scoped to a workspace and a tenant column that is not first in the
 * index is a tenant column the planner ignores.
 *
 * {@link NON_TENANT_TABLES} is the allow-list, and the schema test inverts it: any table in
 * the database that is not named there must have `workspace_id` and an index leading with it.
 * Adding a tenant-owned table and forgetting the column fails the build rather than leaking
 * across a tenant boundary the first time someone writes a query (`docs/THREAT_MODEL.md` T1).
 */

import { assets } from './assets';
import { auditEvents } from './audit';
import { derivatives, assetVersions, mixVersions } from './versions';
import { favorites } from './favorites';
import { mediaJobs } from './media-jobs';
import { snapshotEntries, snapshots } from './snapshots';
import { storageObjects } from './storage-objects';
import { uploadParts, uploadSessions } from './uploads';
import { folders } from './folders';
import { invitations } from './invitations';
import { permissionGrants } from './permissions';
import { projects } from './projects';
import { recents } from './recents';
import { songs } from './songs';
import { users } from './users';
import { workspaceMemberships, workspaces } from './workspaces';

export * from './assets';
export * from './uploads';
export * from './audit';
export * from './columns';
export * from './favorites';
export * from './folders';
export * from './invitations';
export * from './media-jobs';
export * from './permissions';
export * from './projects';
export * from './recents';
export * from './snapshots';
export * from './songs';
export * from './storage-objects';
export * from './versions';
export * from './users';
export * from './workspaces';

/**
 * Tables that legitimately have no `workspace_id`, and why.
 *
 * Each entry is a claim that has to be argued, not a place to silence the schema test. A
 * table belongs here only if it cannot belong to one tenant.
 */
export const NON_TENANT_TABLES: Readonly<Record<string, string>> = {
  // A person exists across workspaces; `workspace_memberships` is what ties them to one.
  users: 'a user spans workspaces',
  // The workspace is the tenant. It cannot contain itself.
  workspaces: 'the workspace is the tenancy',
  // Drizzle's own bookkeeping, in its own schema.
  __drizzle_migrations: "the migrator's ledger",
};

export const schema = {
  uploadSessions,
  uploadParts,
  auditEvents,
  storageObjects,
  assets,
  assetVersions,
  mixVersions,
  derivatives,
  mediaJobs,
  snapshots,
  snapshotEntries,
  users,
  workspaces,
  workspaceMemberships,
  folders,
  projects,
  permissionGrants,
  invitations,
  songs,
  favorites,
  recents,
};

export type Schema = typeof schema;
