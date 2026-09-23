import { recordVersionSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { versionContextFor } from '@/lib/versions/http';
import { recordMixVersion } from '@/lib/versions/service';

/**
 * `POST /api/songs/:songId/versions` — record a finished upload as the song's newest mix
 * (task `056`). Idempotent: a replay answers `200` with the version the first call made.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ songId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, recordVersionSchema);
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    const version = await recordMixVersion(versionContextFor(context, correlationId), songId, body);
    return json(
      {
        versionId: version.mixVersionId,
        number: version.mixVersionNumber,
        created: version.created,
      },
      version.created ? 201 : 200,
    );
  });
}
