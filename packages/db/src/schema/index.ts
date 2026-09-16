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

import { favorites } from './favorites';
import { folders } from './folders';
import { permissionGrants } from './permissions';
import { projects } from './projects';
import { songs } from './songs';
import { users } from './users';
import { workspaceMemberships, workspaces } from './workspaces';

export * from './columns';
export * from './favorites';
export * from './folders';
export * from './permissions';
export * from './projects';
export * from './songs';
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
  users,
  workspaces,
  workspaceMemberships,
  folders,
  projects,
  permissionGrants,
  songs,
  favorites,
};

export type Schema = typeof schema;
