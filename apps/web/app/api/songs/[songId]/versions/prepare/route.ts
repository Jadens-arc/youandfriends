import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { mapUploadError } from '@/lib/uploads/http';
import { versionContextFor } from '@/lib/versions/http';
import { prepareMixUpload } from '@/lib/versions/service';

/**
 * `POST /api/songs/:songId/versions/prepare` — the asset a new mix is uploaded into (task `056`).
 * The browser opens its upload session against the id this returns.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ songId: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      const songId = parsePathId((await params).songId);
      const context = await requireWorkspace();
      return json(await prepareMixUpload(versionContextFor(context, correlationId), songId));
    },
    mapUploadError,
  );
}
