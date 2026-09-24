import { loopRegionSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { clearLoop, readLoop, saveLoop } from '@/lib/player/loop-store';

/**
 * `/api/songs/:songId/loop` — the signed-in person's loop region on a song (task `074`):
 * `GET` it, `PUT` a new one, `DELETE` it. Never anyone else's.
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    return json({ region: await readLoop(libraryContext(context), songId) }, 200);
  });
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const body = await parseBody(request, loopRegionSchema);
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    await saveLoop(libraryContext(context), songId, body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    await clearLoop(libraryContext(context), songId);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
