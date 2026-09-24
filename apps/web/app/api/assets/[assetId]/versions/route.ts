import { recordAssetVersionSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { recordAssetVersion } from '@/lib/assets/service';
import { versionContextFor } from '@/lib/versions/http';

/**
 * `POST /api/assets/:assetId/versions` — a finished upload becomes the asset's newest version
 * (task `055`). Idempotent, through `recordUploadedVersion`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, recordAssetVersionSchema);
    const assetId = parsePathId((await params).assetId);
    const context = await requireWorkspace();
    const version = await recordAssetVersion(
      versionContextFor(context, correlationId),
      assetId,
      body.sessionId,
    );
    return json(
      { versionNumber: version.versionNumber, created: version.created },
      version.created ? 201 : 200,
    );
  });
}
