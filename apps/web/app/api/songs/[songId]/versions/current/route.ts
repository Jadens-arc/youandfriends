import { setCurrentVersionSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { versionContextFor } from '@/lib/versions/http';
import { setCurrentVersion } from '@/lib/versions/service';

/** `POST /api/songs/:songId/versions/current` — choose the current version (task `056`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ songId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, setCurrentVersionSchema);
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    await setCurrentVersion(versionContextFor(context, correlationId), songId, body.versionId);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
