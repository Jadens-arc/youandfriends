import { replySchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { reply } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/** `POST /api/songs/:songId/comments/:threadId/replies` — reply within a thread (task `090`). */
type Params = { params: Promise<{ songId: string; threadId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, replySchema);
    const { songId, threadId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    return json(await reply(context, parsePathId(songId), parsePathId(threadId), body), 201);
  });
}
