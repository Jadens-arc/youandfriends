import { updateSongSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { updateSong } from '@/lib/library/metadata';

/** `PATCH /api/songs/:songId` — title, artist, status, notes (task `043`). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ songId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, updateSongSchema);
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    await updateSong({ ...libraryContext(context), correlationId }, songId, body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
