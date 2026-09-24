import { saveLyricsSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { readLyrics, saveLyrics } from '@/lib/lyrics/service';

/**
 * `/api/songs/:songId/lyrics` (task `080`): `GET` the canonical document and its version; `PUT` a
 * save against the version it started from. A stale version answers `409` — the editor shows a
 * conflict and never overwrites. Both are authorized every time.
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    return json(await readLyrics(libraryContext(context), songId), 200);
  });
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, saveLyricsSchema);
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    const saved = await saveLyrics({ ...libraryContext(context), correlationId }, songId, body);
    return json(saved, 200);
  });
}
