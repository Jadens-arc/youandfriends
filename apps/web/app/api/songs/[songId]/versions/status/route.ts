import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { versionContextFor } from '@/lib/versions/http';
import { readProcessingStates } from '@/lib/versions/processing';

/**
 * `GET /api/songs/:songId/versions/status` — each version's processing state, polled by the song
 * page while anything is still queued or processing (task `065`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ songId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    const versions = await readProcessingStates(versionContextFor(context, correlationId), songId);
    return json({ versions }, 200);
  });
}
