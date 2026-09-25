import { WAVEFORM_CONTENT_TYPE } from '@youandfriends/contracts';
import { StorageNotConfiguredError } from '@youandfriends/storage';

import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { derivativesDriver } from '@/lib/media/derivatives';
import { peaksFor } from '@/lib/player/stream-grant';

/**
 * `GET /api/versions/:versionId/waveform` — the version's peaks (task `072`), authorized as
 * `view` on its song on every request. `private`: the shape and length of unreleased music is
 * cached by this browser only, briefly, never by a shared cache.
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
      const bytes = await peaksFor({ ...libraryContext(context), derivativesDriver }, versionId);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'content-type': WAVEFORM_CONTENT_TYPE,
          'cache-control': 'private, max-age=300',
          'x-content-type-options': 'nosniff',
        },
      });
    },
    (error, correlationId) =>
      error instanceof StorageNotConfiguredError
        ? json(
            {
              code: 'unavailable',
              message: 'Waveforms are not available right now.',
              correlationId,
            },
            503,
          )
        : null,
  );
}
