import { join } from 'node:path';

import {
  COVER_RENDITION_TYPE,
  COVER_RENDITION_WIDTHS,
  coverVariant,
} from '@youandfriends/contracts';
import { assetVersions, mediaJobs } from '@youandfriends/db';
import {
  ArtworkRejectedError,
  probeArtwork,
  renderCoverRendition,
  type AudioJobInput,
  type TempWorkspace,
} from '@youandfriends/media';
import { and, eq, sql } from 'drizzle-orm';

import {
  produceDerivative,
  recordRejection,
  type PipelineDeps,
  type PipelineOutcome,
} from './pipeline';

/**
 * The artwork branch of the job (task `069`): check what the image is and how big it claims to
 * be, then render a square JPEG at each width in `COVER_RENDITION_WIDTHS` as a `thumbnail`
 * derivative named `cover-<width>`. Same idempotency as audio — each rendition's row names its
 * object, and a recorded one is skipped on retry — and the same scratch space, removed on every
 * exit by the caller.
 *
 * An image that is not one, or that declares more pixels than the ceiling, is *rejected* with a
 * sentence the uploader can read (`not_image`, `image_too_large`), not retried.
 */
export async function produceCoverRenditions(
  deps: PipelineDeps,
  input: AudioJobInput,
  scratch: TempWorkspace,
  original: string,
  remaining: () => number,
): Promise<PipelineOutcome> {
  try {
    await probeArtwork(original, { timeoutMs: remaining() });
  } catch (error) {
    if (!(error instanceof ArtworkRejectedError)) throw error;
    await recordRejection(deps.db, input, error.kind, error.message);
    return { status: 'rejected', reason: error.message };
  }

  for (const width of COVER_RENDITION_WIDTHS) {
    await produceDerivative(deps, input, 'thumbnail', coverVariant(width), {
      contentType: COVER_RENDITION_TYPE,
      make: async () => {
        const output = join(scratch.dir, `${coverVariant(width)}.jpg`);
        await renderCoverRendition(original, output, width, { timeoutMs: remaining() });
        await scratch.assertWithinBudget();
        return output;
      },
      uploaded: async () => undefined,
    });
  }

  remaining();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(assetVersions)
      .set({ processingState: 'complete', processingError: null })
      .where(
        and(
          eq(assetVersions.id, input.assetVersionId),
          eq(assetVersions.workspaceId, input.workspaceId),
        ),
      );
    await tx
      .update(mediaJobs)
      .set({ state: 'complete', lastError: null, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(mediaJobs.workspaceId, input.workspaceId),
          eq(mediaJobs.assetVersionId, input.assetVersionId),
        ),
      );
  });
  return { status: 'complete' };
}
