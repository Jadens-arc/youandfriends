import { ROLES, WORK_STATUSES, FAVORITE_TARGETS } from '@youandfriends/contracts';
import { sql } from 'drizzle-orm';
import { pgEnum, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Column shapes shared by every table, so tenancy and identity cannot be spelled two ways.
 *
 * Enums are declared from the contract arrays rather than retyped. `packages/contracts` is
 * the single vocabulary the database, the API, and the UI all read; a hand-copied list here
 * would drift, and the drift would only show up as a constraint violation in production.
 */

/** ULIDs are 26 Crockford base-32 characters. Fixed width, lexicographically sortable. */
export const ULID_LENGTH = 26;

export const id = () => varchar('id', { length: ULID_LENGTH }).primaryKey();

/** A reference to another entity's ULID. */
export const reference = (name: string) => varchar(name, { length: ULID_LENGTH });

/**
 * The tenant column. Every tenant-owned table has one, and a schema test fails the build if
 * one appears without it (`docs/THREAT_MODEL.md` T1) — a tenant-owned table without
 * `workspace_id` is a cross-tenant leak waiting for its first query.
 */
export const workspaceId = () => reference('workspace_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * `updated_at` defaults to now and is maintained by a trigger, not by application code.
 * A row updated through `psql` during an incident should still get an honest timestamp.
 */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ROLES);
export const workStatusEnum = pgEnum('work_status', WORK_STATUSES);
export const favoriteTargetEnum = pgEnum('favorite_target', FAVORITE_TARGETS);

/** Marker for `defaultNow()` in raw SQL contexts. */
export const now = sql`now()`;
