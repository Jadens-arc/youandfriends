import { createCheckpointSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { createCheckpoint, listRevisions } from '@/lib/lyrics/revisions';

/**
 * `/api/songs/:songId/lyrics/revisions` (task `084`): `GET` the song's revisions, newest first;
 * `POST` a named checkpoint of the lyrics as they stand. Viewing is `view`; checkpointing `edit`.
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    const context = libraryContext(await requireWorkspace());
    return json({ revisions: await listRevisions(context, songId) });
  });
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createCheckpointSchema);
    const songId = parsePathId((await params).songId);
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    return json(await createCheckpoint(context, songId, body), 201);
  });
}
