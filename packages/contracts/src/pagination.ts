/**
 * Pagination.
 *
 * Cursor-based rather than offset-based: a library grows while you page through it, and
 * offsets silently skip or repeat rows when that happens. The cursor is opaque to the client
 * so its encoding can change without breaking callers.
 */

import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const paginationRequestSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationRequest = z.infer<typeof paginationRequestSchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const sortDirectionSchema = z.enum(SORT_DIRECTIONS);
export type SortDirection = z.infer<typeof sortDirectionSchema>;
