/**
 * Where a piece of work has got to.
 *
 * One vocabulary for both projects and songs. `docs/DESIGN.md` §2 says each carries a status
 * but does not fix the values; two overlapping vocabularies would be a product decision made
 * by inference, and a shared one is the smaller, reversible default. Adding a project-only
 * value later is an additive migration.
 *
 * The order is the order work moves in, and the UI relies on it for sorting. `archived` is
 * deliberately last and deliberately not a deletion — trashing is a separate concern
 * (task `025`).
 */

import { z } from 'zod';

export const WORK_STATUSES = [
  'idea',
  'in_progress',
  'mixing',
  'mastering',
  'done',
  'archived',
] as const;

export const workStatusSchema = z.enum(WORK_STATUSES);
export type WorkStatus = z.infer<typeof workStatusSchema>;

/** What a new project or song starts as. */
export const DEFAULT_WORK_STATUS: WorkStatus = 'idea';

/** What a favourite can point at. Folders included: a folder is a place you return to. */
export const FAVORITE_TARGETS = ['folder', 'project', 'song'] as const;
export const favoriteTargetSchema = z.enum(FAVORITE_TARGETS);
export type FavoriteTarget = z.infer<typeof favoriteTargetSchema>;
