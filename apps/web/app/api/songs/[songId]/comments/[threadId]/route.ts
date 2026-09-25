import { resolveThreadSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { setResolved } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/** `PATCH /api/songs/:songId/comments/:threadId` — resolve or reopen a thread (task `090`). */
type Params = { params: Promise<{ songId: string; threadId: string }> };

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, resolveThreadSchema);
    const { songId, threadId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    await setResolved(context, parsePathId(songId), parsePathId(threadId), body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
