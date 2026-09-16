/**
 * Every tenant-owned resource class, and how to build an IDOR case for it.
 *
 * The registry exists so that adding a resource class without its cross-workspace test is a
 * **build failure rather than an omission nobody notices**. `idor.test.ts` reads the live
 * database and fails if a tenant-owned table is missing from this list, so the cheap path —
 * ship the table, write the test later — is closed.
 *
 * Classes whose tables do not exist yet are listed as `pending` with the task that creates
 * them. That is not a placeholder to be quietly deleted: the completeness check asserts a
 * pending class really has no table, so the entry has to be converted rather than removed
 * when the table lands.
 */

import {
  favorites,
  folders,
  permissionGrants,
  projects,
  songs,
  workspaceMemberships,
} from '@youandfriends/db';
import type { ScopedTable } from '../scoped-query';

/** A resource class with a table today. */
export interface LiveResource {
  readonly status: 'live';
  readonly name: string;
  readonly table: ScopedTable;
  /** The authz scope this class is reached through, or `null` if it is not directly targetable. */
  readonly scopeType: 'folder' | 'project' | 'song' | null;
  readonly why: string;
}

/** A resource class whose table arrives in a later task. */
export interface PendingResource {
  readonly status: 'pending';
  readonly name: string;
  /** The table name it will create. The completeness check asserts it does not exist yet. */
  readonly tableName: string;
  readonly task: string;
  readonly why: string;
}

export type SensitiveResource = LiveResource | PendingResource;

/**
 * The classes named in task `023`, plus every tenant-owned table that already exists.
 *
 * `docs/ARCHITECTURE.md` §4 is the source for what is coming; the completeness check is the
 * source for what is here.
 */
export const SENSITIVE_RESOURCES: readonly SensitiveResource[] = [
  {
    status: 'live',
    name: 'folders',
    table: folders,
    scopeType: 'folder',
    why: 'The organizational spine. A leaked folder id leaks the shape of someone’s work.',
  },
  {
    status: 'live',
    name: 'projects',
    table: projects,
    scopeType: 'project',
    why: 'Unreleased work, by name and artist.',
  },
  {
    status: 'live',
    name: 'songs',
    table: songs,
    scopeType: 'song',
    why: 'The asset the whole product exists to protect.',
  },
  {
    status: 'live',
    name: 'favorites',
    table: favorites,
    scopeType: null,
    why: 'Reveals what someone is working on, and which collaborators they return to.',
  },
  {
    status: 'live',
    name: 'workspace_memberships',
    table: workspaceMemberships,
    scopeType: null,
    why: 'The membership list is the collaborator list. Enumerating it is reconnaissance.',
  },
  {
    status: 'live',
    name: 'permission_grants',
    table: permissionGrants,
    scopeType: null,
    why: 'Reading the grants tells an attacker exactly where the soft edges are.',
  },

  // Not yet created. Each is converted to `live` by the task that builds its table; the
  // completeness check below fails if one of these quietly appears without being converted.
  {
    status: 'pending',
    name: 'assets',
    tableName: 'assets',
    task: '026',
    why: 'Files: stems, project files, artwork.',
  },
  {
    status: 'pending',
    name: 'asset_versions',
    tableName: 'asset_versions',
    task: '026',
    why: 'Immutable uploaded bytes. Originals are sacred.',
  },
  {
    status: 'pending',
    name: 'mix_versions',
    tableName: 'mix_versions',
    task: '026',
    why: 'The version stack behind every song.',
  },
  {
    status: 'pending',
    name: 'storage_objects',
    tableName: 'storage_objects',
    task: '026',
    why: 'Bucket keys. A leaked key is a leaked file for the life of a presigned URL.',
  },
  {
    status: 'pending',
    name: 'lyrics_documents',
    tableName: 'lyrics_documents',
    task: '081',
    why: 'Unpublished words, which are as sensitive as unreleased audio.',
  },
  {
    status: 'pending',
    name: 'lyrics_revisions',
    tableName: 'lyrics_revisions',
    task: '083',
    why: 'Every earlier draft of the same.',
  },
  {
    status: 'pending',
    name: 'comment_threads',
    tableName: 'comment_threads',
    task: '090',
    why: 'Private discussion between collaborators.',
  },
  {
    status: 'pending',
    name: 'comments',
    tableName: 'comments',
    task: '090',
    why: 'The same, at message granularity.',
  },
  {
    status: 'pending',
    name: 'notifications',
    tableName: 'notifications',
    task: '095',
    why: 'Reveals activity, timing, and who is working with whom.',
  },
  {
    status: 'pending',
    name: 'audit_events',
    tableName: 'audit_events',
    task: '024',
    why: 'The record of who did what. Reading another tenant’s is a complete activity log.',
  },
  {
    status: 'pending',
    name: 'upload_sessions',
    tableName: 'upload_sessions',
    task: '053',
    why: 'An in-flight session is a writable handle to storage.',
  },
  {
    status: 'pending',
    name: 'share_links',
    tableName: 'share_links',
    task: '200',
    why: 'A share link is a bearer credential. Enumerating them is total compromise.',
  },
  {
    status: 'pending',
    name: 'sync_tokens',
    tableName: 'sync_tokens',
    task: '110',
    why: 'A sync token authorizes a Mac agent. Same.',
  },
];

export const liveResources = SENSITIVE_RESOURCES.filter(
  (resource): resource is LiveResource => resource.status === 'live',
);

export const pendingResources = SENSITIVE_RESOURCES.filter(
  (resource): resource is PendingResource => resource.status === 'pending',
);

/** Tables that are not tenant-owned, and so cannot have a cross-workspace case. */
export const NON_TENANT_TABLES = ['users', 'workspaces', '__drizzle_migrations'] as const;
