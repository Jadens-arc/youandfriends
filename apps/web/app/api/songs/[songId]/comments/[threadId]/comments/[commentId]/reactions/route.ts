import { reactionSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { setReaction } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/**
 * `PUT /api/songs/:songId/comments/:threadId/comments/:commentId/reactions` (task `094`): add or
 * take back this person's reaction. Idempotent both ways.
 */
type Params = { params: Promise<{ songId: string; threadId: string; commentId: string }> };

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, reactionSchema);
    const { songId, threadId, commentId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    await setReaction(
      context,
      parsePathId(songId),
      parsePathId(threadId),
      parsePathId(commentId),
      body,
    );
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
