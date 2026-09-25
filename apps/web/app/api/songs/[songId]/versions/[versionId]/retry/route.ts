import { handleJson, parsePathId, requireWorkspace } from '@/lib/api/http';
import { versionContextFor } from '@/lib/versions/http';
import { retryProcessing } from '@/lib/versions/processing';

/**
 * `POST /api/songs/:songId/versions/:versionId/retry` — process a failed version again (task
 * `065`). Editors only, audited; anyone else gets the same 404 as a version that is not there.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ songId: string; versionId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const { songId: rawSong, versionId: rawVersion } = await params;
    const songId = parsePathId(rawSong);
    const versionId = parsePathId(rawVersion);
    const context = await requireWorkspace();
    await retryProcessing(versionContextFor(context, correlationId), songId, versionId);
    return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
  });
}
