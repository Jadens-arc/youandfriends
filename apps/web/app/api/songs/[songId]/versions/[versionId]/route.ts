import { versionNoteSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { versionContextFor } from '@/lib/versions/http';
import { updateVersionNote } from '@/lib/versions/service';

/** `PATCH /api/songs/:songId/versions/:versionId` — edit a version's note (task `056`). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ songId: string; versionId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, versionNoteSchema);
    const { songId, versionId } = await params;
    const context = await requireWorkspace();
    await updateVersionNote(
      versionContextFor(context, correlationId),
      parsePathId(songId),
      parsePathId(versionId),
      body,
    );
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
