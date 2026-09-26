import { reactSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { react } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/**
 * `POST /api/songs/:songId/comments/:threadId/comments/:commentId/reactions` (task `094`):
 * `{ reaction, on }` — react, or take it back. Idempotent either way.
 */
type Params = { params: Promise<{ songId: string; threadId: string; commentId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, reactSchema);
    const { songId, threadId, commentId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    await react(context, parsePathId(songId), parsePathId(threadId), parsePathId(commentId), body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
