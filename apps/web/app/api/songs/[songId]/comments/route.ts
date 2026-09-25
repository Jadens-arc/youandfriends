import { createThreadSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { createThread, listThreads } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/**
 * `/api/songs/:songId/comments` (task `090`): `GET` the song's threads with their comments;
 * `POST` a new thread with its first comment (commenters and above).
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    return json(await listThreads(libraryContext(await requireWorkspace()), songId));
  });
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createThreadSchema);
    const songId = parsePathId((await params).songId);
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    return json(await createThread(context, songId, body), 201);
  });
}
