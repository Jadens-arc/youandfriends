import { editCommentSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { deleteComment, editComment } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/**
 * `/api/songs/:songId/comments/:threadId/comments/:commentId` (task `090`): `PATCH` to edit (the
 * author), `DELETE` to erase the words and leave a tombstone (the author, or an editor).
 */
type Params = { params: Promise<{ songId: string; threadId: string; commentId: string }> };

const noContent = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, editCommentSchema);
    const { songId, threadId, commentId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    await editComment(
      context,
      parsePathId(songId),
      parsePathId(threadId),
      parsePathId(commentId),
      body,
    );
    return noContent();
  });
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const { songId, threadId, commentId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    await deleteComment(
      context,
      parsePathId(songId),
      parsePathId(threadId),
      parsePathId(commentId),
    );
    return noContent();
  });
}
