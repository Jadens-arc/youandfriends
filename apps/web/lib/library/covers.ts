import { coverWidthOf } from '@youandfriends/contracts';
import { listCoverRenditions } from '@youandfriends/db';

import type { LibraryContext } from './context';

/**
 * Cover art for cards and headers (task `069`).
 *
 * One query for every project on the page (`listCoverRenditions`), then one presigned URL per
 * rendition — signing is local arithmetic, not a round trip. The URLs are bearer credentials:
 * short-lived, handed to the page in this render and nowhere else, never logged or stored
 * (CLAUDE.md §9).
 *
 * **Only for projects the caller has already filtered to what this viewer can see.** Nothing here
 * decides visibility; a cover for a project the viewer cannot open must never be asked for.
 */

export interface CoverSource {
  /** The smallest rendition, for browsers that ignore `srcSet`. */
  readonly src: string;
  /** Width-described renditions: `…128w, …256w, …512w`. */
  readonly srcSet: string;
}

/** Signs a read of one rendition. `lib/library/context.ts` builds it from the derivatives bucket. */
export type CoverSigner = (key: string, contentType: string) => Promise<string>;

export async function resolveCovers(
  context: LibraryContext,
  visibleProjectIds: readonly string[],
): Promise<ReadonlyMap<string, CoverSource>> {
  const sign = context.coverSigner;
  // No derivatives bucket configured: every card keeps its placeholder, which is the truth.
  if (sign === undefined || visibleProjectIds.length === 0) return new Map();

  const rows = await listCoverRenditions(context.db, context.workspaceId, visibleProjectIds);
  const byProject = new Map<string, { width: number; url: string }[]>();
  for (const row of rows) {
    const width = coverWidthOf(row.variant);
    if (width === null) continue;
    const url = await sign(row.key, row.contentType);
    const list = byProject.get(row.projectId) ?? [];
    list.push({ width, url });
    byProject.set(row.projectId, list);
  }

  const covers = new Map<string, CoverSource>();
  for (const [projectId, renditions] of byProject) {
    renditions.sort((a, b) => a.width - b.width);
    const [smallest] = renditions;
    if (smallest === undefined) continue;
    covers.set(projectId, {
      src: smallest.url,
      srcSet: renditions.map(({ url, width }) => `${url} ${width}w`).join(', '),
    });
  }
  return covers;
}
