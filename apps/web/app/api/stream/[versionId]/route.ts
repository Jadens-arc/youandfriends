import { StorageNotConfiguredError } from '@youandfriends/storage';

import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { derivativesDriver } from '@/lib/media/derivatives';
import { streamUrlFor } from '@/lib/player/stream-grant';

/**
 * `GET /api/stream/:versionId` — a short-lived URL to stream one mix version (task `070`).
 * `no-store`: the response is a bearer credential and must not sit in any cache.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async () => {
      const versionId = parsePathId((await params).versionId);
      const context = await requireWorkspace();
      const grant = await streamUrlFor(
        { ...libraryContext(context), derivativesDriver },
        versionId,
      );
      return json(grant, 200);
    },
    (error, correlationId) =>
      error instanceof StorageNotConfiguredError
        ? json(
            {
              code: 'unavailable',
              message: 'Streaming is not available right now.',
              correlationId,
            },
            503,
          )
        : null,
  );
}
